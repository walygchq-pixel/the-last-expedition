/*
 * Intérprete de efectos declarativos.
 *
 * Eventos, objetos de la nave y acciones describen sus consecuencias como datos
 * (`{type:'system', id:'power', op:'degrade', value:12}`) y este módulo las aplica
 * sobre el estado de la partida. Así el contenido vive en `data/` y la lógica de
 * aplicación vive en un solo lugar, sin texto y sin DOM.
 */
(function (global, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./systems.js'), require('./crew.js'), require('./food.js'), require('./consequences.js'));
  } else {
    var GS = (global.GS = global.GS || {});
    GS.core = GS.core || {};
    GS.core.effects = factory(GS.core.systems, GS.core.crew, GS.core.food, GS.core.consequences);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (systems, crew, food, consequences) {
  'use strict';

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function scale(value, factor) {
    var n = Number(value);
    var f = isFinite(factor) ? factor : 1;
    return isFinite(n) ? Math.round(n * f * 10) / 10 : 0;
  }

  /**
   * Aplica una lista de efectos.
   * @param {Object} target `{systems, crew, resources, pantry, log, datastore, flags, stats}`
   * @param {Array} effects descriptores declarativos
   * @param {Object} ctx `{rng, day, severity, actorRole, engagement}`
   * @returns {{applied:Array, codes:Array}} descriptores aplicados y códigos para la UI
   */
  function applyEffects(target, effects, ctx) {
    var context = ctx || {};
    var severity = isFinite(context.severity) ? context.severity : 1;
    var applied = [];
    var codes = [];
    var rng = context.rng;

    (effects || []).forEach(function (effect) {
      if (!effect || !effect.type) return;
      var value = scale(effect.value, effect.scaled === false ? 1 : severity);
      switch (effect.type) {
        case 'system':
          applySystem(target, effect, value, applied, codes);
          break;
        case 'crew':
          applyCrew(target, effect, value, applied, codes);
          break;
        case 'crewCondition': {
          var days = scale(effect.days || 2, 1);
          target.crew.members.forEach(function (member) {
            if (effect.id !== 'all' && member.id !== effect.id) return;
            if (!member.alive) return;
            if (effect.condition === 'ill') member.illnessDays = Math.max(member.illnessDays, days);
            member.health = clamp(member.health - (effect.damage || 0), 0, 100);
            // Un daño que deja la salud en cero mata al tripulante: si no, el conteo
            // de vivos lo seguiría sumando y la partida nunca cerraría por pérdida
            // de tripulación (hallazgo R3-CREW-DEATH).
            if (member.health <= 0) member.alive = false;
            if (member.conditions.indexOf(effect.condition) === -1) member.conditions.push(effect.condition);
          });
          applied.push({ type: 'crewCondition', condition: effect.condition, days: days });
          codes.push({ code: 'msg.crew_condition', params: { condition: 'crew.condition.' + effect.condition, days: days } });
          break;
        }
        case 'resource':
          if (effect.id === 'budget' || effect.id === 'data') {
            target.resources[effect.id === 'budget' ? 'budget' : 'dataStored'] = Math.max(
              0,
              (target.resources[effect.id === 'budget' ? 'budget' : 'dataStored'] || 0) + value
            );
          } else if (effect.id === 'bandwidth') {
            target.resources.bandwidth = clamp((target.resources.bandwidth || 0) + value / 100, 0, 1);
          }
          applied.push({ type: 'resource', id: effect.id, value: value });
          break;
        case 'food':
          if (effect.op === 'freshness') {
            target.pantry.items.forEach(function (item) {
              item.freshness = clamp(item.freshness + value, 0, 100);
            });
          } else if (effect.op === 'waste') {
            target.pantry.waste = clamp((target.pantry.waste || 0) + value, 0, 100);
          }
          applied.push({ type: 'food', op: effect.op, value: value });
          break;
        case 'consequence': {
          var scheduled = consequences.schedule(target.log, {
            code: effect.code,
            params: effect.params || {},
            whyKey: effect.whyKey,
            severity: effect.severity || 'warn',
            cause: effect.cause || 'event',
            origin: effect.origin || context.origin || null,
            // Los efectos anidados son los que convierten la consecuencia en un
            // daño real cuando vence el disparador (V-10, V-11).
            effects: effect.effects || [],
            // `dueInDays` es relativo al día actual; el libro suma la posición.
            dueInDays: isFinite(effect.dueInDays) ? effect.dueInDays : undefined,
            dueAfterEvents: effect.dueAfterEvents
          });
          applied.push({ type: 'consequence', id: scheduled.id, code: scheduled.code });
          codes.push({ code: 'msg.scheduled', params: { code: scheduled.code } });
          break;
        }
        case 'flag':
          target.flags = target.flags || {};
          target.flags[effect.id] = effect.value === undefined ? true : effect.value;
          applied.push({ type: 'flag', id: effect.id });
          break;
        case 'data':
          // Pérdida o ganancia de datos almacenados (C-1, C-4).
          target.datastore.total = Math.max(0, (target.datastore.total || 0) + value);
          applied.push({ type: 'data', value: value });
          break;
        case 'chance': {
          // Efecto condicional: solo se aplica si el azar acompaña.
          var probability = isFinite(effect.p) ? effect.p : 0.5;
          if (rng && rng.chance(probability)) {
            var nested = applyEffects(target, effect.effects || [], context);
            applied = applied.concat(nested.applied);
            codes = codes.concat(nested.codes);
          }
          break;
        }
        case 'stat':
          target.stats = target.stats || {};
          target.stats[effect.id] = (target.stats[effect.id] || 0) + value;
          applied.push({ type: 'stat', id: effect.id, value: value });
          break;
        default:
          break;
      }
    });

    return { applied: applied, codes: codes };
  }

  function applySystem(target, effect, value, applied, codes) {
    if (!target.systems || !target.systems[effect.id]) return;
    if (effect.op === 'repair') {
      var repaired = systems.repair(target.systems, effect.id, Math.abs(value));
      applied.push({ type: 'system', id: effect.id, op: 'repair', value: repaired });
      codes.push({ code: 'msg.system_repaired', params: { system: 'sys.' + effect.id + '.name', points: repaired } });
      return;
    }
    if (effect.op === 'service') {
      var serviced = systems.service(target.systems, effect.id, Math.abs(value));
      applied.push({ type: 'system', id: effect.id, op: 'service', value: serviced });
      return;
    }
    if (effect.op === 'reliability') {
      target.systems[effect.id].reliability = clamp(target.systems[effect.id].reliability + value, 0, 100);
      applied.push({ type: 'system', id: effect.id, op: 'reliability', value: value });
      return;
    }
    var descriptor = systems.degrade(target.systems, effect.id, Math.abs(value), effect.cause || 'effect');
    if (descriptor) {
      applied.push({ type: 'system', id: effect.id, op: 'degrade', value: descriptor.points });
      codes.push({ code: 'msg.system_damaged', params: { system: 'sys.' + effect.id + '.name', points: descriptor.points } });
    }
  }

  function applyCrew(target, effect, value, applied, codes) {
    var members = target.crew.members.filter(function (member) {
      if (!member.alive) return false;
      return effect.id === 'all' || member.id === effect.id || (effect.role && member.role === effect.role);
    });
    members.forEach(function (member) {
      if (effect.need) {
        var before = member[effect.need];
        member[effect.need] = clamp((isFinite(before) ? before : 0) + value, 0, 100);
      } else if (isFinite(effect.health)) {
        member.health = clamp(member.health + value, 0, 100);
      }
      if (isFinite(effect.morale)) member.morale = clamp(member.morale + scale(effect.morale, 1), 0, 100);
      if (isFinite(effect.stress)) member.stress = clamp(member.stress + scale(effect.stress, 1), 0, 100);
      if (member.health <= 0) member.alive = false;
    });
    applied.push({ type: 'crew', id: effect.id, need: effect.need || null, value: value, count: members.length });
    if (members.length > 0) {
      codes.push({
        code: 'msg.crew_effect',
        params: {
          need: effect.need ? 'crew.need.' + effect.need : 'crew.need.health',
          value: Math.abs(value),
          count: members.length
        }
      });
    }
  }

  return { applyEffects: applyEffects };
});
