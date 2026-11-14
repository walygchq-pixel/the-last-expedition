/*
 * Cumplimiento del objetivo de misión (DM-1, DM-2, V-18, P-1).
 *
 * `runtime()` es el evaluador que `core/game` inyecta para decidir si el objetivo
 * se cumplió: junta los requisitos del diseño con el estado real de la partida
 * (datos transmitidos, instrumentos a bordo, órbita y tripulación viva).
 */
(function (global, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./catalog.js'), require('./design.js'));
  } else {
    var GS = (global.GS = global.GS || {});
    GS.mission = GS.mission || {};
    GS.mission.objectives = factory(GS.mission.catalog, GS.mission.design);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (catalog, design) {
  'use strict';

  function round1(value) {
    return Math.round(Number(value) * 10) / 10;
  }

  function clamp01(value) {
    var n = Number(value);
    if (!isFinite(n)) return 0;
    return Math.min(1, Math.max(0, n));
  }

  /** Requisitos de diseño del escenario activo (lista verificable de DM-2). */
  function designChecks(missionDesign) {
    return design.getRequirements(missionDesign);
  }

  /** Suma del valor científico por área de los instrumentos que van a bordo. */
  function scienceOnBoard(game) {
    var totals = {};
    (game.design && game.design.instruments ? game.design.instruments : []).forEach(function (instrument) {
      Object.keys(instrument.science || {}).forEach(function (tag) {
        totals[tag] = round1((totals[tag] || 0) + instrument.science[tag]);
      });
    });
    return totals;
  }

  /**
   * Evalúa el objetivo durante el viaje (contrato C-7: lo inyecta la UI en
   * `core/game.createGame({evaluateObjective})`).
   * @returns {{met:boolean, coverage:number, checks:Array, required:number,
   *   transmitted:number, tags:Object}}
   */
  function runtime(game) {
    var scenario = game.scenario || {};
    var objective = catalog.findObjective(scenario.objectiveId) || { requires: [] };
    var required = isFinite(scenario.requiredData) ? scenario.requiredData : 50;
    var transmitted = round1((game.datastore && game.datastore.transmitted) || 0);
    var science = scienceOnBoard(game);
    var orbit = (game.design && game.design.orbit) || null;
    var checks = [];

    // 1. Datos suficientes transmitidos a tierra (C-4, P-1).
    checks.push({
      id: 'data',
      ok: transmitted >= required,
      labelKey: 'obj.progress.data',
      params: { have: transmitted, need: required }
    });

    // 2. Cada área científica del objetivo cubierta por un instrumento a bordo.
    (objective.requires || []).forEach(function (requirement) {
      if (requirement.type === 'science') {
        checks.push({
          id: 'science:' + requirement.tag,
          ok: (science[requirement.tag] || 0) >= requirement.value,
          labelKey: 'req.science',
          params: { tag: 'science.tag.' + requirement.tag, have: science[requirement.tag] || 0, need: requirement.value }
        });
      }
      if (requirement.type === 'coverage') {
        checks.push({
          id: 'coverage',
          ok: !!orbit && (orbit.coverage || 0) >= requirement.value,
          labelKey: 'req.coverage',
          params: { have: Math.round(((orbit && orbit.coverage) || 0) * 100), need: Math.round(requirement.value * 100) }
        });
      }
    });

    // 3. Tiene que quedar alguien vivo para dar por cumplida la misión.
    var alive = (game.crew ? game.crew.members : []).filter(function (member) {
      return member.alive;
    }).length;
    checks.push({
      id: 'crew',
      ok: alive > 0,
      labelKey: 'obj.progress.crew',
      params: { have: alive }
    });

    var satisfied = checks.filter(function (check) {
      return check.ok;
    }).length;
    var coverage = checks.length === 0 ? 0 : satisfied / checks.length;
    return {
      met: checks.every(function (check) {
        return check.ok && check.id !== 'crew';
      }) && alive > 0,
      // El progreso se mide sobre todo por datos transmitidos.
      coverage: round1(clamp01(transmitted / Math.max(1, required))),
      checks: checks,
      required: required,
      transmitted: transmitted,
      tags: science
    };
  }

  return {
    designChecks: designChecks,
    runtime: runtime,
    scienceOnBoard: scienceOnBoard
  };
});
