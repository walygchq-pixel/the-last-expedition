# The Last Expedition

A **space mission design and survival game** that runs entirely in the browser, with no
installation and no server, featuring a **bilingual English / Spanish** interface that can
be switched live.

> **Open project for evaluation.** A complete game that runs in the browser with no install,
> no server and no external dependencies.
>
> - **Playable demo:** <https://walygchq-pixel.github.io/the-last-expedition/>
> - **Verified state:** the whole Node suite (`npm test`) green, plus a headless Chrome smoke run that walks the
>   title → mission design → launch → travel flow, switches language live, and fails on any
>   exception, untranslated key or horizontal overflow.
> - **Requirements traceability:** [REQUIREMENTS.md](REQUIREMENTS.md) maps every requirement
>   of the original specification (§1–§14) to the file that implements it and the test that
>   covers it.
> - **How to play in 30 seconds:** New mission → scenario → Basic difficulty → pick launcher
>   (Atlas M), orbit (Medium), Radar and Advanced Computer → Launch → move with `WASD` and
>   press `E` next to an object.

Open it by **double-clicking `index.html`**. There are no external dependencies, no CDN, no
downloaded fonts and no ES modules: everything is classic scripts and local data, precisely so
that `file://` works (see "Design decisions", D-1).

- Simulation engine with no DOM and no language (`js/core`), testable from Node.
- Mission design phase with real trade-offs (mass, power, budget, data, communications, time).
- Isometric travel phase with 1–4 local players, interactable objects, events with responses,
  team votes and a **consequences ledger** that cashes in decisions later.
- Final report, educational analysis, local leaderboard and a comparator.

## How to play

<!-- section: how-to-play -->

1. **New mission** → choose mode, scenario, difficulty and number of players with their
   roles. Basic enables the tutorial.
2. **Mission design**: the objective rules. The requirement list on the right turns green as
   the design satisfies it; the **Launch** button locks and explains why while something
   does not add up.
3. **Travel**: move through the ship, interact with objects, eat, repair, transmit data and
   respond to events. The clock speeds up with ×1/×2/×4/×8 and pauses to review pending
   consequences.
4. **Report**: rubric-based score, analysis of the trade-offs that mattered most, local
   leaderboard and report export.

## Controls

<!-- section: controls -->

| Player | Move | Interact |
| --- | --- | --- |
| 1 | `W` `A` `S` `D` | `E` |
| 2 | arrow keys | `Enter` |
| 3 | `I` `J` `K` `L` | `Ñ` (or `;`) |
| 4 | numeric keypad `8` `2` `4` `6` | `0` |

Bindings are reassigned from **Settings → Controls** and stored in `localStorage`. A standard
gamepad (Gamepad API) is optional: without one, everything still works.

## Structure

<!-- section: structure -->

```
index.html               entry point (containers and script order only)
js/
  main.js               bootstrap: preferences → translator → catalog → UI
  i18n/                 translator, templates, plural/gender and Intl formatting
  core/                 simulation: rng, resources, systems, crew, food,
                        consequences, events, effects, data, comms, clock,
                        scoring and the game orchestrator
  mission/              mission design, catalogs, requirements and validation
  world/                isometric map, A*, objects, players, input, render
  ui/                   shell, design, travel, report, settings and tutorial
  storage/              localStorage, export/import and leaderboard
data/
  locales/en.json       translations (flat dotted keys)
  locales/es.json
  *.json                content: parts, instruments, launchers, orbits,
                        objectives, scenarios, food, events, ship and objects
  data-bundle.js        generated: bundles the JSON for `file://`
css/                    mission console theme (four sheets)
tests/                  Node suite (no browser)
tools/                  build-data.js, merge-keys.js, smoke.js
odd/tasks/              operational specification, contracts and project log (Spanish)
```

## Development

<!-- section: development -->

```bash
npm test               # full Node suite (core, mission, world, i18n, storage)
npm run build:data     # regenerates data/data-bundle.js from the canonical JSON
npm run smoke          # opens index.html in headless Chrome and walks the flow
node tools/merge-keys.js odd/tasks/keys-ui.json   # merges a key fragment
```

`npm run smoke` needs Chrome or Chromium installed. It verifies that the app loads from
`file://`, that the design → launch → travel flow reaches the canvas, that the language
switch applies live, that there are no exceptions or untranslated keys, and that the
interface does not overflow horizontally; it saves screenshots in `tools/.smoke/`.

The golden rule of the repository: **every key used exists in both languages**.
`tests/i18n-coverage.test.js` walks `js/**` and `data/**` looking for keys and fails if any is
missing, and `tests/i18n.test.js` demands exact parity between `en.json` and `es.json`.

## Design decisions

<!-- section: design-decisions -->

Assumptions taken where the requirements sheet was not explicit. The "Where" column names the
place in the code that guarantees the rule.

| Ref. | Assumption applied | Where |
| --- | --- | --- |
| **D-1** | No ES modules: `file://` blocks `type="module"` and local `fetch()`, and RG-1 requires opening `index.html` with no server. Each file is a classic script with a dual wrapper (Node `require` / browser `GS`). | all `js/**` |
| **D-2** | The JSON under `data/` is the source of truth; `data/data-bundle.js` is generated by `tools/build-data.js` so it can be loaded without `fetch`. | `tools/build-data.js` |
| **D-3** | The simulation never produces text: it returns codes and parameters, and the UI translates them. | `js/core/**`, `js/mission/**` |
| **D-4** | All randomness goes through a seeded generator; `Math.random()` is banned in `core/`, `mission/` and `world/`. | `js/core/rng.js` |
| **S-1** | One mission day lasts **15 real seconds** at ×1 (within the 10–20 s range) and speeds up ×2, ×4 and ×8. | `js/core/time.js` |
| **S-2** | Isometric map of **40 × 30** cells with rooms, corridors and an airlock. | `data/shipLayout.json` |
| **S-3** | Each room holds 6–10 objects; kitchen and mechanics reach 12. | `data/objects.json` |
| **S-4** | Inventory of **2 objects**, 3 with the upgraded backpack. | `js/world/players.js` |
| **S-5** | Voting lasts **30 s**; without agreement the default option applies, 10 % of collaboration is lost and efficiency is reduced for 2 days. | `js/core/game.js` |
| **S-6** | In solo mode collective efficiency is 0.85 and the vote resolves itself against a simulated option. | `js/core/crew.js`, `js/core/game.js` |
| **S-7** | Cannibalizing repairs instantly, drops the donor's reliability by 15–25 points and schedules the breakdown 3–6 days **or** 5 events from now, whichever comes first. | `js/core/systems.js` |
| **S-8** | Freshness drops 2 %/day nominally and 8 %/day with the fridge broken; below 30 % there is a 35 % chance of mild illness, which appears 1–3 days later and leaves waste. | `js/core/food.js` |
| **S-9** | Link windows per orbit: low 10 min every 90, medium 20 min every 4 h, high continuous with reduced bandwidth, transfer 1 h every 2 days. | `data/orbits.json`, `js/core/comms.js` |
| **S-10** | Service life: 90 / 150 / 200 days depending on difficulty. | `js/core/events.js` |
| **S-11** | Budget: 500 / 350 / 250 M€. The **launcher cost is paid out of the same budget** as the components (D-9). | `js/mission/design.js` |
| **S-12** | Delta-v is not integrated: it is approximated with a per-orbit table (launcher reach rank). | `data/launchers.json`, `data/orbits.json` |
| **S-13** | Radiation is modelled as an accumulated value per orbit and affects system reliability. | `data/orbits.json`, `js/core/game.js` |
| **S-14** | One standard gamepad (Xbox/PlayStation) through the Gamepad API; without one the game is played with the keyboard only. | `js/world/input.js` |
| **S-15** | Each indicator has a shape (circle, triangle, square, diamond) and an icon in addition to colour. | `js/core/resources.js` |
| **S-16** | Competitive mode is turn-based on the same device: exported and imported reports are compared. | `js/ui/reportScreen.js` |
| **S-17** | `localStorage` with a 5 MB cap: if it does not fit, the user is told with a code and export is suggested. | `js/storage/store.js` |
| **S-18** | The tutorial activates only on Basic and on the first game, and can be disabled from Settings. | `js/ui/tutorial.js` |
| **S-19** | A* over the ship grid with no diagonals; players may share a cell. | `js/world/pathfinding.js` |
| **S-20** | Text size 100 / 125 / 150 % with panels that reflow (everything in `rem`). | `css/**` |

Decisions of our own, not explicitly requested but needed for the rules above to stay
coherent:

- **D-5. The upgraded backpack** is enabled by the `backpackUpgraded` flag, which no scenario
  enables today: the effective limit is 2 until a scenario uses it.
- **D-6. Communications in the panel**: during design the bandwidth is 0 and the resource
  shows as "critical" because there is no link window yet; during travel it reflects the real
  window of the chosen orbit.
- **D-7. An unanswered event stops the clock**, and at most two events fire per simulation
  step, so the game stays readable.
- **D-8. Language**: the UI uses neutral Spanish (not Rioplatense) and `en-US` / `es-AR` as
  `Intl` tags, so Spanish uses a decimal comma and a thousands dot.
- **D-9. Launcher cost**: it is deducted from the mission budget, so picking a more capable
  rocket takes money away from instruments. That is the DM-9 trade-off.
- **D-10. Score split**: 300 mission, 250 science, 150 efficiency, 150 decisions, 100
  survival, 50 collaboration (1000 total).
- **D-11. `data/data-bundle.js` is versioned on purpose**: without it, opening `index.html`
  with a double click would not work. It is regenerated with `npm run build:data` and a test
  verifies it stays in sync with the JSON.

## Verification

<!-- section: verification -->

- **Node suite**: `npm test` covers `core`, `mission`, `world`, `i18n`, key coverage and
  `storage`. It needs no browser and no dependencies.
- **Headless Chrome smoke** (`npm run smoke`): loads from `file://`, walks title → new mission
  → design (launcher, orbit, instrument, computer) → launch → travel with canvas, switches
  language live and checks there are no exceptions, console errors, raw keys or horizontal
  overflow.

What is **not** verified and deserves human eyes:

- 60 FPS with 4 players on a mid-range machine: headless throttles
  `requestAnimationFrame`, so the goal is a design goal (a single rAF, incremental repaint,
  per-room paths) rather than a measurement.
- Physical gamepad, screen readers and real legibility with text at 150 %.
- `localStorage` persistence across sessions under `file://`: it depends on the browser; if
  it blocks it, the store falls back to memory and reports it with a code.

## Documentation language

<!-- section: documentation-language -->

This repository is meant to be reviewed by an international institution, so the
repository-facing edition of the documentation is **English**. Nothing is discarded: the
Spanish originals live alongside it and both editions stay in sync, enforced by
`tests/docs-parity.test.js`.

| English (repository edition) | Spanish (normative original) |
| --- | --- |
| [README.md](README.md) | [README.es.md](README.es.md) |
| [REQUIREMENTS.md](REQUIREMENTS.md) | [REQUISITOS.md](REQUISITOS.md) |

Internal process artifacts stay in Spanish by decision of the author and are not normative for
reviewers: the work log under `odd/tasks/` (contracts, tasks and a dated log) and the design
system under `design/`. Code comments are in Spanish too, as the original specification
(§12, T-4) requires; translating them module by module is planned follow-up work, not a
pending defect.

## License

<!-- section: license -->

MIT.
