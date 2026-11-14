'use strict';

/*
 * Pruebas de persistencia (G-1, G-2, G-3, P-4, I-9, I-10, S-17).
 *
 * Verifican que lo guardado y exportado son claves y valores, nunca texto
 * traducido: una partida creada en español debe abrirse en inglés sin cambios.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const store = require('../js/storage/store.js');
const prefs = require('../js/storage/prefs.js');
const saves = require('../js/storage/saves.js');
const transfer = require('../js/storage/transfer.js');
const leaderboard = require('../js/storage/leaderboard.js');
const catalog = require('../js/mission/catalog.js');
const design = require('../js/mission/design.js');
const { registry, locales } = require('./helpers/data.js');

catalog.init(registry());

function sampleDesign() {
  const mission = design.createDesign({ scenarioId: 'scn.ceres_survey', difficultyId: 'basic' });
  design.setLauncher(mission, 'atlas_m');
  design.setOrbit(mission, 'medium');
  design.setPartVersion(mission, 'computer', 'advanced');
  design.setInstrument(mission, 'radar', 'simple');
  return mission;
}

function sampleState() {
  return {
    id: 'mission-x',
    scenarioId: 'scn.ceres_survey',
    difficultyId: 'basic',
    mode: 'campaign',
    clock: { hours: 48, missionDays: 90, speed: 1, paused: false },
    crew: { members: [{ id: 'p1', role: 'engineer', alive: true, health: 90 }] }
  };
}

test('S-17: el almacén escribe, lee y avisa cuando una pieza no es serializable', () => {
  store.clearMemory();
  assert.equal(store.write('tle.test.key', { a: 1, b: [2, 3] }).ok, true);
  assert.deepEqual(store.read('tle.test.key', null), { a: 1, b: [2, 3] });
  assert.equal(store.read('tle.test.missing', 'fallback'), 'fallback');

  const circular = {};
  circular.self = circular;
  const failed = store.write('tle.test.circular', circular);
  assert.equal(failed.ok, false);
  assert.equal(failed.code, 'save.unserializable');

  store.remove('tle.test.key');
  assert.equal(store.read('tle.test.key', null), null);
});

test('I-9: las preferencias guardan el idioma y se restauran', () => {
  store.clearMemory();
  const defaults = prefs.get();
  assert.equal(defaults.textSize, 'normal');
  assert.equal(defaults.locale, null);

  prefs.set({ locale: 'es', textSize: 'large', highContrast: true });
  const saved = prefs.get();
  assert.equal(saved.locale, 'es');
  assert.equal(saved.textSize, 'large');
  assert.equal(saved.highContrast, true);

  prefs.set({ locale: 'fr', textSize: 'gigante' });
  const clamped = prefs.get();
  assert.equal(clamped.locale, null, 'un idioma no soportado no se persiste');
  assert.equal(clamped.textSize, 'normal', 'un tamaño desconocido cae en normal');

  assert.equal(prefs.initialLocale('en-US'), 'en');
  prefs.set({ locale: 'es' });
  assert.equal(prefs.initialLocale('en-US'), 'es', 'la preferencia gana al navegador');
});

test('G-1: las partidas y los diseños se guardan y se listan', () => {
  store.clearMemory();
  const game = saves.saveGame(sampleState(), { now: 1700000000000, id: 'g-test' });
  assert.equal(game.ok, true);
  const loaded = saves.loadGame('g-test');
  assert.equal(loaded.state.scenarioId, 'scn.ceres_survey');
  assert.equal(saves.listSaves().length, 1);
  assert.equal(saves.listSaves()[0].day, 3);

  const savedDesign = saves.saveDesign(sampleDesign(), { now: 1700000000000, id: 'd-test' });
  assert.equal(savedDesign.ok, true);
  assert.equal(saves.loadDesign('d-test').design.launcherId, 'atlas_m');
  assert.equal(saves.listDesigns().length, 1);

  saves.removeSave('g-test');
  assert.equal(saves.listSaves().length, 0);
});

test('I-10: lo guardado usa claves y valores, nunca texto traducido', () => {
  store.clearMemory();
  saves.saveGame(sampleState(), { id: 'g-i18n', now: 1700000000000 });
  const raw = JSON.stringify(saves.loadGame('g-i18n'));
  const esName = locales().es['scenario.scn.ceres_survey.name'];
  const enName = locales().en['scenario.scn.ceres_survey.name'];
  assert.ok(esName && enName);
  assert.equal(raw.includes(esName), false, 'el guardado no debe contener el nombre traducido al español');
  assert.equal(raw.includes(enName), false, 'el guardado no debe contener el nombre traducido al inglés');
  assert.ok(raw.includes('scn.ceres_survey'), 'el guardado conserva el identificador del escenario');
});

test('G-2: exportar e importar conserva el contenido y rechaza archivos inválidos', () => {
  const mission = sampleDesign();
  const text = transfer.exportJson(transfer.KIND.DESIGN, design.serialize(mission), { now: 1700000000000 });
  const imported = transfer.importJson(text);
  assert.equal(imported.ok, true);
  assert.equal(imported.kind, 'design');
  assert.equal(imported.data.launcherId, 'atlas_m');

  const restored = design.deserialize(imported.data);
  assert.equal(restored.orbitId, 'medium');
  assert.equal(design.validateLaunch(restored).ok, true);

  assert.equal(transfer.importJson('no es json').code, 'import.invalid_json');
  assert.equal(transfer.importJson(JSON.stringify({ format: 'otra', version: 1, data: {} })).code, 'import.invalid_format');
  assert.equal(
    transfer.importJson(JSON.stringify({ format: 'the-last-expedition', version: 9, data: {} })).code,
    'import.unsupported_version'
  );

  const sanitized = transfer.importJson(
    JSON.stringify({ format: 'the-last-expedition', version: 1, kind: 'report', data: { code: 'x', translatedText: 'texto traducido' } })
  );
  assert.equal(sanitized.data.translatedText, undefined, 'el texto ya traducido se descarta al importar');

  assert.match(transfer.filenameFor('report', 'scn.ceres_survey', 1700000000000), /^tle-report-scn\.ceres_survey-\d{4}-\d{2}-\d{2}\.json$/);
});

test('P-4/G-3: la clasificación ordena por puntaje y el comparador marca el mejor', () => {
  store.clearMemory();
  leaderboard.clear();
  leaderboard.add({ scenarioId: 'scn.ceres_survey', difficultyId: 'basic', mode: 'campaign', score: 420, science: 30, endDay: 80, outcome: 'success', result: 'success', crew: [{ alive: true }] }, 1700000000000);
  leaderboard.add({ scenarioId: 'scn.ceres_survey', difficultyId: 'basic', mode: 'campaign', score: 610, science: 44, endDay: 75, outcome: 'success', result: 'success', crew: [{ alive: true }, { alive: false }] }, 1700000000500);
  leaderboard.add({ scenarioId: 'scn.venus_atmosphere', difficultyId: 'basic', mode: 'campaign', score: 900, science: 55, endDay: 70, outcome: 'success', result: 'success', crew: [{ alive: true }] }, 1700000001000);

  const ceres = leaderboard.list('scn.ceres_survey', 'basic');
  assert.equal(ceres.length, 2);
  assert.equal(ceres[0].score, 610, 'la mejor partida va primero');
  assert.equal(leaderboard.best('scn.ceres_survey', 'basic').score, 610);
  assert.equal(leaderboard.list().length, 3);

  const comparison = transfer.compare(
    { scenarioId: 'scn.ceres_survey', orbitId: 'low', launcherId: 'vector_s', totals: { mass: 3000, powerDraw: 900, cost: 200, dataRate: 5 } },
    { scenarioId: 'scn.ceres_survey', orbitId: 'medium', launcherId: 'atlas_m', totals: { mass: 3100, powerDraw: 950, cost: 240, dataRate: 9 } }
  );
  assert.equal(comparison.kind, 'design');
  const mass = comparison.rows.find((row) => row.id === 'compare.mass');
  assert.equal(mass.better, 'a', 'menos masa es mejor');
  const rate = comparison.rows.find((row) => row.id === 'compare.data_rate');
  assert.equal(rate.better, 'b', 'más ritmo de datos es mejor');
});

test('R3-001: al importar se descarta cualquier campo de texto ya traducido', () => {
  const payload = {
    code: 'x',
    translatedText: 'texto',
    localizedLabel: 'etiqueta',
    text: 'suelto',
    label: 'etiqueta suelta',
    translated: 'traducido',
    description: 'descripción traducida',
    title: 'título traducido',
    nested: { text: 'otro', params: { name: 'Ceres' } },
    nameKey: 'scenario.scn.ceres_survey.name'
  };
  const result = transfer.importJson(
    JSON.stringify({ format: 'the-last-expedition', version: 1, kind: 'report', data: payload })
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, {
    code: 'x',
    nested: { params: { name: 'Ceres' } },
    nameKey: 'scenario.scn.ceres_survey.name'
  });
});

test('R3-002/R3-003: guardar rechaza lo no serializable y no cobra de más al sobrescribir', () => {
  store.clearMemory();
  const rejected = store.write('tle.k', undefined);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, 'save.unserializable');

  assert.equal(store.write('tle.k', 'a'.repeat(1000)).ok, true);
  const afterFirst = store.usage().used;
  assert.equal(store.write('tle.k', 'b'.repeat(1000)).ok, true, 'sobrescribir no debe fallar por cuota');
  assert.equal(store.usage().used, afterFirst, 'el tamaño ocupado no se duplica');
});

test('R3-004: el guardado respeta el máximo de ranuras', () => {
  store.clearMemory();
  for (let i = 0; i < 25; i += 1) {
    saves.saveGame(sampleState(), { now: 1700000000000 + i * 1000, id: 'g' + i });
  }
  const listed = saves.listSaves();
  assert.equal(listed.length, 20, 'se conservan 20 ranuras');
  assert.equal(saves.loadGame('g0'), null, 'la partida más vieja se descartó');
  assert.ok(saves.loadGame('g24'), 'la más reciente sigue disponible');
});
