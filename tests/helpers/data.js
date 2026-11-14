'use strict';

const path = require('node:path');
const { loadData } = require('../../tools/build-data.js');

const ROOT = path.resolve(__dirname, '..', '..');

/** Registro de datos completo (`GS.data`) tal como lo ve el navegador. */
function registry() {
  return loadData().registry;
}

/** Diccionarios de idioma listos para `createTranslator`. */
function locales() {
  const data = registry();
  return { en: data['locales/en'], es: data['locales/es'] };
}

module.exports = { ROOT, registry, locales };
