'use strict';

/*
 * Pruebas de la fase de diseño de misión y del contenido de datos (T11).
 *
 * Cubren el catálogo de lanzadores, órbitas, objetivos, escenarios, alimentos y
 * eventos (S21–S26, S43–S45, S84), la paridad de claves de esos datos (I-4,
 * I-11) y la garantía de que cada escenario admite al menos dos soluciones
 * válidas por dificultad (DM-14, S26).
 *
 * Corren en Node sin navegador y sin dependencias: `node --test tests/mission.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { registry } = require('./helpers/data.js');
const catalog = require('../js/mission/catalog.js');
const design = require('../js/mission/design.js');

const DATA = registry();
catalog.init(DATA);

const DIFFICULTIES = ['basic', 'intermediate', 'advanced'];
// Sistemas y necesidades que aceptan los efectos declarativos (`core/effects.js`).
const SYSTEM_IDS = ['power', 'lifeSupport', 'comms', 'attitude', 'thermal', 'instruments'];
const CREW_NEEDS = ['health', 'hunger', 'thirst', 'sleep', 'stress', 'morale', 'hygiene'];
const CRITICAL_RESOURCES = ['mass', 'power', 'budget', 'data', 'comms', 'time'];
const EFFECT_TYPES = [
  'system',
  'crew',
  'crewCondition',
  'resource',
  'food',
  'consequence',
  'flag',
  'data',
  'chance'
];
// Tipos de ciencia que usan los objetivos y los instrumentos.
const SCIENCE_TAGS = ['imaging', 'mapping', 'atmosphere', 'composition', 'interior', 'surface', 'particles'];

/** Comprueba que una clave de traducción exista en los dos idiomas (I-4). */
function assertKeyExists(key, where) {
  assert.equal(typeof key, 'string', where + ': la clave debe ser una cadena');
  assert.ok(key.length > 0, where + ': la clave está vacía');
  assert.ok(key in DATA['locales/en'], where + ': falta la clave "' + key + '" en en.json');
  assert.ok(key in DATA['locales/es'], where + ': falta la clave "' + key + '" en es.json');
}

/** Suma las raciones de una despensa declarada en `data/scenarios.json`. */
function servingsOf(pantry) {
  return (pantry || []).reduce((total, item) => total + (Number(item.qty) || 0), 0);
}

test('S19/S21/S22/S24: el catálogo de diseño tiene las cantidades esperadas', () => {
  assert.equal(catalog.instrumentEntries().length, 6, 'deben ser 6 instrumentos (S19)');
  assert.equal(catalog.instruments().length, 12, 'cada instrumento tiene versión simple y avanzada (DM-4)');
  assert.ok(catalog.launchers().length >= 3, 'al menos 3 lanzadores (S21)');
  assert.equal(catalog.orbits().length, 4, 'las 4 órbitas del contrato (S22)');
  assert.ok(catalog.scenarios().length >= 3, 'al menos 3 escenarios (S24)');
  assert.ok(catalog.objectives().length >= 3, 'cada escenario necesita su objetivo (DM-1)');
  assert.ok(catalog.events().length >= 10, 'al menos 10 eventos (S43)');
  assert.ok(catalog.foodItems().length >= 4, 'al menos 4 alimentos para la despensa (S41)');
});

test('S21: los tres lanzadores tienen carga, coste y alcance orbital distintos', () => {
  const launchers = catalog.launchers();
  const ids = launchers.map((launcher) => launcher.id).sort();
  assert.deepEqual(ids, ['atlas_m', 'hermes_heavy', 'vector_s']);

  for (const launcher of launchers) {
    assert.equal(launcher.nameKey, 'launcher.' + launcher.id + '.name');
    assert.equal(launcher.descKey, 'launcher.' + launcher.id + '.desc');
    for (const field of ['payloadCapacity', 'cost', 'maxOrbitRank', 'reliability']) {
      assert.ok(Number.isFinite(launcher[field]), launcher.id + ': falta ' + field);
    }
    assert.ok(launcher.payloadCapacity > 0 && launcher.cost > 0);
    assert.ok(launcher.maxOrbitRank >= 1 && launcher.maxOrbitRank <= 4);
    assert.ok(launcher.reliability > 80 && launcher.reliability <= 100);
  }

  // Ningún lanzador domina a otro: subir carga o alcance siempre cuesta dinero.
  const sorted = launchers.slice().sort((a, b) => a.payloadCapacity - b.payloadCapacity);
  for (let i = 1; i < sorted.length; i += 1) {
    assert.ok(sorted[i].cost > sorted[i - 1].cost, 'más carga debe costar más (DM-9)');
    assert.ok(sorted[i].payloadCapacity > sorted[i - 1].payloadCapacity);
  }
});

test('S22: las cuatro órbitas declaran cobertura, radiación, eclipse y comunicaciones', () => {
  const orbits = catalog.orbits().slice().sort((a, b) => a.rank - b.rank);
  assert.deepEqual(
    orbits.map((orbit) => orbit.id),
    ['low', 'medium', 'high', 'transfer']
  );
  assert.deepEqual(
    orbits.map((orbit) => orbit.rank),
    [1, 2, 3, 4]
  );

  for (const orbit of orbits) {
    assert.equal(orbit.nameKey, 'orbit.' + orbit.id + '.name');
    assert.equal(orbit.descKey, 'orbit.' + orbit.id + '.desc');
    assert.ok(orbit.coverage > 0 && orbit.coverage <= 1, orbit.id + ': cobertura fuera de rango');
    assert.ok(orbit.radiation >= 0 && orbit.radiation <= 1, orbit.id + ': radiación fuera de rango');
    assert.ok(orbit.eclipseFraction >= 0 && orbit.eclipseFraction < 1, orbit.id + ': eclipse fuera de rango');
    assert.ok(orbit.comms && Number.isFinite(orbit.comms.bandwidthFactor), orbit.id + ': falta el ancho de banda');
    if (orbit.comms.continuous) {
      assert.equal(orbit.comms.cycleMinutes, undefined, orbit.id + ': el enlace continuo no usa ciclos');
    } else {
      assert.ok(orbit.comms.cycleMinutes > 0, orbit.id + ': falta el ciclo de la ventana');
      assert.ok(orbit.comms.windowMinutes > 0, orbit.id + ': falta la duración de la ventana');
      assert.ok(
        orbit.comms.windowMinutes < orbit.comms.cycleMinutes,
        orbit.id + ': la ventana debe ser más corta que el ciclo'
      );
    }
  }

  // Más cobertura implica más radiación o menos ancho de banda: nunca todo mejora.
  const low = catalog.findOrbit('low');
  const transfer = catalog.findOrbit('transfer');
  assert.ok(transfer.coverage > low.coverage);
  assert.ok(transfer.radiation > low.radiation);
  assert.ok(catalog.findOrbit('high').comms.continuous);
});

test('S24: cada escenario apunta a un objetivo válido y a una despensa y riesgos existentes', () => {
  const eventIds = catalog.events().map((event) => event.id);
  const foodIds = catalog.foodItems().map((item) => item.id);

  for (const scenario of catalog.scenarios()) {
    assert.equal(scenario.nameKey, 'scenario.' + scenario.id + '.name');
    assert.equal(scenario.descKey, 'scenario.' + scenario.id + '.desc');
    assert.equal(scenario.briefKey, 'scenario.' + scenario.id + '.brief');
    assert.ok(catalog.findObjective(scenario.objectiveId), scenario.id + ': objetivo inexistente');
    assert.ok(CRITICAL_RESOURCES.includes(scenario.critical), scenario.id + ': recurso crítico inválido (S28)');
    assert.ok(Number.isFinite(scenario.requiredData) && scenario.requiredData > 0, scenario.id + ': falta requiredData');

    const objective = catalog.findObjective(scenario.objectiveId);
    const dataRequirement = (objective.requires || []).find((requirement) => requirement.type === 'data');
    if (dataRequirement) {
      // El objetivo pide memoria y el escenario anuncia cuántos datos transmite.
      assert.ok(scenario.requiredData <= dataRequirement.value + 10, scenario.id + ': requiredData incoherente');
    }

    assert.ok(Array.isArray(scenario.pantry) && scenario.pantry.length > 0, scenario.id + ': falta la despensa');
    for (const item of scenario.pantry) {
      assert.ok(foodIds.includes(item.id), scenario.id + ': alimento desconocido ' + item.id);
      assert.ok(item.qty > 0, scenario.id + ': cantidad inválida en ' + item.id);
      assert.ok(item.freshness >= 0 && item.freshness <= 100, scenario.id + ': frescura inválida en ' + item.id);
    }

    assert.ok(Array.isArray(scenario.hazards), scenario.id + ': faltan los riesgos');
    for (const hazard of scenario.hazards) {
      assert.ok(eventIds.includes(hazard), scenario.id + ': evento desconocido ' + hazard);
    }
  }
});

test('S84: la despensa alcanza para 90–200 días con 1–4 tripulantes sin ser holgada', () => {
  for (const scenario of catalog.scenarios()) {
    const servings = servingsOf(scenario.pantry);
    // 4 tripulantes × 90 días es la combinación más exigente de una partida Basic.
    assert.ok(servings >= 4 * 90, scenario.id + ': la despensa no cubre 4 tripulantes durante 90 días');
    // Y no debe sobrar el doble de la vida útil más larga (200 días de un tripulante).
    assert.ok(servings <= 2 * 200, scenario.id + ': la despensa es demasiado holgada');
  }

  // Raciones, frescos, proteína y conservas: variedad de frescura para las reglas de S41.
  const freshness = catalog.foodItems().map((item) => item.freshness);
  assert.ok(new Set(freshness).size > 1, 'los alimentos deben tener frescuras distintas');
});

test('S43: cada evento tiene respuestas con compensaciones y efectos válidos (V-14, V-15)', () => {
  const events = catalog.events();
  assert.ok(events.some((event) => event.kind === 'scheduled' && Number.isFinite(event.scheduledDay)), 'falta un evento programado');
  assert.ok(events.some((event) => event.severity === 'severe'), 'falta al menos un evento severo');
  assert.ok(events.some((event) => event.kind === 'random'), 'faltan eventos aleatorios');

  const covered = new Set(events.map((event) => event.id));
  for (const required of ['ev.solar_storm', 'ev.battery_failure', 'ev.pressure_leak', 'ev.food_outbreak']) {
    assert.ok(covered.has(required), 'falta el evento requerido por V-14: ' + required);
  }
  assert.ok(
    events.some((event) => /request/.test(event.id)),
    'falta la petición de datos desde la Tierra (V-14)'
  );
  assert.ok(events.some((event) => /micrometeorites/.test(event.id)), 'faltan los micrometeoritos (V-14)');
  assert.ok(events.some((event) => /overheating/.test(event.id)), 'falta el sobrecalentamiento (V-14)');
  assert.ok(events.some((event) => /isolation/.test(event.id)), 'falta el aislamiento (V-14)');
  assert.ok(events.some((event) => /conflict/.test(event.id)), 'falta el conflicto entre tripulantes (V-14)');

  const ids = new Set();

  for (const event of events) {
    assert.equal(typeof event.id, 'string');
    assert.equal(ids.has(event.id), false, 'evento duplicado: ' + event.id);
    ids.add(event.id);

    assert.ok(event.kind === 'random' || event.kind === 'scheduled', event.id + ': kind inválido');
    assert.ok(event.severity === 'normal' || event.severity === 'severe', event.id + ': severity inválida');
    assert.ok(Number.isFinite(event.weight) && event.weight > 0, event.id + ': falta weight');
    assert.ok(Number.isFinite(event.minDay) && event.minDay >= 0, event.id + ': falta minDay');
    assert.ok(Number.isFinite(event.cooldownDays) && event.cooldownDays > 0, event.id + ': falta cooldownDays');
    if (event.kind === 'scheduled') {
      assert.ok(Number.isFinite(event.scheduledDay) && event.scheduledDay > 0, event.id + ': falta scheduledDay');
    }
    assert.equal(event.titleKey, 'event.' + event.id + '.title');
    assert.equal(event.descriptionKey, 'event.' + event.id + '.description');

    // Requisitos: solo sistemas y necesidades conocidos por el motor.
    const requires = event.requires || {};
    for (const key of ['systemBelow', 'systemAbove']) {
      if (requires[key]) {
        assert.ok(SYSTEM_IDS.includes(requires[key].id), event.id + ': sistema inválido en ' + key);
        assert.ok(Number.isFinite(requires[key].health), event.id + ': falta el umbral de ' + key);
      }
    }

    assert.ok(Array.isArray(event.options) && event.options.length >= 2, event.id + ': hacen falta 2 o 3 respuestas (V-15)');
    assert.ok(event.options.length <= 3, event.id + ': demasiadas respuestas');

    const optionIds = new Set();
    for (const option of event.options) {
      assert.equal(optionIds.has(option.id), false, event.id + ': respuesta duplicada ' + option.id);
      optionIds.add(option.id);
      assert.equal(option.labelKey, 'event.' + event.id + '.opt.' + option.id + '.label');
      assert.equal(option.estimateKey, 'event.' + event.id + '.opt.' + option.id + '.estimate');
      assert.equal(option.whyKey, 'event.' + event.id + '.opt.' + option.id + '.why');
      assert.ok(Array.isArray(option.effects) && option.effects.length > 0, event.id + '/' + option.id + ': sin efectos');
      assertEffectsValid(option.effects, event.id + '/' + option.id);
    }
  }
});

/** Valida la forma de una lista de efectos declarativos (V-15). */
function assertEffectsValid(effects, where) {
  for (const effect of effects) {
    assert.ok(EFFECT_TYPES.includes(effect.type), where + ': tipo de efecto inválido ' + effect.type);
    if (effect.type === 'system') {
      assert.ok(SYSTEM_IDS.includes(effect.id), where + ': sistema inválido ' + effect.id);
      assert.ok(['degrade', 'repair', 'service'].includes(effect.op), where + ': operación inválida ' + effect.op);
      assert.ok(Number.isFinite(effect.value), where + ': falta el valor del efecto de sistema');
    }
    if (effect.type === 'crew') {
      assert.equal(effect.id, 'all', where + ': solo se admite el id "all"');
      if (effect.need) assert.ok(CREW_NEEDS.includes(effect.need), where + ': necesidad inválida ' + effect.need);
      assert.ok(
        Number.isFinite(effect.value) || Number.isFinite(effect.stress) || Number.isFinite(effect.morale),
        where + ': el efecto de tripulación no cambia nada'
      );
    }
    if (effect.type === 'crewCondition') {
      assert.ok(effect.condition, where + ': falta la condición');
      assert.ok(Number.isFinite(effect.days) && effect.days > 0, where + ': faltan los días de la condición');
    }
    if (effect.type === 'resource') {
      assert.ok(['budget', 'data', 'bandwidth'].includes(effect.id), where + ': recurso inválido ' + effect.id);
      assert.ok(Number.isFinite(effect.value), where + ': falta el valor del recurso');
    }
    if (effect.type === 'food') {
      assert.ok(['freshness', 'waste'].includes(effect.op), where + ': operación de comida inválida');
      assert.ok(Number.isFinite(effect.value), where + ': falta el valor de comida');
    }
    if (effect.type === 'consequence') {
      // El código y el porqué viajan como claves: se traducen en la UI (V-13, C-3).
      assert.match(effect.code || '', /^cons\.[a-z_]+$/, where + ': código de consecuencia inválido');
      assertKeyExists(effect.whyKey, where + ' (consecuencia)');
      assert.ok(Number.isFinite(effect.dueInDays) || Number.isFinite(effect.dueAfterEvents), where + ': la consecuencia no tiene disparador');
    }
    if (effect.type === 'chance') {
      assert.ok(effect.p > 0 && effect.p < 1, where + ': probabilidad inválida');
      assertEffectsValid(effect.effects || [], where + ' (efecto condicional)');
    }
  }
}

test('I-4: todas las claves de los datos de diseño existen en inglés y en español', () => {
  // Archivos que consumen `mission/catalog.js` y `mission/design.js`. Los datos de
  // otras fases (`objects`, `shipLayout`, glosario, tutorial) los cubre la prueba
  // de su propia tarea, para que este archivo no dependa de contenido ajeno.
  const files = ['parts', 'instruments', 'launchers', 'orbits', 'objectives', 'scenarios', 'food', 'events'];
  for (const file of files) assert.ok(DATA[file], 'falta el archivo de datos ' + file);
  const missing = [];

  function walk(value, where) {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, where + '[' + index + ']'));
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, entry] of Object.entries(value)) {
      const path = where ? where + '.' + key : key;
      if (key.endsWith('Key')) {
        if (typeof entry !== 'string' || !(entry in DATA['locales/en']) || !(entry in DATA['locales/es'])) {
          missing.push(path + ' -> ' + entry);
        }
      } else {
        walk(entry, path);
      }
    }
  }

  for (const file of files) walk(DATA[file], file);
  assert.deepEqual(missing, [], 'claves de datos sin traducción');
});

/*
 * DM-14: búsqueda por fuerza bruta de soluciones válidas.
 *
 * Para cada escenario y dificultad se prueban combinaciones de versión por grupo,
 * instrumentos (simple/avanzada, uno o dos), las cuatro órbitas y los lanzadores.
 * La búsqueda se detiene al encontrar dos soluciones distintas, que es lo que
 * exige S26; la poda previa (presupuesto, potencia y masa) solo descarta diseños
 * que ningún instrumento podría salvar, porque los instrumentos suman coste,
 * consumo y masa.
 */

const VERSIONS = ['simple', 'advanced'];
const INSTRUMENT_IDS = ['camera', 'spectrometer', 'radar', 'seismometer', 'magnetometer', 'particle_detector'];

/** Todos los subconjuntos de tamaño `size` de `list`. */
function combinations(list, size) {
  const out = [];
  (function walk(start, acc) {
    if (acc.length === size) {
      out.push(acc.slice());
      return;
    }
    for (let index = start; index < list.length; index += 1) {
      acc.push(list[index]);
      walk(index + 1, acc);
      acc.pop();
    }
  })(0, []);
  return out;
}

/** Conjuntos de uno o dos instrumentos, cada uno en versión simple o avanzada. */
function instrumentSets() {
  const sets = [];
  for (const size of [1, 2]) {
    for (const ids of combinations(INSTRUMENT_IDS, size)) {
      let variants = [[]];
      for (const id of ids) {
        const next = [];
        for (const variant of variants) {
          for (const version of VERSIONS) next.push(variant.concat([{ id, version }]));
        }
        variants = next;
      }
      sets.push(variants);
    }
  }
  return sets.flat();
}

/** Orden de grupos del diseño: `computer` primero acorta los datos, el cuello habitual. */
function groupOrder() {
  return catalog
    .partGroups()
    .map((group) => group.id)
    .sort((a, b) => (a === 'computer' ? -1 : b === 'computer' ? 1 : 0));
}

/** Combinaciones de versión para los doce grupos, de menos a más piezas avanzadas. */
function partCombinations(groups) {
  const combos = [];
  for (let mask = 0; mask < 1 << groups.length; mask += 1) {
    const versions = groups.map((groupId, index) => ((mask >> index) & 1 ? 'advanced' : 'simple'));
    combos.push({ versions, mask, advanced: versions.filter((version) => version === 'advanced').length });
  }
  return combos.sort((a, b) => a.advanced - b.advanced || a.mask - b.mask);
}

/**
 * Busca al menos `wanted` diseños que pasen `validateLaunch` para un escenario y
 * una dificultad, partiendo del diseño por defecto.
 * @returns {{found: Array, validations: number}} soluciones (lanzador, órbita,
 *   instrumentos, coste y masa) y cuántas combinaciones se evaluaron
 */
function findSolutions(scenarioId, difficultyId, wanted) {
  const groups = groupOrder();
  const launchers = catalog
    .launchers()
    .slice()
    .sort((a, b) => a.maxOrbitRank - b.maxOrbitRank || a.payloadCapacity - b.payloadCapacity);
  const orbits = catalog
    .orbits()
    .slice()
    .sort((a, b) => a.rank - b.rank);
  const maxMass = Math.max(...launchers.map((launcher) => launcher.payloadCapacity));
  const sets = instrumentSets();
  const combos = partCombinations(groups);
  const found = [];
  const seen = new Set();
  let validations = 0;

  outer: for (const combo of combos) {
    const draft = design.createDesign({ scenarioId, difficultyId });
    groups.forEach((groupId, index) => design.setPartVersion(draft, groupId, combo.versions[index]));

    // Poda barata: los instrumentos solo suman, así que estas cuentas no mejoran.
    if (draft.totals.cost > draft.budget) continue;
    if (draft.totals.powerGen - draft.totals.powerDraw < 0) continue;
    if (draft.totals.mass > maxMass) continue;

    for (const orbit of orbits) {
      for (const launcher of launchers) {
        if (launcher.maxOrbitRank < orbit.rank) continue;
        design.setLauncher(draft, launcher.id);
        design.setOrbit(draft, orbit.id);

        for (const set of sets) {
          for (const entry of set) design.setInstrument(draft, entry.id, entry.version);
          validations += 1;
          const valid = design.validateLaunch(draft).ok;
          const totals = { cost: draft.totals.cost, mass: draft.totals.mass };
          for (const entry of set) design.setInstrument(draft, entry.id, null);
          if (!valid) continue;

          // Dos soluciones solo cuentan como distintas si cambian piezas, instrumentos u órbita.
          const fingerprint = JSON.stringify([draft.groups, set, orbit.id]);
          if (seen.has(fingerprint)) continue;
          seen.add(fingerprint);
          found.push({
            scenarioId,
            difficultyId,
            launcherId: launcher.id,
            orbitId: orbit.id,
            cost: totals.cost,
            mass: totals.mass,
            advancedGroups: combo.versions
              .map((version, index) => (version === 'advanced' ? groups[index] : null))
              .filter(Boolean),
            instruments: set.map((entry) => entry.id + ':' + entry.version)
          });
          if (found.length >= wanted) break outer;
        }
      }
    }
  }

  return { found, validations };
}

for (const scenario of catalog.scenarios()) {
  for (const difficultyId of DIFFICULTIES) {
    test('DM-14: ' + scenario.id + ' (' + difficultyId + ') admite al menos dos soluciones válidas', (t) => {
      const { found, validations } = findSolutions(scenario.id, difficultyId, 2);
      assert.ok(validations > 0, 'la búsqueda no evaluó ninguna combinación');
      assert.equal(found.length, 2, scenario.id + '/' + difficultyId + ': solo ' + found.length + ' soluciones válidas');

      // Rendimiento distinto (S26): las dos soluciones no pueden ser la misma nave.
      assert.notEqual(
        JSON.stringify([found[0].advancedGroups, found[0].instruments, found[0].orbitId, found[0].launcherId]),
        JSON.stringify([found[1].advancedGroups, found[1].instruments, found[1].orbitId, found[1].launcherId]),
        'las dos soluciones son idénticas'
      );

      for (const solution of found) {
        assert.ok(solution.cost > 0 && solution.mass > 0);
        t.diagnostic(
          scenario.id +
            ' / ' +
            difficultyId +
            ' · ' +
            solution.launcherId +
            ' + ' +
            solution.orbitId +
            ' · ' +
            solution.instruments.join(', ') +
            ' · ' +
            solution.cost +
            ' M€ · ' +
            solution.mass +
            ' kg'
        );
      }
    });
  }
}
