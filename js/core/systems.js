/*
 * Ship systems (V-6, V-7) and cannibalization (V-10, S-7).
 *
 * Every system has health 0..100 and reliability 0..100. Health degrades with use
 * and with low reliability; reliability drops with use and with failures. The
 * effects are exposed as 0..1 multipliers that the rest of the modules consume
 * (light, temperature, water, link), so that degradation is visible in the ship
 * and not only in a number.
 */
(function (global, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    var GS = (global.GS = global.GS || {});
    GS.core = GS.core || {};
    GS.core.systems = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SYSTEM_IDS = ['power', 'lifeSupport', 'comms', 'attitude', 'thermal', 'instruments'];

  var DEFAULT_RELIABILITY = 88;
  var CANNIBAL_RELIABILITY_MIN = 15;
  var CANNIBAL_RELIABILITY_MAX = 25;
  var CANNIBAL_FAULT_DAYS_MIN = 3;
  var CANNIBAL_FAULT_DAYS_MAX = 6;
  var CANNIBAL_FAULT_EVENTS = 5;

  function clamp(value, min, max) {
    var n = Number(value);
    if (!isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  function round1(value) {
    return Math.round(value * 10) / 10;
  }

  /**
   * Creates the system state from the mission design.
   * `design.parts` is a list of parts with `system`, `reliability` and `id`;
   * the origin of each system comes from there too (DM-6).
   */
  function createSystems(design) {
    var parts = (design && design.parts) || [];
    var items = {};
    SYSTEM_IDS.forEach(function (id) {
      var own = parts.filter(function (part) {
        return part.system === id;
      });
      var reliability = DEFAULT_RELIABILITY;
      if (own.length > 0) {
        var total = own.reduce(function (sum, part) {
          return sum + (isFinite(part.reliability) ? part.reliability : DEFAULT_RELIABILITY);
        }, 0);
        reliability = total / own.length;
      }
      items[id] = {
        id: id,
        health: 100,
        reliability: round1(reliability),
        origins: own.map(function (part) {
          return part.id;
        }),
        failures: 0
      };
    });
    return items;
  }

  function get(state, id) {
    return state ? state[id] : undefined;
  }

  function average(state) {
    var sum = 0;
    SYSTEM_IDS.forEach(function (id) {
      sum += state[id] ? state[id].health : 0;
    });
    return sum / SYSTEM_IDS.length;
  }

  /**
   * Degrades a system and returns the failure descriptor for the consequence
   * book or the log.
   */
  function degrade(state, id, points, cause) {
    var system = state && state[id];
    if (!system) return null;
    var applied = clamp(points, 0, system.health);
    system.health = round1(clamp(system.health - applied, 0, 100));
    system.reliability = round1(clamp(system.reliability - applied * 0.4, 0, 100));
    system.failures += 1;
    return {
      systemId: id,
      points: round1(applied),
      cause: cause || 'failure',
      health: system.health,
      reliability: system.reliability
    };
  }

  /** Repairs a system. Returns the points actually applied. */
  function repair(state, id, points) {
    var system = state && state[id];
    if (!system) return 0;
    var before = system.health;
    system.health = round1(clamp(system.health + points, 0, 100));
    return round1(system.health - before);
  }

  /** Restores reliability (preventive maintenance) without touching health. */
  function service(state, id, points) {
    var system = state && state[id];
    if (!system) return 0;
    var before = system.reliability;
    system.reliability = round1(clamp(system.reliability + points, 0, 100));
    return round1(system.reliability - before);
  }

  /**
   * Advances the wear over `days` mission days.
   * @param {Object} ctx `{rng, usage:{system:0..1}, severity:number}`
   * @returns {{failures:Array, worn:Array}}
   */
  function tick(state, days, ctx) {
    var context = ctx || {};
    var rng = context.rng;
    var severity = isFinite(context.severity) ? context.severity : 1;
    var usage = context.usage || {};
    var failures = [];
    var step = Math.max(0, isFinite(days) ? days : 0);
    if (step === 0) return { failures: failures };

    SYSTEM_IDS.forEach(function (id) {
      var system = state[id];
      if (!system) return;
      var load = isFinite(usage[id]) ? clamp(usage[id], 0, 1) : 0.5;

      // 1. Reliability drops with use (V-6).
      system.reliability = round1(clamp(system.reliability - step * (0.12 + load * 0.5) * severity, 0, 100));

      // 2. Failure probability: it grows with use and with low reliability.
      var hazard = (0.004 + load * 0.012 + (100 - system.reliability) / 100 * 0.02) * severity;
      var chancePerDay = 1 - Math.pow(1 - Math.min(0.95, hazard), 1);
      var probability = 1 - Math.pow(1 - chancePerDay, step);
      if (rng && rng.chance(probability)) {
        var magnitude = 8 + (rng ? rng.float(0, 18) : 9);
        failures.push(degrade(state, id, magnitude, 'random_failure'));
      }

      // 3. Very low reliability corrodes health even when there is no failure.
      if (system.reliability < 50) {
        system.health = round1(clamp(system.health - step * (50 - system.reliability) * 0.06 * severity, 0, 100));
      }
    });

    return { failures: failures };
  }

  /**
   * Cannibalizes one system to repair another instantly (V-10).
   * Returns the descriptor that the consequence book turns into a deferred
   * fault: donor reliability −15…−25 and a trigger at 3–6 days or 5 events.
   */
  function cannibalize(state, donorId, targetId, rng) {
    var donor = state && state[donorId];
    var target = state && state[targetId];
    if (!donor || !target || donorId === targetId) return null;

    var loss = rng ? rng.float(CANNIBAL_RELIABILITY_MIN, CANNIBAL_RELIABILITY_MAX) : 20;
    var repaired = repair(state, targetId, 55);
    donor.reliability = round1(clamp(donor.reliability - loss, 0, 100));
    var days = rng ? rng.int(CANNIBAL_FAULT_DAYS_MIN, CANNIBAL_FAULT_DAYS_MAX) : CANNIBAL_FAULT_DAYS_MAX;

    return {
      donorId: donorId,
      targetId: targetId,
      repaired: repaired,
      reliabilityLoss: round1(loss),
      donorReliability: donor.reliability,
      faultInDays: days,
      faultAfterEvents: CANNIBAL_FAULT_EVENTS
    };
  }

  /**
   * 0..1 multipliers consumed by the rest of the simulation and by the render.
   * `lighting` and `temperature` are the ones seen in the ship (V-7).
   */
  function effects(state) {
    var power = clamp(state.power.health / 100, 0, 1);
    var life = clamp(state.lifeSupport.health / 100, 0, 1);
    var thermal = clamp(state.thermal.health / 100, 0, 1);
    var comms = clamp(state.comms.health / 100, 0, 1);
    var attitude = clamp(state.attitude.health / 100, 0, 1);
    var instruments = clamp(state.instruments.health / 100, 0, 1);
    return {
      lighting: clamp(power * 0.75 + life * 0.25, 0.15, 1),
      temperature: clamp(thermal * 0.7 + power * 0.3, 0, 1),
      water: clamp(life, 0, 1),
      air: clamp(life * 0.9 + thermal * 0.1, 0, 1),
      commsQuality: clamp(comms * (0.6 + attitude * 0.4), 0, 1),
      dataQuality: clamp(instruments, 0, 1),
      powerFactor: power
    };
  }

  /** Summary for the HUD and to detect that the ship became inoperable (V-18). */
  function summary(state) {
    var worst = null;
    var criticalCount = 0;
    SYSTEM_IDS.forEach(function (id) {
      var system = state[id];
      if (!system) return;
      if (!worst || system.health < worst.health) worst = { id: id, health: system.health };
      if (system.health <= 5) criticalCount += 1;
    });
    return {
      average: round1(average(state)),
      worst: worst,
      criticalCount: criticalCount,
      // Inoperable ship: the five survival systems are dead.
      inoperable: criticalCount >= 4 && state.lifeSupport.health <= 5
    };
  }

  return {
    SYSTEM_IDS: SYSTEM_IDS,
    DEFAULT_RELIABILITY: DEFAULT_RELIABILITY,
    createSystems: createSystems,
    get: get,
    average: average,
    degrade: degrade,
    repair: repair,
    service: service,
    tick: tick,
    cannibalize: cannibalize,
    effects: effects,
    summary: summary
  };
});
