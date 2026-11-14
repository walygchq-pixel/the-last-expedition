/*
 * Preferencias del jugador (I-8, I-9, E-5, RG-8).
 *
 * Guarda idioma, accesibilidad, visibilidad del tutorial y controles reasignados.
 * Nunca guarda texto traducido: solo claves y valores (I-10).
 */
(function (global, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./store.js'), require('../i18n/index.js'));
  } else {
    var GS = (global.GS = global.GS || {});
    GS.storage = GS.storage || {};
    GS.storage.prefs = factory(GS.storage.store, GS.i18n);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (store, i18n) {
  'use strict';

  var KEY = 'tle.prefs.v1';

  var DEFAULTS = {
    locale: null,
    textSize: 'normal',
    highContrast: false,
    reduceMotion: false,
    captions: false,
    tutorialEnabled: true,
    tutorialSeen: false,
    bindings: null,
    lastScenario: null,
    lastDifficulty: 'basic'
  };

  function get() {
    var saved = store.read(KEY, null);
    if (!saved || typeof saved !== 'object') return Object.assign({}, DEFAULTS);
    return Object.assign({}, DEFAULTS, saved);
  }

  /** Aplica un parche parcial sobre las preferencias actuales. */
  function set(patch) {
    var next = Object.assign(get(), patch || {});
    if (next.textSize !== 'normal' && next.textSize !== 'large' && next.textSize !== 'xlarge') next.textSize = 'normal';
    if (next.locale !== null) next.locale = i18n.normalizeLocale(next.locale);
    var result = store.write(KEY, next);
    return { ok: result.ok, code: result.code || null, prefs: next };
  }

  function reset() {
    store.remove(KEY);
    return get();
  }

  /** Idioma inicial según I-8: preferencia, navegador o inglés. */
  function initialLocale(navigatorLanguage) {
    var prefs = get();
    var language = navigatorLanguage;
    if (!language && typeof globalThis !== 'undefined' && globalThis.navigator) {
      language = globalThis.navigator.language;
    }
    return i18n.detectLocale(prefs.locale, language);
  }

  return {
    KEY: KEY,
    DEFAULTS: DEFAULTS,
    get: get,
    set: set,
    reset: reset,
    initialLocale: initialLocale
  };
});
