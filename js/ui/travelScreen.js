/*
 * Fase 2: viaje (V-1 … V-18, C-2, C-3, RG-11, RG-12).
 *
 * La pantalla mantiene un único `requestAnimationFrame`: en cada cuadro lee la
 * entrada, mueve a los jugadores, avanza la simulación con `core/game.tick` y
 * dibuja el canvas con `world/renderer.render`. El HUD no se reconstruye por
 * cuadro: cada sección tiene una firma y sólo se vuelve a pintar cuando sus datos
 * cambian (S5, 60 FPS). Todo el estado de partida vive en `shell.state`, así que
 * re-renderizar por un cambio de idioma no pierde la misión (I-2).
 */
(function (global, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(
      require('../core/game.js'),
      require('../core/time.js'),
      require('../core/comms.js'),
      require('../core/systems.js'),
      require('../core/crew.js'),
      require('../mission/catalog.js'),
      require('../world/world.js'),
      require('../world/players.js'),
      require('../world/objects.js'),
      require('../world/input.js'),
      require('../world/renderer.js'),
      require('../storage/saves.js'),
      require('../storage/transfer.js')
    );
  } else {
    var GS = (global.GS = global.GS || {});
    GS.ui = GS.ui || {};
    GS.ui.travelScreen = factory(
      GS.core.game,
      GS.core.time,
      GS.core.comms,
      GS.core.systems,
      GS.core.crew,
      GS.mission.catalog,
      GS.world.world,
      GS.world.players,
      GS.world.objects,
      GS.world.input,
      GS.world.renderer,
      GS.storage.saves,
      GS.storage.transfer
    );
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (
  gameModule,
  time,
  comms,
  systems,
  crew,
  catalog,
  worldModule,
  playersModule,
  objectsModule,
  inputModule,
  renderer,
  saves,
  transfer
) {
  'use strict';

  var ICON_GLYPHS = {
    weight: '\u2696',
    bolt: '\u26A1',
    coin: '\u00A4',
    database: '\u25A4',
    antenna: '\u2301',
    clock: '\u25F7'
  };

  var STATUS_SHAPES = { ok: 'circle', warn: 'triangle', critical: 'square' };

  function shapeForHealth(health) {
    if (health <= 33) return 'square';
    if (health <= 66) return 'triangle';
    return 'circle';
  }

  function percent(tr, value) {
    return tr.formatPercent(isFinite(value) ? value / 100 : 0, 0);
  }

  /**
   * Pantalla de viaje. Devuelve `{id, node, destroy}`.
   * @param {Object} ctx shell de `js/ui/shell`
   */
  function create(ctx) {
    var t = ctx.t;
    var tr = ctx.tr;
    var state = ctx.state;
    var game = state.game;

    // Sin partida no hay viaje: se ofrece volver al diseño.
    if (!game) {
      var empty = ctx.el('section', { class: 'card stack', 'aria-label': t('travel.title') }, [
        ctx.el('h1', { text: t('travel.title') }),
        ctx.el('p', { class: 'muted', text: t('travel.no_mission') }),
        ctx.el('button', {
          type: 'button',
          class: 'primary',
          text: t('common.back'),
          onclick: function () {
            ctx.back();
          }
        })
      ]);
      return { id: 'travel', node: empty };
    }

    var prefs = ctx.getPrefs();
    var runtime = state.runtime || (state.runtime = {});
    if (!runtime.selected) runtime.selected = firstAliveId();
    if (runtime.priority === undefined) runtime.priority = null;

    var world = state.world || (state.world = worldModule.create({ design: game.design, game: game }));
    var map = world.map;
    var input = state.worldInput || (state.worldInput = inputModule.createInput(prefs.bindings || inputModule.defaults()));
    var win = ctx.win || (typeof window !== 'undefined' ? window : null);
    var raf =
      win && typeof win.requestAnimationFrame === 'function'
        ? win.requestAnimationFrame.bind(win)
        : function (callback) {
            return setTimeout(function () {
              callback(Date.now());
            }, 16);
          };
    var caf =
      win && typeof win.cancelAnimationFrame === 'function'
        ? win.cancelAnimationFrame.bind(win)
        : function (id) {
            clearTimeout(id);
          };

    var cache = {};
    var sections = {};
    var rafId = 0;
    var lastTs = 0;
    var destroyed = false;
    var canvasCtx = null;

    function firstAliveId() {
      var alive = game.crew.members.filter(function (member) {
        return member.alive;
      });
      return (alive[0] || game.crew.members[0] || { id: 'p1' }).id;
    }

    function memberById(playerId) {
      return (
        game.crew.members.find(function (member) {
          return member.id === playerId;
        }) || null
      );
    }

    function selectedId() {
      var found = memberById(runtime.selected);
      if (!found || !found.alive) runtime.selected = firstAliveId();
      return runtime.selected;
    }

    function priorityList() {
      var items = game.datastore.items || {};
      var order = (runtime.priority || Object.keys(items)).filter(function (id) {
        return (items[id] || 0) > 0;
      });
      Object.keys(items).forEach(function (id) {
        if ((items[id] || 0) > 0 && order.indexOf(id) === -1) order.push(id);
      });
      runtime.priority = order;
      return order;
    }

    function a11yOptions() {
      var current = ctx.getPrefs();
      return { highContrast: !!current.highContrast, reduceMotion: !!current.reduceMotion, hideLabels: false };
    }

    function invalidate(key) {
      if (key) {
        delete cache[key];
        return;
      }
      cache = {};
    }

    function paint(key, signature, build) {
      if (cache[key] === signature) return;
      cache[key] = signature;
      var host = sections[key];
      if (!host) return;
      ctx.clear(host);
      var content = build();
      if (content) host.appendChild(content);
    }

    /* --- Secciones del HUD ------------------------------------------- */

    var root = ctx.el('section', { id: 'travel-screen', class: 'travel-screen', 'aria-label': t('travel.title') });

    var view = ctx.el('div', { class: 'travel-view' });
    var canvasWrap = ctx.el('div', { class: 'canvas-wrap' });
    var canvas = ctx.el('canvas', {
      class: 'ship-canvas',
      width: 960,
      height: 600,
      role: 'img',
      'aria-label': t('travel.canvas_label')
    });
    canvasWrap.appendChild(canvas);
    canvasWrap.appendChild(
      ctx.el('p', { class: 'canvas-overlay-hint', text: t('travel.canvas_hint') })
    );
    view.appendChild(canvasWrap);

    sections.clock = ctx.el('section', { id: 'travel-clock', class: 'card hud-clock' });
    sections.resources = ctx.el('section', { id: 'travel-resources', class: 'card' });
    sections.objective = ctx.el('section', { id: 'travel-objective', class: 'card objective-progress' });
    sections.caption = ctx.el('section', { id: 'travel-caption', class: 'caption-bar', hidden: true });
    view.appendChild(sections.clock);
    view.appendChild(sections.resources);
    view.appendChild(sections.objective);
    view.appendChild(sections.caption);

    var side = ctx.el('div', { class: 'travel-hud' });
    sections.crew = ctx.el('section', { id: 'travel-crew', class: 'card' });
    sections.systems = ctx.el('section', { id: 'travel-systems', class: 'card' });
    sections.conflict = ctx.el('section', { id: 'travel-conflict', class: 'card' });
    sections.object = ctx.el('section', { id: 'travel-object', class: 'card' });
    sections.actions = ctx.el('section', { id: 'travel-actions', class: 'card' });
    sections.inventory = ctx.el('section', { id: 'travel-inventory', class: 'card' });
    sections.comms = ctx.el('section', { id: 'travel-comms', class: 'card' });
    sections.vote = ctx.el('section', { id: 'travel-vote', class: 'card' });
    sections.consequences = ctx.el('section', { id: 'travel-consequences', class: 'card' });
    [sections.crew, sections.systems, sections.conflict, sections.object, sections.actions, sections.inventory, sections.comms, sections.vote, sections.consequences].forEach(
      function (node) {
        side.appendChild(node);
      }
    );

    // Controles de partida: guardar, exportar, volver.
    var controlsCard = ctx.el('section', { class: 'card' }, [
      ctx.el('h2', { text: t('travel.controls') }),
      ctx.el('div', { class: 'row tight' }, [
        ctx.el('button', { type: 'button', text: t('common.save'), onclick: saveGame }),
        ctx.el('button', { type: 'button', text: t('common.export'), onclick: exportGame }),
        ctx.el('button', {
          type: 'button',
          class: 'ghost',
          text: t('menu.back_to_title'),
          onclick: function () {
            if (win && typeof win.confirm === 'function' && !win.confirm(t('travel.confirm_exit'))) return;
            ctx.go('title');
          }
        })
      ])
    ]);
    side.appendChild(controlsCard);

    var overlayHost = ctx.el('div', { id: 'travel-event' });
    sections.event = overlayHost;
    // Capa de interacción por teclado (V-4): se dibuja encima del canvas cuando
    // el objeto al alcance tiene más de una acción aplicable.
    var interactionHost = ctx.el('div', { id: 'travel-interaction' });
    sections.interaction = interactionHost;
    root.appendChild(view);
    root.appendChild(side);
    root.appendChild(overlayHost);
    root.appendChild(interactionHost);

    /* --- Acciones ---------------------------------------------------- */

    function runAction(action) {
      var result = gameModule.applyAction(game, action);
      if (result && result.codes && typeof ctx.toastCodes === 'function') ctx.toastCodes(result.codes);
      invalidate();
      if (game.status === 'report') {
        stop();
        if (typeof ctx.finishMission === 'function') ctx.finishMission();
        return result;
      }
      if (action && action.type === 'repair' && typeof ctx.notifyTutorial === 'function') ctx.notifyTutorial('first_repair');
      return result;
    }

    function withActor(action) {
      var copy = Object.assign({}, action);
      if (['eat', 'drink', 'rest', 'repair', 'service'].indexOf(action.type) !== -1) copy.memberId = selectedId();
      return copy;
    }

    function actionButton(action, extraLabel) {
      var label = extraLabel || t(action.labelKey, action.params);
      var button = ctx.el('button', {
        type: 'button',
        class: 'action-button',
        onclick: function () {
          runAction(withActor(action));
        }
      }, [ctx.el('span', { text: label })]);
      if (action.estimateKey) {
        button.appendChild(ctx.el('span', { class: 'estimate', text: t(action.estimateKey, action.params) }));
        ctx.tooltip(button, function () {
          return t(action.estimateKey, action.params);
        });
      }
      return button;
    }

    function saveGame() {
      var result = saves.saveGame(gameModule.getState(game));
      ctx.toast({ code: result.ok ? 'save.game_saved' : result.code || 'save.quota', severity: result.ok ? 'info' : 'warn' });
    }

    function exportGame() {
      var text = transfer.exportJson(transfer.KIND.SAVE, gameModule.getState(game));
      if (transfer.download(transfer.filenameFor('save', game.id), text)) ctx.toast({ code: 'save.exported' });
    }

    /* --- Pintado del HUD --------------------------------------------- */

    function buildClock() {
      var clock = game.clock;
      var info = tr.missionClock(clock.hours);
      var wrap = ctx.el('div', { class: 'stack' });
      var row = ctx.el('div', { class: 'row' });
      row.appendChild(ctx.el('h2', { text: t('hud.mission_time') }));
      row.appendChild(
        ctx.el('span', {
          class: 'clock-readout',
          text: t('travel.clock', { day: info.day, time: info.text })
        })
      );
      row.appendChild(
        ctx.el('span', { class: 'badge', text: time.isEclipse(clock) ? t('hud.eclipse') : t('hud.daylight') })
      );
      row.appendChild(
        ctx.el('span', {
          class: 'badge',
          text: t('hud.lifetime', { value: tr.formatUnit(Math.ceil(time.daysLeft(clock)), 'unit.days') })
        })
      );
      wrap.appendChild(row);

      var speeds = ctx.el('div', { class: 'speed-group', role: 'group', 'aria-label': t('hud.speed') });
      speeds.appendChild(
        ctx.el('button', {
          type: 'button',
          'aria-pressed': clock.paused ? 'true' : 'false',
          text: clock.paused ? t('hud.resume') : t('hud.pause'),
          onclick: function () {
            time.togglePause(clock);
            invalidate('clock');
          }
        })
      );
      [1, 2, 4, 8].forEach(function (speed) {
        speeds.appendChild(
          ctx.el('button', {
            type: 'button',
            'aria-pressed': !clock.paused && clock.speed === speed ? 'true' : 'false',
            text: t('hud.speed_value', { speed: speed }),
            onclick: function () {
              time.setSpeed(clock, speed);
              invalidate('clock');
            }
          })
        );
      });
      wrap.appendChild(speeds);
      return wrap;
    }

    /**
     * Valor de un recurso redondeado a la precisión que se muestra. La firma del
     * panel usa el mismo número, así que el HUD no se reconstruye en cada cuadro
     * por una fracción invisible (rendimiento, S5).
     */
    function displayValue(item) {
      var value = Number(item.value) || 0;
      if (item.id === 'mass' || item.id === 'power') return Math.round(value);
      if (item.id === 'comms') return Math.round(value * 100);
      if (item.id === 'time') return Math.round(value);
      return Math.round(value * 10) / 10;
    }

    function resourceValue(item) {
      return tr.formatUnit(displayValue(item), item.unit || 'unit.pct');
    }

    function buildResources() {
      var panel = gameModule.resourcePanel(game);
      var wrap = ctx.el('div', { class: 'stack' });
      wrap.appendChild(ctx.el('h2', { text: t('design.resources') }));
      var grid = ctx.el('div', { class: 'hud-resources' });
      panel.items.forEach(function (item) {
        var box = ctx.el('div', {
          class: 'hud-resource' + (panel.worst === item.id ? ' is-worst' : ''),
          'data-resource': item.id
        });
        box.appendChild(
          ctx.el('div', { class: 'hud-resource__head' }, [
            ctx.el('span', {
              class: 'shape shape--' + item.shape + ' status--' + item.status,
              'aria-hidden': 'true'
            }),
            ctx.el('span', { class: 'icon-glyph', 'aria-hidden': 'true', text: ICON_GLYPHS[item.icon] || '' }),
            ctx.el('span', { text: t('res.' + item.id + '.name') })
          ])
        );
        box.appendChild(ctx.el('span', { class: 'hud-resource__value', text: resourceValue(item) }));
        box.appendChild(
          ctx.el('span', { class: 'faint status--' + item.status, text: t('res.status.' + item.status) })
        );
        ctx.tooltip(box, function () {
          return t('res.' + item.id + '.desc');
        });
        grid.appendChild(box);
      });
      wrap.appendChild(grid);
      wrap.appendChild(ctx.el('p', { class: 'faint', text: t('res.critical', { resource: t('res.' + panel.critical + '.name') }) }));
      return wrap;
    }

    function buildObjective() {
      var objective = game.objective || { checks: [], coverage: 0 };
      var wrap = ctx.el('div', { class: 'stack' });
      var head = ctx.el('div', { class: 'row' });
      head.appendChild(ctx.el('h2', { text: t('hud.objectives') }));
      head.appendChild(
        ctx.el('span', {
          class: 'badge',
          text: t('travel.coverage', { value: tr.formatPercent(objective.coverage || 0, 0) })
        })
      );
      if (objective.required !== undefined) {
        head.appendChild(
          ctx.el('span', {
            class: 'badge',
            text: t('travel.data_progress', {
              have: tr.formatUnit(objective.transmitted || 0, 'unit.kb'),
              need: tr.formatUnit(objective.required || 0, 'unit.kb')
            })
          })
        );
      }
      wrap.appendChild(head);
      var list = ctx.el('ul');
      (objective.checks || []).forEach(function (check) {
        list.appendChild(
          ctx.el('li', { class: check.ok ? 'status--ok' : 'status--critical' }, [
            ctx.el('span', { class: 'req-mark', 'aria-hidden': 'true', text: check.ok ? '\u2714' : '\u2718' }),
            ctx.el('span', { text: t(check.labelKey, check.params) })
          ])
        );
      });
      wrap.appendChild(list);
      return wrap;
    }

    function buildCrew() {
      var wrap = ctx.el('div', { class: 'stack' });
      wrap.appendChild(ctx.el('h2', { text: t('hud.crew') }));
      var list = ctx.el('div', { class: 'crew-list' });
      game.crew.members.forEach(function (member) {
        var box = ctx.el('div', {
          class: 'crew-member' + (member.id === selectedId() ? ' is-selected' : '') + (member.alive ? '' : ' is-dead'),
          'data-member': member.id
        });
        var head = ctx.el('div', { class: 'crew-member__head' }, [
          ctx.el('button', {
            type: 'button',
            class: 'ghost',
            'aria-pressed': member.id === selectedId() ? 'true' : 'false',
            text: t(member.nameKey),
            onclick: function () {
              runtime.selected = member.id;
              invalidate();
            }
          }),
          ctx.el('span', { class: 'badge', text: t('crew.status.' + (member.alive ? 'alive' : 'dead')) })
        ]);
        box.appendChild(head);
        var healthClass = member.health <= 33 ? 'is-critical' : member.health <= 66 ? 'is-warn' : '';
        var bar = ctx.el('div', { class: 'bar ' + healthClass }, [ctx.el('span', { style: 'width:' + Math.max(0, Math.min(100, member.health)) + '%' })]);
        box.appendChild(bar);
        box.appendChild(
          ctx.el('span', {
            class: 'faint',
            text: t('travel.health_morale', { health: percent(tr, member.health), morale: percent(tr, member.morale) })
          })
        );
        if (member.conditions && member.conditions.length > 0) {
          var chips = ctx.el('div', { class: 'condition-chips' });
          member.conditions.forEach(function (condition) {
            chips.appendChild(ctx.el('span', { class: 'chip is-warn', text: t('crew.condition.' + condition) }));
          });
          box.appendChild(chips);
        }
        ctx.tooltip(box, function () {
          return t('hud.crew_needs', {
            hunger: tr.formatNumber(Math.round(member.hunger)),
            thirst: tr.formatNumber(Math.round(member.thirst)),
            sleep: tr.formatNumber(Math.round(member.sleep)),
            stress: tr.formatNumber(Math.round(member.stress)),
            morale: tr.formatNumber(Math.round(member.morale)),
            hygiene: tr.formatNumber(Math.round(member.hygiene))
          });
        });
        list.appendChild(box);
      });
      wrap.appendChild(list);
      return wrap;
    }

    function buildSystems() {
      var wrap = ctx.el('div', { class: 'stack' });
      wrap.appendChild(ctx.el('h2', { text: t('hud.systems') }));
      var list = ctx.el('div', { class: 'system-list' });
      systems.SYSTEM_IDS.forEach(function (id) {
        var system = game.systems[id];
        if (!system) return;
        var row = ctx.el('div', { class: 'system-row', 'data-system': id });
        var shape = shapeForHealth(system.health);
        var head = ctx.el('div', { class: 'system-row__head' }, [
          ctx.el('span', { class: 'shape shape--' + shape + ' ' + (system.health <= 33 ? 'status--critical' : system.health <= 66 ? 'status--warn' : 'status--ok'), 'aria-hidden': 'true' }),
          ctx.el('span', { text: t('sys.' + id + '.name') }),
          ctx.el('span', {
            class: 'badge',
            text: t('travel.system_health', { health: percent(tr, system.health), reliability: percent(tr, system.reliability) })
          })
        ]);
        row.appendChild(head);
        var barClass = system.health <= 33 ? 'is-critical' : system.health <= 66 ? 'is-warn' : '';
        row.appendChild(ctx.el('div', { class: 'bar ' + barClass }, [ctx.el('span', { style: 'width:' + Math.max(0, Math.min(100, system.health)) + '%' })]));
        list.appendChild(row);
      });
      wrap.appendChild(list);

      wrap.appendChild(ctx.el('h3', { text: t('travel.instruments') }));
      var instruments = ctx.el('div', { class: 'action-list' });
      game.instruments.forEach(function (instrument) {
        var name = t('instrument.' + instrument.id + '.name');
        instruments.appendChild(
          ctx.el('button', {
            type: 'button',
            class: 'action-button',
            'aria-pressed': instrument.active ? 'true' : 'false',
            onclick: function () {
              runAction({ type: 'toggle_instrument', instrumentId: instrument.id });
            }
          }, [
            ctx.el('span', {
              text: t(instrument.active ? 'travel.instrument_on' : 'travel.instrument_off', { instrument: name })
            })
          ])
        );
      });
      if (game.instruments.length === 0) instruments.appendChild(ctx.el('p', { class: 'muted', text: t('common.empty') }));
      wrap.appendChild(instruments);
      return wrap;
    }

    function buildConflict() {
      var panel = gameModule.resourcePanel(game);
      var power = panel.items.find(function (item) {
        return item.id === 'power';
      });
      var active = game.instruments.filter(function (instrument) {
        return instrument.active;
      });
      if (!power || power.status === 'ok' || active.length === 0) return null;
      var wrap = ctx.el('div', { class: 'conflict-notice', role: 'alert' });
      wrap.appendChild(
        ctx.el('p', {
          text: t('travel.power_conflict', {
            margin: tr.formatUnit(power.value, 'unit.w'),
            generation: tr.formatUnit(game.resources.powerGen, 'unit.w')
          })
        })
      );
      var row = ctx.el('div', { class: 'row tight' });
      active.forEach(function (instrument) {
        row.appendChild(
          ctx.el('button', {
            type: 'button',
            text: t('travel.turn_off', { instrument: t('instrument.' + instrument.id + '.name') }),
            onclick: function () {
              runAction({ type: 'toggle_instrument', instrumentId: instrument.id });
            }
          })
        );
      });
      wrap.appendChild(row);
      return wrap;
    }

    function buildObjectPanel() {
      var nearest = worldModule.nearest(world, selectedId());
      var wrap = ctx.el('div', { class: 'stack' });
      wrap.appendChild(ctx.el('h2', { text: t('travel.object_title') }));
      if (!nearest) {
        wrap.appendChild(ctx.el('p', { class: 'muted', text: t('travel.no_object') }));
        return wrap;
      }
      var object = nearest.object;
      wrap.appendChild(ctx.el('h3', { text: t(object.nameKey) }));
      wrap.appendChild(ctx.el('p', { class: 'faint', text: t(object.descKey) }));
      var actions = objectsModule.actions(object);
      var list = ctx.el('div', { class: 'action-list' });
      actions.forEach(function (action) {
        var button = ctx.el('button', {
          type: 'button',
          class: 'action-button',
          onclick: function () {
            applyObjectAction(selectedId(), object, action);
          }
        }, [ctx.el('span', { text: t(action.labelKey) })]);
        if (action.estimateKey) {
          button.appendChild(ctx.el('span', { class: 'estimate', text: t(action.estimateKey) }));
          ctx.tooltip(button, function () {
            return t(action.estimateKey);
          });
        }
        list.appendChild(button);
      });
      wrap.appendChild(list);
      if (object.item) {
        wrap.appendChild(
          ctx.el('button', {
            type: 'button',
            text: t('travel.pickup'),
            onclick: function () {
              var result = playersModule.pickup(world, selectedId(), object.id);
              if (result && result.codes && typeof ctx.toastCodes === 'function') ctx.toastCodes(result.codes);
              invalidate();
            }
          })
        );
      }
      return wrap;
    }

    function groupedActions() {
      var all = gameModule.getActions(game);
      var groups = { care: [], repair: [], cannibalize: [], decisions: [], misc: [] };
      all.forEach(function (action) {
        if (action.type === 'eat' || action.type === 'drink' || action.type === 'rest') {
          if (action.memberId === selectedId()) groups.care.push(action);
        } else if (action.type === 'repair' || action.type === 'service') {
          groups.repair.push(action);
        } else if (action.type === 'cannibalize') {
          groups.cannibalize.push(action);
        } else if (action.type === 'propose') {
          groups.decisions.push(action);
        } else if (action.type === 'clean' || action.type === 'finish') {
          groups.misc.push(action);
        }
      });
      return groups;
    }

    function buildActions() {
      var groups = groupedActions();
      var wrap = ctx.el('div', { class: 'stack' });
      wrap.appendChild(ctx.el('h2', { text: t('travel.actions_title') }));
      var member = memberById(selectedId());
      wrap.appendChild(
        ctx.el('p', {
          class: 'faint',
          text: t('travel.acting_as', { member: t(member ? member.nameKey : 'hud.crew') })
        })
      );

      function group(titleKey, list, open) {
        var details = ctx.el('details', open ? { open: true } : null);
        details.appendChild(ctx.el('summary', { text: t(titleKey) }));
        var box = ctx.el('div', { class: 'action-list' });
        list.forEach(function (action) {
          box.appendChild(actionButton(action));
        });
        details.appendChild(box);
        return details;
      }

      if (groups.care.length > 0) wrap.appendChild(group('travel.actions_care', groups.care, true));
      if (groups.repair.length > 0) wrap.appendChild(group('travel.actions_repair', groups.repair, false));
      if (groups.misc.length > 0) wrap.appendChild(group('travel.actions_misc', groups.misc, false));
      if (groups.cannibalize.length > 0) wrap.appendChild(group('travel.actions_cannibalize', groups.cannibalize, false));
      if (groups.decisions.length > 0) wrap.appendChild(group('travel.actions_decisions', groups.decisions, true));
      return wrap;
    }

    function buildInventory() {
      var player = playersModule.byId(world, selectedId());
      var wrap = ctx.el('div', { class: 'stack' });
      wrap.appendChild(ctx.el('h2', { text: t('hud.inventory') }));
      if (!player) {
        wrap.appendChild(ctx.el('p', { class: 'muted', text: t('common.empty') }));
        return wrap;
      }
      var capacity = playersModule.capacityOf(world, player);
      wrap.appendChild(
        ctx.el('p', {
          class: 'faint',
          text: t('travel.inventory_count', {
            used: tr.formatNumber(player.inventory.length),
            max: tr.formatNumber(capacity)
          })
        })
      );
      var list = ctx.el('ul', { class: 'inventory-list' });
      if (player.inventory.length === 0) {
        list.appendChild(ctx.el('li', { class: 'muted', text: t('travel.inventory_empty') }));
      }
      player.inventory.forEach(function (itemId) {
        var object = objectsModule.find(world, itemId);
        var name = object ? t(object.nameKey) : itemId;
        var row = ctx.el('li', null, [ctx.el('span', { text: name })]);
        var targets = world.players.list.filter(function (other) {
          return other.id !== player.id;
        });
        if (targets.length > 0) {
          var give = ctx.el('div', { class: 'row tight' });
          targets.forEach(function (other, index) {
            give.appendChild(
              ctx.el('button', {
                type: 'button',
                text: t('travel.give_to', {
                  player: t('travel.player_name', {
                    player: t('hud.player', { n: world.players.list.indexOf(other) + 1 }),
                    role: t('role.' + other.role + '.name')
                  })
                }),
                onclick: function () {
                  var result = playersModule.give(world, player.id, other.id, itemId);
                  if (result && result.codes && typeof ctx.toastCodes === 'function') ctx.toastCodes(result.codes);
                  invalidate();
                }
              })
            );
          });
          row.appendChild(give);
        }
        list.appendChild(row);
      });
      wrap.appendChild(list);
      return wrap;
    }

    function windowContext() {
      return {
        orbit: game.design.orbit || {},
        hours: game.clock.hours,
        antennaHealth: game.systems.comms ? game.systems.comms.health : 100,
        commsHealth: game.systems.comms ? game.systems.comms.health : 100
      };
    }

    function buildComms() {
      var wrap = ctx.el('div', { class: 'stack' });
      wrap.appendChild(ctx.el('h2', { text: t('res.comms.name') }));
      var stateWindow = comms.windowState(windowContext());
      var capacity = comms.windowCapacity(windowContext());
      var status = ctx.el('div', { class: 'comms-status' }, [
        ctx.el('span', {
          class: 'chip' + (stateWindow.open ? ' is-ok' : ' is-warn'),
          text: stateWindow.open ? t('travel.comms_open') : t('travel.comms_closed')
        }),
        ctx.el('span', {
          text: stateWindow.open
            ? t('travel.comms_capacity', { amount: tr.formatUnit(capacity, 'unit.kb') })
            : t('travel.comms_next', { minutes: tr.formatNumber(stateWindow.nextOpenInMinutes || 0) })
        })
      ]);
      wrap.appendChild(status);

      var items = game.datastore.items || {};
      var order = priorityList();
      wrap.appendChild(
        ctx.el('p', {
          class: 'faint',
          text: t('travel.data_priority_hint')
        })
      );
      if (order.length === 0) {
        wrap.appendChild(ctx.el('p', { class: 'muted', text: t('travel.no_data') }));
      } else {
        var list = ctx.el('ul', { class: 'priority-list' });
        order.forEach(function (id, index) {
          var row = ctx.el('li', null, [
            ctx.el('span', { text: t('instrument.' + id + '.name') }),
            ctx.el('span', { text: tr.formatUnit(items[id] || 0, 'unit.kb') }),
            ctx.el('button', {
              type: 'button',
              class: 'icon',
              text: '\u25B2',
              'aria-label': t('travel.move_up', { instrument: t('instrument.' + id + '.name') }),
              disabled: index === 0,
              onclick: function () {
                var listOrder = priorityList().slice();
                var at = listOrder.indexOf(id);
                if (at > 0) {
                  listOrder.splice(at, 1);
                  listOrder.splice(at - 1, 0, id);
                  runtime.priority = listOrder;
                  invalidate();
                }
              }
            }),
            ctx.el('button', {
              type: 'button',
              class: 'icon',
              text: '\u25BC',
              'aria-label': t('travel.move_down', { instrument: t('instrument.' + id + '.name') }),
              disabled: index === order.length - 1,
              onclick: function () {
                var listOrder = priorityList().slice();
                var at = listOrder.indexOf(id);
                if (at !== -1 && at < listOrder.length - 1) {
                  listOrder.splice(at, 1);
                  listOrder.splice(at + 1, 0, id);
                  runtime.priority = listOrder;
                  invalidate();
                }
              }
            })
          ]);
          list.appendChild(row);
        });
        wrap.appendChild(list);
      }
      var transmit = ctx.el('button', {
        type: 'button',
        class: 'primary',
        text: t('action.transmit'),
        disabled: !stateWindow.open || order.length === 0,
        onclick: function () {
          runAction({ type: 'transmit', priority: priorityList() });
        }
      });
      if (!stateWindow.open) {
        ctx.tooltip(transmit, function () {
          return t('travel.comms_next', { minutes: tr.formatNumber(stateWindow.nextOpenInMinutes || 0) });
        });
      }
      wrap.appendChild(ctx.el('div', { class: 'row' }, [transmit]));
      return wrap;
    }

    function buildVote() {
      var vote = game.vote;
      if (!vote) return null;
      var wrap = ctx.el('div', { class: 'stack' });
      var remaining = Math.max(0, Math.ceil((vote.durationMs - vote.elapsedMs) / 1000));
      wrap.appendChild(ctx.el('h2', { text: t('travel.vote_title') }));
      var head = ctx.el('div', { class: 'row' }, [
        ctx.el('span', { text: t(vote.code) }),
        ctx.el('span', { class: 'vote-timer', text: t('travel.vote_seconds', { seconds: remaining }) })
      ]);
      wrap.appendChild(head);
      var defaultOption = vote.options.find(function (option) {
        return option.id === vote.defaultOption;
      });
      if (defaultOption) {
        wrap.appendChild(
          ctx.el('p', { class: 'faint', text: t('travel.vote_default', { option: t(defaultOption.labelKey) }) })
        );
      }
      var options = ctx.el('div', { class: 'vote-options' });
      var current = memberById(selectedId());
      var myVote = current ? vote.votes[current.id] : undefined;
      vote.options.forEach(function (option) {
        var button = ctx.el('button', {
          type: 'button',
          class: 'vote-option',
          'aria-pressed': myVote === option.id ? 'true' : 'false',
          onclick: function () {
            runAction({ type: 'vote', memberId: selectedId(), optionId: option.id });
          }
        }, [
          ctx.el('strong', { text: t(option.labelKey) }),
          ctx.el('span', { class: 'estimate', text: t(option.estimateKey) }),
          ctx.el('span', { class: 'why', text: t(option.whyKey) })
        ]);
        options.appendChild(button);
      });
      wrap.appendChild(options);
      var marks = ctx.el('div', { class: 'vote-marks' });
      game.crew.members.forEach(function (member) {
        if (!member.alive) return;
        var chosen = vote.votes[member.id];
        var chosenOption = chosen
          ? vote.options.find(function (option) {
              return option.id === chosen;
            })
          : null;
        var label = chosenOption
          ? t('travel.vote_mark', { member: t(member.nameKey), option: t(chosenOption.labelKey) })
          : t('travel.vote_pending', { member: t(member.nameKey) });
        marks.appendChild(ctx.el('span', { class: 'chip', text: label }));
      });
      wrap.appendChild(marks);
      return wrap;
    }

    function buildConsequences() {
      var wrap = ctx.el('div', { class: 'stack' });
      wrap.appendChild(ctx.el('h2', { text: t('hud.consequences') }));
      if (!game.clock.paused) {
        wrap.appendChild(ctx.el('p', { class: 'faint', text: t('travel.pause_for_consequences') }));
        return wrap;
      }
      var pending = gameModule.pendingConsequences(game);
      if (pending.length === 0) {
        wrap.appendChild(ctx.el('p', { class: 'muted', text: t('travel.no_consequences') }));
        return wrap;
      }
      if (typeof ctx.notifyTutorial === 'function') ctx.notifyTutorial('deferred_consequence');
      var list = ctx.el('ul', { class: 'consequence-list' });
      pending.forEach(function (entry) {
        var countdown = entry.daysLeft !== null
          ? t('travel.days_left', { days: tr.formatNumber(entry.daysLeft) })
          : t('travel.events_left', { events: tr.formatNumber(entry.eventsLeft || 0) });
        var item = ctx.el('li', { class: entry.severity === 'severe' ? 'is-severe' : '' }, [
          ctx.el('span', { text: t(entry.code, entry.params) }),
          ctx.el('span', { class: 'faint', text: countdown })
        ]);
        if (entry.whyKey) {
          ctx.tooltip(item, function () {
            return t(entry.whyKey);
          });
        }
        list.appendChild(item);
      });
      wrap.appendChild(list);
      return wrap;
    }

    function buildCaption() {
      var current = ctx.getPrefs();
      if (!current.captions) return null;
      var notice = (game.notices || [])[game.notices.length - 1];
      if (!notice) return ctx.el('p', { class: 'faint', text: t('travel.captions_idle') });
      return ctx.el('p', { text: t(notice.code, notice.params) });
    }

    function buildEvent() {
      var event = game.pendingEvents[0];
      if (!event) return null;
      var overlay = ctx.el('div', { class: 'overlay' });
      var dialog = ctx.el('div', {
        class: 'dialog dialog--narrow',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'event-title',
        'aria-describedby': 'event-desc'
      });
      dialog.appendChild(
        ctx.el('div', { class: 'dialog__head' }, [
          ctx.el('h2', { id: 'event-title', text: t(event.titleKey) }),
          ctx.el('span', { class: 'badge', text: t('event.severity.' + event.severity) })
        ])
      );
      dialog.appendChild(ctx.el('p', { id: 'event-desc', text: t(event.descriptionKey) }));
      var options = ctx.el('div', { class: 'event-options' });
      event.options.forEach(function (option) {
        var button = ctx.el('button', {
          type: 'button',
          class: 'event-option',
          onclick: function () {
            runAction({ type: 'event_option', uid: event.uid, optionId: option.id });
          }
        }, [
          ctx.el('strong', { text: t(option.labelKey) }),
          ctx.el('span', { class: 'estimate', text: t(option.estimateKey) }),
          ctx.el('span', { class: 'why', text: t(option.whyKey) })
        ]);
        options.appendChild(button);
      });
      dialog.appendChild(options);
      overlay.appendChild(dialog);
      // El evento detiene el reloj: el foco entra en el modal para que se pueda
      // responder con el teclado (accesibilidad de paneles).
      if (ctx.doc && typeof setTimeout === 'function') {
        setTimeout(function () {
          var first = dialog.querySelector('button');
          if (first && !dialog.contains(ctx.doc.activeElement)) first.focus();
        }, 0);
      }
      return overlay;
    }

    /* --- Interacción con la tecla de interactuar (S33, V-4) ---------- */

    /**
     * Estados en los que el flanco de `interact` se ignora: con el reloj en
     * pausa se están revisando consecuencias, y un evento o una votación ya
     * tienen su propia capa encima del canvas (V-4).
     */
    function interactionBlocked() {
      if (!game || !game.clock) return true;
      if (game.clock.paused) return true;
      if (game.vote) return true;
      return (game.pendingEvents || []).length > 0;
    }

    /** Objeto al alcance del jugador; respeta `objects.REACH` (V-4). */
    function objectInReach(playerId) {
      var near = worldModule.nearest(world, playerId);
      return near ? near.object : null;
    }

    /**
     * Ejecuta una acción del objeto por la misma ruta que los botones del panel:
     * `world/objects.interact` aplica los efectos y `core/game` recalcula los
     * recursos (C-7). El `estimate` de la acción sigue visible en el panel.
     */
    function applyObjectAction(playerId, object, action) {
      var result = objectsModule.interact(world, object.id, action.id, playerId);
      if (result && result.codes && typeof ctx.toastCodes === 'function') ctx.toastCodes(result.codes);
      gameModule.recomputeResources(game);
      invalidate();
      return result;
    }

    function closeInteraction() {
      if (!runtime.interaction) return false;
      runtime.interaction = null;
      invalidate();
      return true;
    }

    /**
     * Atiende el flanco de `interact` de un jugador: lo selecciona, busca el
     * objeto al alcance y ejecuta la única acción aplicable o abre la capa de
     * interacción. Devuelve un código estable para las pruebas:
     * `blocked` | `no_object` | `no_action` | `acted` | `overlay`.
     */
    function handleInteract(playerId) {
      var member = memberById(playerId);
      // Un tripulante muerto no interactúa: `runtime.selected` tiene que seguir
      // apuntando a alguien vivo para el resto de la pantalla.
      if (!member || !member.alive) return 'blocked';
      if (interactionBlocked()) return 'blocked';
      runtime.selected = playerId;
      invalidate();

      var object = objectInReach(playerId);
      if (!object) {
        if (typeof ctx.toastCodes === 'function') ctx.toastCodes([{ code: 'travel.no_object_in_reach' }]);
        return 'no_object';
      }

      var actions = objectsModule.actions(object);
      if (actions.length === 0) {
        if (typeof ctx.toastCodes === 'function') ctx.toastCodes([{ code: 'travel.no_action_available' }]);
        return 'no_action';
      }
      if (actions.length === 1) {
        applyObjectAction(playerId, object, actions[0]);
        return 'acted';
      }

      runtime.interaction = { playerId: playerId, objectId: object.id };
      invalidate();
      return 'overlay';
    }

    /** Jugadores que pulsaron interactuar en este cuadro, en orden de jugador. */
    function interactFlanks(controls) {
      return Object.keys(controls).filter(function (playerId) {
        return !!(controls[playerId] && controls[playerId].interact);
      });
    }

    /**
     * Capa de interacción (V-4): nombre, descripción y un botón por acción con
     * su etiqueta y su consecuencia estimada. Sigue el patrón de la capa de
     * eventos: `overlay` + `dialog` modal con el foco dentro y Escape para
     * cerrar; un botón Cancelar o un clic fuera también la cierran.
     */
    function buildInteraction() {
      var current = runtime.interaction;
      if (!current) return null;
      var object = objectsModule.find(world, current.objectId);
      var actions = object ? objectsModule.actions(object) : [];
      // La capa nunca convive con un evento, una votación o una pausa.
      if (!object || actions.length === 0 || interactionBlocked()) return null;

      var overlay = ctx.el('div', {
        class: 'overlay',
        id: 'travel-interaction-overlay',
        onclick: function (event) {
          if (!event || event.target === overlay) closeInteraction();
        }
      });
      var dialog = ctx.el('div', {
        class: 'dialog dialog--narrow',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'interaction-title',
        'aria-describedby': 'interaction-desc',
        onkeydown: function (event) {
          if (!event || event.key !== 'Escape') return;
          if (typeof event.preventDefault === 'function') event.preventDefault();
          closeInteraction();
        }
      });
      dialog.appendChild(
        ctx.el('div', { class: 'dialog__head' }, [
          ctx.el('h2', { id: 'interaction-title', text: t(object.nameKey) }),
          ctx.el('span', { class: 'badge', text: t('travel.object_title') })
        ])
      );
      dialog.appendChild(ctx.el('p', { id: 'interaction-desc', text: t(object.descKey) }));

      var list = ctx.el('div', {
        class: 'event-options',
        role: 'group',
        'aria-label': t('travel.interaction_label')
      });
      actions.forEach(function (action) {
        var content = [ctx.el('strong', { text: t(action.labelKey) })];
        if (action.estimateKey) content.push(ctx.el('span', { class: 'estimate', text: t(action.estimateKey) }));
        list.appendChild(
          ctx.el('button', {
            type: 'button',
            class: 'event-option',
            onclick: function () {
              closeInteraction();
              applyObjectAction(current.playerId, object, action);
            }
          }, content)
        );
      });
      list.appendChild(
        ctx.el('button', {
          type: 'button',
          class: 'ghost',
          text: t('common.cancel'),
          onclick: function () {
            closeInteraction();
          }
        })
      );
      dialog.appendChild(list);
      overlay.appendChild(dialog);

      // El foco entra en la capa para recorrerla y cerrarla con el teclado.
      if (ctx.doc && typeof setTimeout === 'function') {
        setTimeout(function () {
          if (!runtime.interaction) return;
          var first = typeof dialog.querySelector === 'function' ? dialog.querySelector('button') : null;
          if (first && typeof first.focus === 'function' && ctx.doc.activeElement !== first) first.focus();
        }, 0);
      }
      return overlay;
    }

    function paintAll() {
      var clock = game.clock;
      var currentPrefs = ctx.getPrefs();
      if (sections.caption) sections.caption.hidden = !currentPrefs.captions;
      if (sections.vote) sections.vote.hidden = !game.vote;
      if (sections.conflict) {
        var conflictPanel = gameModule.resourcePanel(game);
        var conflictPower = conflictPanel.items.find(function (item) {
          return item.id === 'power';
        });
        sections.conflict.hidden = !conflictPower || conflictPower.status === 'ok' || !game.instruments.some(function (instrument) {
          return instrument.active;
        });
      }
      paint('clock', [Math.floor(clock.hours * 60), clock.speed, clock.paused].join('|'), buildClock);

      var panel = gameModule.resourcePanel(game);
      paint(
        'resources',
        JSON.stringify({
          items: panel.items.map(function (item) {
            return [item.id, displayValue(item), item.status];
          }),
          worst: panel.worst,
          critical: panel.critical
        }),
        buildResources
      );

      var objective = game.objective || { checks: [] };
      paint(
        'objective',
        JSON.stringify({
          coverage: tr.formatPercent(objective.coverage || 0, 0),
          transmitted: Math.round((objective.transmitted || 0) * 10) / 10,
          checks: (objective.checks || []).map(function (check) {
            return [check.id, check.ok];
          })
        }),
        buildObjective
      );

      paint(
        'crew',
        JSON.stringify({
          selected: selectedId(),
          members: game.crew.members.map(function (member) {
            return [
              member.id,
              member.alive,
              Math.round(member.health),
              Math.round(member.morale),
              Math.round(member.hunger),
              Math.round(member.thirst),
              Math.round(member.sleep),
              member.conditions.join(',')
            ];
          })
        }),
        buildCrew
      );

      paint(
        'systems',
        JSON.stringify({
          systems: systems.SYSTEM_IDS.map(function (id) {
            var system = game.systems[id];
            return system ? [Math.round(system.health), Math.round(system.reliability)] : null;
          }),
          instruments: game.instruments.map(function (instrument) {
            return [instrument.id, instrument.active];
          })
        }),
        buildSystems
      );

      var powerItem = panel.items.find(function (item) {
        return item.id === 'power';
      });
      paint(
        'conflict',
        JSON.stringify({
          status: powerItem ? powerItem.status : 'ok',
          margin: powerItem ? displayValue(powerItem) : 0,
          active: game.instruments
            .filter(function (instrument) {
              return instrument.active;
            })
            .map(function (instrument) {
              return instrument.id;
            })
        }),
        buildConflict
      );

      var near = worldModule.nearest(world, selectedId());
      var inventory = (playersModule.byId(world, selectedId()) || { inventory: [] }).inventory;
      paint(
        'object',
        JSON.stringify({
          selected: selectedId(),
          object: near ? near.object.id : null,
          used: near ? near.object.uses : {},
          done: near ? near.object.done : {},
          inventory: inventory
        }),
        buildObjectPanel
      );

      paint(
        'actions',
        JSON.stringify({
          selected: selectedId(),
          systems: systems.SYSTEM_IDS.map(function (id) {
            return Math.round((game.systems[id] || {}).health || 0);
          }),
          instruments: game.instruments.map(function (instrument) {
            return instrument.active;
          }),
          vote: !!game.vote
        }),
        buildActions
      );

      paint('inventory', JSON.stringify({ selected: selectedId(), inventory: inventory }), buildInventory);

      var windowNow = comms.windowState(windowContext());
      paint(
        'comms',
        JSON.stringify({
          bucket: Math.floor((game.clock.hours * 60) / 5),
          items: game.datastore.items,
          priority: priorityList(),
          open: windowNow.open,
          capacity: windowNow.open ? comms.windowCapacity(windowContext()) : 0,
          health: Math.round(game.systems.comms ? game.systems.comms.health : 100)
        }),
        buildComms
      );

      paint(
        'vote',
        game.vote
          ? JSON.stringify({
              id: game.vote.decisionId,
              votes: game.vote.votes,
              remaining: Math.ceil((game.vote.durationMs - game.vote.elapsedMs) / 1000),
              selected: selectedId()
            })
          : 'none',
        buildVote
      );

      paint(
        'consequences',
        JSON.stringify({
          paused: game.clock.paused,
          pending: gameModule.pendingConsequences(game).map(function (entry) {
            return [entry.id, entry.daysLeft === null ? null : Math.ceil(entry.daysLeft), entry.eventsLeft];
          })
        }),
        buildConsequences
      );

      var lastNotice = (game.notices || [])[game.notices.length - 1];
      paint('caption', JSON.stringify({ captions: ctx.getPrefs().captions, note: lastNotice ? lastNotice.id : null }), buildCaption);
      paint('event', game.pendingEvents.length > 0 ? game.pendingEvents[0].uid : 'none', buildEvent);

      // La capa de interacción se cierra sola si el objeto deja de estar al
      // alcance o si aparece un evento, una votación o una pausa (V-4).
      if (runtime.interaction && interactionBlocked()) runtime.interaction = null;
      var interactionSignature = 'none';
      if (runtime.interaction) {
        var interactionObject = objectsModule.find(world, runtime.interaction.objectId);
        interactionSignature = [
          runtime.interaction.playerId,
          runtime.interaction.objectId,
          interactionObject ? objectsModule.actions(interactionObject).length : 0
        ].join('|');
      }
      paint('interaction', interactionSignature, buildInteraction);
    }

    /* --- Bucle ------------------------------------------------------- */

    function sizeCanvas() {
      var rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { width: 960, height: 600 };
      var width = Math.max(320, Math.round(rect.width || 960));
      var height = Math.max(200, Math.round(rect.height || width * 0.625));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    }

    function stop() {
      destroyed = true;
      if (rafId && win) caf(rafId);
      rafId = 0;
      if (win && typeof win.removeEventListener === 'function') win.removeEventListener('resize', sizeCanvas);
      inputModule.detach(input);
    }

    function frame(timestamp) {
      if (destroyed) return;
      if (!lastTs) lastTs = timestamp;
      var delta = Math.min(250, Math.max(0, timestamp - lastTs));
      lastTs = timestamp;

      var controls = inputModule.poll(input);
      // Interacción por teclado (S33, V-4): se atiende un jugador por cuadro y
      // los demás flancos esperan al siguiente, así dos teclas pulsadas a la vez
      // no se pisan.
      var interactQueue = (runtime.interactQueue || []).concat(interactFlanks(controls));
      runtime.interactQueue = [];
      if (interactQueue.length > 0) {
        // Si el flanco se ignora (pausa, evento, votación o tripulante muerto)
        // no queda nada pendiente: la cola se descarta entera.
        var outcome = handleInteract(interactQueue[0]);
        runtime.interactQueue = outcome === 'blocked' ? [] : interactQueue.slice(1);
      }

      worldModule.step(world, controls, delta / 1000);
      var result = gameModule.tick(game, delta);

      if (game.status === 'report') {
        stop();
        if (typeof ctx.finishMission === 'function') ctx.finishMission();
        return;
      }

      if (canvasCtx) {
        sizeCanvas();
        var viewport = { width: canvas.width, height: canvas.height };
        renderer.render(canvasCtx, {
          map: map,
          game: { systems: game.systems, clock: game.clock },
          world: world,
          camera: renderer.computeCamera(map, world, viewport),
          a11y: a11yOptions(),
          t: function (key) {
            return ctx.t(key);
          },
          viewport: viewport,
          time: game.clock.hours
        });
      }

      paintAll();
      rafId = raf(frame);
    }

    canvasCtx = canvas.getContext ? canvas.getContext('2d') : null;
    sizeCanvas();
    if (win && typeof win.addEventListener === 'function') win.addEventListener('resize', sizeCanvas);
    paintAll();
    rafId = raf(frame);

    // `refresh` repinta el HUD sin esperar al siguiente cuadro: lo usan las
    // pruebas de humo y los paneles que cambian fuera del bucle.
    return { id: 'travel', node: root, destroy: stop, refresh: paintAll };
  }

  return { create: create, ICON_GLYPHS: ICON_GLYPHS };
});
