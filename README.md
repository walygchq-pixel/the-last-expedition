# The Last Expedition

Juego de **diseño y supervivencia de misiones espaciales** que funciona entero en el
navegador, sin instalación ni servidor, con interfaz bilingüe **inglés / español**
intercambiable en vivo.

Se abre haciendo **doble clic en `index.html`**. No hay dependencias externas, ni
CDN, ni fuentes descargadas, ni módulos ES: todo son scripts clásicos y datos
locales, justamente para que `file://` funcione (ver «Decisiones de diseño», D-1).

- Motor sin DOM ni idioma (`js/core`), probable con Node.
- Fase de diseño de misión con compensaciones reales (masa, potencia, presupuesto,
  datos, comunicaciones, tiempo).
- Fase de viaje isométrica con 1–4 jugadores locales, objetos interactuables,
  eventos con respuestas, votaciones de equipo y un **libro de consecuencias**
  que cobra las decisiones más adelante.
- Informe final, análisis educativo, clasificación local y comparador.

## Cómo jugar

1. **Nueva misión** → elegí modo, escenario, dificultad y cantidad de jugadores con
   sus roles. Básico activa el tutorial.
2. **Diseño de misión**: el objetivo manda. La lista de requisitos de la derecha se
   pone en verde a medida que el diseño lo cumple; el botón **Lanzar** se bloquea y
   explica el motivo mientras algo no cierre.
3. **Viaje**: movete por la nave, interactuá con objetos, comé, repará, transmití
   datos y respondé eventos. El reloj acelera con ×1/×2/×4/×8 y se pausa para
   revisar consecuencias pendientes.
4. **Informe**: puntaje por rúbrica, análisis de las compensaciones que más pesaron,
   clasificación local y exportación del informe.

## Controles

| Jugador | Mover | Interactuar |
| --- | --- | --- |
| 1 | `W` `A` `S` `D` | `E` |
| 2 | flechas | `Enter` |
| 3 | `I` `J` `K` `L` | `Ñ` (o `;`) |
| 4 | teclado numérico `8` `2` `4` `6` | `0` |

Se reasignan desde **Configuración → Controles** y se guardan en `localStorage`. El
mando estándar (Gamepad API) es opcional: si no hay mando, todo funciona igual.

## Estructura

```
index.html               punto de entrada (solo contenedores y orden de scripts)
js/
  main.js               arranque: preferencias → traductor → catálogo → UI
  i18n/                 traductor, plantillas, plural/género y formato Intl
  core/                 simulación: rng, recursos, sistemas, tripulación, comida,
                        consecuencias, eventos, efectos, datos, comms, reloj,
                        puntaje y orquestador de partida
  mission/              diseño de misión, catálogos, requisitos y validación
  world/                mapa isométrico, A*, objetos, jugadores, entrada, render
  ui/                   shell, diseño, viaje, informe, ajustes y tutorial
  storage/              localStorage, exportación/importación y clasificación
data/
  locales/en.json       traducciones (claves planas con puntos)
  locales/es.json
  *.json                contenido: piezas, instrumentos, lanzadores, órbitas,
                        objetivos, escenarios, alimentos, eventos, nave y objetos
  data-bundle.js        generado: empaqueta los JSON para `file://`
css/                    tema de consola de misión (cuatro hojas)
tests/                  suite de Node (sin navegador)
tools/                  build-data.js, merge-keys.js, smoke.js
odd/tasks/              especificación operativa, contratos y bitácora del proyecto
```

## Desarrollo

```bash
npm test               # suite completa en Node (core, mission, world, i18n, storage)
npm run build:data     # regenera data/data-bundle.js desde los JSON canónicos
npm run smoke          # abre index.html en Chrome headless y recorre el flujo
node tools/merge-keys.js odd/tasks/keys-ui.json   # fusiona un fragmento de claves
```

`npm run smoke` necesita Chrome o Chromium instalado. Verifica que la app carga
desde `file://`, que el flujo diseño → lanzamiento → viaje llega al canvas, que el
cambio de idioma se aplica en vivo, que no hay excepciones ni claves sin traducir,
y que la interfaz no desborda a lo ancho; guarda capturas en `tools/.smoke/`.

La regla de oro del repositorio: **toda clave usada existe en los dos idiomas**.
`tests/i18n-coverage.test.js` recorre `js/**` y `data/**` buscando claves y falla si
alguna falta, y `tests/i18n.test.js` exige paridad exacta entre `en.json` y `es.json`.

## Decisiones de diseño

Suposiciones tomadas donde la hoja de requerimientos no era explícita. La columna
«Dónde» indica el lugar del código que garantiza la regla.

| Ref. | Suposición aplicada | Dónde |
| --- | --- | --- |
| **D-1** | No se usan módulos ES: `file://` bloquea `type="module"` y `fetch()` local, y RG-1 exige abrir `index.html` sin servidor. Cada archivo es un script clásico con envoltorio dual (Node `require` / navegador `GS`). | todos los `js/**` |
| **D-2** | Los JSON de `data/` son la fuente de verdad; `data/data-bundle.js` se genera con `tools/build-data.js` para poder cargarlos sin `fetch`. | `tools/build-data.js` |
| **D-3** | La simulación nunca produce texto: devuelve códigos y parámetros, la UI los traduce. | `js/core/**`, `js/mission/**` |
| **D-4** | Toda la aleatoriedad pasa por un generador con semilla; `Math.random()` está prohibido en `core/`, `mission/` y `world/`. | `js/core/rng.js` |
| **S-1** | Un día de misión dura **15 s reales** a ×1 (dentro del rango 10–20 s) y se acelera ×2, ×4 y ×8. | `js/core/time.js` |
| **S-2** | Mapa isométrico de **40 × 30** casillas con salas, pasillos y esclusa. | `data/shipLayout.json` |
| **S-3** | Cada sala tiene 6–10 objetos; cocina y mecánica llegan a 12. | `data/objects.json` |
| **S-4** | Inventario de **2 objetos**, 3 con la mochila mejorada. | `js/world/players.js` |
| **S-5** | La votación dura **30 s**; sin acuerdo se aplica la opción por defecto, se pierde el 10 % de colaboración y la eficiencia queda reducida 2 días. | `js/core/game.js` |
| **S-6** | En modo individual la eficiencia colectiva es 0,85 y la votación se resuelve sola contra una opción simulada. | `js/core/crew.js`, `js/core/game.js` |
| **S-7** | Canibalizar repara al instante, baja la fiabilidad del donante 15–25 puntos y agenda la avería a 3–6 días **o** 5 eventos de los que ocurra primero. | `js/core/systems.js` |
| **S-8** | La frescura baja 2 %/día nominal y 8 %/día con la nevera averiada; bajo 30 % hay 35 % de enfermedad leve, que aparece 1–3 días después y deja residuos. | `js/core/food.js` |
| **S-9** | Ventanas de enlace por órbita: baja 10 min cada 90, media 20 min cada 4 h, alta continua con banda reducida, transferencia 1 h cada 2 días. | `data/orbits.json`, `js/core/comms.js` |
| **S-10** | Vida útil: 90 / 150 / 200 días según dificultad. | `js/core/events.js` |
| **S-11** | Presupuesto: 500 / 350 / 250 M€. El **coste del lanzador se paga del mismo presupuesto** que los componentes (D-9). | `js/mission/design.js` |
| **S-12** | El delta-v no se integra: se aproxima con una tabla por órbita (rank de alcance del lanzador). | `data/launchers.json`, `data/orbits.json` |
| **S-13** | La radiación se modela como valor acumulado por órbita y afecta a la fiabilidad de los sistemas. | `data/orbits.json`, `js/core/game.js` |
| **S-14** | Un mando estándar (Xbox/PlayStation) por Gamepad API; sin mando se juega solo con teclado. | `js/world/input.js` |
| **S-15** | Cada indicador tiene forma (círculo, triángulo, cuadrado, rombo) e icono además de color. | `js/core/resources.js` |
| **S-16** | El modo competitivo es por turnos en el mismo dispositivo: se comparan informes exportados e importados. | `js/ui/reportScreen.js` |
| **S-17** | `localStorage` con tope de 5 MB: si no entra, se informa con un código y se sugiere exportar. | `js/storage/store.js` |
| **S-18** | El tutorial se activa solo en Basic y en la primera partida, y se puede desactivar desde Configuración. | `js/ui/tutorial.js` |
| **S-19** | A* sobre la cuadrícula de la nave, sin diagonales; los jugadores pueden ocupar la misma casilla. | `js/world/pathfinding.js` |
| **S-20** | Tamaño de texto 100 / 125 / 150 % con paneles que se reacomodan (todo en `rem`). | `css/**` |

Decisiones propias, no pedidas explícitamente pero necesarias para que las reglas
anteriores sean coherentes:

- **D-5. La mochila mejorada** se activa con la bandera `backpackUpgraded`, que hoy
  ningún escenario habilita: el límite efectivo es 2 hasta que un escenario lo use.
- **D-6. Comunicaciones en el panel**: en fase de diseño el ancho de banda es 0 y el
  recurso aparece «crítico» porque todavía no hay ventana de enlace; durante el viaje
  refleja la ventana real de la órbita elegida.
- **D-7. Un evento sin responder detiene el reloj** y como máximo se disparan dos
  eventos por paso de simulación, para que la partida siga siendo legible.
- **D-8. Idioma**: la UI usa español neutro (no rioplatense) y `en-US` / `es-AR` como
  etiquetas de `Intl`, de modo que el español use coma decimal y punto de miles.
- **D-9. Coste del lanzador**: se descuenta del presupuesto de misión, así que elegir
  un cohete más capaz quita dinero para instrumentos. Es la compensación de DM-9.
- **D-10. Reparto de puntaje**: 300 misión, 250 ciencia, 150 eficiencia, 150
  decisiones, 100 supervivencia, 50 colaboración (total 1000).
- **D-11. `data/data-bundle.js` está versionado** a propósito: sin él, abrir
  `index.html` con doble clic no funcionaría. Se regenera con `npm run build:data` y
  un test verifica que esté sincronizado con los JSON.

## Verificación

- **Suite de Node**: 83 pruebas (`core`, `mission`, `world`, `i18n`, cobertura de
  claves y `storage`). No necesitan navegador ni dependencias.
- **Humo en Chrome headless** (`npm run smoke`): carga desde `file://`, recorre
  título → nueva misión → diseño (lanzador, órbita, instrumento, computadora) →
  lanzamiento → viaje con canvas, cambia el idioma en vivo y comprueba que no haya
  excepciones, errores de consola, claves crudas ni desborde horizontal.

Lo que **no** está verificado y conviene mirar con ojos humanos:

- 60 FPS con 4 jugadores en un equipo de gama media: en headless el
  `requestAnimationFrame` queda estrangulado, así que el objetivo es de diseño
  (un solo rAF, repintado incremental, rutas por sala) y no una medición.
- Mando físico, lectores de pantalla y legibilidad real con texto al 150 %.
- Persistencia de `localStorage` entre sesiones bajo `file://`: depende del navegador;
  si lo bloquea, el almacén cae a memoria y se avisa con un código.

## Licencia

MIT.
