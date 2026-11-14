/*
 * Tripulación y supervivencia (V-8, V-9, RG-9, RG-10).
 *
 * Cada jugador tiene salud, estrés, moral, sueño, hambre, sed e higiene. Las
 * necesidades suben con el tiempo y con la actividad; los niveles críticos
 * generan condiciones que penalizan la eficiencia y, en el peor caso, matan al
 * personaje. Nada de esto produce texto: se devuelven códigos para la UI.
 */
(function (global, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    var GS = (global.GS = global.GS || {});
    GS.core = GS.core || {};
    GS.core.crew = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ROLES = ['mission_planner', 'engineer', 'scientist', 'communications', 'medic_cook'];

  // Eficiencia por rol según la tarea (RG-9). 1 = neutro, >1 = bonificado.
  var ROLE_MODIFIERS = {
    mission_planner: { budget: 0.85, vote: 1.1, planning: 1.2 },
    engineer: { repair: 1.35, service: 1.2, cannibalize: 1.15 },
    scientist: { data: 1.2, instrument: 1.25 },
    communications: { bandwidth: 1.2, transmission: 1.15 },
    medic_cook: { medical: 1.3, food: 1.25, morale: 1.15 }
  };

  var NEED_KEYS = ['hunger', 'thirst', 'sleep', 'stress', 'hygiene'];

  function clamp(value, min, max) {
    var n = Number(value);
    if (!isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  function round1(value) {
    return Math.round(value * 10) / 10;
  }

  function createMember(id, role, nameKey) {
    return {
      id: id,
      role: ROLES.indexOf(role) === -1 ? 'engineer' : role,
      nameKey: nameKey || 'role.' + role + '.name',
      health: 100,
      // Necesidades: hambre, sed, falta de sueño y estrés suben; higiene baja.
      hunger: 12,
      thirst: 12,
      sleep: 88,
      stress: 14,
      morale: 72,
      hygiene: 82,
      alive: true,
      illnessDays: 0,
      conditions: [],
      activity: 0.5
    };
  }

  /**
   * Crea la tripulación. `players` es `[{id, role}]`; en modo individual hay un
   * solo jugador con todos los roles y penalización de eficiencia (RG-10).
   */
  function createCrew(players) {
    var list = (players && players.length ? players : [{ id: 'p1', role: 'engineer' }]).map(function (player, index) {
      return createMember(player.id || 'p' + (index + 1), player.role);
    });
    return {
      members: list,
      solo: list.length === 1,
      // S-6: en solitario las decisiones colectivas pierden un 15 % de eficiencia.
      collectiveEfficiency: list.length === 1 ? 0.85 : 1
    };
  }

  function member(state, id) {
    return state.members.find(function (item) {
      return item.id === id;
    });
  }

  /** Aplica una variación a una necesidad o atributo concreto. */
  function apply(state, id, delta) {
    var target = member(state, id);
    if (!target) return null;
    Object.keys(delta || {}).forEach(function (key) {
      if (key === 'health' || key === 'morale' || NEED_KEYS.indexOf(key) !== -1) {
        target[key] = round1(clamp(target[key] + Number(delta[key] || 0), 0, 100));
      }
    });
    return target;
  }

  /** Modificador de eficiencia por rol y tipo de tarea. */
  function roleModifier(role, task) {
    var table = ROLE_MODIFIERS[role];
    if (!table || !isFinite(table[task])) return 1;
    return table[task];
  }

  /**
   * Avanza las necesidades durante `days` días de misión.
   * @param {Object} ctx `{rng, foodFactor, waterFactor, temperature, moraleFactor}`
   */
  function tick(state, days, ctx) {
    var context = ctx || {};
    var step = Math.max(0, isFinite(days) ? days : 0);
    if (step === 0) return { deaths: [], criticals: [] };
    var food = isFinite(context.foodFactor) ? context.foodFactor : 1;
    var water = isFinite(context.waterFactor) ? context.waterFactor : 1;
    var temperature = isFinite(context.temperature) ? context.temperature : 1;
    var moraleFactor = isFinite(context.moraleFactor) ? context.moraleFactor : 1;
    var deaths = [];
    var criticals = [];

    state.members.forEach(function (target) {
      if (!target.alive) return;
      var activity = clamp(target.activity, 0, 1);

      // Necesidades básicas (V-9). La sed sube más rápido que el hambre.
      target.hunger = round1(clamp(target.hunger + step * (11 + activity * 6) * (2 - food), 0, 100));
      target.thirst = round1(clamp(target.thirst + step * (15 + activity * 8) * (2 - water), 0, 100));
      target.sleep = round1(clamp(target.sleep - step * (13 + activity * 12), 0, 100));
      target.hygiene = round1(clamp(target.hygiene - step * 6, 0, 100));

      // Estrés: sube con el desorden térmico y el aislamiento, baja con moral.
      var stressRate = 1.6 + (1 - clamp(temperature, 0, 1)) * 6 + (target.morale < 45 ? 2 : 0);
      target.stress = round1(clamp(target.stress + step * stressRate * (2 - moraleFactor) * 0.5, 0, 100));
      target.morale = round1(clamp(target.morale + step * (clamp(moraleFactor, 0, 1) * 2 - target.stress * 0.03), 0, 100));

      // Condiciones críticas progresivas (V-9).
      var conditions = [];
      if (target.hunger >= 85) conditions.push('starving');
      if (target.thirst >= 85) conditions.push('dehydrated');
      if (target.sleep <= 22) conditions.push('exhausted');
      if (target.stress >= 80) conditions.push('anxious');
      if (target.hygiene <= 25) conditions.push('unhygienic');
      if (target.illnessDays > 0) {
        conditions.push('ill');
        target.illnessDays = Math.max(0, round1(target.illnessDays - step));
      }
      target.conditions = conditions;
      if (conditions.length > 0) criticals.push({ memberId: target.id, conditions: conditions.slice() });

      // Daño por condiciones: lento al principio, acumulativo en el tiempo.
      var damage = 0;
      if (conditions.indexOf('starving') !== -1) damage += 2.2;
      if (conditions.indexOf('dehydrated') !== -1) damage += 3.4;
      if (conditions.indexOf('exhausted') !== -1) damage += 1.1;
      if (conditions.indexOf('ill') !== -1) damage += 1.8;
      if (conditions.indexOf('anxious') !== -1) damage += 0.6;
      if (damage > 0) target.health = round1(clamp(target.health - step * damage, 0, 100));
      else if (target.hunger < 55 && target.thirst < 55 && target.sleep > 45) {
        // Recuperación lenta cuando las necesidades están cubiertas.
        target.health = round1(clamp(target.health + step * 1.4, 0, 100));
      }

      if (target.health <= 0) {
        target.health = 0;
        target.alive = false;
        deaths.push({ memberId: target.id, cause: conditions[0] || 'unknown' });
      }
    });

    return { deaths: deaths, criticals: criticals };
  }

  /** Estado legible de un miembro para la UI (sin texto). */
  function status(target) {
    if (!target) return { severity: 0, conditions: [] };
    var worst = Math.max(target.hunger, target.thirst, target.stress, 100 - target.sleep);
    return {
      alive: target.alive,
      severity: round1(clamp(worst / 100, 0, 1)),
      conditions: (target.conditions || []).slice(),
      health: target.health,
      morale: target.morale
    };
  }

  /** Eficiencia media de la tripulación viva, para puntuar colaboración (P-1). */
  function efficiency(state) {
    var alive = state.members.filter(function (target) {
      return target.alive;
    });
    if (alive.length === 0) return 0;
    var total = alive.reduce(function (sum, target) {
      var penalties = target.conditions.length * 0.08;
      return sum + clamp(1 - penalties - (100 - target.health) / 300, 0.2, 1);
    }, 0);
    return total / alive.length;
  }

  function aliveCount(state) {
    return state.members.filter(function (target) {
      return target.alive;
    }).length;
  }

  return {
    ROLES: ROLES,
    ROLE_MODIFIERS: ROLE_MODIFIERS,
    createCrew: createCrew,
    member: member,
    apply: apply,
    tick: tick,
    status: status,
    efficiency: efficiency,
    aliveCount: aliveCount,
    roleModifier: roleModifier
  };
});
