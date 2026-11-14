/*
 * Genera `data/data-bundle.js` a partir de los JSON canónicos de `data/`.
 *
 * Motivo (ver contrato C-2 del documento de tareas): `fetch()` de archivos locales
 * está bloqueado por CORS cuando el juego se abre con `file://`, y RG-1 exige abrir
 * `index.html` sin servidor. Los JSON siguen siendo la fuente de verdad; este script
 * los empaqueta en un único script clásico que registra todo en `GS.data`.
 *
 * Uso: `node tools/build-data.js` (o `npm run build:data`).
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

/** Recorre `data/` y devuelve las rutas de todos los `.json`. */
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

/** Clave del registro: ruta relativa a `data/` sin extensión y con `/`. */
function registryKey(file) {
  return path.relative(DATA_DIR, file).split(path.sep).join('/').replace(/\.json$/, '');
}

/** Serialización canónica: claves ordenadas, para que el hash sea estable. */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) sorted[key] = canonicalize(value[key]);
    return sorted;
  }
  return value;
}

/** Carga todos los JSON de `data/` y calcula el hash del conjunto. */
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

/** Construye el texto del bundle. */
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
