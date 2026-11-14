/*
 * Motor de eventos aleatorios y programados (V-14, V-15, V-16).
 *
 * Los eventos y sus respuestas viven en `data/events.json` con efectos declarativos
 * (ver `core/effects.js`). La dificultad cambia la frecuencia, la gravedad y si los
 * eventos severos están disponibles. Ninguna respuesta es siempre la mejor: cada
 * una tiene un coste en otro recurso.
 */
(function (global, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    var GS = (global.GS = global.GS || {});
    GS.core = GS.core || {};
    GS.core.events = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Perfiles por dificultad (DM-13, V-16, S-11).
  var DIFFICULTIES = {
    basic: {
      id: 'basic',
      budget: 500,
      missionDays: 90,
      eventRate: 0.32,
      severity: 0.75,
      allowSevere: false,
      tutorial: true,
      allowsAdvancedParts: false,
      leaderboardFactor: 0.8
    },
    intermediate: {
      id: 'intermediate',
      budget: 350,
      missionDays: 150,
      eventRate: 0.55,
      severity: 1,
      allowSevere: true,
      tutorial: false,
      allowsAdvancedParts: true,
      leaderboardFactor: 1
    },
    advanced: {
      id: 'advanced',
      budget: 250,
      missionDays: 200,
      eventRate: 0.8,
      severity: 1.25,
      allowSevere: true,
      tutorial: false,
      allowsAdvancedParts: true,
      leaderboardFactor: 1.25
    }
  };

  function profileFor(difficultyId) {
    return DIFFICULTIES[difficultyId] || DIFFICULTIES.intermediate;
  }

  function createEngine(profile) {
    var config = profile && profile.eventRate !== undefined ? profile : profileFor(profile);
    return {
      profile: config,
      rate: config.eventRate,
      severity: config.severity,
      allowSevere: config.allowSevere,
      firedAt: {},
      cooldowns: {}
    };
  }

  /** Un evento está disponible si cumple día mínimo, enfriamiento y requisitos. */
  function isEligible(definition, engine, ctx) {
    var context = ctx || {};
    var day = isFinite(context.day) ? context.day : 0;
    if (definition.kind === 'scheduled') return false;
    if (definition.severity === 'severe' && !engine.allowSevere) return false;
    if (isFinite(definition.minDay) && day < definition.minDay) return false;
    var lastFired = engine.firedAt[definition.id];
    var cooldown = isFinite(definition.cooldownDays) ? definition.cooldownDays : 8;
    if (isFinite(lastFired) && day - lastFired < cooldown) return false;
    var requires = definition.requires || {};
    if (requires.systemBelow) {
      var system = context.systems && context.systems[requires.systemBelow.id];
      if (!system || system.health >= requires.systemBelow.health) return false;
    }
    if (requires.systemAbove) {
      var above = context.systems && context.systems[requires.systemAbove.id];
      if (!above || above.health <= requires.systemAbove.health) return false;
    }
    if (requires.crewStressAbove && !hasStress(context.crew, requires.crewStressAbove)) return false;
    if (requires.freshnessBelow && !hasSpoiled(context.pantry, requires.freshnessBelow)) return false;
    if (requires.flag && !(context.flags && context.flags[requires.flag])) return false;
    return true;
  }

  function hasStress(crew, threshold) {
    if (!crew || !crew.members) return false;
    return crew.members.some(function (member) {
      return member.alive && member.stress >= threshold;
    });
  }

  function hasSpoiled(pantry, threshold) {
    if (!pantry || !pantry.items) return false;
    return pantry.items.some(function (item) {
      return item.qty > 0 && item.freshness < threshold;
    });
  }

  /**
   * Sortea los eventos de este paso.
   * @param {Object} ctx `{catalog, day, days, systems, crew, pantry, flags, rng}`
   * @returns {Array} eventos disparados, ya materializados
   */
  function roll(engine, ctx) {
    var context = ctx || {};
    var rng = context.rng;
    var catalog = (context.catalog || []).filter(function (definition) {
      return definition.kind !== 'scheduled';
    });
    var step = isFinite(context.days) ? Math.min(3, Math.max(0, context.days)) : 0;
    if (!rng || step <= 0 || catalog.length === 0) return [];
    var fired = [];

    // A lo sumo dos eventos por paso: el juego debe seguir siendo legible.
    for (var attempt = 0; attempt < 2; attempt += 1) {
      var eligible = catalog.filter(function (definition) {
        return isEligible(definition, engine, context);
      });
      if (eligible.length === 0) break;
      var weighted = eligible.map(function (definition) {
        var weight = isFinite(definition.weight) ? definition.weight : 1;
        if (definition.severity === 'severe') weight *= engine.severity;
        return { value: definition, weight: weight };
      });
      var chosen = rng.weighted(weighted);
      if (!chosen) break;
      var chance = 1 - Math.pow(1 - Math.min(0.9, engine.rate * step), 1);
      if (!rng.chance(chance)) break;
      fired.push(materialize(chosen, context.day || 0));
      engine.firedAt[chosen.id] = context.day || 0;
    }

    return fired;
  }

  /** Convierte una definición de datos en una instancia de evento para la partida. */
  function materialize(definition, day) {
    return {
      uid: definition.id + '@' + Math.round((day || 0) * 10),
      id: definition.id,
      titleKey: definition.titleKey,
      descriptionKey: definition.descriptionKey,
      severity: definition.severity || 'normal',
      day: day || 0,
      options: (definition.options || []).map(function (option) {
        return {
          id: option.id,
          labelKey: option.labelKey,
          estimateKey: option.estimateKey,
          whyKey: option.whyKey,
          effects: (option.effects || []).slice(),
          requiresRole: option.requiresRole || null
        };
      }),
      resolved: false
    };
  }

  /** Opciones de un evento (para el panel de decisiones). */
  function options(event) {
    return (event && event.options) || [];
  }

  function optionById(event, optionId) {
    return options(event).find(function (option) {
      return option.id === optionId;
    });
  }

  /**
   * Eventos programados por el escenario (tormenta solar al día 30, etc.).
   * Devuelve los que caen en la ventana `[fromDay, toDay)`.
   */
  function scheduled(catalog, fromDay, toDay) {
    return (catalog || [])
      .filter(function (definition) {
        return definition.kind === 'scheduled' && isFinite(definition.scheduledDay);
      })
      .filter(function (definition) {
        return definition.scheduledDay >= fromDay && definition.scheduledDay < toDay;
      })
      .map(function (definition) {
        return materialize(definition, definition.scheduledDay);
      });
  }

  return {
    DIFFICULTIES: DIFFICULTIES,
    profileFor: profileFor,
    createEngine: createEngine,
    isEligible: isEligible,
    roll: roll,
    materialize: materialize,
    options: options,
    optionById: optionById,
    scheduled: scheduled
  };
});
