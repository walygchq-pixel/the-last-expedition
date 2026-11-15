> **Read in Spanish:** [REQUISITOS.md](REQUISITOS.md) — the normative original.

# Requirements traceability

Map between the original requirements sheet (§1–§14, 150 requirements) and this repository.
Every row says **where** it is implemented and **what** verified it. Tests run with
`npm test`; the browser smoke run with `npm run smoke`.

Evidence legend: **T** = automated Node test · **H** = headless Chrome smoke · **M** =
manual measurement or inspection recorded in `odd/tasks/the-last-expedition.md`.

## §2 General requirements

| Requirement | What it asks for | Where | Evidence |
| --- | --- | --- | --- |
| RG-1 | Opens with `index.html`, no server | `index.html`, contract D-1 (classic scripts, no ES modules) | H opens over `file://` |
| RG-2 | One or more files under `js/ css/ data/` | repository structure | — |
| RG-3 | No visible text in code | `data/locales/{en,es}.json` + `js/i18n/` | T `i18n-coverage` |
| RG-4 | Simulation separated from render | `js/core/**`, `js/mission/**` with no DOM | T core and mission in Node |
| RG-5 | 60 FPS with 4 players | `js/world/renderer.js` (single rAF, culling, no per-cell allocations) | **Partial:** M with screenshot and profile in headless (software), not on a real GPU |
| RG-6 | Procedural graphics, no assets | `js/world/renderer.js`, `design/` | M screenshots |

## §3 Players and modes

| Requirement | What it asks for | Where | Evidence |
| --- | --- | --- | --- |
| RG-7 | 1 to 4 local players | `js/world/players.js`, `js/ui/shell.js` | T world (4 players) |
| RG-8 | Keyboard and gamepad controls, rebindable | `js/world/input.js`, `js/ui/settingsScreen.js`, `js/storage/prefs.js` | T world (bindings and rebinding) · M gamepad untested on hardware |
| RG-9 | Five roles with bonuses | `js/core/crew.js` (`ROLE_MODIFIERS`) | T core (`roleModifier`) |
| RG-10 | Solo mode with a penalty | `js/core/crew.js` (`collectiveEfficiency`) | T core (solo = 0.85) |
| RG-11 | Collective decisions with voting and a default option | `js/core/game.js` (`propose`, `vote`, `resolveVote`) | T core (disagreement applies the default option) |
| RG-12 | Opposing priorities | `js/ui/travelScreen.js` (power warning + shutdown proposal), `js/core/game.js` | M screenshot with the warning active |

## §4 Phase 1: mission design

| Requirement | What it asks for | Where | Evidence |
| --- | --- | --- | --- |
| DM-1 | Objective first, with minimum requirements | `data/objectives.json`, `js/mission/design.js` | T mission |
| DM-2 | Verifiable ✔/✘ list | `js/ui/designScreen.js` (checklist) | H |
| DM-3 | Nine component groups | `data/parts.json` (12 groups) | T mission (counts) |
| DM-4 | Mass, power, cost, data, reliability; simple and advanced | `data/parts.json`, `data/instruments.json` | T mission |
| DM-5 | Immediate impact on resources | `js/mission/design.js` (`liveImpact`), telemetry panel | H |
| DM-6 | Origin of every module | `system` per part in `data/parts.json`, `js/core/systems.js` (`origins`) | T core |
| DM-7 | Six distinct instruments | `data/instruments.json` | T mission |
| DM-8 | The advanced version visibly compensates | `data/instruments.json` + tooltips | T mission · M screenshot |
| DM-9 | Three distinct launchers | `data/launchers.json` | T mission |
| DM-10 | Four orbits explained in plain language | `data/orbits.json` | T mission · M screenshot |
| DM-11 | Launch blocked with reason and fix | `js/mission/design.js` (`validateLaunch`), clearance strip | T mission (block and fix) · H |
| DM-12 | Three scenarios | `data/scenarios.json` | T mission |
| DM-13 | Three difficulties with budget and service life | `js/core/events.js` (`DIFFICULTIES`) | T core and mission |
| DM-14 | At least two valid solutions per scenario and difficulty | `data/*.json` | T mission (brute force over 9 combinations) |

## §5 Resource management

| Requirement | What it asks for | Where | Evidence |
| --- | --- | --- | --- |
| Resources | Six resources in a real-time panel | `js/core/resources.js`, `js/ui/*` | T core (full panel) |
| RN-1 | Most critical resource of the scenario | `critical` per scenario + `resources.evaluate` | T core |
| RN-2 | Colour **and** shape or icon | `resources.SHAPES` / `ICONS` | T core (shape and icon per resource) |

## §6 Phase 2: travel and survival

| Requirement | What it asks for | Where | Evidence |
| --- | --- | --- | --- |
| V-1 | Third-person isometric, group camera | `js/world/renderer.js` | T world (render with camera) · H |
| V-2 | Kitchen, mechanics, infirmary, command, corridors, quarters, airlock | `data/shipLayout.json` | T world (seven rooms) |
| V-3 | At least 6 objects per room | `data/objects.json` (59 objects, 64 actions) | T world |
| V-4 | Action panel with estimated consequence | `js/world/objects.js`, `js/ui/travelScreen.js` (radial) | T world · H `E` key |
| V-5 | Limited inventory and trading | `js/world/players.js` | T world |
| V-6 | State and reliability per system | `js/core/systems.js` | T core |
| V-7 | Degradation is visible inside the ship | `systems.effects` → `renderer` | T world (lighting) |
| V-8 | Health, stress, morale, sleep, hunger, thirst, hygiene | `js/core/crew.js` | T core |
| V-9 | Critical needs with progressive penalty | `js/core/crew.js` | T core (conditions and death) |
| V-10 | Cannibalizing with a deferred breakdown | `js/core/systems.js` (`cannibalize`), `js/core/game.js` | T core (reliability −15…−25 and breakdown in 3–6 days) |
| V-11 | Freshness, illness and waste | `js/core/food.js` | T core (2 %/8 % per day, 35 % below 30 %) |
| V-12 | Collective decisions | `js/core/game.js` (`COLLECTIVE_DECISIONS`) | T core |
| V-13 | Every decision explains why | `whyKey` in consequences, events and actions | T mission (every option has a `whyKey`) |
| V-14 | Varied events | `data/events.json` (11 events) | T mission |
| V-15 | Responses with trade-offs | `data/events.json` | T mission (≥2 options with different effects) |
| V-16 | Frequency and intensity by difficulty | `js/core/events.js` | T core |
| V-17 | Clock with acceleration and pause | `js/core/time.js`, HUD | T core (×1…×8, pause) |
| V-18 | End-of-game conditions | `js/core/game.js` (`checkEnd`) | T core |

## §7 Communications and data

| Requirement | What it asks for | Where | Evidence |
| --- | --- | --- | --- |
| C-1 | Limited data memory | `js/core/datastore.js` | T core (cap and loss) |
| C-2 | Transmission only inside a window | `js/core/comms.js` | T core (windows per orbit) |
| C-3 | Data priority per window | `datastore.transmit`, link strip | T core (priority order) |
| C-4 | What is not transmitted is worth less | `datastore.scienceValue` (0.6) | T core |

## §8 Scoring and evaluation

| Requirement | What it asks for | Where | Evidence |
| --- | --- | --- | --- |
| P-1 | Score across six rubrics | `js/core/scoring.js` | T core (1000 points and breakdown) |
| P-2 | Mission report | `scoring.buildReport` | T core |
| P-3 | Post-game analysis | `scoring.analyze` | T core (ordered by impact) |
| P-4 | Local leaderboard by scenario and difficulty | `js/storage/leaderboard.js` | T storage |

## §9 Game modes

| Requirement | What it asks for | Where | Evidence |
| --- | --- | --- | --- |
| M-1 | Campaign with evaluation | `js/ui/shell.js`, report | H |
| M-2 | Sandbox | `js/ui/shell.js` (`mode.sandbox`) | M |
| M-3 | Turn-based competitive with reports | `js/ui/reportScreen.js` (comparator), `js/core/scoring.js` (`compare`) | T storage (comparator) |
| M-4 | Co-op 1–4 | `js/core/game.js` (`mode: cooperative`), voting | T core |

## §10 Save and load

| Requirement | What it asks for | Where | Evidence |
| --- | --- | --- | --- |
| G-1 | Save and load in `localStorage` | `js/storage/saves.js`, `js/storage/store.js` | T storage |
| G-2 | Export and import JSON with keys | `js/storage/transfer.js` | T storage (file with no translated text) |
| G-3 | Comparator for designs or reports | `scoring.compare`, `reportScreen` | T storage |

## §11 Education and accessibility

| Requirement | What it asks for | Where | Evidence |
| --- | --- | --- | --- |
| E-1 | Tutorial on design, trade-offs, launcher, repair and deferred consequence | `js/ui/tutorial.js`, `data/tutorial.json` (8 steps per screen) | H (callout anchored in design and in travel) |
| E-2 | Glossary always reachable | `data/glossary.json`, shell overlay | H |
| E-3 | Tooltips on components, resources and consequences | `js/ui/shell.js` (`ctx.tooltip`), screens | M |
| E-4 | Short explanations with no prior knowledge | texts in `data/locales/*`, `whyKey` | T mission · M |
| E-5 | Text size, contrast, shapes, animations, subtitles | `css/main.css`, `js/ui/settingsScreen.js` | T core (shapes) · M screenshots at 125/150 % |

## §12 Technical requirements

| Requirement | What it asks for | Where | Evidence |
| --- | --- | --- | --- |
| T-1 | HTML5, CSS3, JS ES2020+, Canvas 2D, no frameworks | `index.html`, `js/**` | — |
| T-2 | Suggested module structure | `js/{core,mission,world,ui,i18n,storage}`, `data/` | — |
| T-3 | Tests for `core/`, `mission/` and `i18n/` in Node | `tests/*.test.js` | **T**: `npm test` |
| T-4 | Comments in Spanish, identifiers in English | all `js/**` | M |

## §13 Internationalisation

| Requirement | What it asks for | Where | Evidence |
| --- | --- | --- | --- |
| I-1 | `en` and `es` with full parity | `data/locales/{en,es}.json` (1168 keys) | T (parity and forms) |
| I-2 | Live language switch | `js/i18n` (`onChange`), `shell` (`rerender`) | T · H (language button verified by state) |
| I-3, I-11 | Unique keys; content referenced by key | `data/**` | T coverage |
| I-4 | Fails if a key is missing | `tests/i18n.test.js`, `tests/i18n-coverage.test.js` | **T** |
| I-5 | Templates with placeholders | `js/i18n/index.js` | T |
| I-6 | Plural and gender | `js/i18n/index.js` (CLDR) | T (including nesting) |
| I-7 | `Intl` for numbers, dates and units | `js/i18n/format.js` | T (`1.234,5` vs `1,234.5`) |
| I-8, I-9 | Locale detection and persistence | `js/i18n.detectLocale`, `js/storage/prefs.js` | T |
| I-12 | Fallback to English, never a raw key | `js/i18n/index.js` | T |
| I-13, I-14 | UTF-8 and tolerance to +30 % text | `index.html`, `css/**` | M screenshots with long text and 150 % |
| I-15 | i18n tests in Node | `tests/i18n.test.js` | **T** |

## §14 Assumptions (S-1 … S-20)

The twenty assumptions are implemented and documented one by one in the
**"Design decisions"** section of [README.md](README.md), with the "Where" column
naming the file that guarantees each one.

## What is not verified

Declared explicitly, so nobody reads it as done:

- **60 FPS on real hardware.** Measured in headless Chrome with software rendering;
  the design goal is implemented (a single rAF, no per-frame allocations, culling),
  but the measurement on a machine with a GPU is missing.
- **Physical gamepad.** The Gamepad API is supported and its absence breaks
  nothing, but it was not tested with a gamepad connected.
- **Screen readers.** Roles, labels and managed focus exist; the test with NVDA or
  VoiceOver is missing.
- **Persistence across sessions under `file://`.** It depends on the browser; if it
  blocks `localStorage`, the game falls back to an in-memory store and reports it.
