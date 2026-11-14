/*
 * Tabla de clasificación local por escenario y dificultad (P-4, S-17).
 *
 * Guarda solo valores y claves: escenario, dificultad, puntaje, resultado y día
 * final. Al mostrarla, la UI traduce nombres y etiquetas con el idioma activo.
 */
(function (global, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./store.js'));
  } else {
    var GS = (global.GS = global.GS || {});
    GS.storage = GS.storage || {};
    GS.storage.leaderboard = factory(GS.storage.store);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (store) {
  'use strict';

  var KEY = 'tle.leaderboard.v1';
  var MAX_ENTRIES = 100;

  function readAll() {
    var saved = store.read(KEY, null);
    return Array.isArray(saved) ? saved : [];
  }

  /**
   * Agrega una entrada a partir de un informe de misión.
   * @param {Object} report informe de `core/scoring.buildReport`
   */
  function add(report, now) {
    if (!report || !report.scenarioId || !report.difficultyId) return { ok: false, code: 'lb.invalid_report' };
    var entry = {
      // Sin `Math.random()`: el identificador sale del reloj y del largo actual (C-4).
      id: String(now || Date.now()) + '-' + (readAll().length + 1),
      createdAt: new Date(now || Date.now()).toISOString(),
      scenarioId: report.scenarioId,
      difficultyId: report.difficultyId,
      mode: report.mode || 'campaign',
      score: Math.round(report.score || 0),
      science: Math.round(report.science || 0),
      endDay: report.endDay || 0,
      outcome: report.outcome || 'unknown',
      result: report.result || 'partial',
      crewAlive: (report.crew || []).filter(function (member) {
        return member.alive;
      }).length,
      crewTotal: (report.crew || []).length
    };
    var all = readAll();
    all.push(entry);
    all.sort(function (a, b) {
      return b.score - a.score;
    });
    var trimmed = all.slice(0, MAX_ENTRIES);
    var result = store.write(KEY, trimmed);
    return { ok: result.ok, code: result.code || null, entry: entry, rank: trimmed.indexOf(entry) + 1 };
  }

  /** Entradas de un escenario y dificultad, de mayor a menor puntaje. */
  function list(scenarioId, difficultyId) {
    return readAll()
      .filter(function (entry) {
        return (!scenarioId || entry.scenarioId === scenarioId) && (!difficultyId || entry.difficultyId === difficultyId);
      })
      .sort(function (a, b) {
        return b.score - a.score;
      });
  }

  /** Mejor puntaje conocido para una combinación escenario/dificultad. */
  function best(scenarioId, difficultyId) {
    var entries = list(scenarioId, difficultyId);
    return entries.length > 0 ? entries[0] : null;
  }

  function clear() {
    return store.remove(KEY);
  }

  return {
    KEY: KEY,
    add: add,
    list: list,
    best: best,
    clear: clear,
    readAll: readAll
  };
});
