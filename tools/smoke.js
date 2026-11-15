/*
 * Humo real en navegador (S1, RG-1, RG-5): abre `index.html` con `file://` en
 * Chrome headless, recorre el flujo principal y falla si hay excepciones, errores
 * de consola o claves de traducción sin resolver. Guarda capturas para revisión
 * visual.
 *
 * Sin dependencias: usa el protocolo DevTools por WebSocket (nativo en Node ≥22).
 *
 * Uso: `node tools/smoke.js [--url file:///ruta/index.html] [--out tools/.smoke]`
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

/**
 * Lee los argumentos de línea de comandos. Es estricto a propósito: un flag mal
 * escrito aborta en lugar de ignorarse, porque el humo terminaría corriendo
 * contra el destino por defecto y aun así informando éxito (R3-001).
 */
function parseArgs(argv) {
  const options = { url: 'file://' + path.join(ROOT, 'index.html'), out: path.join(ROOT, 'tools', '.smoke'), port: 9333 };
  const known = {
    '--url': (value) => {
      options.url = value;
    },
    '--out': (value) => {
      options.out = path.resolve(value);
    },
    '--port': (value) => {
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('--port necesita un puerto válido (1-65535): ' + value);
      }
      options.port = port;
    }
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const apply = known[arg];
    if (!apply) throw new Error('argumento desconocido: ' + arg + ' (válidos: --url, --out, --port)');
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(arg + ' necesita un valor');
    apply(value);
    i += 1;
  }
  return options;
}

/** Espera a que la página termine de cargar y monte la primera pantalla. */
async function waitForReady(client, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await client.evaluate('document.readyState');
    if (state === 'complete') {
      const mounted = await client.evaluate(
        '!!(document.getElementById("screen") && document.getElementById("screen").childElementCount > 0)'
      );
      if (mounted) return true;
    }
    await sleep(120);
  }
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chromeBinary() {
  const candidates = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/opt/google/chrome/chrome'
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function waitForEndpoint(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return await response.json();
    } catch (error) {
      lastError = error;
    }
    await sleep(120);
  }
  throw new Error('Chrome no respondió en el puerto ' + port + (lastError ? ': ' + lastError.message : ''));
}

/** Cliente CDP mínimo: una sesión plana por WebSocket. */
function createClient(wsUrl) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  const events = [];
  let nextId = 1;
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', (error) => reject(error));
  });
  const requestTimeoutMs = 20000;
  socket.addEventListener('close', () => {
    const error = new Error('la conexión con Chrome se cerró');
    pending.forEach((item) => item.reject(error));
    pending.clear();
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
      return;
    }
    if (message.method) events.push(message);
  });

  function send(method, params) {
    const id = nextId++;
    const payload = JSON.stringify({ id, method, params: params || {} });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('sin respuesta de Chrome para ' + method + ' (' + requestTimeoutMs + ' ms)'));
      }, requestTimeoutMs);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        }
      });
      socket.send(payload);
    });
  }

  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true
    });
    if (result.exceptionDetails) {
      const text = result.exceptionDetails.exception && result.exceptionDetails.exception.description;
      throw new Error(text || result.exceptionDetails.text || 'excepción en la página');
    }
    return result.result.value;
  }

  return { ready, send, evaluate, events, close: () => socket.close() };
}

const helpers = String.raw`
  window.__tleSmoke = {
    texts: function () {
      return Array.from(document.querySelectorAll('button, [role="button"], a')).map(function (node) {
        return (node.innerText || node.getAttribute('aria-label') || '').trim();
      }).filter(Boolean);
    },
    nodes: function () {
      return Array.from(document.querySelectorAll('button, [role="button"], a'));
    },
    label: function (node) {
      return (node.innerText || node.getAttribute('aria-label') || '').trim().toLowerCase();
    },
    // Coincidencia por subcadena: las tarjetas tienen título y descripción juntos.
    click: function (texts) {
      var wanted = texts.map(function (t) { return t.toLowerCase(); });
      var nodes = window.__tleSmoke.nodes();
      for (var i = 0; i < nodes.length; i += 1) {
        var node = nodes[i];
        var label = window.__tleSmoke.label(node);
        if (!label || node.disabled) continue;
        for (var j = 0; j < wanted.length; j += 1) {
          if (label.indexOf(wanted[j]) !== -1) { node.click(); return label; }
        }
      }
      return null;
    },
    // Clic por etiqueta exacta: evita que 'EN' coincida con cualquier palabra.
    exact: function (texts) {
      var wanted = texts.map(function (t) { return t.toLowerCase(); });
      var nodes = window.__tleSmoke.nodes();
      for (var i = 0; i < nodes.length; i += 1) {
        var node = nodes[i];
        if (node.disabled) continue;
        var label = window.__tleSmoke.label(node);
        if (wanted.indexOf(label) === -1) continue;
        node.click();
        return label;
      }
      return null;
    },
    // Devuelve la etiqueta exacta presente, sin hacer clic.
    find: function (texts) {
      var wanted = texts.map(function (t) { return t.toLowerCase(); });
      var nodes = window.__tleSmoke.nodes();
      for (var i = 0; i < nodes.length; i += 1) {
        var label = window.__tleSmoke.label(nodes[i]);
        if (wanted.indexOf(label) !== -1) return label;
      }
      return null;
    },
    // Clic en la tarjeta que menciona el texto buscado (p. ej. la ficha del instrumento
    // Radar) y que contiene un botón con alguna de las etiquetas dadas.
    clickCard: function (needle, texts) {
      var wanted = texts.map(function (t) { return t.toLowerCase(); });
      var target = needle.toLowerCase();
      var nodes = window.__tleSmoke.nodes();
      for (var i = 0; i < nodes.length; i += 1) {
        var node = nodes[i];
        var label = window.__tleSmoke.label(node);
        if (!label || node.disabled) continue;
        if (!wanted.some(function (text) { return label.indexOf(text) !== -1; })) continue;
        var scope = node.parentElement;
        for (var up = 0; up < 5 && scope; up += 1) {
          var text = (scope.innerText || '').toLowerCase();
          if (text.indexOf(target) !== -1 && scope.querySelectorAll('button').length <= 8) {
            node.scrollIntoView({ block: 'center' });
            node.click();
            return label;
          }
          scope = scope.parentElement;
        }
      }
      return null;
    },
    // Clic dentro de la sección cuyo encabezado coincide (evita que "órbita" del
    // texto de un lanzador haga clic en el lanzador equivocado).
    clickUnder: function (sectionText, texts) {
      var wanted = texts.map(function (t) { return t.toLowerCase(); });
      var needle = sectionText.toLowerCase();
      var heads = Array.from(document.querySelectorAll('h1, h2, h3, h4, legend, strong'));
      for (var h = 0; h < heads.length; h += 1) {
        if ((heads[h].innerText || '').toLowerCase().indexOf(needle) === -1) continue;
        var section = heads[h].closest('section, fieldset, .card') || heads[h].parentElement;
        if (!section) continue;
        var buttons = Array.from(section.querySelectorAll('button, [role="button"]'));
        for (var i = 0; i < buttons.length; i += 1) {
          var label = window.__tleSmoke.label(buttons[i]);
          if (!label || buttons[i].disabled) continue;
          if (wanted.some(function (text) { return label.indexOf(text) !== -1; })) {
            buttons[i].scrollIntoView({ block: 'center' });
            buttons[i].click();
            return label;
          }
        }
      }
      return null;
    },
    // Clic dentro de la tarjeta que menciona el contexto (p. ej. el grupo Ordenador).
    clickIn: function (context, texts) {
      var wanted = texts.map(function (t) { return t.toLowerCase(); });
      var nodes = window.__tleSmoke.nodes();
      for (var i = 0; i < nodes.length; i += 1) {
        var node = nodes[i];
        var label = window.__tleSmoke.label(node);
        if (!label || node.disabled) continue;
        var matches = wanted.some(function (text) { return label.indexOf(text) !== -1; });
        if (!matches) continue;
        var scope = node.parentElement;
        for (var up = 0; up < 4 && scope; up += 1) {
          if ((scope.innerText || '').toLowerCase().indexOf(context.toLowerCase()) !== -1) {
            node.click();
            return label;
          }
          scope = scope.parentElement;
        }
      }
      return null;
    },
    visibleText: function () { return (document.body.innerText || '').trim(); },
    // Mapa de la pantalla: encabezados y controles por sección. Sirve para
    // diagnosticar por qué un paso no encontró su botón.
    structure: function () {
      var out = [];
      var heads = Array.from(document.querySelectorAll('h1, h2, h3, h4, legend'));
      heads.forEach(function (head) {
        var scope = head.closest('section, fieldset, .card') || head.parentElement;
        var controls = Array.from(scope.querySelectorAll('button, [role="button"], input, select'));
        out.push({
          heading: (head.innerText || '').trim().slice(0, 60),
          controls: controls.slice(0, 40).map(function (node) {
            return {
              tag: node.tagName.toLowerCase(),
              type: node.getAttribute('type') || null,
              label: (node.innerText || node.getAttribute('aria-label') || node.value || '').trim().slice(0, 70),
              disabled: !!node.disabled
            };
          })
        });
      });
      return out;
    },
    rawKeys: function () {
      var text = document.body.innerText || '';
      var words = text.split(/\s+/);
      return words.filter(function (word) { return /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_]+){2,}$/.test(word); });
    }
  };
`;

async function main() {
  const options = parseArgs(process.argv);
  const chrome = chromeBinary();
  if (!chrome) {
    process.stderr.write('No se encontró Chrome ni Chromium; no se puede correr el humo.\n');
    process.exit(2);
  }
  fs.mkdirSync(options.out, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tle-smoke-'));

  const child = spawn(
    chrome,
    [
      '--headless=new',
      `--remote-debugging-port=${options.port}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--hide-scrollbars',
      '--allow-file-access-from-files',
      '--window-size=1440,900',
      'about:blank'
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
  child.stderr.on('data', () => {});

  const problems = [];
  let shot = 0;
  const capture = async (client, name) => {
    shot += 1;
    const result = await client.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(options.out, String(shot).padStart(2, '0') + '-' + name + '.png');
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
    return file;
  };

  try {
    await waitForEndpoint(options.port, 15000);
    // El target se crea en blanco: la navegación va después de `Runtime.enable`,
    // porque CDP no reenvía las excepciones ni los mensajes de consola ocurridos
    // antes de habilitar el dominio y un error de arranque quedaba invisible
    // mientras el humo informaba éxito (R4-001).
    const created = await fetch(`http://127.0.0.1:${options.port}/json/new?about:blank`, { method: 'PUT' });
    const target = await created.json();
    const client = createClient(target.webSocketDebuggerUrl);
    await client.ready;
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Log.enable');
    await client.send('Page.navigate', { url: options.url });
    const ready = await waitForReady(client, 10000);
    if (!ready) problems.push('la aplicación no llegó a montar la primera pantalla en 10 s');
    await client.evaluate(helpers);

    const screenshots = [];
    const title = await client.evaluate('document.title');
    if (!title || !title.trim()) problems.push('document.title vacío: la UI no arrancó o no tradujo el título');
    const topbarText = await client.evaluate('document.getElementById("topbar").innerText.trim()');
    if (!topbarText) problems.push('la barra superior está vacía');
    const screenChildren = await client.evaluate('document.getElementById("screen").childElementCount');
    if (!screenChildren) problems.push('la pantalla principal no tiene contenido');
    screenshots.push(await capture(client, 'title'));

    // Flujo principal: nueva misión → diseño → viaje, con capturas por etapa.
    const clicked = [];
    const steps = [
      { name: 'new-mission', labels: ['nueva misión', 'new mission'] },
      { name: 'design', labels: ['diseñar la misión', 'design mission'] },
      { name: 'launcher', under: ['lanzador', 'launcher'], labels: ['atlas'] },
      { name: 'orbit', under: ['órbita', 'orbit'], labels: ['medium', 'media'] },
      { name: 'instrument', card: ['radar'], labels: ['simple'] },
      { name: 'computer', card: ['computadora', 'computer'], labels: ['advanced', 'avanzada'] },
      { name: 'launch', labels: ['launch mission', 'lanzar la misión', 'launch', 'lanzar'] },
      { name: 'finish', labels: ['finish mission', 'finalizar misión', 'finish', 'finalizar'], optional: true }
    ];
    for (const step of steps) {
      const expression = step.card
        ? `(${JSON.stringify(step.card)}).reduce(function (acc, needle) { return acc || window.__tleSmoke.clickCard(needle, ${JSON.stringify(step.labels)}); }, null)`
        : step.under
        ? `var u = ${JSON.stringify(step.under)}, l = ${JSON.stringify(step.labels)}; u.reduce(function (acc, word) { return acc || window.__tleSmoke.clickUnder(word, l); }, null)`
        : step.context
          ? `window.__tleSmoke.clickIn(${JSON.stringify(step.context)}, ${JSON.stringify(step.labels)})`
          : `window.__tleSmoke.click(${JSON.stringify(step.labels)})`;
      const label = await client.evaluate(expression);
      clicked.push({ step: step.name, label: label || null, optional: !!step.optional });
      if (!label && !step.optional) {
        const available = await client.evaluate('window.__tleSmoke.texts()');
        problems.push(`no se pudo avanzar en "${step.name}"; botones: ${JSON.stringify(available.slice(0, 24))}`);
        break;
      }
      await sleep(400);
      screenshots.push(await capture(client, step.name));
    }

    // Cambio de idioma en vivo (I-2): el texto visible debe cambiar sin recargar.
    const beforeLang = await client.evaluate('window.__tleSmoke.visibleText()');
    // El botón de idioma muestra el idioma al que se va a cambiar: después del
    // clic tiene que mostrar el otro, si no el cambio no ocurrió (R3-001).
    const langLabel = await client.evaluate(`window.__tleSmoke.exact(['English', 'Español'])`);
    await sleep(400);
    const afterLang = await client.evaluate('window.__tleSmoke.visibleText()');
    if (!langLabel) {
      problems.push('no se encontró un control de idioma con etiqueta exacta English/Español');
    } else {
      const flipped = await client.evaluate(`window.__tleSmoke.find(['English', 'Español'])`);
      if (flipped === langLabel) problems.push('el control de idioma no cambió de estado tras el clic');
      if (beforeLang === afterLang) problems.push('el cambio de idioma no modificó el texto visible');
    }
    screenshots.push(await capture(client, 'language'));

    // Claves crudas visibles (I-12) y errores de consola.
    const rawKeys = await client.evaluate('window.__tleSmoke.rawKeys()');
    if (rawKeys.length > 0) problems.push('claves i18n visibles en pantalla: ' + rawKeys.slice(0, 10).join(', '));

    const missing = await client.evaluate('window.TLE && window.TLE.translator ? window.TLE.translator.missingKeys() : null');
    if (missing && (missing.active.length > 0 || missing.fallback.length > 0)) {
      problems.push('claves sin traducir pedidas por la UI: ' + JSON.stringify(missing.active.slice(0, 10).concat(missing.fallback.slice(0, 10))));
    }

    const structure = await client.evaluate('window.__tleSmoke.structure()');
    const width = await client.evaluate('({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth })');
    if (width.scroll - width.client > 1) {
      problems.push(`la pantalla desborda a lo ancho: scrollWidth ${width.scroll} > clientWidth ${width.client} (I-14/S82)`);
    }
    const hasCanvas = await client.evaluate('!!document.querySelector("canvas")');
    const reachedTravel = clicked.some((entry) => entry.step === 'launch' && entry.label);
    if (reachedTravel && !hasCanvas) problems.push('se llegó al viaje pero no hay canvas isométrico');
    const exceptions = client.events.filter((event) => event.method === 'Runtime.exceptionThrown');
    const consoleErrors = client.events.filter(
      (event) => event.method === 'Runtime.consoleAPICalled' && (event.params.type === 'error' || event.params.type === 'assert')
    );
    const logErrors = client.events.filter(
      (event) => event.method === 'Log.entryAdded' && event.params.entry && event.params.entry.level === 'error'
    );
    for (const event of logErrors.slice(0, 8)) {
      problems.push('error del navegador: ' + event.params.entry.text);
    }
    const consoleWarnings = client.events.filter(
      (event) => event.method === 'Runtime.consoleAPICalled' && event.params.type === 'warning'
    );
    for (const event of exceptions.slice(0, 5)) {
      const text = event.params.exceptionDetails;
      problems.push('excepción: ' + ((text.exception && text.exception.description) || text.text));
    }
    for (const event of consoleErrors.slice(0, 8)) {
      problems.push('console.error: ' + event.params.args.map((arg) => arg.value || arg.description || arg.type).join(' '));
    }
    const i18nWarnings = consoleWarnings.filter((event) => JSON.stringify(event.params.args).indexOf('[i18n]') !== -1);
    for (const event of i18nWarnings.slice(0, 10)) {
      problems.push('aviso i18n: ' + event.params.args.map((arg) => arg.value || '').join(' '));
    }

    client.close();

    const summary = {
      url: options.url,
      title: title,
      clicked: clicked,
      canvas: hasCanvas,
      screenshots: screenshots,
      exceptions: exceptions.length,
      consoleErrors: consoleErrors.length,
      browserLogErrors: logErrors.length,
      i18nWarnings: i18nWarnings.length,
      problems: problems,
      structure: structure
    };
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    fs.writeFileSync(path.join(options.out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8');
    if (problems.length > 0) {
      process.stderr.write(`\nHUMO FALLIDO: ${problems.length} problema(s).\n`);
      process.exitCode = 1;
    } else {
      process.stderr.write('\nHUMO OK: la app carga desde file:// sin errores y responde a la interacción.\n');
    }
  } catch (error) {
    process.stderr.write('HUMO FALLIDO: ' + error.message + '\n');
    process.exitCode = 1;
  } finally {
    child.kill('SIGKILL');
    await sleep(200);
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch (error) {
      /* el perfil temporal puede quedar bloqueado: no es un fallo del humo */
    }
  }
}

if (require.main === module) main();

module.exports = { parseArgs };
