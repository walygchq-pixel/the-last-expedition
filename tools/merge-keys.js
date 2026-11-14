/*
 * Fusiona un fragmento de claves i18n en `data/locales/en.json` y `es.json`.
 *
 * Los workers entregan sus claves en `odd/tasks/keys-*.json` con la forma
 * `{ "en": {...}, "es": {...} }` para no pelear por el mismo archivo. Este script
 * es el único punto donde se escriben los diccionarios finales (I-3, I-4).
 *
 * Uso: `node tools/merge-keys.js odd/tasks/keys-world.json [más fragmentos…]`
 * Falla si el fragmento rompe la paridad o si redefine una clave con otro texto.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const LOCALES = ['en', 'es'].map((language) => path.join(ROOT, 'data', 'locales', language + '.json'));

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Ordena las claves para que el archivo resultante sea estable en `git diff`. */
function sorted(dict) {
  const out = {};
  for (const key of Object.keys(dict).sort()) out[key] = dict[key];
  return out;
}

function main() {
  const fragments = process.argv.slice(2);
  if (fragments.length === 0) {
    process.stderr.write('Uso: node tools/merge-keys.js <fragmento.json> […]\\n');
    process.exit(2);
  }

  const dicts = { en: readJson(LOCALES[0]), es: readJson(LOCALES[1]) };
  const report = { added: { en: 0, es: 0 }, conflicts: [] };

  for (const fragment of fragments) {
    const file = path.resolve(ROOT, fragment);
    const incoming = readJson(file);
    for (const language of ['en', 'es']) {
      const block = incoming[language] || {};
      for (const [key, value] of Object.entries(block)) {
        const existing = dicts[language][key];
        if (existing === undefined) {
          dicts[language][key] = value;
          report.added[language] += 1;
        } else if (JSON.stringify(existing) !== JSON.stringify(value)) {
          report.conflicts.push({ language, key, existing, incoming: value, file: fragment });
        }
      }
    }
  }

  if (report.conflicts.length > 0) {
    process.stderr.write('Conflictos de claves (no se escribió nada):\n');
    for (const conflict of report.conflicts.slice(0, 20)) {
      process.stderr.write(`  ${conflict.language} · ${conflict.key} en ${conflict.file}\n`);
    }
    process.exit(1);
  }

  fs.writeFileSync(LOCALES[0], JSON.stringify(sorted(dicts.en), null, 2) + '\n', 'utf8');
  fs.writeFileSync(LOCALES[1], JSON.stringify(sorted(dicts.es), null, 2) + '\n', 'utf8');

  const en = Object.keys(dicts.en).length;
  const es = Object.keys(dicts.es).length;
  process.stdout.write(
    `locales: +${report.added.en} en, +${report.added.es} es · total ${en}/${es}` + (en === es ? ' (paridad ok)\n' : ' (PARIDAD ROTA)\n')
  );
  if (en !== es) process.exit(1);
}

if (require.main === module) main();

module.exports = { readJson, sorted };
