> **Leer en inglés:** [REQUIREMENTS.md](REQUIREMENTS.md) — la edición inglesa es la cara del repositorio.

# Trazabilidad de requisitos

Mapa entre la hoja de requerimientos original (§1–§14, 150 requisitos) y este
repositorio. Cada fila dice **dónde** está implementado y **con qué se verificó**.
Las pruebas se corren con `npm test`; el humo de navegador con `npm run smoke`.

Leyenda de evidencia: **T** = prueba automatizada de Node · **H** = humo en Chrome
headless · **M** = medición o inspección manual registrada en `odd/tasks/the-last-expedition.md`.

## §2 Requisitos generales

<!-- section: general -->

| Requisito | Qué pide | Dónde | Evidencia |
| --- | --- | --- | --- |
| RG-1 | Se abre con `index.html` sin servidor | `index.html`, contrato D-1 (scripts clásicos, sin módulos ES) | H abre con `file://` |
| RG-2 | Uno o varios archivos en `js/ css/ data/` | estructura del repo | — |
| RG-3 | Ningún texto visible en el código | `data/locales/{en,es}.json` + `js/i18n/` | T `i18n-coverage` |
| RG-4 | Simulación separada del render | `js/core/**`, `js/mission/**` sin DOM | T core y mission en Node |
| RG-5 | 60 FPS con 4 jugadores | `js/world/renderer.js` (un rAF, culling, sin asignaciones por celda) | **Parcial:** M con captura y perfil en headless (software), no en GPU real |
| RG-6 | Gráficos procedurales, sin assets | `js/world/renderer.js`, `design/` | M capturas |

## §3 Jugadores y modos

<!-- section: players-and-modes -->

| Requisito | Qué pide | Dónde | Evidencia |
| --- | --- | --- | --- |
| RG-7 | 1 a 4 jugadores locales | `js/world/players.js`, `js/ui/shell.js` | T world (4 jugadores) |
| RG-8 | Controles por teclado y mando, reasignables | `js/world/input.js`, `js/ui/settingsScreen.js`, `js/storage/prefs.js` | T world (enlaces y reasignación) · M mando no probado en hardware |
| RG-9 | Cinco roles con bonificaciones | `js/core/crew.js` (`ROLE_MODIFIERS`) | T core (`roleModifier`) |
| RG-10 | Modo individual con penalización | `js/core/crew.js` (`collectiveEfficiency`) | T core (solo = 0,85) |
| RG-11 | Decisiones colectivas con votación y opción por defecto | `js/core/game.js` (`propose`, `vote`, `resolveVote`) | T core (desacuerdo aplica la opción por defecto) |
| RG-12 | Prioridades contrapuestas | `js/ui/travelScreen.js` (aviso de potencia + propuesta de apagado), `js/core/game.js` | M captura con el aviso activo |

## §4 Fase 1: diseño de misión

<!-- section: mission-design -->

| Requisito | Qué pide | Dónde | Evidencia |
| --- | --- | --- | --- |
| DM-1 | Objetivo primero, con requisitos mínimos | `data/objectives.json`, `js/mission/design.js` | T mission |
| DM-2 | Lista verificable ✔/✘ | `js/ui/designScreen.js` (lista de comprobación) | H |
| DM-3 | Nueve grupos de componentes | `data/parts.json` (12 grupos) | T mission (cantidades) |
| DM-4 | Masa, potencia, coste, datos, fiabilidad; simple y avanzada | `data/parts.json`, `data/instruments.json` | T mission |
| DM-5 | Impacto inmediato en recursos | `js/mission/design.js` (`liveImpact`), panel de telemetría | H |
| DM-6 | Origen de cada módulo | `system` por pieza en `data/parts.json`, `js/core/systems.js` (`origins`) | T core |
| DM-7 | Seis instrumentos distintos | `data/instruments.json` | T mission |
| DM-8 | La versión avanzada compensa visiblemente | `data/instruments.json` + tooltips | T mission · M captura |
| DM-9 | Tres lanzadores distintos | `data/launchers.json` | T mission |
| DM-10 | Cuatro órbitas explicadas en lenguaje sencillo | `data/orbits.json` | T mission · M captura |
| DM-11 | Bloqueo de lanzamiento con motivo y corrección | `js/mission/design.js` (`validateLaunch`), franja de permiso | T mission (bloqueo y corrección) · H |
| DM-12 | Tres escenarios | `data/scenarios.json` | T mission |
| DM-13 | Tres dificultades con presupuesto y vida útil | `js/core/events.js` (`DIFFICULTIES`) | T core y mission |
| DM-14 | Al menos dos soluciones válidas por escenario y dificultad | `data/*.json` | T mission (fuerza bruta en 9 combinaciones) |

## §5 Gestión de recursos

<!-- section: resources -->

| Requisito | Qué pide | Dónde | Evidencia |
| --- | --- | --- | --- |
| Recursos | Seis recursos en panel en tiempo real | `js/core/resources.js`, `js/ui/*` | T core (panel completo) |
| RN-1 | Recurso más crítico del escenario | `critical` por escenario + `resources.evaluate` | T core |
| RN-2 | Color **y** forma o icono | `resources.SHAPES` / `ICONS` | T core (forma e icono por recurso) |

## §6 Fase 2: viaje y supervivencia

<!-- section: travel-and-survival -->

| Requisito | Qué pide | Dónde | Evidencia |
| --- | --- | --- | --- |
| V-1 | Isométrico en tercera persona, cámara de grupo | `js/world/renderer.js` | T world (render con cámara) · H |
| V-2 | Cocina, mecánica, enfermería, mando, pasillos, dormitorios, esclusa | `data/shipLayout.json` | T world (siete salas) |
| V-3 | Al menos 6 objetos por sala | `data/objects.json` (59 objetos, 64 acciones) | T world |
| V-4 | Panel de acción con consecuencia estimada | `js/world/objects.js`, `js/ui/travelScreen.js` (radial) | T world · H tecla `E` |
| V-5 | Inventario limitado e intercambio | `js/world/players.js` | T world |
| V-6 | Estado y fiabilidad por sistema | `js/core/systems.js` | T core |
| V-7 | La degradación se ve en la nave | `systems.effects` → `renderer` | T world (iluminación) |
| V-8 | Salud, estrés, moral, sueño, hambre, sed, higiene | `js/core/crew.js` | T core |
| V-9 | Necesidades críticas con penalización progresiva | `js/core/crew.js` | T core (condiciones y muerte) |
| V-10 | Canibalización con avería diferida | `js/core/systems.js` (`cannibalize`), `js/core/game.js` | T core (fiabilidad −15…−25 y avería a 3–6 días) |
| V-11 | Frescura, enfermedad y residuos | `js/core/food.js` | T core (2 %/8 % por día, 35 % bajo 30 %) |
| V-12 | Decisiones colectivas | `js/core/game.js` (`COLLECTIVE_DECISIONS`) | T core |
| V-13 | Cada decisión explica por qué | `whyKey` en consecuencias, eventos y acciones | T mission (toda opción con `whyKey`) |
| V-14 | Eventos variados | `data/events.json` (11 eventos) | T mission |
| V-15 | Respuestas con compensaciones | `data/events.json` | T mission (≥2 opciones con efectos distintos) |
| V-16 | Frecuencia e intensidad por dificultad | `js/core/events.js` | T core |
| V-17 | Reloj con aceleración y pausa | `js/core/time.js`, HUD | T core (×1…×8, pausa) |
| V-18 | Condiciones de fin de partida | `js/core/game.js` (`checkEnd`) | T core |

## §7 Comunicaciones y datos

<!-- section: communications-and-data -->

| Requisito | Qué pide | Dónde | Evidencia |
| --- | --- | --- | --- |
| C-1 | Memoria de datos limitada | `js/core/datastore.js` | T core (tope y pérdida) |
| C-2 | Transmisión solo en ventana | `js/core/comms.js` | T core (ventanas por órbita) |
| C-3 | Prioridad de datos por ventana | `datastore.transmit`, cinta de enlace | T core (orden de prioridad) |
| C-4 | Lo no transmitido vale menos | `datastore.scienceValue` (0,6) | T core |

## §8 Puntuación y evaluación

<!-- section: scoring -->

| Requisito | Qué pide | Dónde | Evidencia |
| --- | --- | --- | --- |
| P-1 | Puntaje por seis rúbricas | `js/core/scoring.js` | T core (1000 puntos y desglose) |
| P-2 | Informe de misión | `scoring.buildReport` | T core |
| P-3 | Análisis posterior | `scoring.analyze` | T core (ordenado por impacto) |
| P-4 | Clasificación local por escenario y dificultad | `js/storage/leaderboard.js` | T storage |

## §9 Modos de juego

<!-- section: game-modes -->

| Requisito | Qué pide | Dónde | Evidencia |
| --- | --- | --- | --- |
| M-1 | Campaña con evaluación | `js/ui/shell.js`, informe | H |
| M-2 | Sandbox | `js/ui/shell.js` (`mode.sandbox`) | M |
| M-3 | Competitivo por turnos con informes | `js/ui/reportScreen.js` (comparador), `js/core/scoring.js` (`compare`) | T storage (comparador) |
| M-4 | Cooperativo 1–4 | `js/core/game.js` (`mode: cooperative`), votación | T core |

## §10 Guardado y carga

<!-- section: save-and-load -->

| Requisito | Qué pide | Dónde | Evidencia |
| --- | --- | --- | --- |
| G-1 | Guardar y cargar en `localStorage` | `js/storage/saves.js`, `js/storage/store.js` | T storage |
| G-2 | Exportar e importar JSON con claves | `js/storage/transfer.js` | T storage (archivo sin texto traducido) |
| G-3 | Comparador de diseños o informes | `scoring.compare`, `reportScreen` | T storage |

## §11 Educación y accesibilidad

<!-- section: education-and-accessibility -->

| Requisito | Qué pide | Dónde | Evidencia |
| --- | --- | --- | --- |
| E-1 | Tutorial de diseño, compensaciones, lanzador, reparación y consecuencia diferida | `js/ui/tutorial.js`, `data/tutorial.json` (8 pasos por pantalla) | H (llamada anclada en diseño y en viaje) |
| E-2 | Glosario accesible siempre | `data/glossary.json`, overlay del shell | H |
| E-3 | Tooltips en componentes, recursos y consecuencias | `js/ui/shell.js` (`ctx.tooltip`), pantallas | M |
| E-4 | Explicaciones breves sin conocimiento previo | textos de `data/locales/*`, `whyKey` | T mission · M |
| E-5 | Tamaño de texto, contraste, formas, animaciones, subtítulos | `css/main.css`, `js/ui/settingsScreen.js` | T core (formas) · M capturas a 125/150 % |

## §12 Requisitos técnicos

<!-- section: technical -->

| Requisito | Qué pide | Dónde | Evidencia |
| --- | --- | --- | --- |
| T-1 | HTML5, CSS3, JS ES2020+, Canvas 2D, sin frameworks | `index.html`, `js/**` | — |
| T-2 | Estructura de módulos sugerida | `js/{core,mission,world,ui,i18n,storage}`, `data/` | — |
| T-3 | Pruebas de `core/`, `mission/` e `i18n/` en Node | `tests/*.test.js` | **T**: `npm test` |
| T-4 | Comentarios en español, identificadores en inglés | todo `js/**` | M |

## §13 Internacionalización

<!-- section: i18n -->

| Requisito | Qué pide | Dónde | Evidencia |
| --- | --- | --- | --- |
| I-1 | `en` y `es` con paridad completa | `data/locales/{en,es}.json` (1168 claves) | T (paridad y formas) |
| I-2 | Cambio de idioma en vivo | `js/i18n` (`onChange`), `shell` (`rerender`) | T · H (botón de idioma verificado por estado) |
| I-3, I-11 | Claves únicas; contenido referenciado por clave | `data/**` | T cobertura |
| I-4 | Falla si falta una clave | `tests/i18n.test.js`, `tests/i18n-coverage.test.js` | **T** |
| I-5 | Plantillas con marcadores | `js/i18n/index.js` | T |
| I-6 | Plural y género | `js/i18n/index.js` (CLDR) | T (incluye anidamiento) |
| I-7 | `Intl` para números, fechas y unidades | `js/i18n/format.js` | T (`1.234,5` vs `1,234.5`) |
| I-8, I-9 | Detección y persistencia del idioma | `js/i18n.detectLocale`, `js/storage/prefs.js` | T |
| I-12 | Fallback al inglés, nunca una clave cruda | `js/i18n/index.js` | T |
| I-13, I-14 | UTF-8 y tolerancia a +30 % de texto | `index.html`, `css/**` | M capturas con texto largo y 150 % |
| I-15 | Pruebas de i18n en Node | `tests/i18n.test.js` | **T** |

## §14 Suposiciones (S-1 … S-20)

<!-- section: assumptions -->

Las veinte suposiciones están implementadas y documentadas una por una en la
sección **«Decisiones de diseño»** de [README.es.md](README.es.md), con la columna
«Dónde» indicando el archivo que las garantiza.

## Lo que no está verificado

<!-- section: not-verified -->

Declarado explícitamente, para que nadie lo lea como cumplido:

- **60 FPS en hardware real.** Medido en Chrome headless con render por software;
  el objetivo de diseño está implementado (un solo rAF, sin asignaciones por
  cuadro, culling), pero falta la medición en un equipo con GPU.
- **Mando físico.** La Gamepad API está soportada y su ausencia no rompe nada,
  pero no se probó con un mando conectado.
- **Lectores de pantalla.** Hay roles, etiquetas y foco gestionado; falta la
  prueba con NVDA o VoiceOver.
- **Persistencia entre sesiones bajo `file://`.** Depende del navegador; si
  bloquea `localStorage`, el juego cae a un almacén en memoria y avisa.
