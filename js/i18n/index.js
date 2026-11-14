/*
 * Sistema de traducción (sección 13).
 *
 * Reglas que implementa este módulo:
 *  - I-3/I-11: los textos viven en `data/locales/<lang>.json` con claves planas
 *    separadas por puntos (`hud.power.label`). El código nunca escribe texto visible.
 *  - I-5: interpolación con marcadores nombrados `{name}`, nunca concatenación.
 *  - I-6: variantes de plural (categorías CLDR) y de género, anidables.
 *  - I-7: números, fechas y duraciones con `Intl` según el idioma activo.
 *  - I-8: detección `preferencia -> navegador -> inglés` sin tocar el DOM.
 *  - I-12: si falta una clave en el idioma activo se usa el inglés y se avisa por
 *    consola; si falta en ambos se devuelve un guion, jamás la clave cruda.
 */
(function (global, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./format.js'));
  } else {
    var GS = (global.GS = global.GS || {});
    GS.i18n = factory(GS.i18n && GS.i18n.format);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (format) {
  'use strict';

  var SUPPORTED = ['en', 'es'];
  var FALLBACK_LOCALE = 'en';

  // Marcador neutro cuando una clave no existe en ninguno de los dos idiomas.
  // Un guion es preferible a una clave cruda en pantalla (I-12).
  var MISSING_TEXT = '\u2014';

  var PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'];
  var GENDER_KEYS = ['neutral', 'male', 'female'];
  var GENDER_ALIASES = { n: 'neutral', m: 'male', f: 'female', neutral: 'neutral', male: 'male', female: 'female' };

  /**
   * Normaliza una etiqueta de idioma (`es-AR`, `ES`, `en_GB`) a `en`/`es`.
   * Devuelve `null` si el idioma no está soportado.
   */
  function normalizeLocale(tag) {
    if (typeof tag !== 'string' || !tag) return null;
    var base = tag.toLowerCase().replace('_', '-').split('-')[0];
    return SUPPORTED.indexOf(base) === -1 ? null : base;
  }

  /**
   * Detección de idioma de I-8: preferencia guardada, si no el navegador,
   * si no el inglés. Es una función pura para poder probarla en Node.
   */
  function detectLocale(savedLocale, navigatorLanguage) {
    return normalizeLocale(savedLocale) || normalizeLocale(navigatorLanguage) || FALLBACK_LOCALE;
  }

  function isVariantObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function hasPluralForm(value) {
    if (!isVariantObject(value)) return false;
    for (var i = 0; i < PLURAL_CATEGORIES.length; i += 1) {
      if (Object.prototype.hasOwnProperty.call(value, PLURAL_CATEGORIES[i])) return true;
    }
    return false;
  }

  function hasGenderForm(value) {
    if (!isVariantObject(value)) return false;
    for (var i = 0; i < GENDER_KEYS.length; i += 1) {
      if (Object.prototype.hasOwnProperty.call(value, GENDER_KEYS[i])) return true;
    }
    return false;
  }

  /** Primer valor de texto que haya dentro de un objeto de variantes. */
  function firstString(value) {
    var keys = Object.keys(value);
    for (var i = 0; i < keys.length; i += 1) {
      var candidate = value[keys[i]];
      if (typeof candidate === 'string') return candidate;
      if (isVariantObject(candidate)) {
        var nested = firstString(candidate);
        if (typeof nested === 'string') return nested;
      }
    }
    return undefined;
  }

  /**
   * Elige la variante de plural o género. Los objetos pueden anidar un nivel de
   * género dentro de plural (o al revés): por eso el resultado puede seguir siendo
   * un objeto y el llamador vuelve a resolver.
   */
  function selectVariant(value, params, locale) {
    if (hasPluralForm(value)) {
      var raw = params && (params.n !== undefined ? params.n : params.count);
      var numeric = Number(raw);
      var category = 'other';
      if (isFinite(numeric)) {
        try {
          category = format.pluralSelect(locale, numeric);
        } catch (error) {
          category = 'other';
        }
      } else if (Object.prototype.hasOwnProperty.call(value, 'other')) {
        category = 'other';
      }
      if (Object.prototype.hasOwnProperty.call(value, category)) return value[category];
      if (Object.prototype.hasOwnProperty.call(value, 'other')) return value.other;
      return firstString(value);
    }
    if (hasGenderForm(value)) {
      var wanted = GENDER_ALIASES[String((params && params.g) || 'n').toLowerCase()] || 'neutral';
      if (Object.prototype.hasOwnProperty.call(value, wanted)) return value[wanted];
      if (Object.prototype.hasOwnProperty.call(value, 'neutral')) return value.neutral;
      return firstString(value);
    }
    return firstString(value);
  }

  /** Sustituye los marcadores `{nombre}` por el parámetro correspondiente. */
  function interpolate(template, params, locale, onMissing) {
    if (typeof template !== 'string') return MISSING_TEXT;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, function (match, name) {
      var value = params[name];
      if (value === undefined || value === null) {
        if (onMissing) onMissing(name);
        return '';
      }
      if (typeof value === 'number') {
        // I-7: los números dentro de mensajes respetan el idioma activo.
        return isFinite(value) ? format.formatNumber(value, locale, { maximumFractionDigits: 3 }) : String(value);
      }
      return String(value);
    });
  }

  /**
   * Crea un traductor.
   * @param {{dicts:Object, locale:string, fallback:string, logger:Object}} options
   */
  function createTranslator(options) {
    options = options || {};
    var dicts = options.dicts || {};
    var fallback = normalizeLocale(options.fallback) || FALLBACK_LOCALE;
    var locale = normalizeLocale(options.locale) || fallback;
    var logger = options.logger === undefined ? (typeof console !== 'undefined' ? console : null) : options.logger;
    var listeners = [];
    var missingActive = Object.create(null);
    var missingFallback = Object.create(null);
    var warned = Object.create(null);

    function warn(key, message) {
      if (warned[key]) return;
      warned[key] = true;
      if (logger && typeof logger.warn === 'function') logger.warn('[i18n] ' + message);
    }

    function raw(language, key) {
      var dict = dicts[language];
      if (!dict || typeof key !== 'string') return undefined;
      var value = dict[key];
      if (typeof value === 'string') return value;
      if (isVariantObject(value)) return value;
      return undefined;
    }

    function resolve(language, key, params) {
      var value = raw(language, key);
      var guard = 0;
      while (isVariantObject(value) && guard < 4) {
        value = selectVariant(value, params, language);
        guard += 1;
      }
      if (typeof value !== 'string') return undefined;
      return interpolate(value, params, language, function (name) {
        warn(key, 'la plantilla "' + key + '" no recibió el parámetro {' + name + '}');
      });
    }

    /** Traduce una clave. Devuelve `—` si no existe en ningún idioma (I-12). */
    function t(key, params) {
      var text = resolve(locale, key, params);
      if (text !== undefined) return text;
      missingActive[key] = true;
      if (locale !== fallback) {
        var fallbackText = resolve(fallback, key, params);
        if (fallbackText !== undefined) {
          warn(key, 'falta "' + key + '" en "' + locale + '"; se muestra "' + fallback + '"');
          return fallbackText;
        }
      }
      missingFallback[key] = true;
      warn(key, 'clave "' + key + '" sin traducción en ningún idioma');
      return MISSING_TEXT;
    }

    function setLocale(next) {
      var normalized = normalizeLocale(next) || fallback;
      if (normalized === locale) return locale;
      locale = normalized;
      for (var i = 0; i < listeners.length; i += 1) {
        try {
          listeners[i](locale);
        } catch (error) {
          if (logger && logger.error) logger.error('[i18n] error en un suscriptor de idioma', error);
        }
      }
      return locale;
    }

    function onChange(callback) {
      listeners.push(callback);
      return function unsubscribe() {
        listeners = listeners.filter(function (item) {
          return item !== callback;
        });
      };
    }

    /** Claves pedidas que no existen en el idioma activo o en el de respaldo. */
    function missingKeys() {
      return { active: Object.keys(missingActive), fallback: Object.keys(missingFallback) };
    }

    function formatNumber(value, opts) {
      return format.formatNumber(value, locale, opts);
    }

    function formatPercent(ratio, digits) {
      return format.formatPercent(ratio, locale, digits);
    }

    function formatSigned(value) {
      return format.formatSigned(value, locale);
    }

    function formatDate(value, opts) {
      return format.formatDate(value, locale, opts);
    }

    /**
     * Duración legible a partir de horas simuladas: `3 d 04 h`, `5 h 30 min`.
     * Las etiquetas son claves (`unit.day.short`, `unit.hour.short`, …).
     */
    function formatDuration(hours) {
      var total = Number(hours);
      if (!isFinite(total)) return MISSING_TEXT;
      var abs = Math.abs(total);
      if (abs >= 48) {
        var days = Math.floor(abs / 24);
        var restHours = Math.floor(abs % 24);
        return t('unit.days_short', { n: days, day: formatNumber(days), hour: formatNumber(restHours) });
      }
      if (abs >= 1) {
        var wholeHours = Math.floor(abs);
        var minutes = Math.round((abs - wholeHours) * 60);
        return t('unit.hours_short', { n: wholeHours, hour: formatNumber(wholeHours), minute: formatNumber(minutes) });
      }
      return t('unit.minutes_short', { minute: formatNumber(Math.round(abs * 60)) });
    }

    /** Valor con su unidad: `12 kg`, `4,5 M€`. La etiqueta de la unidad se traduce. */
    function formatUnit(value, unitKey, opts) {
      var number = formatNumber(value, opts);
      var label = t(unitKey);
      return label === MISSING_TEXT ? number : number + ' ' + label;
    }

    return {
      t: t,
      has: function (key) {
        return raw(locale, key) !== undefined || raw(fallback, key) !== undefined;
      },
      locale: function () {
        return locale;
      },
      fallback: function () {
        return fallback;
      },
      supported: function () {
        return SUPPORTED.slice();
      },
      setLocale: setLocale,
      onChange: onChange,
      missingKeys: missingKeys,
      formatNumber: formatNumber,
      formatPercent: formatPercent,
      formatSigned: formatSigned,
      formatDate: formatDate,
      formatDuration: formatDuration,
      formatUnit: formatUnit,
      missionClock: format.missionClock,
      tag: function () {
        return format.tagFor(locale);
      }
    };
  }

  /** Crea los diccionarios a partir del registro de datos (`GS.data`). */
  function dictsFromRegistry(registry) {
    var source = registry || {};
    return {
      en: source['locales/en'] || {},
      es: source['locales/es'] || {}
    };
  }

  return {
    SUPPORTED: SUPPORTED,
    FALLBACK_LOCALE: FALLBACK_LOCALE,
    MISSING_TEXT: MISSING_TEXT,
    createTranslator: createTranslator,
    normalizeLocale: normalizeLocale,
    detectLocale: detectLocale,
    dictsFromRegistry: dictsFromRegistry,
    format: format
  };
});
