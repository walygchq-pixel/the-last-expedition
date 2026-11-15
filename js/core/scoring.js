/*
 * Scoring, mission report and post-mission analysis (P-1 … P-3).
 *
 * The score splits 1000 points between mission, scientific value, efficiency,
 * decision quality, survival and collaboration (P-1). The report and the analysis
 * explain in plain language which trade-offs weighed most (P-3); here they come
 * back as codes and parameters, and the text is supplied by the UI.
 */
(function (global, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./datastore.js'));
  } else {
    var GS = (global.GS = global.GS || {});
    GS.core = GS.core || {};
    GS.core.scoring = factory(GS.core.datastore);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (datastore) {
  'use strict';

  var MAX = {
    mission: 300,
    science: 250,
    efficiency: 150,
    decisions: 150,
    survival: 100,
    collaboration: 50
  };

  function clamp(value, min, max) {
    var n = Number(value);
    if (!isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  function round(value) {
    return Math.round(Number(value) || 0);
  }

  function ratio(part, whole) {
    var a = Number(part);
    var b = Number(whole);
    if (!isFinite(a) || !isFinite(b) || b === 0) return 0;
    return clamp(a / b, 0, 1);
  }

  /**
   * Computes the score over the final state of the game.
   * @param {Object} state state of `core/game` with `objective`, `design`,
   *   `crew`, `resources`, `log`, `votes`, `datastore`, `clock`, `stats`.
   */
  function score(state) {
    var breakdown = [];

    // 1. Mission success (P-1): objective met and coverage of the requirements.
    var objective = state.objective || { met: false, coverage: 0 };
    var missionPoints = objective.met
      ? MAX.mission
      : round(MAX.mission * 0.25 * clamp(objective.coverage || 0, 0, 1));
    breakdown.push({
      id: 'mission',
      labelKey: 'report.score.mission',
      points: round(missionPoints),
      max: MAX.mission,
      whyKey: objective.met ? 'report.why.mission_met' : 'report.why.mission_partial',
      params: { coverage: round((objective.coverage || 0) * 100) }
    });

    // 2. Scientific value (P-1, C-4): what was transmitted is worth 1, what stayed on board 0.6.
    var required = (state.scenario && state.scenario.requiredData) || 60;
    var science = datastore.scienceValue(state.datastore || { transmitted: 0, total: 0 });
    var sciencePoints = round(MAX.science * ratio(science, required));
    breakdown.push({
      id: 'science',
      labelKey: 'report.score.science',
      points: sciencePoints,
      max: MAX.science,
      whyKey: 'report.why.science',
      params: { value: science, required: required }
    });

    // 3. Efficient use of resources (P-1).
    var budgetLeft = ratio(state.resources.budget, state.resources.budgetTotal);
    var powerLeft = state.resources.powerGen > 0 ? clamp((state.resources.powerGen - state.resources.powerDraw) / state.resources.powerGen, 0, 1) : 0;
    var timeLeft = ratio(state.resources.daysLeft, state.resources.missionDays);
    var efficiencyRatio = budgetLeft * 0.5 + powerLeft * 0.3 + timeLeft * 0.2;
    breakdown.push({
      id: 'efficiency',
      labelKey: 'report.score.efficiency',
      points: round(MAX.efficiency * efficiencyRatio),
      max: MAX.efficiency,
      whyKey: 'report.why.efficiency',
      params: {
        budget: round(budgetLeft * 100),
        power: round(powerLeft * 100),
        time: round(timeLeft * 100)
      }
    });

    // 4. Effective decision making (P-1): negative consequences avoided.
    var fired = (state.log.entries || []).filter(function (entry) {
      return entry.resolved && !entry.cancelled;
    }).length;
    var scheduled = (state.log.entries || []).length;
    var avoided = scheduled === 0 ? 1 : clamp(1 - fired / Math.max(1, scheduled), 0, 1);
    breakdown.push({
      id: 'decisions',
      labelKey: 'report.score.decisions',
      points: round(MAX.decisions * avoided),
      max: MAX.decisions,
      whyKey: 'report.why.decisions',
      params: { fired: fired, scheduled: scheduled }
    });

    // 5. Survival of the crew (P-1).
    var totalCrew = state.crew.members.length || 1;
    var alive = state.crew.members.filter(function (member) {
      return member.alive;
    }).length;
    var healthRatio = alive === 0
      ? 0
      : state.crew.members.reduce(function (sum, member) {
          return sum + (member.alive ? clamp(member.health / 100, 0, 1) : 0);
        }, 0) / totalCrew;
    var survivalPoints = round(MAX.survival * (ratio(alive, totalCrew) * 0.6 + healthRatio * 0.4));
    breakdown.push({
      id: 'survival',
      labelKey: 'report.score.survival',
      points: survivalPoints,
      max: MAX.survival,
      whyKey: 'report.why.survival',
      params: { alive: alive, total: totalCrew }
    });

    // 6. Collaboration (P-1, RG-11): agreements reached and roles fulfilled.
    var votes = state.votes || { total: 0, agreed: 0 };
    var agreement = votes.total === 0 ? (state.crew.solo ? 0.85 : 1) : ratio(votes.agreed, votes.total);
    breakdown.push({
      id: 'collaboration',
      labelKey: 'report.score.collaboration',
      points: round(MAX.collaboration * agreement),
      max: MAX.collaboration,
      whyKey: 'report.why.collaboration',
      params: { agreed: votes.agreed || 0, total: votes.total || 0 }
    });

    var total = breakdown.reduce(function (sum, item) {
      return sum + item.points;
    }, 0);

    return {
      total: total,
      max: MAX.mission + MAX.science + MAX.efficiency + MAX.decisions + MAX.survival + MAX.collaboration,
      breakdown: breakdown,
      science: science,
      requiredScience: required
    };
  }

  /**
   * Builds the mission report (P-2): outcome, breakdown, resources
   * consumed, key decisions and their consequences.
   */
  function buildReport(state, meta) {
    var scores = score(state);
    var outcome = state.outcome || 'unknown';
    return {
      version: 1,
      missionId: state.id,
      scenarioId: state.scenarioId,
      difficultyId: state.difficultyId,
      mode: state.mode,
      seed: state.seed,
      endDay: Math.round(state.clock.hours / 24),
      outcome: outcome,
      result: outcome === 'success' ? 'success' : outcome === 'lost_crew' || outcome === 'inoperable' ? 'failure' : 'partial',
      score: scores.total,
      maxScore: scores.max,
      breakdown: scores.breakdown,
      science: scores.science,
      requiredScience: scores.requiredScience,
      resources: {
        budgetSpent: Math.round((state.resources.budgetTotal - state.resources.budget) * 10) / 10,
        powerGen: state.resources.powerGen,
        powerDraw: state.resources.powerDraw,
        mass: state.resources.mass,
        dataTransmitted: Math.round((state.datastore.transmitted || 0) * 10) / 10,
        dataLost: Math.round((state.datastore.lost || 0) * 10) / 10
      },
      crew: state.crew.members.map(function (member) {
        return {
          id: member.id,
          role: member.role,
          alive: member.alive,
          health: Math.round(member.health),
          morale: Math.round(member.morale),
          stress: Math.round(member.stress)
        };
      }),
      decisions: (state.log.entries || []).map(function (entry) {
        return {
          id: entry.id,
          code: entry.code,
          params: entry.params,
          whyKey: entry.whyKey,
          createdDay: Math.round(entry.createdDay * 10) / 10,
          resolvedDay: entry.resolvedDay === null ? null : Math.round(entry.resolvedDay * 10) / 10,
          resolved: entry.resolved,
          cancelled: !!entry.cancelled
        };
      }),
      keyDecisions: pickKeyDecisions(state),
      objectives: state.objective && state.objective.checks ? state.objective.checks : [],
      votes: state.votes || { total: 0, agreed: 0 },
      createdAt: meta && meta.createdAt ? meta.createdAt : null
    };
  }

  function pickKeyDecisions(state) {
    var entries = (state.log.entries || []).filter(function (entry) {
      return entry.severity === 'severe' || entry.severity === 'warn';
    });
    return entries.slice(-6).map(function (entry) {
      return {
        code: entry.code,
        params: entry.params,
        whyKey: entry.whyKey,
        createdDay: Math.round(entry.createdDay * 10) / 10,
        resolved: entry.resolved
      };
    });
  }

  /**
   * Post-mission analysis (P-3): which trade-offs weighed most, in codes.
   * Sorted by descending impact on the score lost.
   */
  function analyze(report) {
    var findings = [];
    report.breakdown.forEach(function (item) {
      var lost = item.max - item.points;
      if (lost <= 0) return;
      findings.push({
        id: item.id,
        code: 'report.analysis.' + item.id,
        params: item.params || {},
        lost: lost,
        max: item.max,
        whyKey: item.whyKey
      });
    });
    findings.sort(function (a, b) {
      return b.lost - a.lost;
    });

    // Explicit trade-offs: the contrast between two rubrics is what teaches the lesson.
    var byId = {};
    report.breakdown.forEach(function (item) {
      byId[item.id] = item;
    });
    var tradeoffs = [];
    if (byId.science && byId.efficiency && byId.science.points > byId.science.max * 0.7 && byId.efficiency.points < byId.efficiency.max * 0.5) {
      tradeoffs.push({ code: 'report.tradeoff.science_vs_resources' });
    }
    if (byId.mission && byId.mission.points >= byId.mission.max * 0.9 && byId.survival && byId.survival.points < byId.survival.max * 0.5) {
      tradeoffs.push({ code: 'report.tradeoff.mission_vs_crew' });
    }
    if (report.votes && report.votes.total > 0 && report.votes.agreed === 0) {
      tradeoffs.push({ code: 'report.tradeoff.no_agreement' });
    }
    if (report.resources && report.resources.dataLost > report.resources.dataTransmitted) {
      tradeoffs.push({ code: 'report.tradeoff.data_left_behind' });
    }

    return {
      findings: findings,
      tradeoffs: tradeoffs,
      headline: report.result === 'success' ? 'report.headline.success' : report.result === 'failure' ? 'report.headline.failure' : 'report.headline.partial'
    };
  }

  /** Compares two reports or two designs for the comparator (G-3). */
  function compare(a, b) {
    var rows = [];
    var numeric = function (label, valueA, valueB, higherIsBetter) {
      var delta = (Number(valueB) || 0) - (Number(valueA) || 0);
      rows.push({
        id: label,
        a: Math.round((Number(valueA) || 0) * 10) / 10,
        b: Math.round((Number(valueB) || 0) * 10) / 10,
        delta: Math.round(delta * 10) / 10,
        better: delta === 0 ? 'tie' : (delta > 0) === !!higherIsBetter ? 'b' : 'a'
      });
    };
    if (a && a.score !== undefined && b && b.score !== undefined) {
      numeric('compare.score', a.score, b.score, true);
      numeric('compare.science', a.science, b.science, true);
      numeric('compare.budget_spent', a.resources && a.resources.budgetSpent, b.resources && b.resources.budgetSpent, false);
      numeric('compare.end_day', a.endDay, b.endDay, false);
      numeric('compare.crew_alive', aliveOf(a), aliveOf(b), true);
      return { kind: 'report', rows: rows, resultA: a.result, resultB: b.result };
    }
    var totals = function (design) {
      return (design && design.totals) || {};
    };
    var ta = totals(a);
    var tb = totals(b);
    numeric('compare.mass', ta.mass, tb.mass, false);
    numeric('compare.power', ta.powerDraw, tb.powerDraw, false);
    numeric('compare.cost', ta.cost, tb.cost, false);
    numeric('compare.data_rate', ta.dataRate, tb.dataRate, true);
    return {
      kind: 'design',
      rows: rows,
      scenarioA: a && a.scenarioId,
      scenarioB: b && b.scenarioId,
      orbitA: a && a.orbitId,
      orbitB: b && b.orbitId,
      launcherA: a && a.launcherId,
      launcherB: b && b.launcherId
    };
  }

  function aliveOf(report) {
    return (report.crew || []).filter(function (member) {
      return member.alive;
    }).length;
  }

  return {
    MAX: MAX,
    score: score,
    buildReport: buildReport,
    analyze: analyze,
    compare: compare
  };
});
