# Sistema de diseño — The Last Expedition

Sincronización leída del proyecto, no escrita en él (gentle-design, «Design system sync»).
Fuentes leídas: `css/main.css` (tokens y controles base), `css/design.css`, `css/travel.css`,
`css/overlays.css` (tutorial, tooltip, avisos) e `index.html` (orden de carga y estructura).

Regla de esta sincronización: **nada inventado**. Cada valor de esta página existe en los CSS
citados; lo que no existe está al final, bajo «Propuestas», marcado como propuesta y sin usar en
los artboards.

---

## 1. Color base

Fuente: `css/main.css:14-28` (`:root`). Cada token se usa por nombre; ningún artboard escribe un
hex nuevo.

| Token | Valor | Fuente | Uso |
| --- | --- | --- | --- |
| `--bg` | `#070910` | `css/main.css:14` | Fondo de la ventana y del chasis |
| `--bg-soft` | `#0d1220` | `css/main.css:15` | Fondo de campos, tarjetas internas y filas |
| `--panel` | `#111a2b` | `css/main.css:16` | Superficie de panel, tarjetas y tutorial |
| `--panel-2` | `#16223a` | `css/main.css:17` | Cara superior de tarjeta, botón y barra superior |
| `--line` | `#26365a` | `css/main.css:18` | Bordes de separación y rejillas |
| `--line-strong` | `#3d5687` | `css/main.css:19` | Borde de controles, tarjetas y tooltips |
| `--text` | `#e6ecfb` | `css/main.css:20` | Texto principal |
| `--text-dim` | `#a9b6d3` | `css/main.css:21` | Etiquetas, texto secundario y metadatos |
| `--text-faint` | `#7d8bab` | `css/main.css:22` | Texto terciario de 0.85 rem (`.faint`) |
| `--accent` | `#6fd3c7` | `css/main.css:23` | Énfasis, enlaces, selección y foco de sección |
| `--accent-2` | `#ffcf6b` | `css/main.css:24` | Aviso y segunda jerarquía de énfasis |
| `--ok` | `#6fd98a` | `css/main.css:25` | Estado nominal y barras sanas |
| `--warn` | `#ffcf6b` | `css/main.css:26` | Estado justo, aviso y barra en advertencia |
| `--critical` | `#ff7a7a` | `css/main.css:27` | Estado crítico, avería y barra crítica |
| `--focus` | `#ffe082` | `css/main.css:28` | Anillo de foco y borde del tutorial |

Contraste medido sobre `--panel` (`#111a2b`) y sobre `--bg-soft` (`#0d1220`): `--text` 14.7:1 /
15.8:1, `--text-dim` 8.6:1 / 9.2:1, `--text-faint` 5.1:1 / 5.5:1, `--accent` 9.8:1 / 10.5:1,
`--ok` 9.9:1 / 10.6:1, `--warn` 11.9:1 / 12.8:1, `--focus` 13.5:1 / 14.4:1 y `--critical` 6.9:1 /
7.4:1: **todo texto del sistema pasa AA** (≥ 4.5:1) sobre las dos superficies.

Dos bordes quedan por debajo del 3:1 de información no textual: `--line` (1.5:1) y `--line-strong`
(2.4:1) sobre `--panel`. Por eso `--line` se reserva para separadores decorativos y todo control
interactivo de los artboards lleva `--line-strong` más un filete derivado de `--text-faint` al 35 %
(§9), que es la misma familia de gris que ya pasa AA.

## 2. Color de contraste alto

Fuente: `css/main.css:45-58` (`html.contrast-high`). El juego lo activa desde ajustes (S66); los
artboards muestran solo el tema base.

| Token | Valor | Fuente |
| --- | --- | --- |
| `--bg` | `#000000` | `css/main.css:45` |
| `--bg-soft` | `#05070d` | `css/main.css:46` |
| `--panel` | `#0a0e18` | `css/main.css:47` |
| `--panel-2` | `#101828` | `css/main.css:48` |
| `--line` | `#6c86bf` | `css/main.css:49` |
| `--line-strong` | `#c8d6f5` | `css/main.css:50` |
| `--text` | `#ffffff` | `css/main.css:51` |
| `--text-dim` | `#e2e9f8` | `css/main.css:52` |
| `--text-faint` | `#c3cee6` | `css/main.css:53` |
| `--accent` | `#8ff5e6` | `css/main.css:54` |
| `--accent-2` | `#ffe08a` | `css/main.css:55` |
| `--ok` | `#8bffab` | `css/main.css:56` |
| `--warn` | `#ffe08a` | `css/main.css:57` |
| `--critical` | `#ff9d9d` | `css/main.css:58` |

## 3. Tipografía

Fuente: `css/main.css:33` (`--font`). Una sola familia, monoespaciada del sistema; los tamaños van
en `rem` para que 100/125/150 % escale junto (`css/main.css:12`, `:37`, `:41`).

| Token / rol | Valor | Fuente |
| --- | --- | --- |
| `--font` | `ui-monospace, SFMono-Regular, "Cascadia Mono", "Segoe UI Mono", Menlo, Consolas, monospace` | `css/main.css:33` |
| Cuerpo | `font-size: 1rem`, `line-height: 1.5` | `css/main.css:75-76` |
| Título de pantalla | `2.2rem`, `letter-spacing: 0.08em`, mayúsculas | `css/main.css:446-449` |
| `h1` | `1.8rem` | `css/main.css:111` |
| `h2` | `1.25rem` | `css/main.css:115` |
| `h3` | `1.05rem`, color `--accent` | `css/main.css:119-121` |
| Encabezados | `line-height: 1.2`, `letter-spacing: 0.02em`, peso 700 | `css/main.css:91-93` |
| Marca | `letter-spacing: 0.06em`, mayúsculas, `--accent` | `css/main.css:152-155` |
| Etiqueta de campo | `0.9rem`, color `--text-dim` | `css/main.css:260` |
| `.faint` | `0.85rem`, color `--text-faint` | `css/main.css:330` |
| `.badge` / `.chip` | `0.8rem` | `css/main.css:340`, `css/travel.css:172-174` |
| Glifo de icono | `0.95rem`, `line-height: 1` | `css/main.css:428-429` |
| Rótulo contextual | `0.85rem` en `.context` | `css/main.css:167` |

## 4. Espaciado

| Token | Valor | Fuente | Uso |
| --- | --- | --- | --- |
| `--gap` | `0.75rem` | `css/main.css:31` | Separación entre paneles y grupos |
| `--pad` | `0.9rem` | `css/main.css:32` | Relleno de `.screen` y `.card` |

Literales en uso (no son tokens; se repiten y conviene conocerlos):

| Valor | Fuente | Uso |
| --- | --- | --- |
| `0.3rem` | `css/main.css:307`, `:250` | Rejilla muy compacta, relleno de botón icono |
| `0.35rem` | `css/main.css:336` | Separación dentro de badge |
| `0.4rem` | `css/main.css:198`, `:358` | Relleno de botón, listas y tooltip |
| `0.5rem` | `css/main.css:145` | Filas y sub-columnas |
| `0.55rem` | `css/main.css:339` | Relleno lateral de badge |
| `0.6rem` | `css/main.css:468`, `css/travel.css:50` | Tarjeta de elección y aviso sobre el canvas |
| `0.65rem` | `css/design.css:66` | Relleno de `.part-group` |
| `0.7rem` | `css/main.css:349` | `hr.divider` |
| `0.8rem` | `css/main.css:198` | Relleno lateral de botón |
| `1rem` | `css/overlays.css:102` | Margen del tutorial flotante |

## 5. Radios

| Token | Valor | Fuente | Uso |
| --- | --- | --- | --- |
| `--radius` | `0.5rem` | `css/main.css:30` | Paneles, tarjetas, campos, botones |
| Píldora | `999px` | `css/main.css:170`, `:338`, `:369` | `.context`, `.badge`, `.chip`, `.bar` |
| Cuadrado de forma | `2px` | `css/main.css:400` | `.shape--square` |
| Círculo de forma | `50%` | `css/main.css:404` | `.shape--circle` |

## 6. Sombras, bordes y elevación

| Valor | Fuente | Uso |
| --- | --- | --- |
| `inset 0 0 0 1px var(--accent)` | `css/main.css:223` | Control seleccionado o `aria-pressed` |
| `linear-gradient(180deg, var(--panel-2), var(--panel))` | `css/main.css:148` | Barra superior |
| `linear-gradient(180deg, var(--panel), var(--bg-soft))` | `css/main.css:281` | `.card` |
| `0 8px 24px rgba(0, 0, 0, 0.5)` | `css/overlays.css:120` | Tutorial flotante |
| `0 4px 16px rgba(0, 0, 0, 0.45)` | `css/overlays.css:181` | Aviso (`.toast`) |
| `0 6px 20px rgba(0, 0, 0, 0.55)` | `css/overlays.css:222` | Tooltip |
| `rgba(3, 5, 10, 0.78)` | `css/overlays.css:19` | Velo de capa modal |
| `rgba(5, 7, 13, 0.82)` | `css/travel.css:50` | Aviso sobre el lienzo |
| `radial-gradient(... rgba(111, 211, 199, 0.09) ...)` | `css/main.css:82-83` | Luz de fondo del `body` |

No hay tokens de sombra: son valores literales. Los artboards reutilizan exactamente los de esta
tabla y no añaden otros.

## 7. Foco, movimiento y accesibilidad

| Regla | Valor | Fuente |
| --- | --- | --- |
| Foco global | `outline: 3px solid var(--focus)`, `outline-offset: 2px` | `css/main.css:238-241` |
| Foco del área principal | `outline: 2px solid var(--focus)`, `outline-offset: -4px` | `css/main.css:183-186` |
| Transición de control | `background 120ms linear, border-color 120ms linear` | `css/main.css:204` |
| Movimiento reducido (preferencia) | `animation-duration: 0.001ms`, `transition-duration: 0.001ms` | `css/main.css:517-524` |
| Movimiento reducido (clase) | `html.reduce-motion *` igual que arriba | `css/main.css:501-510` |
| Estado seleccionado ≠ foco | borde + relleno de acento vs anillo `--focus` | `css/main.css:222-223`, `:238` |

## 8. Reglas de componentes (existentes)

**Botón** (`css/main.css:196-252`). Altura mínima `2.4rem`, relleno `0.4rem 0.8rem`, borde
`1px var(--line-strong)`, radio `--radius`, fondo `--panel-2`. Hover: `#1d2c4a` + borde `--accent`.
`:disabled`: `opacity: 0.55`. Seleccionado: borde `--accent` + `rgba(111, 211, 199, 0.16)` +
`inset 0 0 0 1px var(--accent)`. Variantes: `.primary` (fondo `--accent`, texto `#04120f`), `.danger`,
`.ghost`, `.icon` (`min-width: 2.4rem`).

**Tarjeta** (`.card`, `css/main.css:278-284`). Borde `1px var(--line)`, radio `--radius`, fondo en
degradado `--panel → --bg-soft`, relleno `--pad`.

**Campo** (`css/main.css:258-273`). Etiqueta `0.9rem` `--text-dim` sobre el control; control con
`min-height: 2.2rem`, borde `var(--line-strong)`, fondo `--bg-soft`, radio `--radius`.

**Indicador de estado** (`css/main.css:394-423`). Color **y** forma: `.status--ok|warn|critical`
dan el color y `.shape--square|circle|triangle|diamond` la forma (`2px`, `50%`, `clip-path`). El
estado nunca se comunica solo por color (S29). Forma fija por recurso (C-6): masa `square`,
potencia `triangle`, presupuesto `diamond`, datos `circle`, comunicaciones `diamond`, tiempo
`triangle`.

**Barra de progreso** (`.bar`, `css/main.css:366-390`). Alto `0.55rem`, radio `999px`, pista
`#0a1322` con borde `var(--line)`, relleno `--ok`; `.is-warn` → `--warn`, `.is-critical` →
`--critical`. Ancho mínimo `3rem`.

**Badge / chip** (`css/main.css:334-345`, `css/travel.css:172-189`). `inline-flex`, `0.8rem`,
píldora, fondo `--bg-soft`; el chip de estado usa `--warn`/`--critical` con tinte al 10-12 %.

**Fila de recurso** (`.hud-resource`, `css/travel.css:98-125`). Borde `1px var(--line)`, radio
`--radius`, cabecera nombre + valor, barra; `.is-worst` marca el recurso crítico.

**Tabla** (`.table`, `css/main.css:487-500`). `0.9rem`, cabecera `--text-dim` peso 600, filas con
`border-bottom: 1px var(--line)`.

**Tutorial** (`css/overlays.css:104-132`). Borde `1px solid var(--focus)`, radio `--radius`, fondo
`--panel`, relleno `0.8rem`, `gap: 0.5rem`, sombra `0 8px 24px rgba(0,0,0,0.5)`, título `0.95rem`
en `--focus`. Es la regla que reutilizan las llamadas de tutorial de los artboards.

**Tooltip** (`css/overlays.css:209-224`). Borde `--line-strong`, fondo `#04060c`, `0.82rem`,
`line-height: 1.4`, sombra `0 6px 20px rgba(0,0,0,0.55)`.

## 9. Reglas de la consola de la nave (nuevas, derivadas de tokens existentes)

Los artboards de `design/ship-console/` proponen una lectura «panel físico de nave». Estas reglas
se implementan **solo con tokens existentes**; los valores derivados se calculan a partir de ellos
(alfa sobre el mismo RGB), nunca son colores nuevos.

| Patrón | Construcción | Derivación |
| --- | --- | --- |
| Bisel de chasis | `box-shadow: inset 0 1px 0 rgba(230, 236, 251, 0.14), inset 0 -2px 0 rgba(0, 0, 0, 0.55)` | `--text` al 14 % + negro al 55 % |
| Tornillo | Círculo de `10px` con `radial-gradient(circle at 35% 30%, var(--line-strong), var(--panel))`, ranura en `--bg` | `--line-strong`, `--panel`, `--bg` |
| Cara de objeto isométrico | Superior `--panel-2` + velo `rgba(230,236,251,0.10)`; lateral izquierdo `--panel` + sombra `rgba(0,0,0,0.32)`; lateral derecho `--bg-soft`; arista superior `rgba(230,236,251,0.42)` | cuatro tokens y tres alfas |
| Sombra proyectada | Elipse `rgba(0, 0, 0, 0.45)` bajo cada objeto | negro al 45 % |
| Rótulo grabado | Mayúsculas, `letter-spacing: 0.12em`, `0.68rem`, `--text-faint` | `--text-faint` |
| Franja de permiso | Fondo `--bg-soft`, borde superior `1px var(--line-strong)`, sello girado `-4deg` | tokens + `--radius` |
| Retícula del visor | Líneas cada `2rem` en `rgba(38, 54, 90, 0.55)` | `--line` al 55 % |
| Textura de scanline | Repetir `rgba(230,236,251,0.03)` cada `3px` sobre el chasis | `--text` al 3 %; el token `--scanline` sigue siendo propuesta (§10) |
| Borde de control con filete | `1px var(--line-strong)` + `0 0 0 1px rgba(125,139,171,0.35)` | `--line-strong` + `--text-faint` al 35 %, para superar 3:1 (§1) |
| Visor holográfico | Cara superior `rgba(111,211,199,0.14)`, laterales `0.05` y `rgba(13,18,32,0.55)`, rejilla `rgba(111,211,199,0.16)` | `--accent` y `--bg-soft` con alfa; sin relleno opaco |
| Etiqueta de objeto | Fondo `--panel`, borde `--focus`, texto `--text` a `10px` | tokens + `css/overlays.css:122` (patrón del tooltip) |

### Componentes de consola que introducen los artboards

Se describen acá para que la implementación no invente otra forma; todos se construyen con
los tokens y reglas de arriba.

- **Permiso de despegue** (`01`): franja de `104 px` con dos zonas de campos (etiqueta rayada,
  valor y marca ✔/✘), veredicto con motivo y corrección (`block.*` / `fix.*`) y un interruptor
  deshabilitado con sello girado. El motivo nunca falta: un botón bloqueado sin explicación no
  es aceptable (S23).
- **Mesa de instrumentos** (`01`): tabla densa a `0.66 rem` con cabecera en mayúsculas y
  separadores `1px var(--line)`; la versión avanzada se marca en la propia fila.
- **Gauge de sistema** (`02`): fila de dos líneas, nombre y porcentaje, más pista de `5 px` con
  `--ok`/`--warn`/`--critical`; la fiabilidad se escribe aparte en `--text-faint` porque es otro
  dato, no el mismo número.
- **Cinta de consecuencias** (`02`): lista con borde izquierdo `--accent-2`, disparador en
  mayúsculas y el porqué en `--text-faint` (S42).
- **Radial de acciones** (`03`): anillo discontinuo alrededor del jugador, guías `1px` y botones
  de `196 px`; el botón objetivo usa el anillo `--focus` para no confundirse con la selección.
- **Llamada de tutorial anclada** (`01`, `02`): caja del tutorial (`css/overlays.css:104`) unida al
  control con una línea de `1px` y punta de flecha en `--focus`; dos botones, «Entendido» y
  «Después», uno primario.
- **Visor isométrico** (`02`, `03`): SVG generado en el propio archivo (sin imágenes) con
  proyección `(x−y, x+y)`, plataformas con canto, objetos de tres caras, sombra proyectada y
  etiqueta al enfocar. La cámara encuadra la cubierta completa; a 1440 px los objetos miden
  entre 50 y 75 px de ancho, el mínimo para que se lean como objetos y no como iconos.

## 10. Propuestas (no implementadas todavía)

Nada de esta sección existe en `css/*.css`; se listan para que, si se aceptan, entren en
`css/main.css:14-33` como tokens reales. Los artboards **no** las usan.

| Token propuesto | Valor propuesto | Para qué |
| --- | --- | --- |
| `--bevel-hi` | `rgba(230, 236, 251, 0.14)` | Arista iluminada del bisel de chasis, hoy literal |
| `--bevel-lo` | `rgba(0, 0, 0, 0.55)` | Arista en sombra del bisel, hoy literal |
| `--scanline` | `repeating-linear-gradient(0deg, rgba(230, 236, 251, 0.03) 0 1px, transparent 1px 3px)` | Textura de pantalla de la consola |
| `--hinge` | `0.9rem` | Radio de la bisagra que une el visor con el chasis |
| `--screw` | `10px` | Diámetro del tornillo del chasis |
| `--stamp` | `-4deg` | Inclinación del sello de autorización de lanzamiento |
| `--gauge-track` | `--line` | Pista de los gauges de sistemas, hoy `#0a1322` de `.bar` |

## 11. Autochequeo de los artboards

Artboards: `system.html`, `ship-console/01-mission-console.html`, `ship-console/02-flight-deck.html`,
`ship-console/03-flight-deck-holo.html`.

- Colores usados: solo los 15 tokens base de §1 (y sus variantes de §2 no se usan). Los alfas
  derivados son, en total, ocho: `rgba(230,236,251,0.03/0.09/0.10/0.14/0.16/0.22/0.30/0.35)`,
  `rgba(0,0,0,0.32/0.45/0.55)` y, en la variante holográfica, `rgba(111,211,199,0.045/0.14/0.16/0.42)`
  y `rgba(13,18,32,0.55)`. Todas son el mismo RGB de un token con alfa; no hay hex nuevos.
- Familias tipográficas: una sola, la pila de `--font`; no se carga ninguna fuente.
- Tamaños: `0.5-2.2rem` según §3, más `9-11 px` dentro del SVG isométrico (donde el `rem` no
  escala con el lienzo). Los rótulos grabados usan `0.56-0.68rem` y mayúsculas con
  `letter-spacing: 0.12-0.2em` (mismo patrón que la marca, `css/main.css:154`).
- Radios: `--radius`, `999px`, `2px`, `50%` (§5). Sin radios nuevos.
- Contraste: texto de cuerpo y etiquetas en `--text`/`--text-dim`/`--text-faint` (§1);
  `--critical` solo en formas, barras y bordes, con el texto siempre en `--text`.
- Foco: `outline: 3px solid var(--focus)`/`offset: 2px` en todo control interactivo, incluidos los
  objetos del visor (`<g tabindex="0" role="button">`), que responden a teclado y al enfocar
  muestran su etiqueta.
- Movimiento: barrido de scanline, pulso del indicador y anillo del objeto cercano son
  `animation`; bajo `prefers-reduced-motion: reduce` quedan congelados (§7).
- Densidad: los tres artboards miden 1440 × 900 y muestran todo su contenido sin scroll; se
  comprobó con capturas de Chrome headless y con una medición de cajas que no encuentra ningún
  elemento fuera del cuerpo de 1440 × 900.

Desviaciones conocidas y conscientes:

1. `--line-strong` no llega a 3:1 como borde único; los controles suman el filete de `--text-faint`
   al 35 % descrito en §9.
2. En `02` y `03` la cubierta se dibuja más ancha que el visor y se recorta en el borde: es la
   cámara, no un desborde. La medición de cajas lo confirma (todo dentro del SVG).
