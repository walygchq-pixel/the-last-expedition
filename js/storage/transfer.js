/*
 * Exportación e importación de diseños, partidas e informes como JSON (G-2, M-3).
 *
 * El archivo guarda claves, identificadores y valores; nunca texto traducido
 * (I-10). Un informe o diseño exportado en un idioma se puede importar en el otro
 * sin pérdida. También vive acá el comparador de dos piezas (G-3), delegando el
 * cálculo a `core/scoring.compare`.
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

  /** Serializa una pieza a texto JSON con cabecera identificable. */
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
   * Lee un texto exportado. Devuelve `{ok, kind, data}` o `{ok:false, code}`.
   * No interpreta ni traduce el contenido: solo valida la envoltura.
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
    // I-10: si el archivo trae texto ya traducido, se descarta en silencio.
    var sanitized = stripTranslatedText(parsed.data);
    return { ok: true, kind: parsed.kind, data: sanitized, exportedAt: parsed.exportedAt };
  }

  /** Elimina cualquier campo `text`, `label`, `translated` que no sea clave i18n. */
  function stripTranslatedText(node) {
    if (Array.isArray(node)) return node.map(stripTranslatedText);
    if (!node || typeof node !== 'object') return node;
    var out = {};
    Object.keys(node).forEach(function (key) {
      if (key === 'translatedText' || key === 'localizedLabel') return;
      out[key] = stripTranslatedText(node[key]);
    });
    return out;
  }

  /** Compara dos diseños o dos informes (G-3). */
  function compare(a, b) {
    return scoring.compare(a, b);
  }

  /**
   * Descarga un archivo en el navegador. Aislado para que los tests de Node no
   * necesiten DOM.
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

  /** Lee un archivo elegido por el jugador. Devuelve una promesa con el texto. */
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

  /** Nombre de archivo estable derivado de las claves, sin texto traducido. */
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
