'use strict';

/*
 * Cobertura de traducciones (contrato C-8, I-3, I-4).
 *
 * Recorre el código y los datos buscando toda clave i18n referenciada y verifica
 * que exista en inglés y en español. Es la red que impide que una pantalla nueva
 * deje un texto sin traducir: si una clave falta, esta prueba falla.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ROOT, registry, locales } = require('./helpers/data.js');
const systems = require('../js/core/systems.js');
const crew = require('../js/core/crew.js');

const DICTS = locales();

/** Todas las claves referenciadas, con el archivo donde aparecen. */
function referencedKeys() {
  const found = new Map();
  const add = (key, where) => {
    if (!found.has(key)) found.set(key, where);
  };

  // 1. Literales de código: `t('x.y')`, `labelKey: 'x.y'`, `code: 'x.y'`, …
  const patterns = [
    /\bt\(\s*['"]([a-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)['"]/g,
    /\b[A-Za-z]*Key\s*:\s*['"]([a-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)['"]/g,
    /\bcode\s*:\s*['"]([a-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)['"]/g
  ];
  for (const file of walk(path.join(ROOT, 'js'))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) add(match[1], path.relative(ROOT, file));
    }
  }

  // 2. Datos: cualquier campo `*Key` de `data/*.json`.
  const data = registry();
  for (const [fileKey, content] of Object.entries(data)) {
    if (fileKey.startsWith('locales/')) continue;
    walkJson(content, [], (field, value) => {
      if (!/(^|\.)[A-Za-z]*Key$/.test(field)) return;
      if (Array.isArray(value)) return;
      add(value, 'data/' + fileKey + '.json');
    });
  }

  // 3. Claves que se arman en tiempo de ejecución y no se pueden leer del código.
  systems.SYSTEM_IDS.forEach((id) => add('sys.' + id + '.name', 'core/systems (dinámica)'));
  ['health', 'hunger', 'thirst', 'sleep', 'stress', 'morale', 'hygiene'].forEach((need) =>
    add('crew.need.' + need, 'core/effects (dinámica)')
  );
  ['starving', 'dehydrated', 'exhausted', 'anxious', 'unhygienic', 'ill'].forEach((condition) =>
    add('crew.condition.' + condition, 'core/crew (dinámica)')
  );
  ['success', 'expired', 'lost_crew', 'inoperable', 'manual'].forEach((outcome) =>
    add('report.outcome.' + outcome, 'core/scoring (dinámica)')
  );
  const tags = new Set();
  for (const fileKey of Object.keys(data)) {
    if (fileKey !== 'instruments') continue;
    for (const item of data[fileKey].items || []) {
      for (const version of Object.values(item.versions || {})) {
        for (const tag of Object.keys(version.science || {})) tags.add(tag);
      }
    }
  }
  for (const tag of tags) add('science.tag.' + tag, 'data/instruments.json (dinámica)');

  return found;
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function walkJson(node, trail, visit) {
  if (Array.isArray(node)) {
    node.forEach((item, index) => walkJson(item, trail, visit));
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'string' && /Key$/.test(key)) visit(key, value);
    else walkJson(value, trail.concat(key), visit);
  }
}

test('C-8/I-4: toda clave referenciada existe en inglés y en español', () => {
  const missing = { en: [], es: [] };
  const keys = referencedKeys();
  assert.ok(keys.size > 100, 'se esperaban muchas claves referenciadas, se encontraron ' + keys.size);
  for (const [key, where] of keys) {
    if (!(key in DICTS.en)) missing.en.push(key + '  ← ' + where);
    if (!(key in DICTS.es)) missing.es.push(key + '  ← ' + where);
  }
  assert.deepEqual(missing.en, [], 'claves ausentes en en.json');
  assert.deepEqual(missing.es, [], 'claves ausentes en es.json');
});

test('C-8: las claves de sistemas, necesidades y condiciones tienen texto propio', () => {
  systems.SYSTEM_IDS.forEach((id) => {
    assert.ok('sys.' + id + '.name' in DICTS.en, 'falta sys.' + id + '.name');
    assert.ok('sys.' + id + '.name' in DICTS.es, 'falta sys.' + id + '.name en español');
  });
  crew.ROLES.forEach((role) => {
    assert.ok('role.' + role + '.name' in DICTS.en, 'falta role.' + role + '.name');
    assert.ok('role.' + role + '.name' in DICTS.es, 'falta role.' + role + '.name en español');
  });
});
