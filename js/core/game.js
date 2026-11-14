/*
 * Orquestador de la simulación (RG-4, V-17, V-18, RG-11).
 *
 * Este módulo es el único punto de entrada que la UI y los tests usan para hacer
 * avanzar una partida: no conoce el DOM, no produce texto y todo su estado es
 * serializable (contrato C-5). Devuelve códigos de traducción que la UI resuelve.
 */
(function (global, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(
      require('./rng.js'),
      require('./time.js'),
      require('./systems.js'),
      require('./crew.js'),
      require('./food.js'),
      require('./datastore.js'),
      require('./comms.js'),
      require('./consequences.js'),
      require('./events.js'),
      require('./effects.js'),
      require('./resources.js'),
      require('./scoring.js')
    );
  } else {
    var GS = (global.GS = global.GS || {});
    GS.core = GS.core || {};
    GS.core.game = factory(
      GS.core.rng,
      GS.core.time,
      GS.core.systems,
      GS.core.crew,
      GS.core.food,
      GS.core.datastore,
      GS.core.comms,
      GS.core.consequences,
      GS.core.events,
      GS.core.effects,
      GS.core.resources,
      GS.core.scoring
    );
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (
  rngModule,
  time,
  systems,
  crew,
  food,
  datastore,
  comms,
  consequences,
  events,
  effectsModule,
  resources,
  scoring
) {
  'use strict';

  var SUBSTEP_DAYS = 0.25;
  var VOTE_MS = 30000;
  var FOOD_FRESHNESS_DEFAULT = 92;

  // Decisiones colectivas disponibles (RG-11, V-12). Cada opción tiene efectos
  // declarativos y una explicación educativa del porqué (V-13).
  var COLLECTIVE_DECISIONS = {
    ration: {
      code: 'decision.ration',
      durationMs: VOTE_MS,
      defaultOption: 'full',
      options: [
        {
          id: 'full',
          labelKey: 'decision.ration.opt.full',
          estimateKey: 'decision.ration.opt.full.estimate',
          whyKey: 'decision.ration.opt.full.why',
          effects: [
            { type: 'crew', id: 'all', need: 'hunger', value: -6 },
            { type: 'crew', id: 'all', need: 'morale', value: 2 },
            { type: 'stat', id: 'foodConsumed', value: 2 }
          ]
        },
        {
          id: 'half',
          labelKey: 'decision.ration.opt.half',
          estimateKey: 'decision.ration.opt.half.estimate',
          whyKey: 'decision.ration.opt.half.why',
          effects: [
            { type: 'crew', id: 'all', need: 'hunger', value: 8 },
            { type: 'crew', id: 'all', need: 'morale', value: -5 },
            { type: 'crew', id: 'all', need: 'stress', value: 4 },
            { type: 'stat', id: 'foodSaved', value: 2 }
          ]
        }
      ]
    },
    disable_instrument: {
      code: 'decision.disable_instrument',
      durationMs: VOTE_MS,
      defaultOption: 'keep',
      options: [
        {
          id: 'keep',
          labelKey: 'decision.disable.opt.keep',
          estimateKey: 'decision.disable.opt.keep.estimate',
          whyKey: 'decision.disable.opt.keep.why',
          effects: [{ type: 'flag', id: 'instrumentsForcedOn', value: true }]
        },
        {
          id: 'disable',
          labelKey: 'decision.disable.opt.disable',
          estimateKey: 'decision.disable.opt.disable.estimate',
          whyKey: 'decision.disable.opt.disable.why',
          effects: [
            { type: 'flag', id: 'instrumentsForcedOn', value: false },
            { type: 'stat', id: 'instrumentsOff', value: 1 }
          ]
        }
      ]
    },
    change_orbit: {
      code: 'decision.change_orbit',
      durationMs: VOTE_MS,
      defaultOption: 'stay',
      options: [
        {
          id: 'stay',
          labelKey: 'decision.orbit.opt.stay',
          estimateKey: 'decision.orbit.opt.stay.estimate',
          whyKey: 'decision.orbit.opt.stay.why',
          effects: []
        },
        {
          id: 'shift',
          labelKey: 'decision.orbit.opt.shift',
          estimateKey: 'decision.orbit.opt.shift.estimate',
          whyKey: 'decision.orbit.opt.shift.why',
          effects: [
            { type: 'system', id: 'attitude', op: 'degrade', value: 6 },
            { type: 'resource', id: 'budget', value: -12 },
            { type: 'flag', id: 'orbitShifted', value: true }
          ]
        }
      ]
    },
    emergency_transmission: {
      code: 'decision.emergency_transmission',
      durationMs: VOTE_MS,
      defaultOption: 'wait',
      options: [
        {
          id: 'wait',
          labelKey: 'decision.transmit.opt.wait',
          estimateKey: 'decision.transmit.opt.wait.estimate',
          whyKey: 'decision.transmit.opt.wait.why',
          effects: []
        },
        {
          id: 'burst',
          labelKey: 'decision.transmit.opt.burst',
          estimateKey: 'decision.transmit.opt.burst.estimate',
          whyKey: 'decision.transmit.opt.burst.why',
          effects: [
            { type: 'system', id: 'comms', op: 'degrade', value: 9 },
            { type: 'resource', id: 'budget', value: -6 },
            { type: 'stat', id: 'emergencyBursts', value: 1 }
          ]
        }
      ]
    }
  };

  function round1(value) {
    return Math.round(Number(value) * 10) / 10;
  }

  function clamp(value, min, max) {
    var n = Number(value);
    if (!isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  /**
   * Crea una partida en fase de viaje a partir de un diseño validado.
   * @param {Object} config `{mode, scenario, difficulty, design, players, seed,
   *   catalogs:{events, food}, evaluateObjective, now}`
   */
  function createGame(config) {
    var cfg = config || {};
    var scenario = cfg.scenario || { id: 'sandbox', missionDays: 90, critical: 'power', requiredData: 40 };
    var profile = cfg.difficulty && cfg.difficulty.id ? cfg.difficulty : events.profileFor(cfg.difficultyId || scenario.difficultyId);
    var design = cfg.design || { parts: [], totals: {}, instruments: [], orbit: null, launcher: null };
    var seed = cfg.seed === undefined ? 'mission-' + (cfg.now || 0) : cfg.seed;
    var generator = rngModule.createRng(seed);
    var missionDays = scenario.missionDays || profile.missionDays || 90;

    var game = {
      id: 'mission-' + rngModule.hashSeed(String(seed)).toString(36),
      version: 1,
      seed: seed,
      mode: cfg.mode || 'campaign',
      scenarioId: scenario.id,
      scenario: scenario,
      difficultyId: profile.id,
      difficulty: profile,
      design: design,
      clock: time.createClock(missionDays, {
        eclipseFraction: design.orbit && isFinite(design.orbit.eclipseFraction) ? design.orbit.eclipseFraction : 0.35
      }),
      systems: systems.createSystems(design),
      crew: crew.createCrew(cfg.players || [{ id: 'p1', role: 'engineer' }]),
      pantry: food.createPantry(scenario.pantry || defaultPantry(cfg.catalogs)),
      datastore: datastore.createStore(design.dataCapacity || scenario.dataCapacity || 60),
      log: consequences.createLog(),
      engine: events.createEngine(profile),
      pendingEvents: [],
      eventHistory: [],
      flags: {},
      vote: null,
      votes: { total: 0, agreed: 0 },
      stats: {
        repairs: 0,
        services: 0,
        cannibalizations: 0,
        meals: 0,
        spoiledMeals: 0,
        eventsResolved: 0,
        transmissions: 0,
        dataTransmitted: 0
      },
      journal: [],
      instruments: (design.instruments || []).map(function (instrument) {
        return { id: instrument.id, active: instrument.active !== false, draw: instrument.powerDraw || 0, rate: instrument.dataRate || 0 };
      }),
      objective: cfg.objective || { met: false, coverage: 0, checks: [] },
      status: 'travel',
      outcome: null,
      report: null,
      notices: [],
      catalogs: {
        events: (cfg.catalogs && cfg.catalogs.events) || [],
        food: (cfg.catalogs && cfg.catalogs.food) || []
      },
      evaluateObjective: cfg.evaluateObjective || null,
      createdAt: cfg.now || 0
    };

    game.rng = generator;
    game.rngState = generator.state();
    recomputeResources(game);
    game.objective = refreshObjective(game);
    log_initial(game);
    return game;
  }

  function defaultPantry(catalogs) {
    var catalog = (catalogs && catalogs.food) || [];
    if (catalog.length === 0) {
      return [
        { id: 'food.rations', qty: 40, freshness: FOOD_FRESHNESS_DEFAULT, kind: 'meal' },
        { id: 'food.fresh', qty: 14, freshness: 100, kind: 'produce' }
      ];
    }
    return catalog.map(function (item) {
      return { id: item.id, qty: item.qty, freshness: item.freshness === undefined ? FOOD_FRESHNESS_DEFAULT : item.freshness, kind: item.kind };
    });
  }

  function log_initial(game) {
    pushJournal(game, {
      code: 'journal.mission_start',
      params: { day: 1, scenario: 'scenario.' + game.scenarioId + '.name' },
      severity: 'info'
    });
  }

  function pushJournal(game, entry) {
    game.journal.push({
      day: round1(time.days(game.clock)),
      code: entry.code,
      params: entry.params || {},
      severity: entry.severity || 'info',
      whyKey: entry.whyKey || null
    });
    if (game.journal.length > 200) game.journal.shift();
  }

  function pushNotice(game, entry) {
    game.notices.push({
      id: 'n' + (game.notices.length + 1) + '-' + Date.now(),
      day: round1(time.days(game.clock)),
      code: entry.code,
      params: entry.params || {},
      severity: entry.severity || 'info',
      whyKey: entry.whyKey || null
    });
    if (game.notices.length > 20) game.notices.shift();
  }

  /** Recalcula potencia, masa, tiempo y ancho de banda antes de cada lectura del HUD. */
  function recomputeResources(game) {
    var base = game.design.totals || {};
    var activeDraw = game.instruments.reduce(function (sum, instrument) {
      return sum + (instrument.active ? instrument.draw : 0);
    }, 0);
    var totalDraw = (base.powerDrawBase || base.powerDraw || 0) + activeDraw;
    var eclipse = time.isEclipse(game.clock);
    var generation = (base.powerGen || 0) * (eclipse ? 0.25 : 1);
    var antenna = game.systems.comms ? game.systems.comms.health : 100;
    var windowState = comms.windowState({
      orbit: game.design.orbit || {},
      hours: game.clock.hours,
      antennaHealth: antenna,
      commsHealth: antenna
    });
    var bandwidth = windowState.open ? windowState.bandwidth : 0;

    game.resources = resources.createResources({
      mass: base.mass || 0,
      massMax: base.massMax || game.design.launcher && game.design.launcher.payloadCapacity || 0,
      powerGen: round1(generation),
      powerDraw: round1(totalDraw),
      budget: game.resources ? game.resources.budget : base.budgetRemaining || 0,
      budgetTotal: game.resources ? game.resources.budgetTotal : base.budgetTotal || 0,
      dataStored: game.datastore.total,
      dataCap: game.datastore.capacity,
      bandwidth: bandwidth,
      daysLeft: time.daysLeft(game.clock),
      missionDays: game.clock.missionDays,
      critical: game.scenario.critical || 'power'
    });
    return game.resources;
  }

  /** Evalúa el objetivo con el evaluador inyectado (mission/objectives). */
  function refreshObjective(game) {
    if (typeof game.evaluateObjective !== 'function') return game.objective;
    game.objective = game.evaluateObjective(game) || game.objective;
    return game.objective;
  }

  /**
   * Avanza la simulación con milisegundos reales.
   * @returns {{advancedDays:number, pendingEvents:number, ended:boolean}}
   */
  function tick(game, realMs) {
    if (game.status !== 'travel') return { advancedDays: 0, pendingEvents: 0, ended: true };

    if (game.vote) {
      game.vote.elapsedMs += realMs;
      if (game.vote.elapsedMs >= game.vote.durationMs) resolveVote(game, true);
      if (game.status !== 'travel') return { advancedDays: 0, pendingEvents: game.pendingEvents.length, ended: true };
    }

    // Un evento sin responder detiene el reloj: la tripulación tiene que decidir.
    if (game.pendingEvents.length > 0) {
      return { advancedDays: 0, pendingEvents: game.pendingEvents.length, ended: false };
    }

    var step = time.advance(game.clock, realMs);
    var remaining = step.deltaDays;
    while (remaining > 0) {
      var slice = Math.min(SUBSTEP_DAYS, remaining);
      simulateStep(game, slice);
      remaining -= slice;
      if (game.status !== 'travel') break;
    }

    recomputeResources(game);
    game.objective = refreshObjective(game);
    game.rngState = game.rng.state();
    checkEnd(game);
    return {
      advancedDays: round1(step.deltaDays * 100) / 100,
      pendingEvents: game.pendingEvents.length,
      ended: game.status !== 'travel'
    };
  }

  /** Un paso de simulación de como máximo 0,25 días. */
  function simulateStep(game, days) {
    var look = systems.effects(game.systems);
    var day = time.days(game.clock);

    // 1. Sistemas: desgaste, averías y efectos visibles (V-6, V-7).
    var usage = {
      power: 0.7,
      lifeSupport: 0.6,
      comms: look.commsQuality > 0.3 ? 0.5 : 0.2,
      attitude: 0.3,
      thermal: 0.45,
      instruments: game.instruments.some(function (i) { return i.active; }) ? 0.8 : 0.1
    };
    var systemResult = systems.tick(game.systems, days, {
      rng: game.rng,
      usage: usage,
      severity: game.difficulty.severity || 1
    });
    systemResult.failures.forEach(function (failure) {
      pushJournal(game, {
        code: 'journal.system_failure',
        params: { system: 'sys.' + failure.systemId + '.name', points: failure.points },
        severity: 'warn',
        whyKey: 'journal.why.system_failure'
      });
    });

    // 2. Tripulación: necesidades y condiciones (V-8, V-9).
    var crewResult = crew.tick(game.crew, days, {
      rng: game.rng,
      foodFactor: 1 - food.contamination(game.pantry) / 200,
      waterFactor: clamp(look.water, 0.3, 1),
      temperature: look.temperature,
      moraleFactor: 0.5 + look.lighting * 0.5
    });
    crewResult.criticals.forEach(function (critical) {
      pushJournal(game, {
        code: 'journal.crew_critical',
        params: { member: memberNameKey(game, critical.memberId), condition: 'crew.condition.' + critical.conditions[0] },
        severity: 'warn'
      });
    });
    crewResult.deaths.forEach(function (death) {
      pushJournal(game, {
        code: 'journal.crew_death',
        params: { member: memberNameKey(game, death.memberId), cause: 'crew.condition.' + death.cause },
        severity: 'severe'
      });
      pushNotice(game, {
        code: 'notice.crew_death',
        params: { member: memberNameKey(game, death.memberId) },
        severity: 'severe',
        whyKey: 'notice.why.crew_death'
      });
    });

    // 3. Alimentos: frescura, residuos y contaminación (V-11).
    var fridgeOk = !game.flags.fridgeBroken;
    var foodResult = food.tick(game.pantry, days, { fridgeOk: fridgeOk, temperature: look.temperature });
    if (foodResult.spoiled.length > 0) {
      foodResult.spoiled.forEach(function (itemId) {
        pushJournal(game, {
          code: 'journal.food_spoiled',
          params: { item: 'food.' + itemId + '.name' },
          severity: 'warn',
          whyKey: 'journal.why.food_spoiled'
        });
      });
    }
    var contamination = food.contamination(game.pantry);
    if (contamination > 35 && game.systems.lifeSupport) {
      // Los residuos en mal estado castigan al soporte vital (V-11).
      systems.degrade(game.systems, 'lifeSupport', days * (contamination - 35) * 0.05, 'contamination');
    }

    // 4. Datos científicos: producción de los instrumentos activos (C-1).
    var dataQuality = look.dataQuality;
    game.instruments.forEach(function (instrument) {
      if (!instrument.active || instrument.rate <= 0) return;
      var produced = instrument.rate * days * dataQuality;
      var result = datastore.produce(game.datastore, instrument.id, produced);
      if (result.lost > 0) {
        pushJournal(game, {
          code: 'journal.data_lost',
          params: { amount: result.lost },
          severity: 'warn',
          whyKey: 'journal.why.data_lost'
        });
      }
    });

    // 5. Consecuencias diferidas (V-10 … V-13).
    consequences.advance(game.log, { day: day, events: game.stats.eventsResolved });
    consequences.due(game.log).forEach(function (entry) {
      resolveConsequence(game, entry);
    });

    // 6. Eventos: los programados y los aleatorios (V-14, V-15, V-16).
    var scheduledNow = events.scheduled(game.catalogs.events, day - days, day);
    scheduledNow.forEach(function (event) {
      queueEvent(game, event);
    });
    var rolled = events.roll(game.engine, {
      catalog: game.catalogs.events,
      day: day,
      days: days,
      systems: game.systems,
      crew: game.crew,
      pantry: game.pantry,
      flags: game.flags,
      rng: game.rng
    });
    rolled.forEach(function (event) {
      queueEvent(game, event);
    });
  }

  function memberNameKey(game, memberId) {
    var found = crew.member(game.crew, memberId);
    return found ? found.nameKey : 'hud.crew';
  }

  /** Aplica una consecuencia ya vencida usando sus efectos declarativos. */
  function resolveConsequence(game, entry) {
    var applied = effectsModule.applyEffects(game, entry.effects || [], {
      rng: game.rng,
      day: time.days(game.clock),
      severity: game.difficulty.severity || 1,
      origin: entry.code
    });
    consequences.resolve(game.log, entry.id);
    pushJournal(game, {
      code: entry.code,
      params: entry.params || {},
      severity: entry.severity || 'warn',
      whyKey: entry.whyKey
    });
    pushNotice(game, {
      code: entry.code,
      params: entry.params || {},
      severity: entry.severity || 'warn',
      whyKey: entry.whyKey
    });
    return applied;
  }

  function queueEvent(game, event) {
    var duplicate = game.pendingEvents.some(function (pending) {
      return pending.uid === event.uid;
    });
    if (duplicate) return;
    game.pendingEvents.push(event);
    pushJournal(game, {
      code: 'journal.event',
      params: { event: event.titleKey },
      severity: event.severity === 'severe' ? 'severe' : 'warn',
      whyKey: event.descriptionKey
    });
    pushNotice(game, {
      code: 'notice.event',
      params: { event: event.titleKey },
      severity: event.severity === 'severe' ? 'severe' : 'warn',
      whyKey: event.descriptionKey
    });
  }

  /** Acciones sistémicas disponibles, con su estimación cuando se conoce (V-4). */
  function getActions(game) {
    var actions = [];
    var alive = game.crew.members.filter(function (member) {
      return member.alive;
    });

    alive.forEach(function (member) {
      actions.push({
        type: 'eat',
        memberId: member.id,
        labelKey: 'action.eat',
        estimateKey: 'action.eat.estimate'
      });
      actions.push({
        type: 'drink',
        memberId: member.id,
        labelKey: 'action.drink',
        estimateKey: 'action.drink.estimate'
      });
      actions.push({
        type: 'rest',
        memberId: member.id,
        labelKey: 'action.rest',
        estimateKey: 'action.rest.estimate'
      });
    });

    systems.SYSTEM_IDS.forEach(function (systemId) {
      var system = game.systems[systemId];
      if (!system) return;
      if (system.health < 100) {
        actions.push({
          type: 'repair',
          systemId: systemId,
          labelKey: 'action.repair',
          params: { system: 'sys.' + systemId + '.name' },
          estimateKey: 'action.repair.estimate',
          estimate: [{ code: 'estimate.health_up', params: { points: 28 } }]
        });
      }
      actions.push({
        type: 'service',
        systemId: systemId,
        labelKey: 'action.service',
        params: { system: 'sys.' + systemId + '.name' },
        estimateKey: 'action.service.estimate'
      });
    });

    // Canibalización: donantes posibles para cada sistema dañado (V-10).
    systems.SYSTEM_IDS.filter(function (id) {
      return game.systems[id] && game.systems[id].health < 100;
    }).forEach(function (targetId) {
      systems.SYSTEM_IDS.forEach(function (donorId) {
        if (donorId === targetId) return;
        actions.push({
          type: 'cannibalize',
          donorId: donorId,
          targetId: targetId,
          labelKey: 'action.cannibalize',
          params: { donor: 'sys.' + donorId + '.name', target: 'sys.' + targetId + '.name' },
          estimateKey: 'action.cannibalize.estimate',
          estimate: [{ code: 'estimate.deferred_fault', params: { days: '3-6' }, severity: 'warn' }]
        });
      });
    });

    actions.push({ type: 'clean', labelKey: 'action.clean', estimateKey: 'action.clean.estimate' });
    actions.push({ type: 'transmit', labelKey: 'action.transmit', estimateKey: 'action.transmit.estimate' });

    game.instruments.forEach(function (instrument) {
      actions.push({
        type: 'toggle_instrument',
        instrumentId: instrument.id,
        labelKey: instrument.active ? 'action.instrument_off' : 'action.instrument_on',
        params: { instrument: 'instrument.' + instrument.id + '.name' },
        estimateKey: 'action.toggle_instrument.estimate'
      });
    });

    Object.keys(COLLECTIVE_DECISIONS).forEach(function (id) {
      actions.push({
        type: 'propose',
        decisionId: id,
        labelKey: 'action.propose',
        params: { decision: COLLECTIVE_DECISIONS[id].code },
        estimateKey: 'action.propose.estimate'
      });
    });

    actions.push({ type: 'finish', labelKey: 'action.finish', estimateKey: 'action.finish.estimate' });
    return actions;
  }

  /**
   * Ejecuta una acción. Devuelve `{ok, codes:[{code, params}], severity}` listo
   * para que la UI muestre el resultado y su explicación (V-13).
   */
  function applyAction(game, action) {
    var input = action || {};
    if (game.status !== 'travel') return { ok: false, codes: [{ code: 'msg.mission_over' }], severity: 'warn' };

    switch (input.type) {
      case 'eat':
        return doEat(game, input);
      case 'drink':
        return doDrink(game, input);
      case 'rest':
        return doRest(game, input);
      case 'repair':
        return doRepair(game, input);
      case 'service':
        return doService(game, input);
      case 'cannibalize':
        return doCannibalize(game, input);
      case 'clean':
        return doClean(game);
      case 'transmit':
        return doTransmit(game, input);
      case 'toggle_instrument':
        return doToggleInstrument(game, input);
      case 'event_option':
        return doEventOption(game, input);
      case 'propose':
        return doPropose(game, input);
      case 'vote':
        return doVote(game, input);
      case 'finish':
        return finish(game, 'manual');
      default:
        return { ok: false, codes: [{ code: 'msg.unknown_action' }], severity: 'warn' };
    }
  }

  function doEat(game, input) {
    var target = crew.member(game.crew, input.memberId);
    if (!target || !target.alive) return { ok: false, codes: [{ code: 'msg.crew_unavailable' }] };
    var itemId = input.itemId;
    if (!itemId) {
      var best = game.pantry.items
        .filter(function (item) {
          return item.qty > 0;
        })
        .sort(function (a, b) {
          return a.freshness - b.freshness;
        })[0];
      itemId = best ? best.id : null;
    }
    if (!itemId) return { ok: false, codes: [{ code: 'msg.no_food' }], severity: 'warn' };

    var result = food.eat(game.pantry, target.id, itemId, game.rng);
    if (!result.ok) return { ok: false, codes: [{ code: result.code }], severity: 'warn' };

    target.hunger = clamp(target.hunger - 38, 0, 100);
    target.morale = clamp(target.morale + (result.spoiled ? -4 : 3), 0, 100);
    game.stats.meals += 1;
    var codes = [{ code: 'msg.ate', params: { item: 'food.' + itemId + '.name' } }];

    if (result.spoiled) {
      game.stats.spoiledMeals += 1;
      codes.push({ code: 'msg.ate_spoiled', params: { freshness: Math.round(result.freshness) }, severity: 'warn' });
    }
    if (result.illness.willHappen) {
      consequences.schedule(game.log, {
        code: 'cons.food_illness',
        params: { member: target.nameKey, risk: Math.round(result.illness.risk * 100) },
        whyKey: 'cons.why.food_illness',
        severity: 'warn',
        cause: 'food',
        dueInDays: result.illness.delayDays,
        effects: [
          { type: 'crewCondition', id: target.id, condition: 'ill', days: 2, damage: 4 },
          { type: 'crew', id: target.id, need: 'stress', value: 6 }
        ]
      });
      codes.push({
        code: 'msg.illness_scheduled',
        params: { member: target.nameKey, days: result.illness.delayDays },
        severity: 'warn'
      });
    }
    recomputeResources(game);
    game.objective = refreshObjective(game);
    return { ok: true, codes: codes, severity: result.spoiled ? 'warn' : 'info' };
  }

  function doDrink(game, input) {
    var target = crew.member(game.crew, input.memberId);
    if (!target || !target.alive) return { ok: false, codes: [{ code: 'msg.crew_unavailable' }] };
    if (game.systems.lifeSupport.health < 10) return { ok: false, codes: [{ code: 'msg.no_water' }], severity: 'warn' };
    target.thirst = clamp(target.thirst - 42, 0, 100);
    systems.degrade(game.systems, 'lifeSupport', 0.4, 'water_use');
    return { ok: true, codes: [{ code: 'msg.drank', params: { member: target.nameKey } }], severity: 'info' };
  }

  function doRest(game, input) {
    var target = crew.member(game.crew, input.memberId);
    if (!target || !target.alive) return { ok: false, codes: [{ code: 'msg.crew_unavailable' }] };
    target.sleep = clamp(target.sleep + 46, 0, 100);
    target.stress = clamp(target.stress - 9, 0, 100);
    target.hunger = clamp(target.hunger + 5, 0, 100);
    target.thirst = clamp(target.thirst + 7, 0, 100);
    return { ok: true, codes: [{ code: 'msg.rested', params: { member: target.nameKey } }], severity: 'info' };
  }

  function doRepair(game, input) {
    var system = game.systems[input.systemId];
    if (!system) return { ok: false, codes: [{ code: 'msg.unknown_system' }] };
    var actor = crew.member(game.crew, input.memberId);
    var bonus = actor && actor.alive ? crew.roleModifier(actor.role, 'repair') : 1;
    var points = systems.repair(game.systems, input.systemId, 28 * bonus);
    game.stats.repairs += 1;
    pushJournal(game, {
      code: 'journal.repair',
      params: { system: 'sys.' + input.systemId + '.name', points: round1(points) },
      severity: 'info',
      whyKey: 'journal.why.repair'
    });
    recomputeResources(game);
    return { ok: true, codes: [{ code: 'msg.repaired', params: { system: 'sys.' + input.systemId + '.name', points: round1(points) } }], severity: 'info' };
  }

  function doService(game, input) {
    var system = game.systems[input.systemId];
    if (!system) return { ok: false, codes: [{ code: 'msg.unknown_system' }] };
    var actor = crew.member(game.crew, input.memberId);
    var bonus = actor && actor.alive ? crew.roleModifier(actor.role, 'service') : 1;
    var points = systems.service(game.systems, input.systemId, 16 * bonus);
    game.stats.services += 1;
    return { ok: true, codes: [{ code: 'msg.serviced', params: { system: 'sys.' + input.systemId + '.name', points: round1(points) } }], severity: 'info' };
  }

  function doCannibalize(game, input) {
    var result = systems.cannibalize(game.systems, input.donorId, input.targetId, game.rng);
    if (!result) return { ok: false, codes: [{ code: 'msg.unknown_system' }] };
    game.stats.cannibalizations += 1;

    // V-10: la avería diferida queda agendada con su mensaje explicativo.
    var faultMagnitude = 10 + Math.round(game.rng.float(0, 8));
    consequences.schedule(game.log, {
      code: 'cons.cannibal_fault',
      params: {
        source: 'sys.' + input.donorId + '.name',
        target: 'sys.' + input.targetId + '.name'
      },
      whyKey: 'cons.why.cannibal_fault',
      severity: 'warn',
      cause: 'cannibalization',
      dueInDays: result.faultInDays,
      dueAfterEvents: result.faultAfterEvents,
      effects: [{ type: 'system', id: input.donorId, op: 'degrade', value: faultMagnitude }]
    });

    recomputeResources(game);
    return {
      ok: true,
      codes: [
        {
          code: 'msg.cannibalized',
          params: {
            donor: 'sys.' + input.donorId + '.name',
            target: 'sys.' + input.targetId + '.name',
            points: result.repaired,
            reliability: result.reliabilityLoss
          }
        },
        { code: 'msg.deferred_fault', params: { days: result.faultInDays, events: result.faultAfterEvents }, severity: 'warn' }
      ],
      severity: 'warn'
    };
  }

  function doClean(game) {
    var cleaned = food.clean(game.pantry, 30);
    return { ok: true, codes: [{ code: 'msg.cleaned', params: { amount: round1(cleaned) } }], severity: 'info' };
  }

  function doTransmit(game, input) {
    var look = systems.effects(game.systems);
    var state = comms.windowState({
      orbit: game.design.orbit || {},
      hours: game.clock.hours,
      antennaHealth: game.systems.comms.health,
      commsHealth: look.commsQuality * 100
    });
    if (!state.open) {
      return {
        ok: false,
        codes: [{ code: 'msg.no_window', params: { minutes: state.nextOpenInMinutes }, severity: 'warn' }],
        severity: 'warn'
      };
    }
    var capacity = comms.windowCapacity({
      orbit: game.design.orbit || {},
      hours: game.clock.hours,
      antennaHealth: game.systems.comms.health,
      commsHealth: look.commsQuality * 100
    });
    var priority = input.priority && input.priority.length ? input.priority : datastore.defaultPriority(game.datastore);
    var result = datastore.transmit(game.datastore, priority, capacity);
    game.stats.transmissions += 1;
    game.stats.dataTransmitted = round1(game.stats.dataTransmitted + result.total);
    recomputeResources(game);
    game.objective = refreshObjective(game);
    return {
      ok: true,
      codes: [{
        code: 'msg.transmitted',
        params: { amount: result.total, remaining: result.remaining, capacity: capacity }
      }],
      severity: 'info',
      detail: result
    };
  }

  function doToggleInstrument(game, input) {
    var instrument = game.instruments.find(function (item) {
      return item.id === input.instrumentId;
    });
    if (!instrument) return { ok: false, codes: [{ code: 'msg.unknown_instrument' }] };
    instrument.active = !instrument.active;
    recomputeResources(game);
    return {
      ok: true,
      codes: [{
        code: instrument.active ? 'msg.instrument_on' : 'msg.instrument_off',
        params: { instrument: 'instrument.' + instrument.id + '.name' }
      }],
      severity: 'info'
    };
  }

  function doEventOption(game, input) {
    var index = game.pendingEvents.findIndex(function (event) {
      return event.uid === input.uid;
    });
    if (index === -1) return { ok: false, codes: [{ code: 'msg.unknown_event' }] };
    var event = game.pendingEvents[index];
    var option = events.optionById(event, input.optionId);
    if (!option) return { ok: false, codes: [{ code: 'msg.unknown_option' }] };

    var applied = effectsModule.applyEffects(game, option.effects, {
      rng: game.rng,
      day: time.days(game.clock),
      severity: game.difficulty.severity || 1,
      origin: event.id
    });
    event.resolved = true;
    game.pendingEvents.splice(index, 1);
    game.eventHistory.push({
      id: event.id,
      day: round1(time.days(game.clock)),
      optionId: option.id
    });
    game.stats.eventsResolved += 1;
    pushJournal(game, {
      code: 'journal.event_resolved',
      params: { event: event.titleKey, option: option.labelKey },
      severity: 'info',
      whyKey: option.whyKey
    });
    recomputeResources(game);
    game.objective = refreshObjective(game);
    return {
      ok: true,
      codes: [{ code: 'msg.event_resolved', params: { event: event.titleKey } }].concat(applied.codes),
      severity: 'info'
    };
  }

  function doPropose(game, input) {
    var decision = COLLECTIVE_DECISIONS[input.decisionId];
    if (!decision) return { ok: false, codes: [{ code: 'msg.unknown_decision' }] };
    if (game.vote) return { ok: false, codes: [{ code: 'msg.vote_in_progress' }], severity: 'warn' };

    game.vote = {
      decisionId: input.decisionId,
      code: decision.code,
      options: decision.options,
      defaultOption: decision.defaultOption,
      durationMs: decision.durationMs,
      elapsedMs: 0,
      votes: {},
      resolved: false
    };

    // S-6: en modo individual la votación se resuelve sola contra una opción
    // simulada, con un 15 % de eficiencia menos en las decisiones colectivas.
    if (game.crew.solo) {
      var simulated = game.rng.chance(0.5) ? decision.options[decision.options.length - 1].id : decision.defaultOption;
      game.vote.votes[game.crew.members[0].id] = simulated;
      resolveVote(game, false);
      return { ok: true, codes: [{ code: 'msg.solo_vote_resolved' }], severity: 'info' };
    }

    return { ok: true, codes: [{ code: 'msg.vote_started', params: { decision: decision.code, seconds: decision.durationMs / 1000 } }], severity: 'info' };
  }

  function doVote(game, input) {
    if (!game.vote) return { ok: false, codes: [{ code: 'msg.no_vote' }] };
    var member = crew.member(game.crew, input.memberId);
    if (!member || !member.alive) return { ok: false, codes: [{ code: 'msg.crew_unavailable' }] };
    game.vote.votes[member.id] = input.optionId;
    var aliveMembers = game.crew.members.filter(function (item) {
      return item.alive;
    });
    var voted = aliveMembers.filter(function (item) {
      return game.vote.votes[item.id] !== undefined;
    });
    if (voted.length >= aliveMembers.length) resolveVote(game, false);
    return { ok: true, codes: [{ code: 'msg.vote_registered' }], severity: 'info' };
  }

  /** Cierra la votación: unanimidad o, si no, opción por defecto con penalización. */
  function resolveVote(game, timedOut) {
    var vote = game.vote;
    if (!vote) return null;
    var aliveMembers = game.crew.members.filter(function (member) {
      return member.alive;
    });
    var chosen = {};
    aliveMembers.forEach(function (member) {
      chosen[vote.votes[member.id] || vote.defaultOption] = (chosen[vote.votes[member.id] || vote.defaultOption] || 0) + 1;
    });
    var optionIds = Object.keys(chosen);
    var unanimous = optionIds.length === 1 && !timedOut;
    var effectiveOption = unanimous ? optionIds[0] : vote.defaultOption;
    var option = vote.options.find(function (item) {
      return item.id === effectiveOption;
    }) || vote.options[0];

    effectsModule.applyEffects(game, option.effects || [], {
      rng: game.rng,
      day: time.days(game.clock),
      severity: game.difficulty.severity || 1,
      origin: vote.code
    });

    game.votes.total += 1;
    if (unanimous) game.votes.agreed += 1;

    // S-5: sin acuerdo, penalización del 10 % en colaboración y eficiencia
    // reducida durante 2 días de misión.
    if (!unanimous) {
      consequences.schedule(game.log, {
        code: 'cons.vote_default',
        params: { decision: vote.code, option: option.labelKey },
        whyKey: 'cons.why.vote_default',
        severity: 'warn',
        cause: 'vote',
        dueInDays: 2,
        effects: [{ type: 'flag', id: 'efficiencyPenalty', value: 0.1 }]
      });
    }

    var summary = {
      code: unanimous ? 'msg.vote_agreed' : 'msg.vote_default',
      params: { decision: vote.code, option: option.labelKey },
      severity: unanimous ? 'info' : 'warn'
    };
    game.vote = null;
    recomputeResources(game);
    game.objective = refreshObjective(game);
    return { ok: true, codes: [summary], severity: summary.severity };
  }

  /** Termina la partida y arma el informe (V-18, P-2). */
  function finish(game, outcome) {
    if (game.status === 'report') return { ok: true, codes: [], report: game.report };
    game.outcome = outcome || game.outcome || 'manual';
    game.status = 'report';
    game.report = scoring.buildReport(game, { createdAt: Date.now() });
    return { ok: true, codes: [{ code: 'msg.mission_finished', params: { outcome: 'report.outcome.' + game.outcome } }], report: game.report };
  }

  /** Detecta las condiciones de final de partida (V-18). */
  function checkEnd(game) {
    if (game.status !== 'travel') return game.outcome;
    var summary = systems.summary(game.systems);
    if (crew.aliveCount(game.crew) === 0) return finish(game, 'lost_crew').ok && game.outcome;
    if (summary.inoperable) return finish(game, 'inoperable').ok && game.outcome;
    if (time.expired(game.clock)) return finish(game, 'expired').ok && game.outcome;
    if (game.objective && game.objective.met && game.mode !== 'sandbox') return finish(game, 'success').ok && game.outcome;
    return null;
  }

  /** Estado serializable (contrato C-5): sin funciones ni ciclos. */
  function getState(game) {
    return {
      id: game.id,
      version: game.version,
      seed: game.seed,
      rngState: game.rngState,
      mode: game.mode,
      scenarioId: game.scenarioId,
      scenario: game.scenario,
      difficultyId: game.difficultyId,
      design: game.design,
      clock: game.clock,
      systems: game.systems,
      crew: game.crew,
      resources: game.resources,
      pantry: game.pantry,
      datastore: game.datastore,
      log: game.log,
      pendingEvents: game.pendingEvents,
      eventHistory: game.eventHistory,
      flags: game.flags,
      vote: game.vote,
      votes: game.votes,
      stats: game.stats,
      journal: game.journal,
      instruments: game.instruments,
      objective: game.objective,
      status: game.status,
      outcome: game.outcome,
      report: game.report,
      notices: game.notices,
      createdAt: game.createdAt
    };
  }

  /** Reconstruye una partida guardada (G-1, I-10). */
  function restoreGame(saved, options) {
    var state = JSON.parse(JSON.stringify(saved));
    var generator = rngModule.createRng(state.rngState === undefined ? state.seed : state.rngState);
    var game = Object.assign({}, state);
    game.rng = generator;
    game.difficulty = events.profileFor(state.difficultyId);
    game.engine = events.createEngine(game.difficulty);
    game.catalogs = {
      events: (options && options.events) || [],
      food: (options && options.food) || []
    };
    game.evaluateObjective = (options && options.evaluateObjective) || null;
    // Reconstruye los disparadores de enfriamiento a partir del historial.
    (state.eventHistory || []).forEach(function (entry) {
      if (isFinite(entry.day)) game.engine.firedAt[entry.id] = entry.day;
    });
    recomputeResources(game);
    return game;
  }

  /** Panel de recursos listo para pintar (RN-1, RN-2). */
  function resourcePanel(game) {
    return resources.evaluate(game.resources);
  }

  /** Consecuencias pendientes para el panel de pausa (V-17). */
  function pendingConsequences(game) {
    return consequences.pending(game.log);
  }

  return {
    COLLECTIVE_DECISIONS: COLLECTIVE_DECISIONS,
    createGame: createGame,
    restoreGame: restoreGame,
    tick: tick,
    getActions: getActions,
    applyAction: applyAction,
    getState: getState,
    finish: finish,
    resourcePanel: resourcePanel,
    pendingConsequences: pendingConsequences,
    recomputeResources: recomputeResources,
    resolveVote: resolveVote,
    checkEnd: checkEnd
  };
});
