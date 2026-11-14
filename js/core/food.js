/*
 * Alimentos y frescura (V-11, S-8).
 *
 * La frescura baja 2 % por día a temperatura nominal y 8 % por día con la nevera
 * averiada. Con frescura menor al 30 % hay 35 % de probabilidad de enfermedad
 * leve, que aparece 1 a 3 días después. Los alimentos en mal estado dejan además
 * residuos que degradan el soporte vital.
 */
(function (global, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    var GS = (global.GS = global.GS || {});
    GS.core = GS.core || {};
    GS.core.food = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var NOMINAL_RATE = 2;
  var BROKEN_FRIDGE_RATE = 8;
  var SPOILED_THRESHOLD = 30;
  var ILLNESS_CHANCE = 0.35;
  var ILLNESS_DELAY_MIN = 1;
  var ILLNESS_DELAY_MAX = 3;
  var WASTE_PER_SPOILED_MEAL = 4;

  function clamp(value, min, max) {
    var n = Number(value);
    if (!isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  function round1(value) {
    return Math.round(value * 10) / 10;
  }

  /**
   * Crea la despensa. Cada ítem declara `id` (clave de datos), `qty` y
   * opcionalmente su frescura inicial.
   */
  function createPantry(items) {
    return {
      items: (items || []).map(function (item) {
        return {
          id: item.id,
          qty: isFinite(item.qty) ? item.qty : 1,
          freshness: isFinite(item.freshness) ? item.freshness : 100,
          kind: item.kind || 'meal'
        };
      }),
      waste: 0
    };
  }

  /**
   * Avanza la frescura durante `days` días.
   * @param {Object} ctx `{fridgeOk:boolean, temperature:0..1}`
   */
  function tick(state, days, ctx) {
    var context = ctx || {};
    var step = Math.max(0, isFinite(days) ? days : 0);
    if (step === 0) return { spoiled: [], wasteAdded: 0 };
    var rate = context.fridgeOk === false ? BROKEN_FRIDGE_RATE : NOMINAL_RATE;
    // Una nave caliente estropea la comida más rápido: la temperatura no es un
    // detalle decorativo, está conectada con esta regla.
    if (isFinite(context.temperature) && context.temperature < 0.75) rate *= 1.5;
    var spoiled = [];
    var wasteAdded = 0;

    state.items.forEach(function (item) {
      if (item.qty <= 0) return;
      var before = item.freshness;
      item.freshness = round1(clamp(item.freshness - step * rate, 0, 100));
      if (before >= SPOILED_THRESHOLD && item.freshness < SPOILED_THRESHOLD) spoiled.push(item.id);
      if (item.freshness < SPOILED_THRESHOLD) {
        var added = step * 0.4;
        state.waste = round1(clamp(state.waste + added, 0, 100));
        wasteAdded += added;
      }
    });

    return { spoiled: spoiled, wasteAdded: round1(wasteAdded) };
  }

  /** `true` si el ítem ya no es seguro. */
  function isSpoiled(item) {
    return !!item && item.freshness < SPOILED_THRESHOLD;
  }

  /**
   * Come una unidad de un ítem. Devuelve la decisión de enfermedad ya sorteada
   * para que el juego la agende como consecuencia diferida (1–3 días).
   */
  function eat(state, memberId, itemId, rng) {
    var item = state.items.find(function (candidate) {
      return candidate.id === itemId;
    });
    if (!item || item.qty <= 0) return { ok: false, code: 'food.empty' };

    var freshness = item.freshness;
    var risk = freshness < SPOILED_THRESHOLD ? ILLNESS_CHANCE : freshness < 60 ? 0.12 : 0.02;
    var sick = rng ? rng.chance(risk) : false;
    var delay = rng ? rng.int(ILLNESS_DELAY_MIN, ILLNESS_DELAY_MAX) : ILLNESS_DELAY_MAX;

    if (freshness < SPOILED_THRESHOLD) {
      state.waste = round1(clamp(state.waste + WASTE_PER_SPOILED_MEAL, 0, 100));
    }
    item.qty = Math.max(0, item.qty - 1);

    return {
      ok: true,
      memberId: memberId,
      itemId: itemId,
      freshness: freshness,
      spoiled: freshness < SPOILED_THRESHOLD,
      illness: {
        willHappen: sick,
        delayDays: sick ? delay : 0,
        risk: risk
      },
      waste: state.waste
    };
  }

  /** Nivel de contaminación 0..100 que castiga al soporte vital. */
  function contamination(state) {
    return round1(clamp(state.waste, 0, 100));
  }

  /** Cuántas unidades comestibles quedan por encima del umbral de seguridad. */
  function safeServings(state) {
    return state.items.reduce(function (sum, item) {
      return sum + (item.freshness >= SPOILED_THRESHOLD ? item.qty : 0);
    }, 0);
  }

  function totalServings(state) {
    return state.items.reduce(function (sum, item) {
      return sum + Math.max(0, item.qty);
    }, 0);
  }

  /** Limpia residuos (acción de la cocina). Devuelve lo que se limpió. */
  function clean(state, amount) {
    var before = state.waste;
    state.waste = round1(clamp(state.waste - Math.max(0, amount || 30), 0, 100));
    return round1(before - state.waste);
  }

  return {
    NOMINAL_RATE: NOMINAL_RATE,
    BROKEN_FRIDGE_RATE: BROKEN_FRIDGE_RATE,
    SPOILED_THRESHOLD: SPOILED_THRESHOLD,
    ILLNESS_CHANCE: ILLNESS_CHANCE,
    createPantry: createPantry,
    tick: tick,
    eat: eat,
    isSpoiled: isSpoiled,
    contamination: contamination,
    safeServings: safeServings,
    totalServings: totalServings,
    clean: clean
  };
});
