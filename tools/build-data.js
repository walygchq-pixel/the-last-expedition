/*
 * Generates `data/data-bundle.js` from the canonical JSON files in `data/`.
 *
 * Why (see contract C-2 in the task document): `fetch()` of local files
 * is blocked by CORS when the game is opened with `file://`, and RG-1 requires
 * opening `index.html` without a server. The JSON files remain the source of truth; this script
 * packs them into a single classic script that registers everything in `GS.data`.
 *
 * Usage: `node tools/build-data.js` (or `npm run build:data`).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const OUTPUT = path.join(DATA_DIR, 'data-bundle.js');
const HEADER = [
  '/*',
  ' * ARCHIVO GENERADO — no editar a mano.',
  ' * Fuente: los JSON de data/ (y sus subcarpetas). Regenerar: node tools/build-data.js',
  ' * Existe porque `fetch()` local falla bajo `file://` y el juego debe abrirse',
  ' * haciendo doble clic en index.html (RG-1).',
  ' */'
].join('\n');

/** Walks `data/` and returns the paths of every `.json` file. */
function listJsonFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listJsonFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      out.push(full);
    }
  }
  return out.sort();
}

/** Registry key: path relative to `data/`, without the extension and with `/`. */
function registryKey(file) {
  return path.relative(DATA_DIR, file).split(path.sep).join('/').replace(/\.json$/, '');
}

/** Canonical serialization: sorted keys, so the hash stays stable. */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) sorted[key] = canonicalize(value[key]);
    return sorted;
  }
  return value;
}

/** Loads every JSON file under `data/` and hashes the whole set. */
function loadData() {
  const files = listJsonFiles(DATA_DIR).map((file) => ({
    file,
    key: registryKey(file),
    text: fs.readFileSync(file, 'utf8')
  }));
  const registry = {};
  const hasher = crypto.createHash('sha256');
  for (const item of files) {
    let parsed;
    try {
      parsed = JSON.parse(item.text);
    } catch (error) {
      throw new Error(`JSON inválido en ${path.relative(ROOT, item.file)}: ${error.message}`);
    }
    registry[item.key] = parsed;
    hasher.update(item.key);
    hasher.update('\u0000');
    hasher.update(JSON.stringify(canonicalize(parsed)));
    hasher.update('\u0000');
  }
  return { registry, hash: hasher.digest('hex'), keys: files.map((item) => item.key) };
}

/** Builds the bundle text. */
function renderBundle(registry, hash, keys) {
  const lines = [HEADER, '(function (global) {', "  'use strict';", '  var GS = (global.GS = global.GS || {});', '  GS.data = GS.data || {};'];
  for (const key of keys) {
    lines.push(`  GS.data[${JSON.stringify(key)}] = ${JSON.stringify(registry[key])};`);
  }
  lines.push('  GS.dataMeta = ' + JSON.stringify({ hash, keys }) + ';');
  lines.push('})(typeof globalThis !== \'undefined\' ? globalThis : this);', '');
  return lines.join('\n');
}

function main() {
  const { registry, hash, keys } = loadData();
  fs.writeFileSync(OUTPUT, renderBundle(registry, hash, keys), 'utf8');
  process.stdout.write(`data-bundle.js actualizado: ${keys.length} archivos, hash ${hash.slice(0, 12)}\n`);
}

if (require.main === module) main();

module.exports = { loadData, renderBundle, registryKey, listJsonFiles, canonicalize, OUTPUT, DATA_DIR };
