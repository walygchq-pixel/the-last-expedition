/*
 * Formato de números, fechas, duraciones y unidades por idioma (I-7).
 * Módulo puro: sin DOM, sin acceso a `localStorage`. Lo usan tanto el navegador
 * como las pruebas de Node.
 */
(function (global, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    var GS = (global.GS = global.GS || {});
    GS.i18n = GS.i18n || {};
    GS.i18n.format = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Idioma lógico -> etiqueta BCP 47 usada por `Intl`. `es-AR` da separador
  // decimal `,` y separador de miles `.`, como pide I-7 para español.
  var LOCALE_TAGS = {
    en: 'en-US',
    es: 'es-AR'
  };

  // Cachés de formateadores: construir `Intl.*` en cada frame del HUD cuesta caro.
  var numberCache = new Map();
  var dateCache = new Map();
  var pluralCache = new Map();

  /** Devuelve la etiqueta BCP 47 del idioma lógico (`en`/`es`) o la de inglés. */
  function tagFor(locale) {
    return LOCALE_TAGS[locale] || LOCALE_TAGS.en;
  }

  function numberFormatter(locale, options) {
    var key = tagFor(locale) + '|' + JSON.stringify(options || {});
    var cached = numberCache.get(key);
    if (!cached) {
      cached = new Intl.NumberFormat(tagFor(locale), options || {});
      numberCache.set(key, cached);
    }
    return cached;
  }

  function dateFormatter(locale, options) {
    var key = tagFor(locale) + '|' + JSON.stringify(options || {});
    var cached = dateCache.get(key);
    if (!cached) {
      cached = new Intl.DateTimeFormat(tagFor(locale), options || {});
      dateCache.set(key, cached);
    }
    return cached;
  }

  function pluralRules(locale) {
    var tag = tagFor(locale);
    var cached = pluralCache.get(tag);
    if (!cached) {
      cached = new Intl.PluralRules(tag);
      pluralCache.set(tag, cached);
    }
    return cached;
  }

  /** Formatea un número según el idioma activo. */
  function formatNumber(value, locale, options) {
    var n = Number(value);
    if (!isFinite(n)) return String(value);
    return numberFormatter(locale, options).format(n);
  }

  /** Formatea un porcentaje a partir de una fracción 0..1. */
  function formatPercent(ratio, locale, fractionDigits) {
    var n = Number(ratio);
    if (!isFinite(n)) return String(ratio);
    var digits = typeof fractionDigits === 'number' ? fractionDigits : 0;
    return numberFormatter(locale, {
      style: 'percent',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    }).format(n);
  }

  /** Formatea un número con signo explícito (+3 / -2), útil en el desglose de puntos. */
  function formatSigned(value, locale) {
    var n = Number(value);
    if (!isFinite(n)) return String(value);
    return numberFormatter(locale, { signDisplay: 'exceptZero' }).format(n);
  }

  /**
   * Formatea una fecha del calendario real (ms o Date) según I-7.
   * `options` por defecto: día y mes cortos, año numérico.
   */
  function formatDate(value, locale, options) {
    var date = value instanceof Date ? value : new Date(Number(value));
    if (isNaN(date.getTime())) return '—';
    return dateFormatter(locale, options || { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
  }

  /**
   * Formatea una hora de misión expresada en horas simuladas como `D3 · 05:00`.
   * El formato es independiente del idioma; las etiquetas las pone quien llama.
   */
  function missionClock(hours) {
    var total = Math.max(0, Number(hours) || 0);
    var day = Math.floor(total / 24) + 1;
    var hour = Math.floor(total % 24);
    var minute = Math.floor((total % 1) * 60);
    return {
      day: day,
      hour: hour,
      minute: minute,
      text: String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0')
    };
  }

  return {
    LOCALE_TAGS: LOCALE_TAGS,
    tagFor: tagFor,
    formatNumber: formatNumber,
    formatPercent: formatPercent,
    formatSigned: formatSigned,
    formatDate: formatDate,
    missionClock: missionClock,
    pluralSelect: function (locale, n) {
      return pluralRules(locale).select(Number(n));
    }
  };
});
