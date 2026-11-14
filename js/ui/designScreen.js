/*
 * Fase 1: diseño de misión (DM-1 … DM-14).
 *
 * La pantalla no guarda estado propio: el diseño vive en `shell.state.design`,
 * así que cambiar de idioma o re-renderizar no pierde ninguna elección (I-2).
 * Cada cambio de pieza llama a `mission/design`, que recalcula los totales, y la
 * pantalla sólo vuelve a pintar las secciones derivadas: recursos, lista
 * verificable y panel de lanzamiento (DM-5, DM-2, DM-11).
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
          ctx.el('span', { class: 'chip', text: t('design.science_chip', { tag: t('science.tag.' + tag), value: instrument.science[tag] }) })
        );
      });
      return wrap;
    }

    /* --- Cabecera y objetivo ----------------------------------------- */

    function buildHeader() {
      var head = ctx.el('div', { class: 'design-header' });
      var titles = ctx.el('div', { class: 'stack' }, [
        ctx.el('h1', { text: t('design.title') }),
        ctx.el('div', { class: 'row tight' }, [
          ctx.el('span', { class: 'badge', text: t(scenario.nameKey || 'scenario.' + design.scenarioId + '.name') }),
          ctx.el('span', { class: 'badge', text: t('diff.' + design.difficultyId + '.name') }),
          ctx.el('span', { class: 'badge', text: t('mode.' + design.mode + '.name') }),
          ctx.el('span', { class: 'badge', text: t('design.budget_badge', { budget: tr.formatUnit(design.budget, 'unit.meur') }) })
        ])
      ]);
      var actions = ctx.el('div', { class: 'row tight' }, [
        ctx.el('button', { type: 'button', text: t('common.save'), onclick: saveDesign }),
        ctx.el('button', { type: 'button', text: t('design.load'), onclick: toggleSaved }),
        ctx.el('button', { type: 'button', text: t('common.export'), onclick: exportDesign }),
        ctx.el('button', { type: 'button', text: t('common.import'), onclick: importDesign }),
        ctx.el('button', {
          type: 'button',
          class: 'ghost',
          text: t('common.back'),
          onclick: function () {
            ctx.back();
          }
        })
      ]);
      head.appendChild(titles);
      head.appendChild(actions);
      return head;
    }

    function buildObjective() {
      var card = ctx.el('article', { id: 'design-objective', class: 'card objective-card' }, [
        ctx.el('h2', { text: t('design.objective') })
      ]);
      if (objective) {
        card.appendChild(ctx.el('h3', { text: t(objective.nameKey) }));
        card.appendChild(ctx.el('p', { text: t(objective.descKey) }));
      } else {
        card.appendChild(ctx.el('p', { class: 'muted', text: t('common.none') }));
      }
      if (scenario.briefKey) card.appendChild(ctx.el('p', { class: 'brief', text: t(scenario.briefKey) }));
      card.appendChild(
        ctx.el('p', {
          class: 'faint',
          text: t('design.objective_meta', {
            critical: t('res.critical', { resource: t('res.' + (scenario.critical || 'power') + '.name') }),
            amount: tr.formatUnit(scenario.requiredData || 0, 'unit.kb')
          })
        })
      );
      return card;
    }

    /* --- Componentes e instrumentos ---------------------------------- */

    function buildParts() {
      var card = ctx.el('section', { id: 'design-parts', class: 'card' }, [
        ctx.el('h2', { text: t('design.parts') }),
        ctx.el('p', { class: 'faint', text: t('design.parts_hint') })
      ]);
      var groups = ctx.el('div', { class: 'part-groups' });
      catalog.partGroups().forEach(function (group) {
        var box = ctx.el('div', { class: 'part-group', 'data-group': group.id });
        var head = ctx.el('div', { class: 'part-group__head' }, [
          ctx.el('strong', { text: t(group.nameKey) })
        ]);
        box.appendChild(head);
        box.appendChild(ctx.el('p', { class: 'part-group__desc', text: t(group.descKey) }));
        var toggle = ctx.el('div', { class: 'version-toggle' });
        catalog.partsForGroup(group.id).forEach(function (part) {
          var button = ctx.el('button', {
            type: 'button',
            'data-group': group.id,
            'data-version': part.version,
            'aria-pressed': design.groups[group.id] === part.id ? 'true' : 'false',
            text: t('design.part_option', {
              name: t(part.nameKey),
              version: t(part.version === 'advanced' ? 'design.advanced' : 'design.simple')
            }),
            onclick: function () {
              designModule.setPartVersion(design, group.id, part.version);
              syncSelections();
              refreshDerived();
            }
          });
          ctx.tooltip(button, function () {
            return t('design.part_tooltip', { stats: statsTooltip(part), description: t(part.descKey) });
          });
          toggle.appendChild(button);
        });
        box.appendChild(toggle);
        groups.appendChild(box);
      });
      card.appendChild(groups);
      return card;
    }

    function buildInstruments() {
      var card = ctx.el('section', { class: 'card' }, [
        ctx.el('h2', { text: t('design.instruments') }),
        ctx.el('p', { class: 'faint', text: t('design.instruments_hint') })
      ]);
      var list = ctx.el('div', { class: 'instrument-list' });
      catalog.instrumentEntries().forEach(function (entry) {
        var cardBox = ctx.el('div', { class: 'instrument-card', 'data-instrument': entry.id });
        cardBox.appendChild(ctx.el('strong', { text: t(entry.nameKey) }));
        cardBox.appendChild(ctx.el('p', { class: 'faint', text: t(entry.descKey) }));
        var selected = designModule.instrumentVersion(design, entry.id);
        cardBox.classList.toggle('is-on', !!selected);
        var choices = ctx.el('div', { class: 'version-toggle' });
        [
          { version: null, labelKey: 'common.none' },
          { version: 'simple', labelKey: 'design.simple' },
          { version: 'advanced', labelKey: 'design.advanced' }
        ].forEach(function (choice) {
          var button = ctx.el('button', {
            type: 'button',
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
          choices.appendChild(button);
        });
        cardBox.appendChild(choices);
        if (selected && entry.versions[selected]) cardBox.appendChild(scienceChips(entry.versions[selected]));
        list.appendChild(cardBox);
      });
      card.appendChild(list);
      return card;
    }

    /* --- Lanzador y órbita ------------------------------------------- */

    function buildLaunchers() {
      var card = ctx.el('section', { class: 'card' }, [ctx.el('h2', { text: t('design.launcher') })]);
      var list = ctx.el('div', { class: 'launcher-list' });
      catalog.launchers().forEach(function (launcher) {
        var selected = design.launcherId === launcher.id;
        var button = ctx.el('button', {
          type: 'button',
          class: 'launcher-card' + (selected ? ' is-selected' : ''),
          'aria-pressed': selected ? 'true' : 'false',
          onclick: function () {
            designModule.setLauncher(design, selected ? null : launcher.id);
            ctx.rerender();
          }
        }, [
          ctx.el('strong', { text: t(launcher.nameKey) }),
          ctx.el('span', { class: 'part-group__desc', text: t(launcher.descKey) }),
          ctx.el('span', { class: 'meta' }, [
            ctx.el('span', { text: t('design.payload', { value: tr.formatUnit(launcher.payloadCapacity, 'unit.kg') }) }),
            ctx.el('span', { text: t('design.launch_cost', { value: tr.formatUnit(launcher.cost, 'unit.meur') }) }),
            ctx.el('span', { text: t('design.max_orbit', { rank: launcher.maxOrbitRank }) })
          ])
        ]);
        list.appendChild(button);
      });
      card.appendChild(list);
      return card;
    }

    function buildOrbits() {
      var card = ctx.el('section', { class: 'card' }, [ctx.el('h2', { text: t('design.orbit') })]);
      var list = ctx.el('div', { class: 'orbit-list' });
      catalog.orbits().forEach(function (orbit) {
        var selected = design.orbitId === orbit.id;
        var button = ctx.el('button', {
          type: 'button',
          class: 'orbit-card' + (selected ? ' is-selected' : ''),
          'aria-pressed': selected ? 'true' : 'false',
          onclick: function () {
            designModule.setOrbit(design, selected ? null : orbit.id);
            ctx.rerender();
          }
        }, [
          ctx.el('strong', { text: t(orbit.nameKey) }),
          ctx.el('span', { class: 'part-group__desc', text: t(orbit.descKey) }),
          ctx.el('span', { class: 'meta' }, [
            ctx.el('span', { text: t('design.coverage', { value: tr.formatPercent(orbit.coverage, 0) }) }),
            ctx.el('span', { text: t('design.radiation', { value: tr.formatPercent(orbit.radiation, 0) }) }),
            ctx.el('span', { text: t('design.eclipse', { value: tr.formatPercent(orbit.eclipseFraction, 0) }) }),
            ctx.el('span', {
              text: t('design.comms_window', {
                minutes: orbit.comms && orbit.comms.continuous ? t('design.continuous') : (orbit.comms && orbit.comms.windowMinutes) || 0
              })
            })
          ])
        ]);
        list.appendChild(button);
      });
      card.appendChild(list);
      return card;
    }

    /* --- Lista verificable y recursos en vivo ------------------------ */

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

    function resourceValue(item) {
      return tr.formatUnit(item.value, item.unit || 'unit.pct');
    }

    function buildResources() {
      var impact = designModule.liveImpact(design);
      var panel = impact.panel;
      var wrap = ctx.el('div', { class: 'stack' });
      var grid = ctx.el('div', { class: 'resource-panel' });
      panel.items.forEach(function (item) {
        var box = ctx.el('div', {
          class: 'resource-item' + (panel.critical === item.id ? ' is-critical-resource' : '') + (panel.worst === item.id ? ' is-worst' : ''),
          'data-resource': item.id
        });
        var shapeClass = 'shape shape--' + item.shape + ' status--' + item.status;
        var head = ctx.el('div', { class: 'resource-item__head' }, [
          ctx.el('span', { class: shapeClass, 'aria-hidden': 'true' }),
          ctx.el('span', { class: 'icon-glyph', 'aria-hidden': 'true', text: ICON_GLYPHS[item.icon] || '' }),
          ctx.el('span', { class: 'resource-item__name', text: t('res.' + item.id + '.name') })
        ]);
        box.appendChild(head);
        box.appendChild(ctx.el('span', { class: 'resource-item__value', text: resourceValue(item) }));
        box.appendChild(
          ctx.el('span', {
            class: 'resource-item__status status--' + item.status,
            text: t('res.status.' + item.status)
          })
        );
        ctx.tooltip(box, function () {
          return t('res.' + item.id + '.desc');
        });
        grid.appendChild(box);
      });
      wrap.appendChild(grid);
      wrap.appendChild(
        ctx.el('p', { class: 'faint', text: t('res.critical', { resource: t('res.' + panel.critical + '.name') }) })
      );
      return wrap;
    }

    function buildTotals() {
      var totals = design.totals || designModule.refresh(design);
      var box = ctx.el('div', { class: 'design-totals' });
      [
        { label: 'res.mass.name', value: tr.formatUnit(totals.mass, 'unit.kg') },
        { label: 'res.power.name', value: tr.formatUnit(totals.powerDraw, 'unit.w') },
        { label: 'res.budget.name', value: tr.formatUnit(totals.cost, 'unit.meur') },
        { label: 'design.data_rate', value: tr.formatUnit(totals.dataRate, 'unit.kb') },
        { label: 'design.data_capacity', value: tr.formatUnit(totals.dataCapacity, 'unit.kb') },
        { label: 'design.part_count', value: tr.formatNumber(totals.partCount) },
        { label: 'design.instrument_count', value: tr.formatNumber(totals.instrumentCount) }
      ].forEach(function (row) {
        box.appendChild(ctx.el('div', null, [ctx.el('div', { class: 'faint', text: t(row.label) }), ctx.el('div', { text: row.value })]));
      });
      return box;
    }

    function buildLaunch() {
      var launch = designModule.validateLaunch(design);
      var panel = ctx.el('section', {
        id: 'design-launch',
        class: 'card launch-panel ' + (launch.ok ? 'is-ready' : 'is-blocked')
      });
      panel.appendChild(ctx.el('h2', { text: launch.ok ? t('design.launch_ready') : t('design.launch_blocked') }));
      if (launch.blockers.length > 0) {
        var blockers = ctx.el('ul', { class: 'blocker-list', id: 'design-blockers' });
        launch.blockers.forEach(function (blocker) {
          blockers.appendChild(ctx.el('li', { text: t(blocker.code, blocker.params) }));
        });
        panel.appendChild(ctx.el('h3', { text: t('design.blockers_title') }));
        panel.appendChild(blockers);

        var seen = {};
        var fixes = ctx.el('ul', { class: 'fix-list' });
        launch.blockers.forEach(function (blocker) {
          if (!blocker.fixKey || seen[blocker.fixKey]) return;
          seen[blocker.fixKey] = true;
          fixes.appendChild(ctx.el('li', { text: t(blocker.fixKey) }));
        });
        if (fixes.childNodes.length > 0) {
          panel.appendChild(ctx.el('h3', { text: t('design.fixes_title') }));
          panel.appendChild(fixes);
        }
      }
      if (launch.warnings.length > 0) {
        var warnings = ctx.el('ul', { class: 'warning-list' });
        launch.warnings.forEach(function (warning) {
          warnings.appendChild(ctx.el('li', { text: t(warning.code, warning.params) }));
        });
        panel.appendChild(ctx.el('h3', { text: t('design.warnings_title') }));
        panel.appendChild(warnings);
      }
      var launchButton = ctx.el('button', {
        type: 'button',
        class: 'primary',
        text: t('design.launch'),
        disabled: !launch.ok,
        'aria-describedby': launch.ok ? null : 'design-blockers',
        onclick: function () {
          if (!designModule.validateLaunch(design).ok) return;
          if (typeof ctx.startTravel === 'function') {
            ctx.startTravel(design);
          }
        }
      });
      panel.appendChild(ctx.el('div', { class: 'row' }, [launchButton]));
      return panel;
    }

    function buildSavedPanel() {
      var box = ctx.el('div', { class: 'saved-list' });
      var entries = saves.listDesigns();
      if (entries.length === 0) {
        box.appendChild(ctx.el('p', { class: 'muted', text: t('design.none_saved') }));
        return box;
      }
      entries.forEach(function (entry) {
        var row = ctx.el('div', { class: 'row tight' }, [
          ctx.el('span', {
            text: t('design.saved_entry', {
              scenario: t('scenario.' + entry.scenarioId + '.name'),
              difficulty: t('diff.' + entry.difficultyId + '.name'),
              date: tr.formatDate(entry.savedAt)
            })
          }),
          ctx.el('button', {
            type: 'button',
            text: t('common.load'),
            onclick: function () {
              loadDesign(entry.id);
            }
          }),
          ctx.el('button', {
            type: 'button',
            class: 'danger',
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
      var panel = ctx.el('section', { id: 'design-saved', class: 'card' }, [
        ctx.el('h2', { text: t('design.saved_title') }),
        buildSavedPanel()
      ]);
      var side = ctx.doc.getElementById('design-side');
      if (side) side.appendChild(panel);
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

    function syncSelections() {
      var buttons = root.querySelectorAll('[data-group]');
      Array.prototype.forEach.call(buttons, function (button) {
        var groupId = button.getAttribute('data-group');
        var version = button.getAttribute('data-version');
        if (!groupId || !version) return;
        var selected = catalog.partsForGroup(groupId).find(function (part) {
          return part.id === design.groups[groupId];
        });
        button.setAttribute('aria-pressed', selected && selected.version === version ? 'true' : 'false');
      });
    }

    // Reemplaza solo un panel derivado, conservando su identificador para
    // `aria-describedby` y sin reconstruir toda la pantalla (DM-5).
    function replaceSection(ref, build) {
      var current = root.querySelector('#' + ref);
      if (!current) return;
      current.parentNode.replaceChild(build(), current);
    }

    function refreshDerived() {
      replaceSection('design-requirements', function () {
        var panel = ctx.el('section', { id: 'design-requirements', class: 'card' }, [
          ctx.el('h2', { text: t('design.requirements') })
        ]);
        panel.appendChild(buildRequirements());
        return panel;
      });
      replaceSection('design-resources', function () {
        var panel = ctx.el('section', { id: 'design-resources', class: 'card' }, [
          ctx.el('h2', { text: t('design.resources') })
        ]);
        panel.appendChild(buildResources());
        panel.appendChild(buildTotals());
        return panel;
      });
      replaceSection('design-launch', buildLaunch);
    }

    /* --- Montaje ----------------------------------------------------- */

    var main = ctx.el('div', { class: 'design-main' }, [buildHeader(), buildObjective(), buildParts(), buildInstruments()]);
    var side = ctx.el('div', { class: 'design-side', id: 'design-side' }, [
      ctx.el('section', { id: 'design-resources', class: 'card' }, [ctx.el('h2', { text: t('design.resources') }), buildResources(), buildTotals()]),
      ctx.el('section', { id: 'design-requirements', class: 'card' }, [ctx.el('h2', { text: t('design.requirements') }), buildRequirements()]),
      buildLaunch(),
      buildLaunchers(),
      buildOrbits()
    ]);
    root.appendChild(main);
    root.appendChild(side);

    return { id: 'design', node: root };
  }

  return { create: create, ICON_GLYPHS: ICON_GLYPHS };
});
