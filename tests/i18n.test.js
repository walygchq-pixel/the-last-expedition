'use strict';

/*
 * Pruebas de `js/i18n` en Node, sin navegador (T-3, I-15).
 * Cubren paridad de claves (I-4), plantillas (I-5), plural y género (I-6),
 * formato numérico (I-7), detección de idioma (I-8), cambio en vivo (I-2)
 * y fallback (I-12).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const i18n = require('../js/i18n/index.js');
const { locales } = require('./helpers/data.js');

const DICTS = locales();

/** Devuelve el tipo estructural de un valor de diccionario. */
function shapeOf(value) {
  if (typeof value === 'string') return 'string';
  if (value && typeof value === 'object') return 'object:' + Object.keys(value).sort().join(',');
  return typeof value;
}

test('I-4: las claves de inglés y español coinciden exactamente', () => {
  const en = Object.keys(DICTS.en).sort();
  const es = Object.keys(DICTS.es).sort();
  const missingInEs = en.filter((key) => !(key in DICTS.es));
  const missingInEn = es.filter((key) => !(key in DICTS.en));
  assert.deepEqual(missingInEs, [], 'claves presentes en en.json y ausentes en es.json');
  assert.deepEqual(missingInEn, [], 'claves presentes en es.json y ausentes en en.json');
});

test('I-4: las variantes de plural y género tienen la misma forma en ambos idiomas', () => {
  for (const key of Object.keys(DICTS.en)) {
    assert.equal(shapeOf(DICTS.en[key]), shapeOf(DICTS.es[key]), 'forma distinta en la clave ' + key);
  }
});

test('I-4: ninguna traducción está vacía', () => {
  for (const [language, dict] of Object.entries(DICTS)) {
    for (const [key, value] of Object.entries(dict)) {
      const texts = typeof value === 'string' ? [value] : collectStrings(value);
      assert.ok(texts.length > 0, language + ' · ' + key + ' sin texto');
      for (const text of texts) assert.ok(text.trim().length > 0, language + ' · ' + key + ' vacío');
    }
  }
});

function collectStrings(value) {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap(collectStrings);
}

test('I-5: resuelve plantillas con marcadores nombrados y orden propio de cada idioma', () => {
  const dicts = {
    en: { 'msg.share': '{sender} gave {item} to {receiver}' },
    es: { 'msg.share': '{item}: de {sender} para {receiver}' }
  };
  const tr = i18n.createTranslator({ dicts, locale: 'en', logger: null });
  assert.equal(tr.t('msg.share', { sender: 'Ana', item: 'wrench', receiver: 'Bo' }), 'Ana gave wrench to Bo');
  tr.setLocale('es');
  assert.equal(tr.t('msg.share', { sender: 'Ana', item: 'llave', receiver: 'Bo' }), 'llave: de Ana para Bo');
});

test('I-5: un marcador sin parámetro no deja llaves visibles en pantalla', () => {
  const warnings = [];
  const dicts = { en: { 'msg.need': 'You need {count} parts' }, es: {} };
  const tr = i18n.createTranslator({ dicts, locale: 'en', logger: { warn: (m) => warnings.push(m) } });
  const text = tr.t('msg.need', {});
  assert.equal(text, 'You need  parts');
  assert.equal(text.includes('{'), false);
  assert.equal(warnings.length, 1);
});

test('I-6: elige la forma singular y plural según el número', () => {
  const dicts = {
    en: { 'res.days': { one: '{n} day', other: '{n} days' } },
    es: {}
  };
  const tr = i18n.createTranslator({ dicts, locale: 'en', logger: null });
  assert.equal(tr.t('res.days', { n: 1 }), '1 day');
  assert.equal(tr.t('res.days', { n: 5 }), '5 days');
});

test('I-6: admite categorías CLDR de español y anidamiento de género dentro de plural', () => {
  const dicts = {
    en: {},
    es: {
      'crew.hurt': {
        one: { male: '{n} herido', female: '{n} herida' },
        other: { male: '{n} heridos', female: '{n} heridas' }
      }
    }
  };
  const tr = i18n.createTranslator({ dicts, locale: 'es', logger: null });
  assert.equal(tr.t('crew.hurt', { n: 1, g: 'f' }), '1 herida');
  assert.equal(tr.t('crew.hurt', { n: 3, g: 'm' }), '3 heridos');
  // Sin género explícito cae en el masculino genérico del español (valor `male`).
  assert.equal(tr.t('crew.hurt', { n: 3 }), '3 heridos');
});

test('I-7: números y decimales usan el separador de cada idioma', () => {
  const tr = i18n.createTranslator({ dicts: DICTS, locale: 'en', logger: null });
  assert.equal(tr.formatNumber(1234.5), '1,234.5');
  tr.setLocale('es');
  assert.equal(tr.formatNumber(1234.5), '1.234,5');
});

test('I-7: los números dentro de una plantilla también se formatean', () => {
  const dicts = { en: { 'msg.mass': 'Mass: {mass} kg' }, es: { 'msg.mass': 'Masa: {mass} kg' } };
  const tr = i18n.createTranslator({ dicts, locale: 'es', logger: null });
  assert.equal(tr.t('msg.mass', { mass: 1234.5 }), 'Masa: 1.234,5 kg');
});

test('I-7: fechas, duraciones y unidades respetan el idioma activo', () => {
  const tr = i18n.createTranslator({ dicts: DICTS, locale: 'en', logger: null });
  const date = new Date(Date.UTC(2031, 2, 14, 12, 0, 0));
  const enDate = tr.formatDate(date);
  tr.setLocale('es');
  const esDate = tr.formatDate(date);
  assert.notEqual(enDate, esDate);
  assert.match(enDate, /Mar/);
  assert.match(esDate, /mar/i);
  assert.equal(tr.formatUnit(12, 'unit.kg'), '12 kg');
  assert.equal(tr.formatDuration(72), "3 d 0 h");
  assert.equal(tr.formatDuration(0.5), '30 min');
});

test('I-2: el cambio de idioma notifica a los suscriptores y es inmediato', () => {
  const tr = i18n.createTranslator({ dicts: DICTS, locale: 'en', logger: null });
  const seen = [];
  const unsubscribe = tr.onChange((locale) => seen.push(locale));
  assert.equal(tr.t('res.power.name'), 'Power');
  tr.setLocale('es');
  assert.equal(tr.t('res.power.name'), 'Potencia');
  assert.deepEqual(seen, ['es']);
  tr.setLocale('es');
  assert.deepEqual(seen, ['es'], 'no notifica si el idioma no cambia');
  unsubscribe();
  tr.setLocale('en');
  assert.deepEqual(seen, ['es']);
});

test('I-12: si falta una clave en el idioma activo se muestra el inglés y se avisa', () => {
  const warnings = [];
  const dicts = { en: { 'hud.power.label': 'Power' }, es: {} };
  const tr = i18n.createTranslator({ dicts, locale: 'es', logger: { warn: (m) => warnings.push(m) } });
  assert.equal(tr.t('hud.power.label'), 'Power');
  assert.equal(warnings.length, 1);
  assert.deepEqual(tr.missingKeys().active, ['hud.power.label']);
});

test('I-12: una clave inexistente en ambos idiomas nunca se muestra cruda', () => {
  const warnings = [];
  const tr = i18n.createTranslator({ dicts: DICTS, locale: 'en', logger: { warn: (m) => warnings.push(m) } });
  const text = tr.t('ns.no.existe');
  assert.equal(text, i18n.MISSING_TEXT);
  assert.equal(text.includes('ns.no.existe'), false);
  assert.equal(warnings.length, 1);
});

test('I-8: detección preferencia → navegador → inglés', () => {
  assert.equal(i18n.detectLocale('es', 'en-US'), 'es');
  assert.equal(i18n.detectLocale(null, 'es-AR'), 'es');
  assert.equal(i18n.detectLocale(undefined, 'fr-FR'), 'en');
  assert.equal(i18n.detectLocale('xx', 'de'), 'en');
  assert.equal(i18n.normalizeLocale('es_419'), 'es');
  assert.equal(i18n.normalizeLocale('EN-gb'), 'en');
  assert.equal(i18n.normalizeLocale(''), null);
});

test('un idioma no soportado cae en inglés al crear el traductor', () => {
  const tr = i18n.createTranslator({ dicts: DICTS, locale: 'fr', logger: null });
  assert.equal(tr.locale(), 'en');
  assert.deepEqual(tr.supported(), ['en', 'es']);
});
