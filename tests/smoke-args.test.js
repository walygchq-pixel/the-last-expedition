'use strict';

/*
 * Pruebas del arnés de humo (R3-001).
 *
 * `parseArgs` tiene que ser estricto: si un flag se ignora en silencio, el humo
 * corre contra el destino por defecto y puede informar éxito sobre otra cosa.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseArgs } = require('../tools/smoke.js');

test('R3-001: un argumento desconocido aborta en vez de ignorarse', () => {
  assert.throws(() => parseArgs(['node', 'tools/smoke.js', '--urll', 'http://x']), /argumento desconocido/);
  assert.throws(() => parseArgs(['node', 'tools/smoke.js', '--url']), /necesita un valor/);
  assert.throws(() => parseArgs(['node', 'tools/smoke.js', '--port', 'abc']), /puerto válido/);
});

test('R3-001: los argumentos válidos se aplican en orden', () => {
  const options = parseArgs(['node', 'tools/smoke.js', '--url', 'file:///tmp/x.html', '--out', '/tmp/salida', '--port', '9444']);
  assert.equal(options.url, 'file:///tmp/x.html');
  assert.equal(options.out, '/tmp/salida');
  assert.equal(options.port, 9444);

  const defaults = parseArgs(['node', 'tools/smoke.js']);
  assert.equal(defaults.port, 9333);
  assert.match(defaults.url, /index\.html$/);
});
