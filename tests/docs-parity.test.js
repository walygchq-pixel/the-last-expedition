'use strict';
// La documentación vive en dos ediciones (S69/S70): el inglés es la cara del repositorio y el
// español es el original normativo. Esta prueba impide que las ediciones se separen: si alguien
// toca una sin la otra, falla.
//
// No compara el texto —la traducción es libre— sino el esqueleto que no depende del idioma:
// cantidad y orden de secciones, filas de tabla, identificadores de requisito y referencias a
// las decisiones de diseño. También prohíbe publicar cifras volátiles del proceso (cuántas
// pruebas hay), porque eso es lo que se desincronizó dos veces: el README llegó a declarar
// «95 pruebas» en la cabecera y «83 pruebas» en «Verificación».

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const raiz = path.join(__dirname, '..');
const leer = (archivo) => fs.readFileSync(path.join(raiz, archivo), 'utf8');

// Cada par es la misma documentación en dos idiomas.
const PARES = [
  { nombre: 'README', ingles: 'README.md', espanol: 'README.es.md' },
  { nombre: 'requisitos', ingles: 'REQUIREMENTS.md', espanol: 'REQUISITOS.md' }
];

/** Secciones de nivel dos, en orden de aparición. */
function secciones(texto) {
  return texto.split(/^## /m).slice(1).map((bloque) => bloque.split('\n')[0].trim());
}

/** Filas de tabla, sin la línea de separación del encabezado. */
function filas(texto) {
  return texto
    .split('\n')
    .filter((linea) => /^\|/.test(linea.trim()))
    .filter((linea) => !/^\|[\s|:-]+\|$/.test(linea.trim()));
}

/** Identificadores de requisito de la primera celda: RG-1, DM-7, RN-2, I-3, I-11 … */
function identificadores(texto) {
  const salida = [];
  for (const linea of filas(texto)) {
    const celda = linea.trim().split('|')[1] || '';
    for (const trozo of celda.split(',')) {
      const id = trozo.trim();
      if (/^[A-Z]+-\d+$/.test(id)) salida.push(id);
    }
  }
  return salida;
}

/** Referencias a las decisiones de diseño: son siglas, no se traducen, se citen en negrita o
 * en texto plano (`**D-9**`, `(D-9)`, `contract D-1`). */
function referencias(texto) {
  return [...texto.matchAll(/(?<![A-Za-z0-9-])([DS]-\d+)(?!\d)/g)].map((m) => m[1]);
}

/** Marca de orden de sección: `<!-- section: id -->`, idéntica en los dos idiomas. */
function marcas(texto) {
  return [...texto.matchAll(/<!-- section: ([a-z0-9-]+) -->/g)].map((m) => m[1]);
}

test('S69/S70: cada edición tiene el mismo esqueleto de secciones y tablas que su par', () => {
  const problemas = [];
  for (const par of PARES) {
    const ingles = leer(par.ingles);
    const espanol = leer(par.espanol);
    const seccionesIngles = secciones(ingles);
    const seccionesEspanol = secciones(espanol);

    if (seccionesIngles.length !== seccionesEspanol.length) {
      problemas.push(
        `${par.nombre}: ${seccionesIngles.length} secciones en ${par.ingles} y ` +
          `${seccionesEspanol.length} en ${par.espanol}`
      );
      continue;
    }

    // Se comparan por posición porque el título de cada sección está traducido.
    seccionesIngles.forEach((_, indice) => {
      const bloque = (texto) => texto.split(/^## /m)[indice + 1] || '';
      const filasIngles = filas(bloque(ingles)).length;
      const filasEspanol = filas(bloque(espanol)).length;
      if (filasIngles !== filasEspanol) {
        problemas.push(
          `${par.nombre}: la sección ${indice + 1} tiene ${filasIngles} filas en ${par.ingles} ` +
            `y ${filasEspanol} en ${par.espanol}`
        );
      }
    });
  }
  assert.deepEqual(problemas, []);
});

test('S69/S70: ambas ediciones de requisitos listan los mismos identificadores en el mismo orden', () => {
  for (const par of PARES) {
    assert.deepEqual(
      identificadores(leer(par.ingles)),
      identificadores(leer(par.espanol)),
      `${par.ingles} y ${par.espanol} no recorren los mismos requisitos`
    );
  }
});

test('S69/S70: ambas ediciones citan las mismas decisiones de diseño', () => {
  for (const par of PARES) {
    const enIngles = referencias(leer(par.ingles));
    const enEspanol = referencias(leer(par.espanol));
    // Sin esto, un par que no cita ninguna decisión compararía dos arreglos vacíos y pasaría
    // sin cubrir nada, que es exactamente el defecto que la revisión nativa marcó en R2-002.
    assert.ok(
      enIngles.length > 0,
      `${par.ingles} no cita ninguna decisión de diseño: la comparación no probaría nada`
    );
    assert.deepEqual(
      enIngles,
      enEspanol,
      `${par.ingles} y ${par.espanol} no citan las mismas decisiones de diseño`
    );
  }
});

test('S69/S70: las secciones van en el mismo orden en las dos ediciones', () => {
  for (const par of PARES) {
    const ingles = leer(par.ingles);
    const espanol = leer(par.espanol);
    // La cantidad ya se compara arriba; acá se compara el orden, que el texto no puede dar
    // porque cada edición traduce los títulos. La marca `<!-- section: id -->` es el contrato.
    assert.equal(
      marcas(ingles).length,
      secciones(ingles).length,
      `${par.ingles}: alguna sección no tiene su marca \`<!-- section: id -->\``
    );
    assert.equal(
      marcas(espanol).length,
      secciones(espanol).length,
      `${par.espanol}: alguna sección no tiene su marca \`<!-- section: id -->\``
    );
    assert.deepEqual(
      marcas(ingles),
      marcas(espanol),
      `${par.ingles} y ${par.espanol} ordenan las secciones distinto`
    );
  }
});

test('S69/S70: cada edición enlaza a su par, así el lector elige el idioma', () => {
  for (const par of PARES) {
    const ingles = leer(par.ingles);
    const espanol = leer(par.espanol);
    assert.ok(ingles.includes(`](${par.espanol})`), `${par.ingles} no enlaza a ${par.espanol}`);
    assert.ok(espanol.includes(`](${par.ingles})`), `${par.espanol} no enlaza a ${par.ingles}`);
  }
  // El README es la puerta de entrada: tiene que llevar a las dos ediciones de requisitos.
  const readme = leer('README.md');
  assert.ok(readme.includes('](REQUIREMENTS.md)'), 'README.md no enlaza a REQUIREMENTS.md');
  assert.ok(readme.includes('](REQUISITOS.md)'), 'README.md no enlaza a REQUISITOS.md');
});

test('S69/S70: ninguna edición publica el conteo de pruebas, que cambia con cada commit', () => {
  const volatil = /\b\d+\s+(?:pruebas|tests)\b/gi;
  for (const par of PARES) {
    for (const archivo of [par.ingles, par.espanol]) {
      const encontrado = leer(archivo).match(volatil);
      assert.equal(
        encontrado,
        null,
        `${archivo} publica una cifra volátil: ${encontrado && encontrado[0]}. ` +
          'Citá `npm test` en lugar del número.'
      );
    }
  }
});
