/*
 * Exporting and importing designs, saves and reports as JSON (G-2, M-3).
 *
 * The file stores keys, identifiers and values; never translated text (I-10).
 * A report or design exported in one language can be imported in the other
 * without loss. The two-piece comparator (G-3) also lives here, delegating the
 * calculation to `core/scoring.compare`.
 */
(function (global, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('../core/scoring.js'));
  } else {
    var GS = (global.GS = global.GS || {});
    GS.storage = GS.storage || {};
    GS.storage.transfer = factory(GS.core.scoring);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (scoring) {
  'use strict';

  var FORMAT = 'the-last-expedition';
  var KIND = { DESIGN: 'design', SAVE: 'save', REPORT: 'report' };

  /** Serializes a piece to JSON text with an identifiable header. */
  function exportJson(kind, payload, options) {
    var opts = options || {};
    return JSON.stringify(
      {
        format: FORMAT,
        version: 1,
        kind: kind,
        exportedAt: new Date(opts.now || Date.now()).toISOString(),
        appVersion: opts.appVersion || '0.1.0',
        data: payload
      },
      null,
      2
    );
  }

  /**
   * Reads exported text. Returns `{ok, kind, data}` or `{ok:false, code}`.
   * It neither interprets nor translates the content: it only validates the envelope.
   */
  function importJson(text) {
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      return { ok: false, code: 'import.invalid_json' };
    }
    if (!parsed || parsed.format !== FORMAT) return { ok: false, code: 'import.invalid_format' };
    if (parsed.version !== 1) return { ok: false, code: 'import.unsupported_version', params: { version: parsed.version } };
    if (!parsed.data || typeof parsed.data !== 'object') return { ok: false, code: 'import.invalid_payload' };
    // I-10: if the file carries already translated text, it is dropped silently.
    var sanitized = stripTranslatedText(parsed.data);
    return { ok: true, kind: parsed.kind, data: sanitized, exportedAt: parsed.exportedAt };
  }

  /*
   * Fields that, by convention, would carry already translated text. i18n keys
   * (`*Key`) are always kept: the imported file stores keys and values, never
   * text (I-10, finding R3-001).
   */
  var TRANSLATED_FIELDS = {
    translatedText: true,
    localizedLabel: true,
    translated: true,
    localized: true,
    text: true,
    label: true,
    message: true,
    description: true,
    title: true
  };

  /** Removes, in depth, any field holding already translated text. */
  function stripTranslatedText(node) {
    if (Array.isArray(node)) return node.map(stripTranslatedText);
    if (!node || typeof node !== 'object') return node;
    var out = {};
    Object.keys(node).forEach(function (key) {
      if (TRANSLATED_FIELDS[key] === true) return;
      out[key] = stripTranslatedText(node[key]);
    });
    return out;
  }

  /** Compares two designs or two reports (G-3). */
  function compare(a, b) {
    return scoring.compare(a, b);
  }

  /**
   * Downloads a file in the browser. Isolated so the Node tests do not need a
   * DOM.
   */
  function download(filename, text) {
    if (typeof document === 'undefined') return false;
    var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return true;
  }

  /** Reads a file chosen by the player. Returns a promise with the text. */
  function readFile(file) {
    return new Promise(function (resolve, reject) {
      if (!file) {
        reject(new Error('no file'));
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ''));
      };
      reader.onerror = function () {
        reject(reader.error || new Error('read error'));
      };
      reader.readAsText(file, 'utf-8');
    });
  }

  /** Stable file name derived from the keys, without translated text. */
  function filenameFor(kind, subject, now) {
    var date = new Date(now || Date.now()).toISOString().slice(0, 10);
    var subjectId = (subject || 'mission').replace(/[^a-zA-Z0-9_.-]/g, '-');
    return 'tle-' + kind + '-' + subjectId + '-' + date + '.json';
  }

  return {
    FORMAT: FORMAT,
    KIND: KIND,
    exportJson: exportJson,
    importJson: importJson,
    compare: compare,
    download: download,
    readFile: readFile,
    filenameFor: filenameFor,
    stripTranslatedText: stripTranslatedText
  };
});
