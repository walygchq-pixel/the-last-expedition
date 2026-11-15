/*
 * Formatting of numbers, dates, durations and units per language (I-7).
 * Pure module: no DOM, no access to `localStorage`. It is used both by the browser
 * and by the Node tests.
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

  // Logical language -> BCP 47 tag used by `Intl`. `es-AR` yields `,` as the
  // decimal separator and `.` as the thousands separator, as I-7 requires for Spanish.
  var LOCALE_TAGS = {
    en: 'en-US',
    es: 'es-AR'
  };

  // Formatter caches: building `Intl.*` on every HUD frame is expensive.
  var numberCache = new Map();
  var dateCache = new Map();
  var pluralCache = new Map();

  /** Returns the BCP 47 tag of the logical language (`en`/`es`), or the English one. */
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

  /** Formats a number according to the active language. */
  function formatNumber(value, locale, options) {
    var n = Number(value);
    if (!isFinite(n)) return String(value);
    return numberFormatter(locale, options).format(n);
  }

  /** Formats a percentage from a 0..1 fraction. */
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

  /** Formats a number with an explicit sign (+3 / -2), useful in the score breakdown. */
  function formatSigned(value, locale) {
    var n = Number(value);
    if (!isFinite(n)) return String(value);
    return numberFormatter(locale, { signDisplay: 'exceptZero' }).format(n);
  }

  /**
   * Formats a real-calendar date (ms or Date) according to I-7.
   * Default `options`: short day and month, numeric year.
   */
  function formatDate(value, locale, options) {
    var date = value instanceof Date ? value : new Date(Number(value));
    if (isNaN(date.getTime())) return '—';
    return dateFormatter(locale, options || { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
  }

  /**
   * Formats a mission time expressed in simulated hours as `D3 · 05:00`.
   * The format is language-independent; the caller supplies the labels.
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
