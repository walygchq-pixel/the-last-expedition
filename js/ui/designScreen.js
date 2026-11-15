/*
 * Fase 1: diseño de misión (DM-1 … DM-14).
 *
 * La pantalla no guarda estado propio: el diseño vive en `shell.state.design`,
 * así que cambiar de idioma o re-renderizar no pierde ninguna elección (I-2).
 * Cada cambio de pieza llama a `mission/design`, que recalcula los totales, y la
 * pantalla sólo vuelve a pintar las secciones derivadas: telemetría, lista
 * verificable y permiso de despegue (DM-5, DM-2, DM-11).
 *
 * La composición es un chasis de consola de nave: cabecera de instrumentación,
 * tres columnas densas con scroll propio y franja de autorización al pie. No usa
 * anchos fijos en píxeles: todo va en `rem` para que 100/125/150 % escale junto
 * (I-14, S82).
 */
(function (global, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(
      require('../mission/catalog.js'),
      require('../mission/design.js'),
      require('../storage/saves.js'),
      require('../storage/transfer.js')
    );
  } else {
    var GS = (global.GS = global.GS || {});
    GS.ui = GS.ui || {};
    GS.ui.designScreen = factory(GS.mission.catalog, GS.mission.design, GS.storage.saves, GS.storage.transfer);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (catalog, designModule, saves, transfer) {
  'use strict';

  // Iconos de recurso según `resources.ICONS` (C-6). Son símbolos neutros al
  // idioma: el nombre traducido va al lado, así que nunca dependen sólo del icono.
  var ICON_GLYPHS = {
    weight: '\u2696',
    bolt: '\u26A1',
    coin: '\u00A4',
    database: '\u25A4',
    antenna: '\u2301',
    clock: '\u25F7'
  };

  function percent(tr, value) {
    return tr.formatPercent(isFinite(value) ? value / 100 : 0, 0);
  }

  function pad2(value) {
    return value < 10 ? '0' + value : String(value);
  }

  /**
   * Pantalla completa de diseño. Devuelve `{id, node}` para el router.
   * @param {Object} ctx ayudantes y estado de `js/ui/shell`
   */
  function create(ctx) {
    var t = ctx.t;
    var tr = ctx.tr;
    var state = ctx.state;
    var design =
      state.design ||
      (state.design = designModule.createDesign({
        scenarioId: state.scenarioId,
        difficultyId: state.difficultyId,
        mode: state.mode
      }));

    var scenario = designModule.scenarioOf(design) || {};
    var objective = designModule.objectiveOf(design);
    var root = ctx.el('section', {
      id: 'design-screen',
      class: 'design-screen',
      'aria-label': t('design.title')
    });

    /* --- Ayudantes de formato ---------------------------------------- */

    function totalsOf() {
      return design.totals && design.totals.mass !== undefined ? design.totals : designModule.refresh(design);
    }

    function statsTooltip(part) {
      return t('design.part_stats', {
        mass: tr.formatUnit(part.mass || 0, 'unit.kg'),
        draw: tr.formatUnit(part.powerDraw || 0, 'unit.w'),
        generation: tr.formatUnit(part.powerGen || 0, 'unit.w'),
        cost: tr.formatUnit(part.cost || 0, 'unit.meur'),
        data: tr.formatUnit(part.dataRate || 0, 'unit.kb'),
        reliability: percent(tr, part.reliability)
      });
    }

    function instrumentStats(instrument) {
      return t('design.instrument_stats', {
        mass: tr.formatUnit(instrument.mass || 0, 'unit.kg'),
        power: tr.formatUnit(instrument.powerDraw || 0, 'unit.w'),
        cost: tr.formatUnit(instrument.cost || 0, 'unit.meur'),
        data: tr.formatUnit(instrument.dataRate || 0, 'unit.kb'),
        reliability: percent(tr, instrument.reliability)
      });
    }

    function scienceChips(instrument) {
      var wrap = ctx.el('div', { class: 'science-tags' });
      Object.keys(instrument.science || {}).forEach(function (tag) {
        wrap.appendChild(
          ctx.el('span', {
            class: 'chip',
            text: t('design.science_chip', {
              tag: t('science.tag.' + tag),
              value: instrument.science[tag]
            })
          })
        );
      });
      return wrap;
    }

    function partMetrics(part) {
      return (
        tr.formatUnit(part.mass || 0, 'unit.kg') +
        ' · ' +
        tr.formatUnit(part.cost || 0, 'unit.meur') +
        ' · ' +
        percent(tr, part.reliability)
      );
    }

    function launchState() {
      return designModule.validateLaunch(design);
    }

    /* --- Chasis y cabecera de estado --------------------------------- */

    // Tornillos del marco: decorativos, fuera del flujo de la rejilla.
    function buildScrews() {
      return ['tl', 'tr', 'bl', 'br'].map(function (corner) {
        return ctx.el('span', {
          class: 'console-screw console-screw--' + corner,
          'aria-hidden': 'true'
        });
      });
    }

    function buildObjective() {
      var box = ctx.el('div', {
        id: 'design-objective',
        class: 'console-objective',
        'data-tutorial': 'design-objective',
        tabindex: '0'
      });
      box.appendChild(ctx.el('span', { class: 'console-objective__label', text: t('design.objective') }));
      if (objective) {
        box.appendChild(ctx.el('strong', { class: 'console-objective__name', text: t(objective.nameKey) }));
      } else {
        box.appendChild(ctx.el('strong', { class: 'console-objective__name', text: t('common.none') }));
      }
      box.appendChild(
        ctx.el('span', {
          class: 'console-objective__meta',
          text: t('design.objective_meta', {
            critical: t('res.critical', { resource: t('res.' + (scenario.critical || 'power') + '.name') }),
            amount: tr.formatUnit(scenario.requiredData || 0, 'unit.kb')
          })
        })
      );
      // La descripción completa y el informe del escenario quedan a un foco o
      // un hover: la franja de estado muestra lo accionable y no se come el mazo.
      var details = [];
      if (objective) details.push(t(objective.descKey));
      if (scenario.briefKey) details.push(t(scenario.briefKey));
      if (details.length > 0) {
        ctx.tooltip(box, function () {
          return details.join(' ');
        });
      }
      return box;
    }

    function buildActions() {
      return ctx.el('div', { class: 'console-actions' }, [
        ctx.el('button', { type: 'button', class: 'console-action', text: t('common.save'), onclick: saveDesign }),
        ctx.el('button', { type: 'button', class: 'console-action', text: t('design.load'), onclick: toggleSaved }),
        ctx.el('button', { type: 'button', class: 'console-action', text: t('common.export'), onclick: exportDesign }),
        ctx.el('button', { type: 'button', class: 'console-action', text: t('common.import'), onclick: importDesign }),
        ctx.el('button', {
          type: 'button',
          class: 'console-action console-action--back',
          text: t('common.back'),
          onclick: function () {
            ctx.back();
          }
        })
      ]);
    }

    function buildHeader() {
      var totals = totalsOf();
      var launch = launchState();
      var head = ctx.el('header', { class: 'console-status' }, [
        ctx.el('div', { class: 'console-brand' }, [
          ctx.el('h1', { class: 'console-brand__name', text: t('app.title') }),
          ctx.el('span', { class: 'console-brand__unit', text: t('design.title') })
        ]),
        ctx.el('div', { class: 'console-mission__id' }, [
          ctx.el('strong', {
            class: 'console-scenario',
            text: t(scenario.nameKey || 'scenario.' + design.scenarioId + '.name')
          }),
          ctx.el('span', { class: 'console-chip', text: t('diff.' + design.difficultyId + '.name') }),
          ctx.el('span', { class: 'console-chip', text: t('mode.' + design.mode + '.name') })
        ]),
        ctx.el('div', { class: 'console-readouts' }, [
          ctx.el('div', { class: 'console-readout' }, [
            ctx.el('b', { text: t('design.phase_design') }),
            ctx.el('span', { text: t('design.phase') })
          ]),
          ctx.el('div', { class: 'console-readout' }, [
            ctx.el('b', { id: 'design-readout-mass', text: tr.formatUnit(totals.mass, 'unit.kg') }),
            ctx.el('span', { text: t('res.mass.name') })
          ]),
          ctx.el('div', { class: 'console-readout' }, [
            ctx.el('b', { text: tr.formatUnit(design.budget, 'unit.meur') }),
            ctx.el('span', { text: t('res.budget.name') })
          ]),
          ctx.el('div', { class: 'console-readout' }, [
            ctx.el('b', { id: 'design-readout-cost', text: tr.formatUnit(totals.cost, 'unit.meur') }),
            ctx.el('span', { text: t('design.cost') })
          ]),
          ctx.el('span', {
            id: 'design-readout-state',
            class: 'console-led ' + (launch.ok ? 'is-ready' : 'is-blocked'),
            text: t(launch.ok ? 'design.launch_ready' : 'design.launch_blocked')
          })
        ]),
        buildObjective(),
        buildActions()
      ]);
      return head;
    }

    /* --- Columna izquierda: 12 grupos con palanca simple/avanzada ---- */

    function buildParts() {
      var panel = ctx.el('section', {
        id: 'design-parts',
        class: 'console-panel console-panel--parts',
        'aria-labelledby': 'design-parts-title'
      });
      panel.appendChild(
        ctx.el('h2', { id: 'design-parts-title' }, [
          ctx.el('span', { text: t('design.parts') }),
          ctx.el('em', { text: pad2(catalog.partGroups().length) })
        ])
      );
      panel.appendChild(ctx.el('p', { class: 'console-hint', text: t('design.parts_hint') }));

      var rack = ctx.el('ol', { class: 'part-rack' });
      catalog.partGroups().forEach(function (group, index) {
        rack.appendChild(buildPartUnit(group, index));
      });
      panel.appendChild(rack);
      return panel;
    }

    function buildPartUnit(group, index) {
      var chosen = catalog.findPart(design.groups[group.id]);
      var unit = ctx.el('li', { class: 'part-unit', 'data-group': group.id });
      unit.appendChild(ctx.el('span', { class: 'part-unit__idx', 'aria-hidden': 'true', text: pad2(index + 1) }));
      unit.appendChild(
        ctx.el('span', { class: 'part-unit__what' }, [
          ctx.el('strong', { class: 'part-unit__name', text: t(group.nameKey) }),
          ctx.el('span', {
            class: 'part-unit__metrics',
            'data-part-metrics': group.id,
            text: chosen ? partMetrics(chosen) : t('common.none')
          })
        ])
      );

      var lever = ctx.el('span', {
        class: 'part-lever',
        role: 'group',
        'aria-label': t(group.nameKey)
      });
      catalog.partsForGroup(group.id).forEach(function (part) {
        var versionKey = part.version === 'advanced' ? 'design.advanced' : 'design.simple';
        var button = ctx.el('button', {
          type: 'button',
          class: 'console-switch',
          'data-group': group.id,
          'data-version': part.version,
          'data-tutorial': 'design-component',
          'aria-pressed': design.groups[group.id] === part.id ? 'true' : 'false',
          text: t(versionKey),
          onclick: function () {
            designModule.setPartVersion(design, group.id, part.version);
            syncSelections();
            refreshDerived();
          }
        });
        ctx.tooltip(button, function () {
          return t(group.descKey) + ' ' + t('design.part_tooltip', {
            stats: statsTooltip(part),
            description: t(part.descKey)
          });
        });
        lever.appendChild(button);
      });
      unit.appendChild(lever);
      return unit;
    }

    /* --- Columna central: mesa de instrumentos ----------------------- */

    function buildInstruments() {
      var panel = ctx.el('section', {
        class: 'console-panel console-panel--bench',
        'data-tutorial': 'design-instruments',
        'aria-labelledby': 'design-bench-title'
      });
      panel.appendChild(
        ctx.el('h2', { id: 'design-bench-title' }, [
          ctx.el('span', { text: t('design.instruments') }),
          ctx.el('em', { text: t('design.bench') + ' · ' + pad2(catalog.instrumentEntries().length) })
        ])
      );
      panel.appendChild(ctx.el('p', { class: 'console-hint', text: t('design.instruments_hint') }));

      var bench = ctx.el('div', { class: 'bench', role: 'list' });
      catalog.instrumentEntries().forEach(function (entry) {
        bench.appendChild(buildInstrumentRow(entry));
      });
      panel.appendChild(bench);
      return panel;
    }

    function buildInstrumentRow(entry) {
      var selected = designModule.instrumentVersion(design, entry.id);
      var data = selected ? entry.versions[selected] : null;
      var row = ctx.el('div', {
        class: 'bench-row' + (data ? ' is-on' : ''),
        'data-instrument': entry.id,
        role: 'listitem'
      });

      var ident = ctx.el('div', { class: 'bench-row__ident' }, [
        ctx.el('strong', { class: 'bench-row__name', text: t(entry.nameKey) }),
        ctx.el('span', { class: 'bench-row__desc', text: t(entry.descKey) })
      ]);
      row.appendChild(ident);

      var readout = ctx.el('div', { class: 'bench-row__readout' });
      if (data) {
        [
          tr.formatUnit(data.mass || 0, 'unit.kg'),
          tr.formatUnit(data.powerDraw || 0, 'unit.w'),
          tr.formatUnit(data.cost || 0, 'unit.meur'),
          tr.formatUnit(data.dataRate || 0, 'unit.kb'),
          percent(tr, data.reliability)
        ].forEach(function (text) {
          readout.appendChild(ctx.el('span', { text: text }));
        });
        readout.appendChild(scienceChips(data));
        ctx.tooltip(readout, function () {
          return instrumentStats(data);
        });
      } else {
        readout.appendChild(ctx.el('span', { class: 'faint', text: '\u2014' }));
      }
      row.appendChild(readout);

      var lever = ctx.el('span', {
        class: 'part-lever part-lever--instrument',
        role: 'group',
        'aria-label': t(entry.nameKey)
      });
      [
        { version: null, labelKey: 'common.none' },
        { version: 'simple', labelKey: 'design.simple' },
        { version: 'advanced', labelKey: 'design.advanced' }
      ].forEach(function (choice) {
        var button = ctx.el('button', {
          type: 'button',
          class: 'console-switch',
          'data-instrument-version': choice.version || 'none',
          'aria-pressed': (selected || null) === choice.version ? 'true' : 'false',
          text: t(choice.labelKey),
          onclick: function () {
            designModule.setInstrument(design, entry.id, choice.version);
            ctx.rerender();
          }
        });
        if (choice.version) {
          var versionData = entry.versions[choice.version];
          ctx.tooltip(button, function () {
            return instrumentStats(versionData);
          });
        }
        lever.appendChild(button);
      });
      row.appendChild(lever);
      return row;
    }

    /* --- Lanzador y órbita: selectores de consola -------------------- */

    function buildPicks() {
      return ctx.el('div', { class: 'console-pair' }, [buildLaunchers(), buildOrbits()]);
    }

    function buildLaunchers() {
      var panel = ctx.el('section', {
        class: 'console-panel console-panel--picker',
        'data-tutorial': 'design-launcher',
        'aria-labelledby': 'design-launcher-title'
      });
      panel.appendChild(
        ctx.el('h2', { id: 'design-launcher-title' }, [
          ctx.el('span', { text: t('design.launcher') }),
          ctx.el('em', { text: pad2(catalog.launchers().length) })
        ])
      );
      var list = ctx.el('ul', { class: 'console-pick-list' });
      catalog.launchers().forEach(function (launcher) {
        list.appendChild(
          ctx.el('li', null, [buildLauncherOption(launcher)])
        );
      });
      panel.appendChild(list);
      return panel;
    }

    function buildLauncherOption(launcher) {
      var selected = design.launcherId === launcher.id;
      var button = ctx.el('button', {
        type: 'button',
        class: 'console-pick' + (selected ? ' is-selected' : ''),
        'data-launcher': launcher.id,
        'aria-pressed': selected ? 'true' : 'false',
        onclick: function () {
          designModule.setLauncher(design, selected ? null : launcher.id);
          ctx.rerender();
        }
      }, [
        ctx.el('span', { class: 'console-pick__title' }, [
          ctx.el('strong', { text: t(launcher.nameKey) }),
          selected ? ctx.el('span', { class: 'console-pick__pick', text: t('design.selected') }) : null
        ]),
        ctx.el('span', { class: 'console-pick__desc', text: t(launcher.descKey) }),
        ctx.el('span', { class: 'console-pick__metrics' }, [
          ctx.el('span', { text: t('design.payload', { value: tr.formatUnit(launcher.payloadCapacity, 'unit.kg') }) }),
          ctx.el('span', { text: t('design.launch_cost', { value: tr.formatUnit(launcher.cost, 'unit.meur') }) }),
          ctx.el('span', { text: t('design.max_orbit', { rank: launcher.maxOrbitRank }) }),
          ctx.el('span', { text: t('design.reliability', { value: percent(tr, launcher.reliability) }) })
        ])
      ]);
      return button;
    }

    function buildOrbits() {
      var panel = ctx.el('section', {
        class: 'console-panel console-panel--picker',
        'data-tutorial': 'design-orbit',
        'aria-labelledby': 'design-orbit-title'
      });
      panel.appendChild(
        ctx.el('h2', { id: 'design-orbit-title' }, [
          ctx.el('span', { text: t('design.orbit') }),
          ctx.el('em', { text: pad2(catalog.orbits().length) })
        ])
      );
      var list = ctx.el('ul', { class: 'console-pick-list' });
      catalog.orbits().forEach(function (orbit) {
        list.appendChild(ctx.el('li', null, [buildOrbitOption(orbit)]));
      });
      panel.appendChild(list);
      return panel;
    }

    function buildOrbitOption(orbit) {
      var selected = design.orbitId === orbit.id;
      var metrics = [
        ctx.el('span', { text: t('design.coverage', { value: tr.formatPercent(orbit.coverage, 0) }) }),
        ctx.el('span', { text: t('design.radiation', { value: tr.formatPercent(orbit.radiation, 0) }) }),
        ctx.el('span', { text: t('design.eclipse', { value: tr.formatPercent(orbit.eclipseFraction, 0) }) }),
        ctx.el('span', {
          text: t('design.comms_window', {
            minutes:
              orbit.comms && orbit.comms.continuous
                ? t('design.continuous')
                : (orbit.comms && orbit.comms.windowMinutes) || 0
          })
        })
      ];
      if (orbit.comms && isFinite(orbit.comms.bandwidthFactor)) {
        metrics.push(
          ctx.el('span', {
            text: t('design.bandwidth', { value: tr.formatPercent(orbit.comms.bandwidthFactor, 0) })
          })
        );
      }
      return ctx.el('button', {
        type: 'button',
        class: 'console-pick' + (selected ? ' is-selected' : ''),
        'data-orbit': orbit.id,
        'aria-pressed': selected ? 'true' : 'false',
        onclick: function () {
          designModule.setOrbit(design, selected ? null : orbit.id);
          ctx.rerender();
        }
      }, [
        ctx.el('span', { class: 'console-pick__title' }, [
          ctx.el('strong', { text: t(orbit.nameKey) }),
          selected ? ctx.el('span', { class: 'console-pick__pick', text: t('design.selected') }) : null
        ]),
        ctx.el('span', { class: 'console-pick__desc', text: t(orbit.descKey) }),
        ctx.el('span', { class: 'console-pick__metrics' }, metrics)
      ]);
    }

    /* --- Columna derecha: telemetría -------------------------------- */

    function buildTelemetry() {
      var panel = ctx.el('section', {
        id: 'design-resources',
        class: 'console-panel console-panel--telemetry',
        'aria-labelledby': 'design-resources-title'
      });
      panel.appendChild(
        ctx.el('h2', { id: 'design-resources-title' }, [
          ctx.el('span', { text: t('design.telemetry') }),
          ctx.el('em', { text: t('design.resources') })
        ])
      );
      var impact = designModule.liveImpact(design);
      panel.appendChild(buildResources(impact));
      panel.appendChild(buildGauges(impact));
      return panel;
    }

    function buildResources(impact) {
      var panel = impact.panel;
      var criticalItem = panel.items.filter(function (item) {
        return item.id === panel.critical;
      })[0];
      var wrap = ctx.el('div', { class: 'console-resources' });
      wrap.appendChild(
        ctx.el('p', { class: 'console-critical' }, [
          ctx.el('span', {
            class:
              'shape shape--' +
              (criticalItem ? criticalItem.shape : 'diamond') +
              ' status--' +
              (criticalItem ? criticalItem.status : 'warn'),
            'aria-hidden': 'true'
          }),
          ctx.el('span', {
            text: t('res.critical', { resource: t('res.' + panel.critical + '.name') })
          })
        ])
      );

      var list = ctx.el('ul', { class: 'res-list' });
      panel.items.forEach(function (item) {
        var trackClass = 'res-item__track is-' + item.status;
        var box = ctx.el('li', {
          class:
            'res-item status--' + item.status +
            (panel.critical === item.id ? ' is-critical-res' : '') +
            (panel.worst === item.id ? ' is-worst' : ''),
          'data-resource': item.id
        });
        box.appendChild(
          ctx.el('span', { class: 'shape shape--' + item.shape + ' status--' + item.status, 'aria-hidden': 'true' })
        );
        box.appendChild(
          ctx.el('span', { class: 'icon-glyph', 'aria-hidden': 'true', text: ICON_GLYPHS[item.icon] || '' })
        );
        box.appendChild(ctx.el('span', { class: 'res-item__name', text: t('res.' + item.id + '.name') }));
        var valueText = tr.formatUnit(item.value, item.unit || 'unit.pct');
        if (item.max > 0 && item.id !== 'comms' && item.unit !== 'unit.pct') {
          valueText += ' / ' + tr.formatUnit(item.max, item.unit);
        }
        box.appendChild(
          ctx.el('span', {
            class: 'res-item__value',
            text: valueText
          })
        );
        box.appendChild(
          ctx.el('span', {
            class: 'res-item__status status--' + item.status,
            text: t('res.status.' + item.status)
          })
        );
        var track = ctx.el('span', { class: trackClass, 'aria-hidden': 'true' });
        track.appendChild(
          ctx.el('span', {
            style: 'width: ' + Math.round(Math.max(0, Math.min(1, item.ratio)) * 100) + '%'
          })
        );
        box.appendChild(track);
        ctx.tooltip(box, function () {
          return t('res.' + item.id + '.desc');
        });
        list.appendChild(box);
      });
      wrap.appendChild(list);
      return wrap;
    }

    function buildGauges(impact) {
      var totals = impact.totals;
      var launcher = impact.launcher;
      var grid = ctx.el('div', { class: 'console-gauges' });

      var budgetRatio = design.budget > 0 ? totals.cost / design.budget : 0;
      grid.appendChild(
        ctx.el('div', { class: 'console-gauge', 'data-tutorial': 'design-budget' }, [
          ctx.el('span', { text: t('res.budget.name') }),
          ctx.el('b', { text: t('req.budget', { have: totals.cost, need: design.budget }) }),
          gaugeBar(budgetRatio, budgetRatio > 1 ? 'is-critical' : budgetRatio > 0.9 ? 'is-warn' : '')
        ])
      );

      var massRatio = launcher && launcher.payloadCapacity > 0 ? totals.mass / launcher.payloadCapacity : 0;
      grid.appendChild(
        ctx.el('div', { class: 'console-gauge' }, [
          ctx.el('span', { text: t('res.mass.name') }),
          ctx.el('b', { text: t('req.mass', { have: totals.mass, need: launcher ? launcher.payloadCapacity : 0 }) }),
          gaugeBar(massRatio, massRatio > 1 ? 'is-critical' : massRatio > 0.9 ? 'is-warn' : '')
        ])
      );

      var powerRatio = totals.powerGen > 0 ? (totals.powerGen - totals.powerDraw) / totals.powerGen : 0;
      grid.appendChild(
        ctx.el('div', { class: 'console-gauge' }, [
          ctx.el('span', { text: t('res.power.name') }),
          ctx.el('b', { text: t('req.power', { have: totals.powerGen, need: totals.powerDraw }) }),
          gaugeBar(powerRatio, powerRatio < 0 ? 'is-critical' : powerRatio < 0.1 ? 'is-warn' : '')
        ])
      );
      return grid;
    }

    function gaugeBar(ratio, stateClass) {
      var bar = ctx.el('span', { class: 'bar ' + (stateClass || ''), 'aria-hidden': 'true' });
      bar.appendChild(
        ctx.el('span', {
          style: 'width: ' + Math.round(Math.max(0, Math.min(1, isFinite(ratio) ? ratio : 0)) * 100) + '%'
        })
      );
      return bar;
    }

    function totalsRows() {
      var totals = totalsOf();
      return [
        { key: 'mass', label: 'res.mass.name', value: tr.formatUnit(totals.mass, 'unit.kg') },
        { key: 'power', label: 'res.power.name', value: tr.formatUnit(totals.powerDraw, 'unit.w') },
        { key: 'cost', label: 'res.budget.name', value: tr.formatUnit(totals.cost, 'unit.meur') },
        { key: 'dataRate', label: 'design.data_rate', value: tr.formatUnit(totals.dataRate, 'unit.kb') },
        { key: 'dataCapacity', label: 'design.data_capacity', value: tr.formatUnit(totals.dataCapacity, 'unit.kb') },
        { key: 'partCount', label: 'design.part_count', value: tr.formatNumber(totals.partCount) },
        { key: 'instrumentCount', label: 'design.instrument_count', value: tr.formatNumber(totals.instrumentCount) }
      ];
    }

    function buildTotals() {
      var box = ctx.el('div', { class: 'design-totals' });
      totalsRows().forEach(function (row) {
        box.appendChild(
          ctx.el('div', null, [
            ctx.el('div', { class: 'faint', text: t(row.label) }),
            ctx.el('div', { 'data-total': row.key, text: row.value })
          ])
        );
      });
      return box;
    }

    function buildTotalsPanel() {
      return ctx.el(
        'section',
        { class: 'console-panel console-panel--totals', 'aria-label': t('design.resources') },
        [buildTotals()]
      );
    }

    function buildRequirementsPanel() {
      var panel = ctx.el('section', {
        id: 'design-requirements',
        class: 'console-panel console-panel--check',
        'aria-labelledby': 'design-requirements-title'
      });
      panel.appendChild(
        ctx.el('h2', { id: 'design-requirements-title' }, [
          ctx.el('span', { text: t('design.requirements') }),
          ctx.el('em', { text: '✔ / ✘' })
        ])
      );
      panel.appendChild(buildRequirements());
      return panel;
    }

    function buildRequirements() {
      var list = ctx.el('ul', { class: 'requirements' });
      designModule.getRequirements(design).forEach(function (check) {
        var item = ctx.el('li', { class: check.ok ? 'is-met' : 'is-unmet' }, [
          ctx.el('span', {
            class: 'req-mark',
            text: check.ok ? '\u2714' : '\u2718',
            'aria-label': t(check.ok ? 'design.req_met' : 'design.req_unmet'),
            role: 'img'
          }),
          ctx.el('span', { text: t(check.labelKey, check.params) })
        ]);
        list.appendChild(item);
      });
      return list;
    }

    /* --- Franja de autorización de lanzamiento ----------------------- */

    function buildLaunch() {
      var launch = launchState();
      var checks = launch.checks || [];
      var done = checks.filter(function (check) {
        return check.ok;
      }).length;

      var permit = ctx.el('footer', {
        id: 'design-launch',
        class: 'console-permit ' + (launch.ok ? 'is-ready' : 'is-blocked'),
        'data-tutorial': 'design-launch',
        'aria-label': t('design.permit')
      });

      var verdict = ctx.el('div', { class: 'permit-verdict' });
      verdict.appendChild(
        ctx.el('h2', null, [
          ctx.el('span', { text: t('design.permit') }),
          ctx.el('em', { text: launch.ok ? t('design.launch_ready') : t('design.launch_blocked') })
        ])
      );
      if (launch.blockers.length > 0) {
        // Varios requisitos científicos pueden fallar por el mismo motivo: la
        // franja muestra el motivo una sola vez y deja el detalle en la lista.
        var seenCodes = {};
        var reasons = launch.blockers.filter(function (blocker) {
          if (seenCodes[blocker.code]) return false;
          seenCodes[blocker.code] = true;
          return true;
        });
        var blockers = ctx.el('ul', { class: 'blocker-list', id: 'design-blockers' });
        reasons.forEach(function (blocker) {
          blockers.appendChild(ctx.el('li', { text: t(blocker.code, blocker.params) }));
        });
        verdict.appendChild(ctx.el('h3', { text: t('design.blockers_title') }));
        verdict.appendChild(blockers);

        var seen = {};
        var fixes = ctx.el('ul', { class: 'fix-list' });
        launch.blockers.forEach(function (blocker) {
          if (!blocker.fixKey || seen[blocker.fixKey]) return;
          seen[blocker.fixKey] = true;
          fixes.appendChild(ctx.el('li', { text: t(blocker.fixKey) }));
        });
        if (fixes.childNodes.length > 0) {
          verdict.appendChild(ctx.el('h3', { text: t('design.fixes_title') }));
          verdict.appendChild(fixes);
        }
      } else {
        verdict.appendChild(ctx.el('p', { class: 'permit-ok', text: t('design.launch_ready') }));
      }
      if (launch.warnings.length > 0) {
        var warnings = ctx.el('ul', { class: 'warning-list' });
        launch.warnings.forEach(function (warning) {
          warnings.appendChild(ctx.el('li', { text: t(warning.code, warning.params) }));
        });
        verdict.appendChild(ctx.el('h3', { text: t('design.warnings_title') }));
        verdict.appendChild(warnings);
      }
      verdict.appendChild(
        ctx.el('p', {
          class: 'permit-note',
          text: t('design.checklist_count', { done: done, total: checks.length })
        })
      );
      permit.appendChild(verdict);

      var action = ctx.el('div', { class: 'permit-action' });
      action.appendChild(
        ctx.el('span', {
          class: 'console-stamp',
          role: 'img',
          'aria-label': launch.ok ? t('design.stamp_authorized') : t('design.stamp_blocked'),
          text: launch.ok ? t('design.stamp_authorized') : t('design.stamp_blocked')
        })
      );
      var reason = !launch.ok
        ? launch.blockers.length > 0
          ? t(launch.blockers[0].code, launch.blockers[0].params)
          : t('design.launch_blocked')
        : t('design.launch_ready');
      var launchButton = ctx.el('button', {
        type: 'button',
        class: 'permit-switch',
        disabled: !launch.ok,
        'aria-describedby': launch.ok ? null : 'design-blockers',
        onclick: function () {
          if (!designModule.validateLaunch(design).ok) return;
          if (typeof ctx.startTravel === 'function') {
            ctx.startTravel(design);
          }
        }
      }, [
        ctx.el('b', { text: t('design.launch') }),
        ctx.el('span', { text: reason })
      ]);
      action.appendChild(launchButton);
      permit.appendChild(action);
      return permit;
    }

    /* --- Panel de diseños guardados ---------------------------------- */

    function buildSavedPanel() {
      var box = ctx.el('div', { class: 'saved-list' });
      var entries = saves.listDesigns();
      if (entries.length === 0) {
        box.appendChild(ctx.el('p', { class: 'muted', text: t('design.none_saved') }));
        return box;
      }
      entries.forEach(function (entry) {
        var row = ctx.el('div', { class: 'saved-row' }, [
          ctx.el('span', {
            text: t('design.saved_entry', {
              scenario: t('scenario.' + entry.scenarioId + '.name'),
              difficulty: t('diff.' + entry.difficultyId + '.name'),
              date: tr.formatDate(entry.savedAt)
            })
          }),
          ctx.el('button', {
            type: 'button',
            class: 'console-action',
            text: t('common.load'),
            onclick: function () {
              loadDesign(entry.id);
            }
          }),
          ctx.el('button', {
            type: 'button',
            class: 'console-action console-action--danger',
            text: t('common.delete'),
            onclick: function () {
              saves.removeDesign(entry.id);
              toggleSaved(true);
            }
          })
        ]);
        box.appendChild(row);
      });
      return box;
    }

    function toggleSaved(forceOpen) {
      var existing = ctx.doc.getElementById('design-saved');
      if (existing && !forceOpen) {
        existing.parentNode.removeChild(existing);
        return;
      }
      if (existing) existing.parentNode.removeChild(existing);
      var panel = ctx.el('section', { id: 'design-saved', class: 'console-panel console-panel--saved' }, [
        ctx.el('h2', null, [
          ctx.el('span', { text: t('design.saved_title') }),
          ctx.el('em', { text: t('common.load') })
        ]),
        buildSavedPanel()
      ]);
      var host = root.querySelector('.console-col--parts') || root;
      host.appendChild(panel);
    }

    /* --- Persistencia y exportación ---------------------------------- */

    function saveDesign() {
      var result = saves.saveDesign(design);
      ctx.toast({ code: result.ok ? 'save.design_saved' : result.code || 'save.quota', severity: result.ok ? 'info' : 'warn' });
      if (result.ok) toggleSaved(true);
    }

    function loadDesign(id) {
      var payload = saves.loadDesign(id);
      if (!payload) {
        ctx.toast({ code: 'save.not_found', severity: 'warn' });
        return;
      }
      state.design = designModule.deserialize(payload.design);
      ctx.rerender();
    }

    function exportDesign() {
      var text = transfer.exportJson(transfer.KIND.DESIGN, designModule.serialize(design));
      var ok = transfer.download(transfer.filenameFor('design', design.scenarioId), text);
      if (ok) ctx.toast({ code: 'save.exported' });
    }

    function importDesign() {
      var input = ctx.el('input', { type: 'file', accept: '.json,application/json', hidden: true });
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        if (!file) return;
        transfer.readFile(file).then(function (text) {
          var parsed = transfer.importJson(text);
          if (!parsed.ok) {
            ctx.toast({ code: parsed.code, params: parsed.params, severity: 'warn' });
            return;
          }
          if (parsed.kind !== transfer.KIND.DESIGN) {
            ctx.toast({ code: 'import.wrong_kind', severity: 'warn' });
            return;
          }
          state.design = designModule.deserialize(parsed.data);
          ctx.rerender();
          ctx.toast({ code: 'save.design_imported' });
        });
      });
      ctx.doc.body.appendChild(input);
      input.click();
      ctx.doc.body.removeChild(input);
    }

    /* --- Sincronización de estado visual ----------------------------- */

    // Actualiza las palancas y sus cifras sin reconstruir la pantalla, para no
    // perder la posición de scroll ni el foco dentro de la columna (S5).
    function syncSelections() {
      Array.prototype.forEach.call(root.querySelectorAll('[data-group][data-version]'), function (button) {
        var groupId = button.getAttribute('data-group');
        var version = button.getAttribute('data-version');
        if (!groupId || !version) return;
        var selected = catalog.partsForGroup(groupId).find(function (part) {
          return part.id === design.groups[groupId];
        });
        button.setAttribute('aria-pressed', selected && selected.version === version ? 'true' : 'false');
      });
      Array.prototype.forEach.call(root.querySelectorAll('[data-part-metrics]'), function (node) {
        var part = catalog.findPart(design.groups[node.getAttribute('data-part-metrics')]);
        node.textContent = part ? partMetrics(part) : t('common.none');
      });
      Array.prototype.forEach.call(root.querySelectorAll('[data-total]'), function (node) {
        var key = node.getAttribute('data-total');
        totalsRows().forEach(function (row) {
          if (row.key === key) node.textContent = row.value;
        });
      });
      var totals = totalsOf();
      var mass = root.querySelector('#design-readout-mass');
      var cost = root.querySelector('#design-readout-cost');
      var stateBox = root.querySelector('#design-readout-state');
      if (mass) mass.textContent = tr.formatUnit(totals.mass, 'unit.kg');
      if (cost) cost.textContent = tr.formatUnit(totals.cost, 'unit.meur');
      if (stateBox) {
        var ok = designModule.validateLaunch(design).ok;
        stateBox.textContent = t(ok ? 'design.launch_ready' : 'design.launch_blocked');
        stateBox.className = 'console-led ' + (ok ? 'is-ready' : 'is-blocked');
      }
    }

    // Reemplaza solo un panel derivado, conservando su identificador para
    // `aria-describedby` y sin reconstruir toda la pantalla (DM-5).
    function replaceSection(ref, build) {
      var current = root.querySelector('#' + ref);
      if (!current) return;
      current.parentNode.replaceChild(build(), current);
    }

    function refreshDerived() {
      replaceSection('design-requirements', buildRequirementsPanel);
      replaceSection('design-resources', buildTelemetry);
      replaceSection('design-launch', buildLaunch);
    }

    /* --- Montaje ----------------------------------------------------- */

    var deck = ctx.el('main', { class: 'console-deck' }, [
      ctx.el('aside', { class: 'console-col console-col--parts', 'aria-label': t('design.parts') }, [buildParts()]),
      ctx.el('div', { class: 'console-col console-col--center', 'aria-label': t('design.bench') }, [
        buildInstruments(),
        buildPicks(),
        buildTotalsPanel()
      ]),
      ctx.el('aside', { class: 'console-col console-col--telemetry', 'aria-label': t('design.telemetry') }, [
        buildTelemetry(),
        buildRequirementsPanel()
      ])
    ]);

    buildScrews().forEach(function (screw) {
      root.appendChild(screw);
    });
    root.appendChild(buildHeader());
    root.appendChild(deck);
    root.appendChild(buildLaunch());

    return { id: 'design', node: root };
  }

  return { create: create, ICON_GLYPHS: ICON_GLYPHS };
});
