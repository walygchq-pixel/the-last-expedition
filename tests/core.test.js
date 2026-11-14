'use strict';

/*
 * Pruebas de la simulación (`js/core`) en Node, sin navegador (T-3, S68).
 *
 * Cubren las reglas que el jugador debe poder predecir: recursos y su forma,
 * degradación y canibalización, supervivencia, frescura de alimentos, disparadores
 * del libro de consecuencias, ventanas de enlace, memoria de datos, reloj,
 * puntaje e informe, y el ciclo de partida completo.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const rngModule = require('../js/core/rng.js');
const resources = require('../js/core/resources.js');
const systems = require('../js/core/systems.js');
const crew = require('../js/core/crew.js');
const food = require('../js/core/food.js');
const consequences = require('../js/core/consequences.js');
const events = require('../js/core/events.js');
const comms = require('../js/core/comms.js');
const datastore = require('../js/core/datastore.js');
const time = require('../js/core/time.js');
const scoring = require('../js/core/scoring.js');
const game = require('../js/core/game.js');
const catalog = require('../js/mission/catalog.js');
const design = require('../js/mission/design.js');
const objectives = require('../js/mission/objectives.js');
const { registry } = require('./helpers/data.js');

catalog.init(registry());

/** Generador falso controlable para probar reglas sin depender del azar real. */
function fixedRng({ chance = false, int = [1, 1], float = [0, 0] } = {}) {
  return {
    chance: () => chance,
    int: () => (Array.isArray(int) ? int[1] : int),
    float: () => (Array.isArray(float) ? float[0] : float),
    pick: (list) => list[0],
    next: () => 0.5
  };
}

function validDesign(scenarioId = 'scn.ceres_survey', difficultyId = 'basic') {
  const mission = design.createDesign({ scenarioId, difficultyId });
  design.setLauncher(mission, 'atlas_m');
  design.setOrbit(mission, 'medium');
  design.setPartVersion(mission, 'computer', 'advanced');
  design.setInstrument(mission, 'radar', 'simple');
  return mission;
}

test('C-4: el generador es determinista y respeta los límites', () => {
  const a = rngModule.createRng('semilla');
  const b = rngModule.createRng('semilla');
  const c = rngModule.createRng('otra');
  const seqA = [a.next(), a.next(), a.next()];
  const seqB = [b.next(), b.next(), b.next()];
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, [c.next(), c.next(), c.next()]);
  for (let i = 0; i < 50; i += 1) {
    const value = a.int(3, 7);
    assert.ok(value >= 3 && value <= 7, 'fuera de rango: ' + value);
  }
  assert.equal(rngModule.createRng(1).chance(0), false);
  assert.equal(rngModule.createRng(1).chance(1), true);
});

test('RN-1/RN-2: el panel identifica el recurso crítico y cada recurso tiene forma e icono', () => {
  const state = resources.createResources({
    mass: 3000,
    massMax: 4200,
    powerGen: 1200,
    powerDraw: 900,
    budget: 200,
    budgetTotal: 500,
    dataStored: 10,
    dataCap: 60,
    bandwidth: 0,
    daysLeft: 88,
    missionDays: 90,
    critical: 'data'
  });
  const panel = resources.evaluate(state);
  assert.equal(panel.critical, 'data');
  assert.equal(panel.items.length, 6);
  for (const item of panel.items) {
    assert.ok(item.shape, 'falta forma en ' + item.id);
    assert.ok(item.icon, 'falta icono en ' + item.id);
    assert.ok(['ok', 'warn', 'critical'].includes(item.status));
  }
  assert.equal(panel.items.find((item) => item.id === 'comms').status, 'critical', 'sin ventana de enlace el indicador es crítico');
  assert.equal(panel.blocked, false);
});

test('DM-11: pasarse de la masa del lanzador bloquea el panel', () => {
  const state = resources.createResources({ mass: 5000, massMax: 4200, powerGen: 1000, powerDraw: 900, budget: 10, budgetTotal: 10, dataCap: 10, missionDays: 90, daysLeft: 90 });
  const panel = resources.evaluate(state);
  assert.equal(panel.blocked, true);
  assert.equal(panel.items.find((item) => item.id === 'mass').status, 'critical');
});

test('V-6/V-10: degradar baja estado y fiabilidad, y canibalizar agenda la avería', () => {
  const ship = systems.createSystems({ parts: [{ id: 'p1', system: 'power', reliability: 90 }, { id: 'p2', system: 'lifeSupport', reliability: 80 }] });
  assert.equal(ship.power.reliability, 90);
  systems.degrade(ship, 'power', 20, 'test');
  assert.equal(ship.power.health, 80);
  assert.ok(ship.power.reliability < 90);

  const result = systems.cannibalize(ship, 'lifeSupport', 'power', rngModule.createRng('x'));
  assert.ok(result.reliabilityLoss >= 15 && result.reliabilityLoss <= 25, 'pérdida de fiabilidad fuera de S-7: ' + result.reliabilityLoss);
  assert.ok(result.faultInDays >= 3 && result.faultInDays <= 6, 'días de avería fuera de S-7: ' + result.faultInDays);
  assert.equal(ship.power.health, 100, 'la reparación por canibalización es inmediata');
  const effects = systems.effects(ship);
  assert.ok(effects.lighting > 0 && effects.lighting <= 1);
  assert.ok(effects.temperature > 0 && effects.temperature <= 1);
});

test('V-6/S-13: el desgaste por uso baja la fiabilidad con el tiempo', () => {
  const ship = systems.createSystems({ parts: [{ id: 'p1', system: 'instruments', reliability: 80 }] });
  const before = ship.instruments.reliability;
  systems.tick(ship, 10, { rng: fixedRng(), usage: { instruments: 1 }, severity: 1 });
  assert.ok(ship.instruments.reliability < before);
});

test('V-9: las necesidades suben con el tiempo y las críticas enferman a la tripulación', () => {
  const team = crew.createCrew([{ id: 'p1', role: 'engineer' }, { id: 'p2', role: 'medic_cook' }]);
  assert.equal(team.solo, false);
  assert.equal(team.collectiveEfficiency, 1);
  crew.tick(team, 5, { rng: fixedRng(), foodFactor: 1, waterFactor: 1, temperature: 1, moraleFactor: 1 });
  const member = crew.member(team, 'p1');
  assert.ok(member.hunger > 12, 'el hambre debería subir');
  assert.ok(member.thirst > 12, 'la sed debería subir');
  assert.ok(member.sleep < 88, 'el sueño debería bajar');

  member.thirst = 100;
  member.health = 6;
  const result = crew.tick(team, 3, { rng: fixedRng(), foodFactor: 1, waterFactor: 1, temperature: 1, moraleFactor: 1 });
  assert.ok(member.conditions.includes('dehydrated'));
  assert.equal(member.alive, false, 'sin agua la salud llega a cero');
  assert.equal(result.deaths.length, 1);
});

test('RG-10/S-6: en modo individual hay un solo rol y menor eficiencia colectiva', () => {
  const solo = crew.createCrew([{ id: 'p1', role: 'engineer' }]);
  assert.equal(solo.solo, true);
  assert.equal(solo.collectiveEfficiency, 0.85);
  assert.equal(crew.roleModifier('engineer', 'repair'), 1.35);
  assert.equal(crew.roleModifier('scientist', 'repair'), 1);
});

test('V-11/S-8: la frescura baja 2 % por día y 8 % con la nevera averiada', () => {
  const normal = food.createPantry([{ id: 'rations', qty: 10, freshness: 100 }]);
  food.tick(normal, 10, { fridgeOk: true, temperature: 1 });
  assert.equal(normal.items[0].freshness, 80);

  const broken = food.createPantry([{ id: 'rations', qty: 10, freshness: 100 }]);
  food.tick(broken, 10, { fridgeOk: false, temperature: 1 });
  assert.equal(broken.items[0].freshness, 20);
});

test('V-11/S-8: comer en mal estado arriesga enfermedad a 1–3 días y deja residuos', () => {
  const pantry = food.createPantry([{ id: 'protein', qty: 5, freshness: 20 }]);
  const result = food.eat(pantry, 'p1', 'protein', fixedRng({ chance: true, int: [1, 3] }));
  assert.equal(result.ok, true);
  assert.equal(result.spoiled, true);
  assert.equal(result.illness.willHappen, true);
  assert.equal(result.illness.risk, 0.35);
  assert.ok(result.illness.delayDays >= 1 && result.illness.delayDays <= 3);
  assert.ok(pantry.waste > 0, 'la comida en mal estado genera residuos');
  assert.equal(pantry.items[0].qty, 4);

  const fresh = food.createPantry([{ id: 'rations', qty: 1, freshness: 100 }]);
  const safe = food.eat(fresh, 'p1', 'rations', fixedRng({ chance: true }));
  assert.equal(safe.illness.risk, 0.02, 'comida fresca tiene riesgo bajo');
});

test('V-10: el libro de consecuencias dispara por día, por eventos o nunca antes de tiempo', () => {
  const log = consequences.createLog();
  consequences.advance(log, { day: 5, events: 0 });
  const byDay = consequences.schedule(log, { code: 'cons.cannibal_fault', dueInDays: 3, effects: [] });
  const byEvent = consequences.schedule(log, { code: 'cons.food_illness', dueAfterEvents: 2, effects: [] });
  assert.equal(byDay.dueDay, 8);
  assert.equal(consequences.due(log).length, 0, 'todavía no venció ninguna');
  consequences.advance(log, { day: 8, events: 1 });
  assert.deepEqual(consequences.due(log).map((entry) => entry.id), [byDay.id]);
  consequences.advance(log, { day: 8, events: 2 });
  assert.equal(consequences.due(log).length, 2);
  consequences.resolve(log, byDay.id);
  assert.equal(consequences.due(log).length, 1);
  assert.equal(consequences.pending(log).length, 1);
  assert.equal(consequences.pending(log)[0].eventsLeft, 0);
});

test('DM-13/S-10/S-11: cada dificultad define presupuesto y vida útil', () => {
  assert.equal(events.profileFor('basic').budget, 500);
  assert.equal(events.profileFor('intermediate').budget, 350);
  assert.equal(events.profileFor('advanced').budget, 250);
  assert.equal(events.profileFor('basic').missionDays, 90);
  assert.equal(events.profileFor('intermediate').missionDays, 150);
  assert.equal(events.profileFor('advanced').missionDays, 200);
  assert.equal(events.profileFor('advanced').allowSevere, true);
});

test('V-14/V-16: los eventos respetan enfriamiento y severidad permitida', () => {
  const engine = events.createEngine(events.profileFor('basic'));
  const definition = { id: 'ev.x', kind: 'random', weight: 1, severity: 'normal', cooldownDays: 10 };
  assert.equal(events.isEligible(definition, engine, { day: 1 }), true);
  engine.firedAt['ev.x'] = 5;
  assert.equal(events.isEligible(definition, engine, { day: 8 }), false);
  assert.equal(events.isEligible(definition, engine, { day: 16 }), true);
  const severe = { id: 'ev.severe', kind: 'random', weight: 1, severity: 'severe' };
  assert.equal(events.isEligible(severe, engine, { day: 20 }), false, 'Basic no permite eventos severos');

  const inst = events.materialize({ id: 'ev.y', titleKey: 'event.y.title', options: [{ id: 'a', effects: [] }] }, 3);
  assert.equal(events.options(inst).length, 1);
  assert.equal(events.optionById(inst, 'a').id, 'a');
  assert.equal(events.optionById(inst, 'z'), undefined);
});

test('C-2/S-9: las ventanas de enlace dependen de la órbita y de la antena', () => {
  const low = catalog.findOrbit('low');
  const open = comms.windowState({ orbit: low, hours: 0, antennaHealth: 100, commsHealth: 100 });
  assert.equal(open.open, true);
  const closed = comms.windowState({ orbit: low, hours: 0.5, antennaHealth: 100, commsHealth: 100 });
  assert.equal(closed.open, false);
  assert.ok(closed.nextOpenInMinutes > 0);
  const degraded = comms.windowState({ orbit: low, hours: 0, antennaHealth: 50, commsHealth: 100 });
  assert.ok(degraded.bandwidth < open.bandwidth, 'una antena degradada da menos ancho de banda');

  const high = catalog.findOrbit('high');
  const geo = comms.windowState({ orbit: high, hours: 7, antennaHealth: 100, commsHealth: 100 });
  assert.equal(geo.open, true, 'la órbita alta transmite de forma continua');
  assert.ok(comms.windowCapacity({ orbit: low, hours: 0, antennaHealth: 100, commsHealth: 100 }) > 0);
});

test('C-1/C-3/C-4: la memoria tiene tope, se prioriza y lo no enviado vale menos', () => {
  const store = datastore.createStore(10);
  assert.equal(datastore.produce(store, 'radar', 6).stored, 6);
  const overflow = datastore.produce(store, 'camera', 9);
  assert.equal(overflow.stored, 4);
  assert.equal(overflow.lost, 5);
  assert.equal(store.total, 10);

  const sent = datastore.transmit(store, ['camera', 'radar'], 8);
  assert.equal(sent.total, 8);
  assert.equal(sent.sent.camera, 4, 'se envía primero lo priorizado');
  assert.equal(sent.sent.radar, 4);
  assert.equal(store.total, 2);
  assert.equal(datastore.scienceValue(store), 8 + 2 * 0.6);
});

test('V-17/S-1: el reloj acelera hasta ×8 y marca la sombra', () => {
  const clock = time.createClock(90, { eclipseFraction: 0.5 });
  const day = time.advance(clock, time.DAY_MS);
  assert.equal(Math.round(day.deltaDays), 1);
  assert.equal(time.dayNumber(clock), 2);
  // Con el 50 % del día en sombra, el arranque del día está en eclipse y el
  // mediodía no: el indicador del HUD sale de esta misma función.
  assert.equal(time.isEclipse(clock), true);
  time.advance(clock, time.DAY_MS * 0.5);
  assert.equal(time.isEclipse(clock), false, 'a mitad del día hay luz');
  time.setSpeed(clock, 8);
  assert.equal(clock.speed, 8);
  time.setSpeed(clock, 4);
  time.pause(clock);
  assert.equal(time.advance(clock, 10000).deltaDays, 0, 'en pausa el reloj no avanza');
  time.resume(clock);
  assert.equal(time.expired(time.createClock(1)), false);
});

test('P-1/P-3: el puntaje reparte 1000 puntos y el análisis explica las compensaciones', () => {
  const state = sampleState();
  const scores = scoring.score(state);
  assert.equal(scores.max, 1000);
  const sum = scores.breakdown.reduce((total, item) => total + item.points, 0);
  assert.equal(scores.total, sum);
  for (const item of scores.breakdown) assert.ok(item.points <= item.max, 'rúbrica por encima del máximo: ' + item.id);

  const report = scoring.buildReport(state, { createdAt: '2025-01-01T00:00:00.000Z' });
  assert.equal(report.scenarioId, state.scenarioId);
  assert.equal(report.crew.length, state.crew.members.length);
  assert.ok(Array.isArray(report.decisions));

  const analysis = scoring.analyze(report);
  assert.ok(analysis.findings.length > 0);
  for (let i = 1; i < analysis.findings.length; i += 1) {
    assert.ok(analysis.findings[i - 1].lost >= analysis.findings[i].lost, 'el análisis va ordenado por impacto');
  }
  assert.match(analysis.headline, /^report\.headline\./);

  const comparison = scoring.compare({ score: 400, science: 10, resources: { budgetSpent: 50 }, endDay: 40, crew: [{ alive: true }] }, { score: 600, science: 20, resources: { budgetSpent: 80 }, endDay: 30, crew: [{ alive: true }, { alive: false }] });
  assert.equal(comparison.kind, 'report');
  assert.ok(comparison.rows.some((row) => row.id === 'compare.score' && row.better === 'b'));
});

function sampleState() {
  const mission = validDesign();
  const built = design.toGameDesign(mission);
  return {
    id: 'test',
    scenarioId: mission.scenarioId,
    difficultyId: mission.difficultyId,
    mode: 'campaign',
    seed: 'seed',
    design: built,
    clock: { hours: 24 * 30, missionDays: 90 },
    crew: crew.createCrew([{ id: 'p1', role: 'engineer' }, { id: 'p2', role: 'scientist' }]),
    systems: systems.createSystems(built),
    resources: resources.createResources({ mass: built.totals.mass, massMax: built.totals.massMax, powerGen: built.totals.powerGen, powerDraw: built.totals.powerDraw, budget: 100, budgetTotal: 500, dataCap: 60, missionDays: 90, daysLeft: 60, critical: 'data' }),
    datastore: { capacity: 60, total: 10, items: {}, transmitted: 45, lost: 0 },
    log: { entries: [{ id: 'c1', severity: 'warn', resolved: true, createdDay: 4, params: {} }] },
    votes: { total: 2, agreed: 1 },
    objective: { met: true, coverage: 0.9, checks: [] }
  };
}

test('C-5: el estado de la partida es serializable y se puede retomar', () => {
  const mission = validDesign();
  const scenario = catalog.findScenario(mission.scenarioId);
  const gameState = game.createGame({
    mode: 'cooperative',
    scenario,
    difficulty: design.profileOf(mission),
    design: design.toGameDesign(mission),
    players: [{ id: 'p1', role: 'engineer' }, { id: 'p2', role: 'scientist' }],
    seed: 'serializa',
    catalogs: { events: catalog.events(), food: catalog.foodItems() },
    evaluateObjective: objectives.runtime
  });
  const snapshot = game.getState(gameState);
  const text = JSON.stringify(snapshot);
  assert.ok(text.length > 100);
  const restored = game.restoreGame(JSON.parse(text), { events: catalog.events(), food: catalog.foodItems(), evaluateObjective: objectives.runtime });
  assert.equal(restored.scenarioId, gameState.scenarioId);
  assert.equal(restored.crew.members.length, 2);
  game.tick(restored, 5000);
  assert.ok(restored.clock.hours > gameState.clock.hours, 'la partida restaurada sigue avanzando');
});

test('V-17: dejar correr la misión produce registros y consume necesidades', () => {
  const mission = validDesign();
  const state = game.createGame({
    mode: 'campaign',
    scenario: catalog.findScenario(mission.scenarioId),
    difficulty: design.profileOf(mission),
    design: design.toGameDesign(mission),
    players: [{ id: 'p1', role: 'engineer' }],
    seed: 'corre',
    catalogs: { events: catalog.events(), food: catalog.foodItems() },
    evaluateObjective: objectives.runtime
  });
  const hungerBefore = state.crew.members[0].hunger;
  for (let i = 0; i < 40; i += 1) game.tick(state, 2000);
  assert.ok(state.clock.hours > 0);
  assert.ok(state.crew.members[0].hunger > hungerBefore);
  assert.ok(state.journal.length > 0, 'la bitácora registra lo que pasa');
  const panel = game.resourcePanel(state);
  assert.equal(panel.items.length, 6);
});

test('V-10/S-7: canibalizar repara al instante y agenda una avería con su mensaje', () => {
  const mission = validDesign();
  const state = game.createGame({
    mode: 'campaign',
    scenario: catalog.findScenario(mission.scenarioId),
    difficulty: design.profileOf(mission),
    design: design.toGameDesign(mission),
    players: [{ id: 'p1', role: 'engineer' }],
    seed: 'canibal',
    catalogs: { events: catalog.events(), food: catalog.foodItems() },
    evaluateObjective: objectives.runtime
  });
  systems.degrade(state.systems, 'comms', 40, 'test');
  const before = state.systems.comms.health;
  const result = game.applyAction(state, { type: 'cannibalize', donorId: 'lifeSupport', targetId: 'comms' });
  assert.equal(result.ok, true);
  assert.ok(state.systems.comms.health > before, 'la reparación es inmediata');
  const scheduled = state.log.entries.filter((entry) => entry.code === 'cons.cannibal_fault');
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].whyKey, 'cons.why.cannibal_fault');
  assert.ok(scheduled[0].params.source.startsWith('sys.'));
  assert.ok(scheduled[0].dueDay - scheduled[0].createdDay >= 3);
});

test('V-11: comer en mal estado agenda la enfermedad como consecuencia diferida', () => {
  const mission = validDesign();
  const state = game.createGame({
    mode: 'campaign',
    scenario: catalog.findScenario(mission.scenarioId),
    difficulty: design.profileOf(mission),
    design: design.toGameDesign(mission),
    players: [{ id: 'p1', role: 'medic_cook' }],
    seed: 'comida',
    catalogs: { events: catalog.events(), food: catalog.foodItems() },
    evaluateObjective: objectives.runtime
  });
  state.pantry.items.forEach((item) => {
    item.freshness = 10;
  });
  state.rng = fixedRng({ chance: true, int: [1, 3] });
  const result = game.applyAction(state, { type: 'eat', memberId: 'p1' });
  assert.equal(result.ok, true);
  const scheduled = state.log.entries.filter((entry) => entry.code === 'cons.food_illness');
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].effects[0].type, 'crewCondition');
});

test('S-5/RG-11: sin acuerdo se aplica la opción por defecto con penalización', () => {
  const mission = validDesign();
  const state = game.createGame({
    mode: 'cooperative',
    scenario: catalog.findScenario(mission.scenarioId),
    difficulty: design.profileOf(mission),
    design: design.toGameDesign(mission),
    players: [{ id: 'p1', role: 'engineer' }, { id: 'p2', role: 'scientist' }],
    seed: 'voto',
    catalogs: { events: catalog.events(), food: catalog.foodItems() },
    evaluateObjective: objectives.runtime
  });
  assert.equal(game.applyAction(state, { type: 'propose', decisionId: 'ration' }).ok, true);
  assert.ok(state.vote);
  game.applyAction(state, { type: 'vote', memberId: 'p1', optionId: 'full' });
  const closed = game.applyAction(state, { type: 'vote', memberId: 'p2', optionId: 'half' });
  assert.equal(closed.ok, true);
  assert.equal(state.vote, null);
  assert.equal(state.votes.total, 1);
  assert.equal(state.votes.agreed, 0, 'hubo desacuerdo');
  const penalty = state.log.entries.filter((entry) => entry.code === 'cons.vote_default');
  assert.equal(penalty.length, 1, 'el desacuerdo deja una consecuencia de eficiencia reducida');
  assert.equal(penalty[0].dueDay - penalty[0].createdDay, 2, 'la penalización dura 2 días (S-5)');
});

test('S-6: en modo individual la votación se resuelve sola', () => {
  const mission = validDesign();
  const state = game.createGame({
    mode: 'campaign',
    scenario: catalog.findScenario(mission.scenarioId),
    difficulty: design.profileOf(mission),
    design: design.toGameDesign(mission),
    players: [{ id: 'p1', role: 'engineer' }],
    seed: 'solovoto',
    catalogs: { events: catalog.events(), food: catalog.foodItems() },
    evaluateObjective: objectives.runtime
  });
  const result = game.applyAction(state, { type: 'propose', decisionId: 'ration' });
  assert.equal(result.ok, true);
  assert.equal(state.vote, null, 'no queda votación abierta');
  assert.equal(state.votes.total, 1);
});

test('V-18/P-2: la partida termina y genera informe con desglose', () => {
  const mission = validDesign();
  const state = game.createGame({
    mode: 'campaign',
    scenario: catalog.findScenario(mission.scenarioId),
    difficulty: design.profileOf(mission),
    design: design.toGameDesign(mission),
    players: [{ id: 'p1', role: 'engineer' }],
    seed: 'final',
    catalogs: { events: catalog.events(), food: catalog.foodItems() },
    evaluateObjective: objectives.runtime
  });
  const ended = game.finish(state, 'manual');
  assert.equal(ended.ok, true);
  assert.equal(state.status, 'report');
  assert.ok(state.report.score >= 0);
  assert.equal(state.report.outcome, 'manual');
  assert.ok(state.report.breakdown.length >= 6);
  const again = game.tick(state, 5000);
  assert.equal(again.ended, true);
  assert.equal(again.advancedDays, 0, 'una partida cerrada no avanza');
});

test('DM-11: el lanzamiento se bloquea y explica el motivo y la corrección', () => {
  const mission = design.createDesign({ scenarioId: 'scn.ceres_survey', difficultyId: 'basic' });
  const blocked = design.validateLaunch(mission);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.blockers.length > 0);
  assert.ok(blocked.blockers.every((blocker) => blocker.code.startsWith('block.') && blocker.labelKey));

  const valid = design.validateLaunch(validDesign());
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.blockers, []);
  assert.ok(valid.warnings.length >= 0);
});

test('R3-RNGSTATE: guardar después de consumir azar no rebobina el generador', () => {
  const mission = validDesign();
  const state = game.createGame({
    mode: 'campaign',
    scenario: catalog.findScenario(mission.scenarioId),
    difficulty: design.profileOf(mission),
    design: design.toGameDesign(mission),
    players: [{ id: 'p1', role: 'medic_cook' }],
    seed: 'rng-guardado',
    catalogs: { events: [], food: catalog.foodItems() },
    evaluateObjective: objectives.runtime
  });
  const before = game.getState(state).rngState;
  game.applyAction(state, { type: 'eat', memberId: 'p1' });
  const after = game.getState(state).rngState;
  assert.notEqual(after, before, 'la acción consumió azar y el guardado tiene que reflejarlo');

  const restored = game.restoreGame(JSON.parse(JSON.stringify(game.getState(state))), {
    events: catalog.events(),
    food: catalog.foodItems(),
    evaluateObjective: objectives.runtime
  });
  assert.equal(restored.rng.state(), after, 'la partida restaurada sigue el sorteo donde quedó');
});

test('S-5/R3-VOTE-PENALTY: el desacuerdo reduce la eficiencia 2 días y se recupera', () => {
  const mission = validDesign();
  const build = (seed) =>
    game.createGame({
      mode: 'cooperative',
      scenario: catalog.findScenario(mission.scenarioId),
      difficulty: design.profileOf(mission),
      design: design.toGameDesign(mission),
      players: [{ id: 'p1', role: 'engineer' }, { id: 'p2', role: 'scientist' }],
      seed,
      // Sin eventos: el reloj no se detiene y la penalización se puede medir.
      catalogs: { events: [], food: catalog.foodItems() },
      evaluateObjective: objectives.runtime
    });

  // 1. La misma reparación rinde menos con la penalización vigente.
  const calm = build('penal-calma');
  systems.degrade(calm.systems, 'comms', 40, 'test');
  game.applyAction(calm, { type: 'repair', systemId: 'comms', memberId: 'p1' });

  const penalized = build('penal-calma');
  systems.degrade(penalized.systems, 'comms', 40, 'test');
  penalized.penalty = { factor: 0.1, daysLeft: 2 };
  game.applyAction(penalized, { type: 'repair', systemId: 'comms', memberId: 'p1' });
  assert.ok(
    penalized.systems.comms.health < calm.systems.comms.health,
    'sin acuerdo la tripulación repara peor (S-5)'
  );

  // 2. Un desacuerdo real arranca la penalización de 2 días.
  const voted = build('penal-voto');
  game.applyAction(voted, { type: 'propose', decisionId: 'ration' });
  game.applyAction(voted, { type: 'vote', memberId: 'p1', optionId: 'full' });
  game.applyAction(voted, { type: 'vote', memberId: 'p2', optionId: 'half' });
  assert.deepEqual(voted.penalty, { factor: 0.1, daysLeft: 2 });

  // 3. Se consume con el reloj y no queda pegada para siempre.
  let guard = 0;
  while (voted.penalty && guard < 100) {
    game.tick(voted, 3000);
    guard += 1;
  }
  assert.equal(voted.penalty, null, 'la penalización se extingue a los 2 días');
  assert.ok(guard > 0 && guard < 100);
});
