# The Last Expedition — hoja de implementación

Juego HTML de diseño y supervivencia de misiones espaciales, bilingüe EN/ES, sin servidor.
Fuente autorizada: hoja de requerimientos del usuario (150 requisitos, §1–§14). Este documento
es el contrato operativo: specs, contratos de módulo, tareas y bitácora.

## Specs

Índice fiel de requisitos. La numeración es la del documento del usuario y no se renombra.

**Generales (§2).** S1: `index.html` abre el juego sin servidor ni dependencia externa (RG-1).
S2: carpetas `js/ css/ data/` y submódulos `core/ mission/ world/ ui/ i18n/ storage/` (RG-2, T-2).
S3: ningún texto visible en el código; todo por claves (RG-3, I-3). S4: simulación separada del
render, probable sin DOM ni idioma (RG-4). S5: 60 FPS con 4 jugadores (RG-5). S6: gráficos
procedurales, sin assets (RG-6).

**Jugadores (§3).** S7: 1–4 jugadores locales (RG-7). S8: controles P1 WASD+E, P2 flechas+Enter,
P3 IJKL+Ñ, P4 numérico; mando opcional; reasignables (RG-8, S-14). S9: 5 roles con bonificaciones
(RG-9). S10: modo individual con penalización del 15 % (RG-10, S-6). S11: decisiones colectivas por
votación de 30 s; sin acuerdo, opción por defecto con −10 % en colaboración y eficiencia reducida
2 días (RG-11, S-5). S12: negociación de prioridades contrapuestas (RG-12).

**Diseño de misión (§4).** S13: objetivo primero, con requisitos mínimos (DM-1). S14: lista
verificable ✔/✘ durante el diseño (DM-2). S15: los 9 grupos de componentes (DM-3). S16: cada
componente con masa, consumo, coste, datos y fiabilidad, en versión simple y avanzada (DM-4).
S17: impacto inmediato en recursos al cambiar piezas (DM-5). S18: cada módulo registra su origen
(DM-6). S19: 6 instrumentos distintos con valor científico por objetivo y ritmo de datos propio
(DM-7). S20: la versión avanzada sube valor científico y también masa, energía, datos y coste, de
forma visible (DM-8). S21: 3 lanzadores con carga, coste y capacidad orbital distintas (DM-9).
S22: 4 órbitas explicadas en lenguaje sencillo: cobertura, oportunidades, comunicaciones, duración,
radiación (DM-10). S23: si masa u órbita no son compatibles con el lanzador, el lanzamiento se
bloquea y se explica el motivo y la corrección (DM-11). S24: 3 escenarios con objetivos distintos
(DM-12). S25: 3 dificultades Basic/Intermediate/Advanced con presupuesto 500/350/250 M€ y vidas
útiles 90/150/200 días (DM-13, S-10, S-11). S26: cada escenario admite ≥2 soluciones válidas con
rendimiento distinto (DM-14).

**Recursos (§5).** S27: panel en tiempo real con masa, potencia, presupuesto, datos, comunicaciones
y tiempo. S28: se indica el recurso más crítico del escenario (RN-1). S29: color **y** forma o icono
en cada indicador (RN-2, S-15).

**Viaje (§6).** S30: isométrico 3.ª persona con vista superior y cámara de encuadre compartido
(V-1). S31: cocina, mecánica, enfermería, mando, pasillos, dormitorios y esclusa navegables (V-2).
S32: 6–10 objetos por sala, hasta 12 en cocina y mecánica (V-3, S-3). S33: panel de acción con
consecuencia estimada (V-4). S34: inventario de 2 objetos (3 con mochila mejorada) e intercambio
entre jugadores (V-5, S-4). S35: sistemas con estado 0–100 % y fiabilidad decreciente (V-6).
S36: la degradación se ve en la nave: luz, temperatura, agua, enlace (V-7). S37: salud, estrés,
moral, sueño, hambre, sed e higiene opcional por jugador (V-8). S38: necesidades bajan con tiempo y
actividad; niveles críticos penalizan de forma progresiva hasta la pérdida del personaje (V-9).

**Consecuencias (§6.4).** S39: toda decisión importante entra en el libro de consecuencias con
disparador temporal o de evento (V-10…V-13). S40: canibalizar repara al instante, baja 15–25 puntos
la fiabilidad del donante y agenda una avería a 3–6 días o 5 eventos, con mensaje explicativo en
ambos idiomas (V-10, S-7). S41: frescura −2 %/día nominal y −8 %/día con nevera averiada; con
frescura < 30 % hay 35 % de enfermedad leve que aparece a 1–3 días; residuos que afectan al soporte
vital (V-11, S-8). S42: cada decisión explica **por qué** (V-13).

**Eventos (§6.5).** S43: tormenta solar, fallo de batería, fuga de presión, brote alimentario,
petición de datos, micrometeoritos, sobrecalentamiento, aislamiento y conflicto (V-14). S44: ≥2
respuestas con compensaciones, ninguna siempre óptima (V-15). S45: frecuencia e intensidad por
dificultad (V-16). S46: reloj de misión con aceleración ×1/×2/×4/×8, pausa para revisar
consecuencias, y fin por objetivo, vida útil, muerte de todos o nave inoperativa (V-17, V-18, S-1).

**Comunicaciones y datos (§7).** S47: datos con memoria limitada (C-1). S48: transmisión solo en
ventana según órbita y antena (C-2, S-9). S49: priorizar datos por ventana; ancho de banda bajo
obliga a elegir (C-3). S50: los datos no transmitidos pierden valor científico (C-4).

**Puntuación (§8).** S51: puntaje por éxito, valor científico, eficiencia, decisiones, supervivencia
y colaboración (P-1). S52: informe de misión con resultado, desglose, recursos, decisiones clave y
consecuencias (P-2). S53: análisis posterior que explica en lenguaje sencillo las compensaciones
decisivas (P-3). S54: clasificación local por escenario y dificultad en `localStorage` (P-4).

**Modos (§9).** S55: campaña/escenario con evaluación (M-1). S56: sandbox sin restricciones (M-2).
S57: competitivo por turnos con informes exportables e importables (M-3, S-16). S58: cooperativo 1–4
(M-4).

**Guardado (§10).** S59: guardar y cargar diseños y partidas en `localStorage`, límite 5 MB con aviso
y sugerencia de exportar (G-1, S-17). S60: exportar e importar JSON con claves y valores, nunca texto
traducido (G-2, I-10). S61: comparador de dos diseños o informes (G-3).

**Educación y accesibilidad (§11).** S62: tutorial de diseño, compensaciones, comprobación de
lanzador, primera reparación y primera consecuencia diferida; solo en Basic y en la primera partida,
desactivable (E-1, S-18). S63: glosario accesible desde cualquier pantalla, con término en ambos
idiomas (E-2). S64: tooltips en cada componente, recurso y consecuencia (E-3). S65: explicaciones
breves sin conocimiento previo (E-4). S66: tamaño de texto 100/125/150 %, contraste alto, formas
además de color, menos animaciones, subtítulos (E-5, S-20).

**Técnicos (§12).** S67: HTML5, CSS3, JS ES2020+ y Canvas 2D, sin frameworks (T-1). S68: pruebas de
`core/`, `mission/` e `i18n/` en Node sin navegador (T-3). S69: comentarios en español, identificadores
en inglés (T-4).

**i18n (§13).** S70: `en` y `es` con paridad completa; inglés para claves, español para comentarios y
documentación (I-1). S71: cambio de idioma en vivo sin recargar, incluidos HUD, paneles, tooltips,
tutorial, glosario, informes, eventos y consecuencias (I-2). S72: claves únicas en
`data/locales/en.json` y `data/locales/es.json` (I-3). S73: una prueba falla si falta una clave en
cualquiera de los dos idiomas (I-4). S74: plantillas con marcadores nombrados; nunca concatenar
fragmentos (I-5). S75: singular, plural y variantes de género (I-6). S76: `Intl.NumberFormat` e
`Intl.DateTimeFormat`; unidades SI con nombre traducido (I-7). S77: idioma guardado → navegador →
inglés (I-8). S78: preferencia persistida (I-9). S79: escenarios, instrumentos, lanzadores, órbitas y
eventos referenciados por clave desde `data/*.json` (I-11). S80: fallback al inglés con advertencia
en consola, nunca una clave cruda en pantalla (I-12). S81: UTF-8 declarado y acentos correctos (I-13).
S82: los diseños toleran +30 % de longitud de texto (I-14). S83: pruebas de i18n en Node: paridad,
plantillas, fallback y formato (I-15).

**Suposiciones (§14).** S84: 60–120 días de misión; 10–20 s reales por día a velocidad normal
(S-1). S85: mapa de 40 × 30 casillas con salas, pasillos y esclusa (S-2). S86: A* sobre cuadrícula,
sin colisión entre jugadores (S-19, T-2). Todas las suposiciones S-1…S-20 se documentan en el README.

## Contracts

Decisiones transversales congeladas antes de escribir código. Cualquier cambio acá reabre tareas.

**C-1. Sin servidor (RG-1 ⇒ sin ES modules).** Los `.js` son scripts clásicos con envoltorio
dual Node/navegador y namespace `GS`:

```js
(function (global, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./dep.js'));
  else { var GS = global.GS = global.GS || {}; GS.core = GS.core || {}; GS.core.crew = factory(GS.core.rng); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (rng) { 'use strict'; /* … */ return api; });
```

Motivo: `<script type="module">` y `fetch()` de JSON fallan en `file://` por CORS, y RG-1 exige abrir
`index.html` sin servidor. Los tests requieren los mismos archivos con `require()`.

**C-2. Datos.** `data/**/*.json` es la fuente canónica. `tools/build-data.js` genera
`data/data-bundle.js` (un solo script clásico que registra todo en `GS.data`), que es lo que carga
`index.html`. Un test verifica que el bundle esté sincronizado con los JSON.

**C-3. Simulación sin texto.** `core/` y `mission/` nunca producen cadenas visibles: devuelven
códigos (`{code:'power.deficit', params:{need:12, have:8}}`) y la UI los traduce. RG-4 + I-3.

**C-4. Determinismo.** Toda aleatoriedad pasa por `GS.core.rng` con semilla explícita; ninguna llamada
directa a `Math.random()` en `core/`, `mission/` ni `world/`. Habilita tests y repetición de partidas.

**C-5. Estado serializable.** `game.getState()` devuelve JSON plano sin funciones ni referencias
circulares; guardar, exportar y el comparador operan sobre eso. Las claves de traducción viajan como
claves (I-10).

**C-6. Recurso crítico y accesibilidad.** `resources.evaluate()` devuelve por ítem
`{id, value, max, ratio, status:'ok'|'warn'|'critical', shape:'circle'|'triangle'|'square'|'diamond', icon}`
y `critical: <id>`. Forma fija por recurso: masa=square, potencia=triangle, presupuesto=diamond,
datos=circle, comunicaciones=diamond, tiempo=triangle. La UI no inventa formas.

**C-7. Contrato de la UI con la simulación.** La UI solo habla con `GS.core.game` (`createGame`,
`tick`, `getState`, `getActions`, `applyAction`, `getReport`) y con `GS.mission.design`
(`createDesign`, `setX`, `getRequirements`, `validateLaunch`). Nunca muta estado de simulación a mano.

**C-8. Claves i18n.** Namespaces: `app. menu. mode. diff. role. res. hud. part. instrument. launcher.
orbit. obj. scenario. event. cons. action. object. room. report. tutorial. glossary. settings. a11y.
save. compare. lb. unit. msg. err. sys. food.` Un test recorre `js/**` buscando `t('…')` y verifica
que cada clave exista en los dos idiomas.

**C-9. API mínima de módulos** (firmas congeladas; implementación libre dentro del contrato):

| Módulo | API |
| --- | --- |
| `i18n/index` | `createTranslator({dicts, locale, fallback})`, `t(key, params)`, `setLocale`, `formatNumber`, `formatDate`, `formatDuration`, `formatUnit`, `onChange`, `missingKeys` |
| `core/rng` | `createRng(seed)`, `hashSeed(str)`, `.next()`, `.int(a,b)`, `.pick(arr)`, `.chance(p)` |
| `core/resources` | `createResources(ctx)`, `evaluate(state)`, `spend(state, id, amount)`, `critical(state)` |
| `core/systems` | `createSystems(design)`, `get(state, id)`, `degrade(state, id, pts, cause)`, `repair(state, id, pts)`, `tick(state, dtDays, ctx)`, `effects(state)` |
| `core/crew` | `createCrew(players)`, `tick(state, dtDays, ctx)`, `apply(state, id, delta)`, `status(member)` |
| `core/food` | `createPantry(items)`, `tick(state, dtDays, ctx)`, `eat(state, memberId, itemId, rng)`, `contamination(state)` |
| `core/consequences` | `createLog()`, `schedule(log, entry)`, `advance(log, {days, events})`, `due(log)`, `resolve(log, id)`, `pending(log)` |
| `core/events` | `createEngine(difficulty)`, `roll(engine, ctx, rng)`, `options(event)`, `resolve(state, eventId, optionId)` |
| `core/data` | `createStore(capacity)`, `produce(store, instrumentId, amount)`, `transmit(store, ids)` (capacidad y pérdida) |
| `core/comms` | `windowState(ctx)`, `bandwidth(ctx)`, `canTransmit(ctx)` |
| `core/time` | `createClock(missionDays)`, `advance(clock, realMs)`, `setSpeed(clock, s)`, `isEclipse(clock)` |
| `core/scoring` | `score(state)`, `buildReport(state)`, `analyze(report)` |
| `core/game` | `createGame(cfg)`, `tick(game, realMs)`, `getState(game)`, `getActions(game, ctx)`, `applyAction(game, action)`, `endGame(game)` |
| `mission/catalog` | `parts()`, `instruments()`, `launchers()`, `orbits()`, `objectives()`, `scenarios()`, `events()` (leen `GS.data`) |
| `mission/design` | `createDesign(cfg)`, `addPart`, `removePart`, `setLauncher`, `setOrbit`, `totals`, `getRequirements`, `liveImpact`, `validateLaunch` |
| `world/shipMap` | `build(design)` → `{grid, rooms, doors, spawn, objects}` |
| `world/pathfinding` | `findPath(grid, from, to)`, `walkable(grid, cell)` |
| `world/players` | `create(state, roles)`, `move(players, input, dt, grid)`, `give(from, to, itemId)` |
| `world/renderer` | `render(ctx2d, {map, state, camera, a11y})` |
| `world/input` | `createInput(bindings)`, `poll(input)`, `bind(input, playerId, action, code)`, `gamepad()` |
| `storage/saves` | `saveGame(state)`, `loadGame(id)`, `list()`, `remove(id)` |
| `storage/transfer` | `exportJson(kind, payload)`, `importJson(text)`, `compare(a, b)` |
| `storage/leaderboard` | `add(entry)`, `list(scenarioId, difficulty)` |
| `storage/prefs` | `get()`, `set(patch)` (idioma, binds, accesibilidad) |

## Tasks

| ID | Requisitos | Ruta | Estado |
| --- | --- | --- | --- |
| T1 | S1–S6, C-1–C-3, S69: scaffold, repo, pipeline de datos | parent | hecho |
| T2 | S70–S83: `js/i18n/*` + locales base + pruebas | parent | hecho |
| T3 | S27–S54: `js/core/*` (rng, recursos, sistemas, tripulación, comida, consecuencias, eventos, efectos, datos, comms, tiempo, puntaje, game) | parent | hecho |
| T4 | S13–S26: `js/mission/{catalog,design}.js` | parent | hecho |
| T12 | S33 (V-4): la tecla de interactuar no ejecutaba ninguna acción; sólo cambiaba el jugador seleccionado. Afecta a los cuatro jugadores. | worker | hecho |
| T11 | S21–S26, S43–S45, S84: `data/{launchers,orbits,objectives,scenarios,food,events}.json` + claves EN/ES + `tests/mission.test.js` | worker | hecho |
| T5 | S59–S61: `js/storage/*` + `tests/storage.test.js` | parent | hecho |
| T6 | S7–S12, S30–S34, S86: `js/world/*` + `data/{shipLayout,objects}.json` + `tests/world.test.js` | worker | hecho |
| T7 | S4, S55–S58, S62–S66, S29, S82: `js/ui/*`, `css/*` | worker | hecho |
| T8 | integración `index.html`, `data/data-bundle.js`, `main.js` | parent | hecho |
| T9 | S68, C-8, C-2: suite completa + cobertura de claves + smoke en Chrome (`tools/smoke.js`) | parent | hecho |
| T10 | README con §14 documentada | parent | hecho |

## Log

- **L1 (pedido original).** «# Hoja de requerimientos: proyecto "The Last Expedition" … Juego HTML de
  diseño y supervivencia de misiones espaciales, con interfaz bilingüe inglés-español …
  **Instrucción para el agente de codificación:** Inicializa un proyecto de videojuego que funcione
  completamente en el navegador, sin instalación ni servidor. Implementa las funciones descritas en
  este documento, en el orden de las fases indicadas. Todo el texto visible debe existir en **inglés
  (idioma principal de referencia)** y **español**, intercambiables en tiempo real desde el panel de
  configuración. Cuando un requisito sea ambiguo, aplica la suposición indicada en la sección 14 y
  documéntala en el README.» Índice completo de requisitos en §Specs de este documento.
- **L2 (usuario).** «te pego el 13 y el 14 que faltan» + §13 (I-1…I-15) y §14 (S-1…S-20) literales.
  Correcciones clave: comentarios y documentación en **español**, claves y código en **inglés**;
  presupuesto 500/350/250 M€; 30 s de votación con −10 % de colaboración; frescura −2 %/−8 % por día;
  35 % de enfermedad bajo 30 % de frescura; canibalización −15…−25 de fiabilidad y avería a 3–6 días
  o 5 eventos.
- **L3 (usuario).** «git init + rama + commits por unidad». Repo creado en `main`; trabajo en
  `feat/the-last-expedition`; sin push ni PR.

- **L4 (cierre).** Implementación terminada y verificada: **83 pruebas** de Node en
  verde y `node tools/smoke.js` sin problemas (carga desde `file://`, flujo
  diseño → lanzamiento → viaje con canvas, cambio de idioma en vivo, sin
  excepciones, sin claves crudas y sin desborde horizontal).
  Commits por unidad en `feat/the-last-expedition` (11 commits, `main` queda en el
  andamiaje inicial). El corte por unidad de trabajo no sigue el tamaño ideal de
  ~400 líneas: el contenido del juego (datos + locales) y la interfaz entraron
  como unidades completas, porque ya venían terminadas al autorizar el commit y
  partirlas habría dejado commits que no arrancan.
- **L5 (revisión nativa, rebanada core).** `gentle_review` sobre `719de3b..9e89c6e`
  (lente `review-reliability`, tier medium, 3.783 líneas) levantó dos hallazgos
  CRITICAL confirmados por el refutador como propios del candidato:
  *R3-RNGSTATE* (el estado guardado serializaba la semilla en caché, así que
  guardar después de comer, canibalizar o votar en solitario rebobinaba el
  generador al restaurar) y *R3-VOTE-PENALTY* (la penalización de S-5 agendaba una
  bandera que ningún código leía ni limpiaba, así que la eficiencia reducida de 2
  días nunca ocurría). Corrección acotada en `15dad45`, con dos pruebas nuevas que
  fallan sin el arreglo y pasan con él; propagada a `feat/the-last-expedition`.
  Suite completa: **85 pruebas en verde**.
- **L6 (hallazgos consultivos del revisor).** La revisión aprobada dejó tres
  hallazgos WARNING no bloqueantes que se corrigieron igual, como trabajo
  posterior y con prueba de regresión cada uno:
  *R3-CREW-DEATH* (un efecto `crewCondition` bajaba la salud a cero sin marcar al
  tripulante como perdido, así que el conteo de vivos lo seguía sumando),
  *R3-RESTORE-COOLDOWN* (un evento pendiente al guardar perdía su enfriamiento al
  restaurar) y *R3-TICK-PENDING* (un tick largo seguía simulando y sorteando
  eventos después del primero, con el reloj por delante de la simulación).
  El reloj ahora avanza subpaso a subpaso. Suite completa: **88 pruebas**.
- **L7 (cadena de revisión nativa).** Slices revisados y **aprobados**, cada uno con
  su linaje y su recibo quemado (`gentle-ai.review-acknowledged/v1`):
  `core` (`review-782ad290cdb701c8`, 2 correcciones), `mission`
  (`review-e8ac91c0b8def597`, 1 corrección), `data` del mundo
  (`review-712a74b32f5f070e`) y `world` (`review-0f9fb2634e80a8c9`), `storage`
  (`review-33be7043f529810a`, 1 corrección). Cada rebanada se partió hasta entrar
  en el presupuesto del revisor: el candidato completo (22.733 líneas) y el commit
  de mundo entero (4.757) se detuvieron con `lens_context_budget_exceeded`.
  Total: 12 ejecuciones de modelo (revisor, refutador y validador), ~505k tokens,
  ~0,18 USD. Suite: **93 pruebas** en verde y humo en Chrome sin problemas.
  Pendientes de revisión: la interfaz (`32df2dc`, ~5.6k líneas) y el contenido
  inicial de datos (`2ab63b4`), ambos por encima del presupuesto sin partir.

- **L8 (cierre de la cadena).** Se partieron las dos rebanadas que faltaban. La
  interfaz quedó en tres commits (shell, pantallas de diseño y viaje, informe y
  ajustes) y el contenido inicial en cuatro (catálogos, objetivos/escenarios/
  despensa, eventos, y cada diccionario por separado). Los siete commits nuevos
  dieron `reviewDue: false` en ASSESS (`nativeRisk: medium`, `under_budget`): el
  proveedor no exige revisión para ellos.
  Sí exigió revisión la rebanada de arneses (`tools/smoke.js` + cobertura de
  claves), que era la que había disparado el riesgo alto del candidato completo
  por lanzar un proceso de shell. Se revisó con **cuatro lentes** dos veces (una
  vez la versión original y otra la corregida) y dejó dos CRITICAL más:
  *R3-001* (`parseArgs` ignoraba en silencio los argumentos desconocidos, así que
  un flag mal escrito hacía correr el humo contra el destino por defecto y podía
  informar éxito) y *R4-001* (el target se navegaba antes de habilitar `Runtime`,
  así que las excepciones del arranque no se veían).
  Total de la cadena: **8 transacciones aprobadas**, 25 ejecuciones de modelo,
  ~820k tokens, ~0,31 USD. Suite: **95 pruebas** en verde y humo sin problemas.

- **L9 (reporte del humano).** «encontre un error muy notable que es que con el jugador 1
  no puedo interactuar con nada esto con la tecla E, no se si pase con el resto de
  jugadores». Reproducido por lectura: `js/ui/travelScreen.js` consume el flanco de
  `interact` sólo para fijar `runtime.selected`; nunca busca el objeto cercano ni
  ejecuta la acción, así que la tecla no hace nada con ninguno de los cuatro
  jugadores y la interacción queda únicamente en los botones del panel.
  Arreglado en `js/ui/travelScreen.js`: el flanco ahora busca el objeto al alcance
  del jugador que pulsó, ejecuta la acción si es única y abre una capa modal con
  etiqueta y consecuencia estimada si hay varias; sin objeto, avisa. El humo
  despacha un `keydown` real de `KeyE` en el viaje y exige una reacción.

- **L11 (rediseño implementado).** Se implementaron las dos direcciones elegidas y el
  tutorial nuevo. Viaje: visor a pantalla completa, HUD flotante por bordes (reloj y
  velocidades, tira de tripulación, cintas de objetivo/enlace/instrumentos, gauges de
  sistemas sin cifras, recursos, dock inferior con inventario y acciones, cinta de
  consecuencias), radial de acciones junto al objeto y **23 siluetas isométricas de
  tres caras** dibujadas en Canvas 2D para los 60 objetos. Diseño de misión: chasis
  único con biseles y tornillos, cabecera de instrumentación, tres columnas y franja
  de permiso de despegue con sello y botón integrado. Tutorial: pasos por pantalla
  (`data/tutorial.json` con `screen`, `target`, `place`), llamada anclada al control,
  contorno sobre el objetivo, «Entendido» / «Después» / «No mostrar más», y salto
  automático al primer paso pendiente de la pantalla activa (ya no queda «paso 1 de 5»
  encima del viaje). El dock inferior se ancla a la ventana y reparte sus secciones en
  columnas para que las acciones no queden dentro de un scroll.
  Suite: **95 pruebas** en verde y humo sin problemas.
