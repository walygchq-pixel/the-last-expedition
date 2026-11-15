/*
 * Phase 2: travel (V-1 … V-18, C-2, C-3, RG-11, RG-12).
 *
 * Holographic screen: the isometric viewer fills the whole frame and the HUD
 * floats around it, glued to the edges (clock at the top left, crew at the
 * top centre, objective/link/instrument ribbons on the left, systems and
 * resources on the right, the inventory/actions/consequences dock at the
 * bottom). No panel covers the centre of the viewer or the character.
 *
 * The screen keeps a single `requestAnimationFrame`: on every frame it reads the
 * input, moves the players, advances the simulation with `core/game.tick` and
 * draws the canvas with `world/renderer.render`. The HUD is not rebuilt per
 * frame: each section has a signature and is only repainted when its data
 * changes (S5, 60 FPS). All match state lives in `shell.state`, so
 * re-rendering for a language change does not lose the mission (I-2).
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

  // Own icon per system: status is never communicated by colour alone (S29).
  var SYSTEM_GLYPHS = {
    lifeSupport: '\u25C9',
    power: '\u26A1',
    thermal: '\u2668',
    comms: '\u2301',
    instruments: '\u25A4',
    attitude: '\u2295'
  };

  var STATUS_SHAPES = { ok: 'circle', warn: 'triangle', critical: 'square' };

  var ARROW_KEYS = { ArrowUp: '\u2191', ArrowDown: '\u2193', ArrowLeft: '\u2190', ArrowRight: '\u2192' };

  function shapeForHealth(health) {
    if (health <= 33) return 'square';
    if (health <= 66) return 'triangle';
    return 'circle';
  }

  function percent(tr, value) {
    return tr.formatPercent(isFinite(value) ? value / 100 : 0, 0);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  /** Visual abbreviation of a translated label (the full one goes in aria-label). */
  function abbrev(label) {
    return String(label || '')
      .replace(/[^\p{L}\p{N} ]/gu, '')
      .trim()
      .slice(0, 3)
      .toUpperCase();
  }

  /** Human-readable label of a physical key code (display only). */
  function keyLabel(code) {
    if (!code) return 'E';
    if (code.indexOf('Key') === 0) return code.slice(3);
    if (code.indexOf('Digit') === 0) return code.slice(5);
    if (code.indexOf('Numpad') === 0) return code.slice(6);
    if (code === 'Semicolon') return '\u00D1';
    if (code === 'Enter') return '\u21B5';
    if (code === 'Space') return '\u2423';
    if (ARROW_KEYS[code]) return ARROW_KEYS[code];
    return String(code).replace(/^Arrow/, '');
  }

  /**
   * Travel screen. Returns `{id, node, destroy}`.
   * @param {Object} ctx shell from `js/ui/shell`
   */
  function create(ctx) {
    var t = ctx.t;
    var tr = ctx.tr;
    var state = ctx.state;
    var game = state.game;

    // No game, no travel: it offers to go back to the design screen.
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
    var doc = ctx.doc || (typeof document !== 'undefined' ? document : null);
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
    var lastView = null;
    var pointer = null;

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

    function prefersReducedMotion() {
      if (ctx.getPrefs().reduceMotion) return true;
      if (!win || typeof win.matchMedia !== 'function') return false;
      try {
        return !!win.matchMedia('(prefers-reduced-motion: reduce)').matches;
      } catch (error) {
        return false;
      }
    }

    function a11yOptions() {
      var current = ctx.getPrefs();
      return { highContrast: !!current.highContrast, reduceMotion: prefersReducedMotion(), hideLabels: false };
    }

    function invalidate(key) {
      if (key) {
        delete cache[key];
        return;
      }
      cache = {};
    }

    /** Paints a section only if its signature changed. Returns `true` if it rebuilt. */
    function paint(key, signature, build) {
      if (cache[key] === signature) return false;
      cache[key] = signature;
      var host = sections[key];
      if (!host) return false;
      ctx.clear(host);
      var content = build();
      if (content) host.appendChild(content);
      return true;
    }

    /* --- Viewer structure --------------------------------------------- */

    var root = ctx.el('section', { id: 'travel-screen', class: 'travel-screen', 'aria-label': t('travel.title') });
    var frameNode = ctx.el('div', { class: 'travel-frame' });

    var canvasWrap = ctx.el('div', { class: 'canvas-wrap' });
    var canvas = ctx.el('canvas', {
      class: 'ship-canvas',
      width: 960,
      height: 600,
      tabindex: '0',
      role: 'img',
      'aria-label': t('travel.canvas_label')
    });
    canvasWrap.appendChild(canvas);

    // Clock (top left) and crew (top centre).
    sections.clock = ctx.el('section', {
      id: 'travel-clock',
      class: 'hud hud-clock hud-plate',
      'data-tutorial': 'travel-clock',
      'aria-label': t('hud.mission_time')
    });
    sections.crew = ctx.el('section', { id: 'travel-crew', class: 'hud hud-crew', 'aria-label': t('hud.crew') });

    // Rarely used utilities: save, export, back and the key help.
    sections.controls = ctx.el('section', {
      id: 'travel-controls',
      class: 'hud hud-utility hud-plate',
      'aria-label': t('travel.controls')
    });

    // Left ribbon: objective, comms window, instruments and voting.
    var leftRail = ctx.el('div', { class: 'hud hud-rail hud-rail--left' });
    sections.objective = ctx.el('section', {
      id: 'travel-objective',
      class: 'hud-plate tape',
      'aria-label': t('hud.objectives')
    });
    sections.comms = ctx.el('section', { id: 'travel-comms', class: 'hud-plate tape', 'aria-label': t('res.comms.name') });
    sections.instruments = ctx.el('section', {
      id: 'travel-instruments',
      class: 'hud-plate tape',
      'aria-label': t('travel.instruments')
    });
    sections.vote = ctx.el('section', { id: 'travel-vote', class: 'hud-plate tape' });
    [sections.objective, sections.comms, sections.instruments, sections.vote].forEach(function (node) {
      leftRail.appendChild(node);
    });

    // Right ribbon: systems as gauges and resources in compact form.
    var rightRail = ctx.el('div', { class: 'hud hud-rail hud-rail--right' });
    sections.conflict = ctx.el('section', { id: 'travel-conflict', class: 'hud-plate' });
    sections.systems = ctx.el('section', {
      id: 'travel-systems',
      class: 'hud-plate tape',
      'data-tutorial': 'travel-systems',
      'aria-label': t('hud.systems')
    });
    sections.resources = ctx.el('section', {
      id: 'travel-resources',
      class: 'hud-plate tape',
      'aria-label': t('design.resources')
    });
    [sections.conflict, sections.systems, sections.resources].forEach(function (node) {
      rightRail.appendChild(node);
    });

    // Bottom dock glued to the edge of the viewer.
    var dock = ctx.el('div', { class: 'hud hud-dock' });
    sections.caption = ctx.el('section', { id: 'travel-caption', class: 'hud-caption hud-plate', hidden: true });
    sections.inventory = ctx.el('section', {
      id: 'travel-inventory',
      class: 'hud-plate dock-panel dock-panel--inventory',
      'data-tutorial': 'travel-inventory',
      'aria-label': t('hud.inventory')
    });
    sections.actions = ctx.el('section', {
      id: 'travel-actions',
      class: 'hud-plate dock-panel dock-panel--actions',
      'data-tutorial': 'travel-actions',
      'aria-label': t('travel.actions_title')
    });
    sections.consequences = ctx.el('section', {
      id: 'travel-consequences',
      class: 'hud-plate dock-panel dock-panel--consequences tape',
      'aria-label': t('hud.consequences')
    });
    [sections.caption, sections.inventory, sections.actions, sections.consequences].forEach(function (node) {
      dock.appendChild(node);
    });

    // Layer for the interact-key radial/flow and the nearby-object chip.
    var interactionHost = ctx.el('div', { id: 'travel-interaction', class: 'travel-interaction' });
    sections.interaction = interactionHost;
    var chip = ctx.el('div', { id: 'travel-object-chip', class: 'travel-chip', hidden: true });
    sections.chip = chip;

    [canvasWrap, sections.clock, sections.crew, sections.controls, leftRail, rightRail, dock, chip, interactionHost].forEach(function (node) {
      frameNode.appendChild(node);
    });

    var overlayHost = ctx.el('div', { id: 'travel-event' });
    sections.event = overlayHost;

    root.appendChild(frameNode);
    root.appendChild(overlayHost);

    /* --- Actions ----------------------------------------------------- */

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
        class: 'dock-action',
        onclick: function () {
          runAction(withActor(action));
        }
      }, [ctx.el('span', { class: 'dock-action__label', text: label })]);
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

    /* --- HUD utilities ------------------------------------------------ */

    function plateTitle(text, extra) {
      var head = ctx.el('h2', { class: 'hud-title' }, [ctx.el('span', { text: text })]);
      if (extra) head.appendChild(extra);
      return head;
    }

    function thinBar(value, statusClass, label) {
      var ratio = clamp(isFinite(value) ? value : 0, 0, 100);
      var bar = ctx.el('div', {
        class: 'gauge-track' + (statusClass ? ' is-' + statusClass : ''),
        role: 'img',
        'aria-label': label || ''
      }, [ctx.el('i', { style: 'width:' + ratio.toFixed(1) + '%' })]);
      return bar;
    }

    /* --- Clock -------------------------------------------------------- */

    function buildClock() {
      var clock = game.clock;
      var info = tr.missionClock(clock.hours);
      var wrap = ctx.el('div', { class: 'clock' });
      var readout = ctx.el('div', { class: 'clock-main' });
      readout.appendChild(ctx.el('p', { class: 'hud-label', text: t('hud.mission_time') }));
      readout.appendChild(ctx.el('p', { class: 'clock-big', text: t('travel.clock', { day: info.day, time: info.text }) }));
      var meta = ctx.el('p', { class: 'clock-meta' }, [
        ctx.el('span', {
          class: (time.isEclipse(clock) ? 'is-eclipse' : 'is-daylight'),
          text: time.isEclipse(clock) ? t('hud.eclipse') : t('hud.daylight')
        }),
        ctx.el('span', { class: 'clock-sep', 'aria-hidden': 'true', text: '\u00B7' }),
        ctx.el('span', { text: t('hud.lifetime') }),
        ctx.el('b', { text: tr.formatUnit(Math.ceil(time.daysLeft(clock)), 'unit.days') })
      ]);
      readout.appendChild(meta);
      wrap.appendChild(readout);

      var speeds = ctx.el('div', { class: 'clock-speed', role: 'group', 'aria-label': t('hud.speed') });
      speeds.appendChild(
        ctx.el('button', {
          type: 'button',
          class: 'pause-button',
          'aria-pressed': clock.paused ? 'true' : 'false',
          'aria-label': clock.paused ? t('hud.resume') : t('hud.pause'),
          text: clock.paused ? '\u25B6' : '\u23F8',
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

    /* --- Resources ---------------------------------------------------- */

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
      var wrap = ctx.el('div', { class: 'tape-body' });
      wrap.appendChild(plateTitle(t('design.resources')));
      var list = ctx.el('ul', { class: 'res-list' });
      panel.items.forEach(function (item) {
        var row = ctx.el('li', {
          class: 'res-row' + (panel.worst === item.id ? ' is-worst' : ''),
          'data-resource': item.id
        }, [
          ctx.el('span', {
            class: 'shape shape--' + item.shape + ' status--' + item.status,
            'aria-hidden': 'true'
          }),
          ctx.el('span', { class: 'res-icon', 'aria-hidden': 'true', text: ICON_GLYPHS[item.icon] || '' }),
          ctx.el('span', { class: 'res-name', text: t('res.' + item.id + '.name') }),
          ctx.el('b', { class: 'res-value num', text: resourceValue(item) })
        ]);
        ctx.tooltip(row, function () {
          return t('res.' + item.id + '.desc');
        });
        list.appendChild(row);
      });
      wrap.appendChild(list);
      wrap.appendChild(
        ctx.el('p', { class: 'faint hud-note', text: t('res.critical', { resource: t('res.' + panel.critical + '.name') }) })
      );
      return wrap;
    }

    /* --- Crew --------------------------------------------------------- */

    var NEED_BARS = [
      { id: 'health', key: 'health', invert: false, numeric: true },
      { id: 'stress', key: 'stress', invert: true },
      { id: 'hunger', key: 'hunger', invert: true },
      { id: 'thirst', key: 'thirst', invert: true },
      { id: 'sleep', key: 'sleep', invert: false }
    ];

    function needClass(value, invert) {
      var good = invert ? 100 - value : value;
      if (good <= 33) return ' c';
      if (good <= 66) return ' w';
      return '';
    }

    function buildCrew() {
      var wrap = ctx.el('div', { class: 'crew-strip' });
      game.crew.members.forEach(function (member) {
        var needs = {
          hunger: Math.round(member.hunger),
          thirst: Math.round(member.thirst),
          sleep: Math.round(member.sleep),
          stress: Math.round(member.stress),
          morale: Math.round(member.morale),
          hygiene: Math.round(member.hygiene)
        };
        var card = ctx.el('button', {
          type: 'button',
          class:
            'crew-card' +
            (member.id === selectedId() ? ' is-active' : '') +
            (member.alive ? '' : ' is-dead'),
          'aria-pressed': member.id === selectedId() ? 'true' : 'false',
          'aria-label': t('hud.crew_needs', needs),
          disabled: !member.alive,
          onclick: function () {
            runtime.selected = member.id;
            invalidate();
          }
        });
        var memberName = t(member.nameKey);
        var roleName = t('role.' + member.role + '.name');
        var top = ctx.el('span', { class: 'crew-top' }, [
          ctx.el('b', { text: memberName }),
          roleName !== memberName ? ctx.el('span', { class: 'crew-role', text: roleName }) : null,
          ctx.el('span', {
            class: 'crew-health num' + (member.alive ? '' : ' is-dead'),
            text: member.alive ? percent(tr, member.health) : t('crew.status.dead')
          })
        ]);
        card.appendChild(top);
        var bars = ctx.el('span', { class: 'crew-needs', 'aria-hidden': 'true' });
        NEED_BARS.forEach(function (need) {
          var value = clamp(Number(member[need.id]) || 0, 0, 100);
          bars.appendChild(
            ctx.el('span', { class: 'need' + needClass(value, need.invert) }, [
              ctx.el('i', { style: 'width:' + value.toFixed(0) + '%' })
            ])
          );
        });
        card.appendChild(bars);
        var legend = ctx.el('span', { class: 'crew-legend', 'aria-hidden': 'true' });
        NEED_BARS.forEach(function (need) {
          legend.appendChild(ctx.el('span', { text: abbrev(t('crew.need.' + need.key)) }));
        });
        card.appendChild(legend);
        wrap.appendChild(card);
      });
      return wrap;
    }

    /* --- Objective and ribbons on the left ---------------------------- */

    function buildObjective() {
      var objective = game.objective || { checks: [], coverage: 0 };
      var wrap = ctx.el('div', { class: 'tape-body' });
      wrap.appendChild(plateTitle(t('hud.objectives')));
      wrap.appendChild(
        ctx.el('p', { class: 'tape-line' }, [
          ctx.el('span', { text: t('travel.coverage', { value: tr.formatPercent(objective.coverage || 0, 0) }) })
        ])
      );
      wrap.appendChild(
        thinBar(objective.coverage || 0, (objective.coverage || 0) >= 100 ? 'ok' : '', t('travel.coverage', {
          value: tr.formatPercent(objective.coverage || 0, 0)
        }))
      );
      if (objective.required !== undefined) {
        var progress = t('travel.data_progress', {
          have: tr.formatUnit(objective.transmitted || 0, 'unit.kb'),
          need: tr.formatUnit(objective.required || 0, 'unit.kb')
        });
        wrap.appendChild(ctx.el('p', { class: 'tape-line num', text: progress }));
        wrap.appendChild(
          thinBar(
            objective.required > 0 ? ((objective.transmitted || 0) / objective.required) * 100 : 0,
            '',
            progress
          )
        );
      }
      var list = ctx.el('ul', { class: 'tape-list' });
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

    function windowContext() {
      return {
        orbit: game.design.orbit || {},
        hours: game.clock.hours,
        antennaHealth: game.systems.comms ? game.systems.comms.health : 100,
        commsHealth: game.systems.comms ? game.systems.comms.health : 100
      };
    }

    function buildComms() {
      var wrap = ctx.el('div', { class: 'tape-body' });
      var stateWindow = comms.windowState(windowContext());
      var capacity = comms.windowCapacity(windowContext());
      wrap.appendChild(
        plateTitle(
          t('res.comms.name'),
          ctx.el('span', { class: 'led' + (stateWindow.open ? ' is-ok' : ''), 'aria-hidden': 'true' })
        )
      );
      wrap.appendChild(
        ctx.el('p', { class: 'tape-line' }, [
          ctx.el('span', {
            class: stateWindow.open ? 'status--ok' : 'status--warn',
            text: stateWindow.open ? t('travel.comms_open') : t('travel.comms_closed')
          })
        ])
      );
      wrap.appendChild(
        ctx.el('p', {
          class: 'tape-sub num',
          text: stateWindow.open
            ? t('travel.comms_capacity', { amount: tr.formatUnit(capacity, 'unit.kb') })
            : t('travel.comms_next', { minutes: tr.formatNumber(stateWindow.nextOpenInMinutes || 0) })
        })
      );

      var items = game.datastore.items || {};
      var order = priorityList();
      var details = ctx.el('details', { class: 'tape-details' });
      details.appendChild(ctx.el('summary', { text: t('res.data.name') }));
      details.appendChild(ctx.el('p', { class: 'faint hud-note', text: t('travel.data_priority_hint') }));
      if (order.length === 0) {
        details.appendChild(ctx.el('p', { class: 'muted', text: t('travel.no_data') }));
      } else {
        var list = ctx.el('ul', { class: 'priority-list' });
        order.forEach(function (id, index) {
          list.appendChild(
            ctx.el('li', null, [
              ctx.el('span', { class: 'priority-name', text: t('instrument.' + id + '.name') }),
              ctx.el('span', { class: 'num', text: tr.formatUnit(items[id] || 0, 'unit.kb') }),
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
            ])
          );
        });
        details.appendChild(list);
      }
      var transmit = ctx.el('button', {
        type: 'button',
        class: 'primary tape-primary',
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
      details.appendChild(transmit);
      wrap.appendChild(details);
      return wrap;
    }

    function buildInstruments() {
      var wrap = ctx.el('div', { class: 'tape-body' });
      wrap.appendChild(plateTitle(t('travel.instruments')));
      if (game.instruments.length === 0) {
        wrap.appendChild(ctx.el('p', { class: 'muted', text: t('common.empty') }));
        return wrap;
      }
      var list = ctx.el('ul', { class: 'tape-list tape-list--instruments' });
      game.instruments.forEach(function (instrument) {
        var name = t('instrument.' + instrument.id + '.name');
        list.appendChild(
          ctx.el('li', null, [
            ctx.el('button', {
              type: 'button',
              class: 'tape-toggle' + (instrument.active ? ' is-on' : ''),
              'aria-pressed': instrument.active ? 'true' : 'false',
              'aria-label': t(instrument.active ? 'travel.instrument_on' : 'travel.instrument_off', {
                instrument: name
              }),
              onclick: function () {
                runAction({ type: 'toggle_instrument', instrumentId: instrument.id });
              }
            }, [
              ctx.el('span', { class: 'tape-toggle__mark', 'aria-hidden': 'true', text: instrument.active ? '\u25AE' : '\u25AF' }),
              ctx.el('span', { text: name })
            ])
          ])
        );
      });
      wrap.appendChild(list);
      return wrap;
    }

    /* --- Systems (gauges without figures) ----------------------------- */

    function gaugesLegend() {
      return ctx.el('p', { class: 'gauge-legend faint' }, [
        ctx.el('span', { class: 'gauge-legend__health', text: t('travel.gauge_health') }),
        ctx.el('span', { class: 'gauge-legend__reliability', text: t('travel.gauge_reliability') })
      ]);
    }

    function buildSystems() {
      var wrap = ctx.el('div', { class: 'tape-body' });
      wrap.appendChild(plateTitle(t('hud.systems')));
      wrap.appendChild(gaugesLegend());
      var list = ctx.el('ul', { class: 'gauge-list' });
      systems.SYSTEM_IDS.forEach(function (id) {
        var system = game.systems[id];
        if (!system) return;
        var health = clamp(system.health, 0, 100);
        var reliability = clamp(system.reliability, 0, 100);
        var status = health <= 33 ? 'critical' : health <= 66 ? 'warn' : 'ok';
        var summary = t('travel.system_health', { health: percent(tr, health), reliability: percent(tr, reliability) });
        var row = ctx.el('li', {
          class: 'gauge is-' + status,
          'data-system': id,
          role: 'group',
          'aria-label': summary
        });
        row.appendChild(
          ctx.el('span', { class: 'gauge-head' }, [
            ctx.el('span', {
              class: 'shape shape--' + shapeForHealth(health) + ' status--' + status,
              'aria-hidden': 'true'
            }),
            ctx.el('span', { class: 'gauge-icon', 'aria-hidden': 'true', text: SYSTEM_GLYPHS[id] || '\u25A1' }),
            ctx.el('span', { class: 'gauge-name', text: t('sys.' + id + '.name') })
          ])
        );
        row.appendChild(
          ctx.el('span', { class: 'gauge-track', 'aria-hidden': 'true' }, [
            ctx.el('i', { style: 'width:' + health.toFixed(1) + '%' })
          ])
        );
        row.appendChild(
          ctx.el('span', { class: 'gauge-track gauge-track--reliability', 'aria-hidden': 'true' }, [
            ctx.el('i', { style: 'width:' + reliability.toFixed(1) + '%' })
          ])
        );
        list.appendChild(row);
      });
      wrap.appendChild(list);
      return wrap;
    }

    /* --- Conflicts, actions, inventory and consequences --------------- */

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
      var wrap = ctx.el('div', { class: 'dock-body' });
      var member = memberById(selectedId());
      wrap.appendChild(
        ctx.el('div', { class: 'dock-head' }, [
          ctx.el('h2', { class: 'hud-title', text: t('travel.actions_title') }),
          ctx.el('span', { class: 'dock-sub', text: t('travel.acting_as', { member: t(member ? member.nameKey : 'hud.crew') }) })
        ])
      );

      function group(titleKey, list, open) {
        var details = ctx.el('details', { class: 'dock-group', open: open ? true : null });
        details.appendChild(ctx.el('summary', { text: t(titleKey) }));
        var box = ctx.el('div', { class: 'dock-actions' });
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

    /** Proximity of an object to the selected player (for inventory and chip). */
    function nearObject(playerId) {
      var near = worldModule.nearest(world, playerId);
      return near ? near.object : null;
    }

    function buildInventory() {
      var player = playersModule.byId(world, selectedId());
      var wrap = ctx.el('div', { class: 'dock-body' });
      if (!player) {
        wrap.appendChild(ctx.el('h2', { class: 'hud-title', text: t('hud.inventory') }));
        wrap.appendChild(ctx.el('p', { class: 'muted', text: t('common.empty') }));
        return wrap;
      }
      var capacity = playersModule.capacityOf(world, player);
      wrap.appendChild(
        ctx.el('div', { class: 'dock-head' }, [
          ctx.el('h2', { class: 'hud-title', text: t('hud.inventory') }),
          ctx.el('span', {
            class: 'dock-sub num',
            text: t('travel.inventory_count', {
              used: tr.formatNumber(player.inventory.length),
              max: tr.formatNumber(capacity)
            })
          })
        ])
      );
      var slots = ctx.el('div', { class: 'inv-slots' });
      for (var index = 0; index < capacity; index += 1) {
        var itemId = player.inventory[index];
        if (!itemId) {
          slots.appendChild(
            ctx.el('div', { class: 'inv-slot is-empty' }, [
              ctx.el('b', { text: t('common.none') }),
              ctx.el('span', { class: 'faint', text: t('travel.inventory_empty') })
            ])
          );
          continue;
        }
        var object = objectsModule.find(world, itemId);
        var slot = ctx.el('div', { class: 'inv-slot' }, [
          ctx.el('b', { text: object ? t(object.nameKey) : itemId })
        ]);
        var targets = world.players.list.filter(function (other) {
          return other.id !== player.id;
        });
        if (targets.length > 0) {
          var give = ctx.el('div', { class: 'inv-give' });
          targets.forEach(function (other) {
            var n = world.players.list.indexOf(other) + 1;
            var full = t('travel.give_to', {
              player: t('travel.player_name', {
                player: t('hud.player', { n: n }),
                role: t('role.' + other.role + '.name')
              })
            });
            give.appendChild(
              ctx.el('button', {
                type: 'button',
                class: 'inv-give__button',
                text: 'P' + n,
                'aria-label': full,
                onclick: function () {
                  var result = playersModule.give(world, player.id, other.id, itemId);
                  if (result && result.codes && typeof ctx.toastCodes === 'function') ctx.toastCodes(result.codes);
                  invalidate();
                }
              })
            );
          });
          slot.appendChild(give);
        }
        slots.appendChild(slot);
      }
      wrap.appendChild(slots);
      var near = nearObject(selectedId());
      if (near && near.item && !near.carriedBy) {
        wrap.appendChild(
          ctx.el('button', {
            type: 'button',
            class: 'dock-pickup',
            text: t('travel.pickup'),
            onclick: function () {
              var result = playersModule.pickup(world, selectedId(), near.id);
              if (result && result.codes && typeof ctx.toastCodes === 'function') ctx.toastCodes(result.codes);
              invalidate();
            }
          })
        );
      }
      return wrap;
    }

    function buildConsequences() {
      var wrap = ctx.el('div', { class: 'dock-body' });
      var pending = gameModule.pendingConsequences(game);
      wrap.appendChild(
        ctx.el('div', { class: 'dock-head' }, [
          ctx.el('h2', { class: 'hud-title', text: t('hud.consequences') }),
          ctx.el('span', { class: 'dock-sub num', text: tr.formatNumber(pending.length) })
        ])
      );
      if (!game.clock.paused) {
        wrap.appendChild(ctx.el('p', { class: 'faint', text: t('travel.pause_for_consequences') }));
        return wrap;
      }
      if (pending.length === 0) {
        wrap.appendChild(ctx.el('p', { class: 'muted', text: t('travel.no_consequences') }));
        return wrap;
      }
      if (typeof ctx.notifyTutorial === 'function') ctx.notifyTutorial('deferred_consequence');
      var list = ctx.el('ul', { class: 'tape-list' });
      pending.forEach(function (entry) {
        var countdown = entry.daysLeft !== null
          ? t('travel.days_left', { days: tr.formatNumber(entry.daysLeft) })
          : t('travel.events_left', { events: tr.formatNumber(entry.eventsLeft || 0) });
        var item = ctx.el('li', { class: entry.severity === 'severe' ? 'is-severe' : '' }, [
          ctx.el('span', { class: 'tape-entry', text: t(entry.code, entry.params) }),
          ctx.el('span', { class: 'tape-trigger faint', text: countdown })
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

    function buildVote() {
      var vote = game.vote;
      if (!vote) return null;
      var wrap = ctx.el('div', { class: 'tape-body' });
      var remaining = Math.max(0, Math.ceil((vote.durationMs - vote.elapsedMs) / 1000));
      wrap.appendChild(
        plateTitle(
          t('travel.vote_title'),
          ctx.el('span', { class: 'vote-timer num', text: t('travel.vote_seconds', { seconds: remaining }) })
        )
      );
      wrap.appendChild(ctx.el('p', { class: 'tape-line', text: t(vote.code) }));
      var defaultOption = vote.options.find(function (option) {
        return option.id === vote.defaultOption;
      });
      if (defaultOption) {
        wrap.appendChild(
          ctx.el('p', { class: 'faint hud-note', text: t('travel.vote_default', { option: t(defaultOption.labelKey) }) })
        );
      }
      var options = ctx.el('div', { class: 'vote-options' });
      var current = memberById(selectedId());
      var myVote = current ? vote.votes[current.id] : undefined;
      vote.options.forEach(function (option) {
        options.appendChild(
          ctx.el('button', {
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
          ])
        );
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
        options.appendChild(
          ctx.el('button', {
            type: 'button',
            class: 'event-option',
            onclick: function () {
              runAction({ type: 'event_option', uid: event.uid, optionId: option.id });
            }
          }, [
            ctx.el('strong', { text: t(option.labelKey) }),
            ctx.el('span', { class: 'estimate', text: t(option.estimateKey) }),
            ctx.el('span', { class: 'why', text: t(option.whyKey) })
          ])
        );
      });
      dialog.appendChild(options);
      overlay.appendChild(dialog);
      // The event stops the clock: focus enters the modal so it can be
      // answered from the keyboard (panel accessibility).
      if (doc && typeof setTimeout === 'function') {
        setTimeout(function () {
          var first = dialog.querySelector('button');
          if (first && !dialog.contains(doc.activeElement)) first.focus();
        }, 0);
      }
      return overlay;
    }

    /* --- Interaction: radial next to the player (S33, V-4) ------------- */

    /**
     * States in which the `interact` edge is ignored: with the clock paused
     * the player is reviewing consequences, and an event or a vote already
     * has its own layer on top of the viewer (V-4).
     */
    function interactionBlocked() {
      if (!game || !game.clock) return true;
      if (game.clock.paused) return true;
      if (game.vote) return true;
      return (game.pendingEvents || []).length > 0;
    }

    /** Object within the player's reach; honours `objects.REACH` (V-4). */
    function objectInReach(playerId) {
      return nearObject(playerId);
    }

    /**
     * Runs an object action through the same path as the dock buttons:
     * `world/objects.interact` applies the effects and `core/game` recomputes
     * the resources (C-7). The action's `estimate` stays visible in the radial.
     */
    function applyObjectAction(playerId, object, action) {
      var result = objectsModule.interact(world, object.id, action.id, playerId);
      if (result && result.codes && typeof ctx.toastCodes === 'function') ctx.toastCodes(result.codes);
      gameModule.recomputeResources(game);
      invalidate();
      return result;
    }

    function focusCanvas() {
      if (canvas && typeof canvas.focus === 'function') canvas.focus();
    }

    function closeInteraction() {
      if (!runtime.interaction) return false;
      runtime.interaction = null;
      invalidate();
      focusCanvas();
      return true;
    }

    function openRadial(playerId, object) {
      if (!object) return false;
      runtime.selected = playerId;
      runtime.interaction = { playerId: playerId, objectId: object.id };
      invalidate();
      return true;
    }

    /**
     * Handles a player's `interact` edge: selects that player, looks for the
     * object within reach and opens the radial with its actions. Returns a code
     * that is stable for the tests: `blocked` | `no_object` | `no_action` | `overlay`.
     */
    function handleInteract(playerId) {
      var member = memberById(playerId);
      // A dead crew member does not interact: `runtime.selected` has to keep
      // pointing at someone alive for the rest of the screen.
      if (!member || !member.alive) return 'blocked';
      // With the radial open, the edge reopens nothing and re-runs nothing.
      if (runtime.interaction) return 'blocked';
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

      openRadial(playerId, object);
      return 'overlay';
    }

    /** Players that pressed interact on this frame, in player order. */
    function interactFlanks(controls) {
      return Object.keys(controls).filter(function (playerId) {
        return !!(controls[playerId] && controls[playerId].interact);
      });
    }

    /** Radial buttons (actions only: closing stays out of the cycle). */
    function radialActions(radial) {
      if (!radial || typeof radial.querySelectorAll !== 'function') return [];
      return Array.prototype.slice.call(radial.querySelectorAll('button.radial-action'));
    }

    /**
     * Keyboard inside the radial: arrows or Tab walk the actions, Enter runs
     * the focused one and Escape closes. The handler stops propagation so the
     * keys neither move the character nor trigger the interact edge at the
     * same time.
     */
    function onRadialKeydown(event) {
      if (!event) return;
      var radial = event.currentTarget;
      if (!radial) return;
      var key = event.key;
      if (key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeInteraction();
        return;
      }
      var list = radialActions(radial);
      if (key === 'Enter') {
        var active = doc ? doc.activeElement : null;
        if (active && list.indexOf(active) !== -1) {
          event.preventDefault();
          event.stopPropagation();
          closeInteraction();
          active.click();
        }
        return;
      }
      var step;
      if (key === 'ArrowDown' || key === 'ArrowRight') step = 1;
      else if (key === 'ArrowUp' || key === 'ArrowLeft') step = -1;
      else if (key === 'Tab') step = event.shiftKey ? -1 : 1;
      else if (key === 'Home') step = -list.length;
      else if (key === 'End') step = list.length;
      else return;
      if (list.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      var at = doc ? list.indexOf(doc.activeElement) : -1;
      var next = at === -1 ? (step > 0 ? 0 : list.length - 1) : (at + step + list.length) % list.length;
      list[next].focus();
      list.forEach(function (button, index) {
        button.classList.toggle('is-target', index === next);
      });
    }

    /** Builds the radial; returns `null` if it should no longer be shown. */
    function buildRadial() {
      var current = runtime.interaction;
      if (!current) return null;
      var object = objectsModule.find(world, current.objectId);
      var actions = object ? objectsModule.actions(object) : [];
      if (!object || actions.length === 0 || interactionBlocked()) return null;

      var radial = ctx.el('div', {
        class: 'radial',
        role: 'group',
        'aria-label': t('travel.interaction_label'),
        onkeydown: onRadialKeydown
      });
      radial.appendChild(
        ctx.el('div', { class: 'radial-head' }, [
          ctx.el('div', { class: 'radial-title' }, [
            ctx.el('b', { text: t(object.nameKey) }),
            ctx.el('span', { text: t(object.descKey) })
          ]),
          ctx.el('button', {
            type: 'button',
            class: 'radial-close icon',
            text: '\u2715',
            'aria-label': t('common.close'),
            onclick: function () {
              closeInteraction();
            }
          })
        ])
      );
      var list = ctx.el('div', { class: 'radial-list' });
      actions.forEach(function (action, index) {
        var button = ctx.el('button', {
          type: 'button',
          class: 'radial-action' + (index === 0 ? ' is-target' : ''),
          'data-tutorial': 'travel-action',
          'data-action': action.id,
          onclick: function () {
            closeInteraction();
            applyObjectAction(current.playerId, object, action);
          }
        }, [
          ctx.el('b', { text: t(action.labelKey) }),
          action.estimateKey
            ? ctx.el('span', { class: 'estimate', text: t(action.estimateKey) })
            : null
        ]);
        list.appendChild(button);
      });
      if (object.item && !object.carriedBy) {
        list.appendChild(
          ctx.el('button', {
            type: 'button',
            class: 'radial-action',
            'data-tutorial': 'travel-action',
            'data-action': 'pickup',
            onclick: function () {
              closeInteraction();
              var result = playersModule.pickup(world, current.playerId, object.id);
              if (result && result.codes && typeof ctx.toastCodes === 'function') ctx.toastCodes(result.codes);
              invalidate();
            }
          }, [ctx.el('b', { text: t('travel.pickup') })])
        );
      }
      radial.appendChild(list);
      radial.appendChild(ctx.el('p', { class: 'radial-keys faint', text: t('travel.radial_keys') }));
      return radial;
    }

    /* --- Match utilities ---------------------------------------------- */

    function buildControls() {
      var wrap = ctx.el('div', { class: 'utility' });
      var row = ctx.el('div', { class: 'utility-row' });
      row.appendChild(ctx.el('button', { type: 'button', text: t('common.save'), onclick: saveGame }));
      row.appendChild(ctx.el('button', { type: 'button', text: t('common.export'), onclick: exportGame }));
      row.appendChild(
        ctx.el('button', {
          type: 'button',
          class: 'ghost',
          text: t('menu.back_to_title'),
          onclick: function () {
            if (win && typeof win.confirm === 'function' && !win.confirm(t('travel.confirm_exit'))) return;
            ctx.go('title');
          }
        })
      );
      wrap.appendChild(row);
      wrap.appendChild(ctx.el('p', { class: 'faint utility-hint', text: t('travel.canvas_hint') }));
      return wrap;
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
        sections.conflict.hidden =
          !conflictPower ||
          conflictPower.status === 'ok' ||
          !game.instruments.some(function (instrument) {
            return instrument.active;
          });
      }

      paint('controls', 'static:' + t('travel.controls'), buildControls);
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
              Math.round(member.stress),
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
          })
        }),
        buildSystems
      );

      paint(
        'instruments',
        JSON.stringify(
          game.instruments.map(function (instrument) {
            return [instrument.id, instrument.active];
          })
        ),
        buildInstruments
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

      var near = nearObject(selectedId());
      var actingPlayer = playersModule.byId(world, selectedId());
      var inventory = (actingPlayer || { inventory: [] }).inventory;
      var capacity = actingPlayer ? playersModule.capacityOf(world, actingPlayer) : 0;
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

      paint(
        'inventory',
        JSON.stringify({
          selected: selectedId(),
          inventory: inventory,
          capacity: capacity,
          targets: world.players.list.length,
          near: near ? near.id : null,
          item: near ? !!near.item : false,
          carried: near ? !!near.carriedBy : false
        }),
        buildInventory
      );

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

      // The radial closes itself only if the object leaves reach, if its
      // actions run out, or if an event, a vote or a pause appears.
      if (runtime.interaction) {
        var interactionObject = objectsModule.find(world, runtime.interaction.objectId);
        var liveActions = interactionObject ? objectsModule.actions(interactionObject) : [];
        if (interactionBlocked() || !interactionObject || liveActions.length === 0) runtime.interaction = null;
      }
      var interactionSignature = 'none';
      if (runtime.interaction) {
        var objectNow = objectsModule.find(world, runtime.interaction.objectId);
        interactionSignature = [
          runtime.interaction.playerId,
          runtime.interaction.objectId,
          objectsModule
            .actions(objectNow)
            .map(function (action) {
              return action.id;
            })
            .join(','),
          objectNow && objectNow.item ? 'item' : ''
        ].join('|');
      }
      var rebuilt = paint('interaction', interactionSignature, buildRadial);
      if (rebuilt) focusRadial();
    }

    function focusRadial() {
      if (!runtime.interaction || !doc || typeof setTimeout !== 'function') return;
      setTimeout(function () {
        if (!runtime.interaction) return;
        var radial = interactionHost.querySelector ? interactionHost.querySelector('.radial') : null;
        var first = radial ? radialActions(radial)[0] : null;
        if (first && doc.activeElement !== first) first.focus();
      }, 0);
    }

    /* --- Chip and radial position ------------------------------------- */

    function cellScreen(point) {
      if (!lastView || !point) return null;
      var viewport = lastView.viewport;
      var camera = lastView.camera;
      return renderer.toScreen(
        renderer.project(point),
        camera,
        { x: viewport.width / 2, y: viewport.height / 2 },
        camera.zoom
      );
    }

    function objectScreen(object) {
      var point = cellScreen(object);
      if (!point) return null;
      return { x: point.x, y: point.y - 14 * (lastView ? lastView.camera.zoom : 1) };
    }

    /** Object under the pointer (26 px radius around its drawn volume). */
    function objectAtPointer() {
      if (!pointer || !lastView) return null;
      var best = null;
      var bestDistance = 26;
      (map.objects || []).forEach(function (def) {
        var instance = world.objects && world.objects.items[def.id];
        if (instance && instance.carriedBy) return;
        var point = objectScreen(def);
        if (!point) return;
        var distance = Math.sqrt(Math.pow(point.x - pointer.x, 2) + Math.pow(point.y - pointer.y, 2));
        if (distance < bestDistance) {
          bestDistance = distance;
          best = def;
        }
      });
      return best;
    }

    function setChipContent(object) {
      if (!object) {
        if (!chip.hidden) chip.hidden = true;
        runtime.chipObject = null;
        return;
      }
      if (runtime.chipObject === object.id) return;
      runtime.chipObject = object.id;
      var binds = (input.bindings && (input.bindings[selectedId()] || input.bindings.p1)) || {};
      var key = keyLabel(binds.interact);
      ctx.clear(chip);
      chip.setAttribute('title', t('travel.interact_hint', { key: key }));
      chip.setAttribute('aria-label', t(object.nameKey));
      chip.appendChild(ctx.el('kbd', { text: key }));
      chip.appendChild(ctx.el('span', { class: 'travel-chip__name', text: t(object.nameKey) }));
    }

    function positionChip() {
      if (runtime.interaction) {
        setChipContent(null);
        return;
      }
      var hovered = runtime.hoverObject ? objectsModule.find(world, runtime.hoverObject) : null;
      var object = hovered || nearObject(selectedId());
      setChipContent(object);
      if (!object) return;
      var point = objectScreen(object);
      if (!point) return;
      var frameRect = frameNode.getBoundingClientRect ? frameNode.getBoundingClientRect() : null;
      var width = frameRect ? frameRect.width : 960;
      var height = frameRect ? frameRect.height : 540;
      var x = clamp(Math.round(point.x), 60, Math.max(60, width - 60));
      var y = clamp(Math.round(point.y - 30), 58, Math.max(58, height - 80));
      if (runtime.chipX !== x) {
        runtime.chipX = x;
        chip.style.left = x + 'px';
      }
      if (runtime.chipY !== y) {
        runtime.chipY = y;
        chip.style.top = y + 'px';
      }
      if (chip.hidden) chip.hidden = false;
    }

    function positionRadial() {
      var current = runtime.interaction;
      if (!current) return;
      var radial = interactionHost.querySelector ? interactionHost.querySelector('.radial') : null;
      if (!radial) return;
      var player = playersModule.byId(world, current.playerId);
      if (!player) return;
      var point = cellScreen(player);
      if (!point) return;
      var frameRect = frameNode.getBoundingClientRect ? frameNode.getBoundingClientRect() : null;
      var width = frameRect ? frameRect.width : 960;
      var height = frameRect ? frameRect.height : 540;
      var panelWidth = radial.offsetWidth || 200;
      var panelHeight = radial.offsetHeight || 160;
      var zoom = lastView ? lastView.camera.zoom : 1;
      var offset = 42 * zoom;
      var left = point.x + offset;
      if (left + panelWidth > width - 12) left = point.x - offset - panelWidth;
      left = clamp(Math.round(left), 10, Math.max(10, width - panelWidth - 10));
      var top = clamp(Math.round(point.y - panelHeight / 2), 10, Math.max(10, height - panelHeight - 10));
      if (runtime.radialLeft === left && runtime.radialTop === top) return;
      runtime.radialLeft = left;
      runtime.radialTop = top;
      radial.style.left = left + 'px';
      radial.style.top = top + 'px';
    }

    function updateHover() {
      var hovered = objectAtPointer();
      runtime.hoverObject = hovered ? hovered.id : null;
    }

    /* --- Pointer ------------------------------------------------------ */

    function pointerPosition(event) {
      if (!event) return null;
      var rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    function onCanvasMove(event) {
      pointer = pointerPosition(event);
    }

    function onCanvasLeave() {
      pointer = null;
      runtime.hoverObject = null;
    }

    /**
     * Click on the viewer: opens the radial of the pointed object (if the
     * selected player is within its reach) or of the nearest object; with a
     * radial already open, it closes it.
     */
    function onCanvasClick(event) {
      if (runtime.interaction) {
        closeInteraction();
        return;
      }
      if (interactionBlocked()) return;
      var point = pointerPosition(event);
      pointer = point;
      updateHover();
      var selected = selectedId();
      var target = runtime.hoverObject ? objectsModule.find(world, runtime.hoverObject) : null;
      var reachable = target && worldModule.nearest(world, selected, objectsModule.REACH);
      var object = null;
      if (target && reachable && reachable.object.id === target.id) object = target;
      else object = nearObject(selected);
      if (!object) return;
      var actions = objectsModule.actions(object);
      if (actions.length === 0) return;
      openRadial(selected, object);
    }

    /** Global Escape: closes the radial from any focus. */
    function onDocumentKeydown(event) {
      if (!event || event.key !== 'Escape' || !runtime.interaction) return;
      if (typeof event.preventDefault === 'function') event.preventDefault();
      closeInteraction();
    }

    if (canvas && typeof canvas.addEventListener === 'function') {
      canvas.addEventListener('click', onCanvasClick);
      canvas.addEventListener('mousemove', onCanvasMove);
      canvas.addEventListener('mouseleave', onCanvasLeave);
    }
    if (doc && typeof doc.addEventListener === 'function') doc.addEventListener('keydown', onDocumentKeydown);

    /* --- Loop --------------------------------------------------------- */

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
      if (canvas && typeof canvas.removeEventListener === 'function') {
        canvas.removeEventListener('click', onCanvasClick);
        canvas.removeEventListener('mousemove', onCanvasMove);
        canvas.removeEventListener('mouseleave', onCanvasLeave);
      }
      if (doc && typeof doc.removeEventListener === 'function') doc.removeEventListener('keydown', onDocumentKeydown);
      inputModule.detach(input);
    }

    /**
     * Cancels the movement of the player whose radial is open (V-4): the
     * rest of the group keeps moving, so the radial stays anchored to its owner.
     */
    function freezeActor(controls, playerId) {
      var out = {};
      Object.keys(controls || {}).forEach(function (id) {
        var table = controls[id] || {};
        out[id] =
          id === playerId
            ? { up: false, down: false, left: false, right: false, interact: !!table.interact }
            : {
                up: !!table.up,
                down: !!table.down,
                left: !!table.left,
                right: !!table.right,
                interact: !!table.interact
              };
      });
      return out;
    }

    function frame(timestamp) {
      if (destroyed) return;
      if (!lastTs) lastTs = timestamp;
      var delta = Math.min(250, Math.max(0, timestamp - lastTs));
      lastTs = timestamp;

      var controls = inputModule.poll(input);
      // Keyboard interaction (S33, V-4): one player is served per frame and
      // the other edges wait for the next one, so two keys pressed at the same
      // time do not step on each other.
      var interactQueue = (runtime.interactQueue || []).concat(interactFlanks(controls));
      runtime.interactQueue = [];
      if (interactQueue.length > 0) {
        var outcome = handleInteract(interactQueue[0]);
        runtime.interactQueue = outcome === 'blocked' ? [] : interactQueue.slice(1);
      }

      updateHover();
      worldModule.step(
        world,
        runtime.interaction ? freezeActor(controls, runtime.interaction.playerId) : controls,
        delta / 1000
      );
      var result = gameModule.tick(game, delta);

      if (game.status === 'report') {
        stop();
        if (typeof ctx.finishMission === 'function') ctx.finishMission();
        return;
      }

      if (canvasCtx) {
        sizeCanvas();
        var viewport = { width: canvas.width, height: canvas.height };
        var camera = renderer.computeCamera(map, world, viewport);
        lastView = { camera: camera, viewport: viewport };
        var near = nearObject(selectedId());
        renderer.render(canvasCtx, {
          map: map,
          game: { systems: game.systems, clock: game.clock },
          world: world,
          camera: camera,
          a11y: a11yOptions(),
          t: function (key) {
            return ctx.t(key);
          },
          viewport: viewport,
          time: game.clock.hours,
          selected: selectedId(),
          near: near ? near.id : null,
          hover: runtime.hoverObject || null
        });
      }

      paintAll();
      positionChip();
      positionRadial();
      rafId = raf(frame);
    }

    canvasCtx = canvas.getContext ? canvas.getContext('2d') : null;
    sizeCanvas();
    if (win && typeof win.addEventListener === 'function') win.addEventListener('resize', sizeCanvas);
    paintAll();
    rafId = raf(frame);

    // `refresh` repaints the HUD without waiting for the next frame: the smoke
    // tests and the panels that change outside the loop use it.
    return { id: 'travel', node: root, destroy: stop, refresh: paintAll };
  }

  return { create: create, ICON_GLYPHS: ICON_GLYPHS };
});
