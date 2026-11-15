/*
 * Mission resource panel (section 5).
 *
 * `evaluate()` is the only place where the status of each resource is decided, so
 * that the design HUD and the travel HUD show exactly the same thing (RG-5/RN-1)
 * and so that the colour code always travels together with shape and icon (RN-2).
 */
(function (global, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    var GS = (global.GS = global.GS || {});
    GS.core = GS.core || {};
    GS.core.resources = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Fixed order of the panel: mass, power, budget, data, comms, time.
  var ORDER = ['mass', 'power', 'budget', 'data', 'comms', 'time'];

  /*
   * Geometric shape and icon per resource (RN-2, S-15). They live here and not in
   * the UI because they are part of the data contract (C-6): the UI never invents them.
   */
  var SHAPES = {
    mass: 'square',
    power: 'triangle',
    budget: 'diamond',
    data: 'circle',
    comms: 'diamond',
    time: 'triangle'
  };

  var ICONS = {
    mass: 'weight',
    power: 'bolt',
    budget: 'coin',
    data: 'database',
    comms: 'antenna',
    time: 'clock'
  };

  /** Qualitative status from a normalized 0..1 ratio. */
  function statusFromRatio(ratio, direction) {
    var value = isFinite(ratio) ? ratio : 0;
    if (direction === 'usage') {
      // The more of what is available gets used, the worse.
      if (value > 1) return 'critical';
      if (value > 0.8) return 'warn';
      return 'ok';
    }
    if (direction === 'margin') {
      // Remaining margin: if it is negative or minimal, it is critical.
      if (value <= 0.02) return 'critical';
      if (value < 0.15) return 'warn';
      return 'ok';
    }
    // 'stock': remaining amount (budget, time, comms window).
    if (value <= 0.1) return 'critical';
    if (value < 0.3) return 'warn';
    return 'ok';
  }

  function ratio(part, whole) {
    var a = Number(part);
    var b = Number(whole);
    if (!isFinite(a)) return 0;
    if (!isFinite(b) || b === 0) return 0;
    return a / b;
  }

  /**
   * Builds the resource state of a mission.
   * @param {Object} input flat data (mass, max mass, power generated and consumed,
   *   budget available and spent, data stored and capacity, bandwidth fraction,
   *   days left and total service life, critical resource).
   */
  function createResources(input) {
    var source = input || {};
    return {
      mass: numberOr(source.mass, 0),
      massMax: numberOr(source.massMax, 0),
      powerGen: numberOr(source.powerGen, 0),
      powerDraw: numberOr(source.powerDraw, 0),
      budget: numberOr(source.budget, 0),
      budgetTotal: numberOr(source.budgetTotal, 0),
      dataStored: numberOr(source.dataStored, 0),
      dataCap: numberOr(source.dataCap, 0),
      bandwidth: clamp01(source.bandwidth === undefined ? 0 : source.bandwidth),
      daysLeft: numberOr(source.daysLeft, 0),
      missionDays: numberOr(source.missionDays, 0),
      critical: source.critical || 'power'
    };
  }

  function numberOr(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }

  function clamp01(value) {
    var n = Number(value);
    if (!isFinite(n)) return 0;
    return Math.min(1, Math.max(0, n));
  }

  /** Sets a field of the resource state (mass, power, budget, …). */
  function set(state, field, value) {
    if (field in state) state[field] = numberOr(value, state[field]);
    return state;
  }

  /**
   * Spends a resource when it can. Returns `true` if the operation was applied.
   * Budget and data share the same cap semantics.
   */
  function spend(state, id, amount) {
    var cost = Math.max(0, numberOr(amount, 0));
    if (id === 'budget') {
      if (state.budget < cost) return false;
      state.budget = round3(state.budget - cost);
      return true;
    }
    if (id === 'data') {
      if (state.dataStored + cost > state.dataCap) return false;
      state.dataStored = round3(state.dataStored + cost);
      return true;
    }
    return false;
  }

  function round3(value) {
    return Math.round(value * 1000) / 1000;
  }

  /**
   * Evaluates every resource and returns the panel ready to paint.
   * `critical` is the resource declared critical by the scenario (RN-1) and `worst`
   * the one that is worst right now.
   */
  function evaluate(state) {
    var powerMargin = state.powerGen - state.powerDraw;
    var items = [
      makeItem('mass', state.mass, state.massMax, ratio(state.mass, state.massMax), 'usage', 'unit.kg'),
      makeItem('power', Math.max(0, powerMargin), state.powerGen, ratio(powerMargin, state.powerGen), 'margin', 'unit.w'),
      makeItem('budget', state.budget, state.budgetTotal, ratio(state.budget, state.budgetTotal), 'stock', 'unit.meur'),
      makeItem('data', state.dataStored, state.dataCap, ratio(state.dataStored, state.dataCap), 'usage', 'unit.kb'),
      makeItem('comms', clamp01(state.bandwidth), 1, clamp01(state.bandwidth), 'stock', 'unit.pct'),
      makeItem('time', state.daysLeft, state.missionDays, ratio(state.daysLeft, state.missionDays), 'stock', 'unit.days')
    ];

    var worst = items[0];
    var rank = { ok: 0, warn: 1, critical: 2 };
    for (var i = 1; i < items.length; i += 1) {
      if (rank[items[i].status] > rank[worst.status]) worst = items[i];
      else if (rank[items[i].status] === rank[worst.status] && items[i].ratio > worst.ratio && items[i].direction === 'usage') worst = items[i];
    }

    return {
      items: items,
      critical: state.critical,
      worst: worst.id,
      blocked: items.some(function (item) {
        return item.id === 'mass' && item.ratio > 1;
      })
    };
  }

  function makeItem(id, value, max, itemRatio, direction, unitKey) {
    var safeRatio = direction === 'margin' ? clamp01(itemRatio) : itemRatio;
    return {
      id: id,
      value: round3(value),
      max: round3(max),
      ratio: safeRatio,
      rawRatio: itemRatio,
      direction: direction,
      status: statusFromRatio(itemRatio, direction),
      shape: SHAPES[id],
      icon: ICONS[id],
      unit: unitKey
    };
  }

  return {
    ORDER: ORDER,
    SHAPES: SHAPES,
    ICONS: ICONS,
    createResources: createResources,
    evaluate: evaluate,
    set: set,
    spend: spend,
    statusFromRatio: statusFromRatio,
    ratio: ratio
  };
});
