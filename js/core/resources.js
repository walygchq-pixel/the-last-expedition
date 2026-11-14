/*
 * Panel de recursos de misión (sección 5).
 *
 * `evaluate()` es el único lugar donde se decide el estado de cada recurso, para
 * que el HUD del diseño y el del viaje muestren exactamente lo mismo (RG-5/RN-1)
 * y para que el código de color viaje acompañado siempre de forma e icono (RN-2).
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

  // Orden fijo del panel: masa, potencia, presupuesto, datos, comunicaciones, tiempo.
  var ORDER = ['mass', 'power', 'budget', 'data', 'comms', 'time'];

  /*
   * Forma geométrica e icono por recurso (RN-2, S-15). Viven acá y no en la UI
   * porque son parte del contrato de datos (C-6): la UI nunca los inventa.
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

  /** Estado cualitativo a partir de una razón normalizada 0..1. */
  function statusFromRatio(ratio, direction) {
    var value = isFinite(ratio) ? ratio : 0;
    if (direction === 'usage') {
      // Cuanto más se usa de lo disponible, peor.
      if (value > 1) return 'critical';
      if (value > 0.8) return 'warn';
      return 'ok';
    }
    if (direction === 'margin') {
      // Margen remanente: si es negativo o mínimo, es crítico.
      if (value <= 0.02) return 'critical';
      if (value < 0.15) return 'warn';
      return 'ok';
    }
    // 'stock': existencia remanente (presupuesto, tiempo, ventana de enlace).
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
   * Construye el estado de recursos de una misión.
   * @param {Object} input datos planos (masa, masa máxima, potencia generada y
   *   consumida, presupuesto disponible y gastado, datos almacenados y capacidad,
   *   fracción de ancho de banda, días restantes y vida útil total, recurso crítico).
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

  /** Ajusta un campo del estado de recursos (masa, potencia, presupuesto, …). */
  function set(state, field, value) {
    if (field in state) state[field] = numberOr(value, state[field]);
    return state;
  }

  /**
   * Gasta un recurso cuando se puede. Devuelve `true` si la operación se aplicó.
   * Presupuesto y datos comparten la misma semántica de tope.
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
   * Evalúa todos los recursos y devuelve el panel listo para pintar.
   * `critical` es el recurso declarado crítico por el escenario (RN-1) y `worst`
   * el que está peor ahora mismo.
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
