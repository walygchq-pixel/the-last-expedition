/*
 * Mission objective compliance (DM-1, DM-2, V-18, P-1).
 *
 * `runtime()` is the evaluator that `core/game` injects to decide whether the
 * objective was met: it joins the design requirements with the real state of the
 * run (transmitted data, instruments on board, orbit and living crew).
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

  /** Design requirements of the active scenario (the verifiable list of DM-2). */
  function designChecks(missionDesign) {
    return design.getRequirements(missionDesign);
  }

  /** Sum of the science value per area of the instruments on board. */
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
   * Evaluates the objective during the voyage (contract C-7: the UI injects it in
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

    // 1. Enough data transmitted to the ground (C-4, P-1).
    checks.push({
      id: 'data',
      ok: transmitted >= required,
      labelKey: 'obj.progress.data',
      params: { have: transmitted, need: required }
    });

    // 2. Every science area of the objective covered by an instrument on board.
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

    // 3. Someone has to stay alive for the mission to count as accomplished.
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
      met:
        checks.every(function (check) {
          // The living-crew check is not an objective requirement: it is
          // demanded separately (below) and does not prevent meeting the rest (R3-001).
          return check.id === 'crew' ? true : check.ok;
        }) && alive > 0,
      // Progress is measured mainly by transmitted data.
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
