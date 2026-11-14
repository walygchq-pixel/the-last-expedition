/*
 * Shell de la interfaz: router de pantallas, barra superior, avisos, glosario y
 * tooltips (E-2, E-3, I-2).
 *
 * Es el único módulo que conoce el DOM global. Las pantallas reciben este shell
 * como contexto y construyen su propio nodo; así el shell puede re-montar la
 * pantalla activa al cambiar de idioma sin recargar ni perder estado, porque
 * todas las decisiones viven en `shell.state` (I-2, S71).
 *
 * En Node el módulo se puede requerir: nada del DOM se ejecuta hasta `mount()`.
 */
(function (global, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(
      require('./designScreen.js'),
      require('./travelScreen.js'),
      require('./reportScreen.js'),
      require('./settingsScreen.js'),
      require('./tutorial.js'),
      require('../core/game.js'),
      require('../core/scoring.js'),
      require('../mission/catalog.js'),
      require('../mission/design.js'),
      require('../mission/objectives.js'),
      require('../storage/prefs.js'),
      require('../storage/saves.js'),
      require('../storage/transfer.js'),
      require('../storage/leaderboard.js')
    );
  } else {
    var GS = (global.GS = global.GS || {});
    GS.ui = GS.ui || {};
    GS.ui.shell = factory(
      GS.ui.designScreen,
      GS.ui.travelScreen,
      GS.ui.reportScreen,
      GS.ui.settingsScreen,
      GS.ui.tutorial,
      GS.core.game,
      GS.core.scoring,
      GS.mission.catalog,
      GS.mission.design,
      GS.mission.objectives,
      GS.storage.prefs,
      GS.storage.saves,
      GS.storage.transfer,
      GS.storage.leaderboard
    );
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (
  designScreen,
  travelScreen,
  reportScreen,
  settingsScreen,
  tutorial,
  gameModule,
  scoring,
  catalog,
  designModule,
  objectives,
  prefs,
  saves,
  transfer,
  leaderboard
) {
  'use strict';

  var SCREEN_FACTORIES = {
    design: designScreen,
    travel: travelScreen,
    report: reportScreen,
    compare: reportScreen,
    settings: settingsScreen
  };

  var ROLE_ORDER = ['mission_planner', 'engineer', 'scientist', 'communications', 'medic_cook'];

  function appendChildren(doc, node, children) {
    if (children === null || children === undefined || children === false) return;
    if (Array.isArray(children)) {
      children.forEach(function (child) {
        appendChildren(doc, node, child);
      });
      return;
    }
    if (typeof children === 'string' || typeof children === 'number') {
      node.appendChild(doc.createTextNode(String(children)));
      return;
    }
    if (children && children.nodeType) node.appendChild(children);
  }

  /** Crea un elemento con atributos, texto, hijos y manejadores en un solo paso. */
  function makeElement(doc) {
    return function el(tag, attrs, children) {
      var node = doc.createElement(tag);
      if (attrs) {
        Object.keys(attrs).forEach(function (key) {
          var value = attrs[key];
          if (value === null || value === undefined || value === false) return;
          if (key === 'class' || key === 'className') {
            node.className = value;
          } else if (key === 'text') {
            node.textContent = value;
          } else if (key === 'hidden') {
            node.hidden = !!value;
          } else if (key === 'checked') {
            node.checked = !!value;
          } else if (key === 'value') {
            node.setAttribute('value', String(value));
            node.value = value;
          } else if (key === 'style' && typeof value === 'string') {
            node.setAttribute('style', value);
          } else if (key.indexOf('on') === 0 && typeof value === 'function') {
            node.addEventListener(key.slice(2), value);
          } else if (value === true) {
            node.setAttribute(key, '');
          } else {
            node.setAttribute(key, String(value));
          }
        });
      }
      appendChildren(doc, node, children);
      return node;
    };
  }

  /**
   * Monta el shell sobre un contenedor. Devuelve el objeto `shell` que consumen
   * las pantallas, `js/main.js` y la consola de depuración.
   */
  function mount(options) {
    var opts = options || {};
    var doc = opts.document || (typeof document !== 'undefined' ? document : null);
    var win = opts.window || (typeof window !== 'undefined' ? window : null);
    var translator = opts.translator;
    var el = makeElement(doc);
    var currentPrefs = prefs.get();

    var state = {
      screen: 'title',
      history: [],
      mode: 'campaign',
      scenarioId: (catalog.scenarios()[0] || {}).id || null,
      difficultyId: currentPrefs.lastDifficulty || 'basic',
      playerCount: 1,
      roles: ['engineer'],
      design: null,
      game: null,
      world: null,
      worldInput: null,
      runtime: {},
      report: null,
      analysis: null,
      compare: null,
      lbRank: null,
      tutorialStep: 0,
      tutorialDismissed: false,
      tutorialHighlight: null,
      settingsCapture: null,
      screenHandle: null,
      overlayReturnFocus: null
    };

    var toasts = [];
    var overlayNode = null;
    var overlayKeyHandler = null;

    /* --- Traducción con parámetros que son claves -------------------- */

    function resolveParams(params) {
      if (!params || typeof params !== 'object') return params;
      var out = {};
      Object.keys(params).forEach(function (key) {
        var value = params[key];
        if (typeof value === 'string' && value.indexOf('.') !== -1 && translator.has(value)) {
          out[key] = translator.t(value);
        } else {
          out[key] = value;
        }
      });
      return out;
    }

    function t(key, params) {
      return translator.t(key, resolveParams(params));
    }

    /* --- Preferencias y accesibilidad -------------------------------- */

    function getPrefs() {
      return currentPrefs;
    }

    function setPrefs(patch) {
      var result = prefs.set(patch || {});
      currentPrefs = result.prefs || prefs.get();
      applyAccessibility();
      return result;
    }

    function applyAccessibility() {
      if (!doc) return;
      var html = doc.documentElement;
      if (!html) return;
      html.setAttribute('lang', translator.locale());
      html.classList.toggle('text-large', currentPrefs.textSize === 'large');
      html.classList.toggle('text-xlarge', currentPrefs.textSize === 'xlarge');
      html.classList.toggle('contrast-high', !!currentPrefs.highContrast);
      html.classList.toggle('reduce-motion', !!currentPrefs.reduceMotion);
      if (doc.title !== undefined) doc.title = t('app.title');
    }

    /* --- Avisos ------------------------------------------------------ */

    function toast(entry) {
      if (!doc) return null;
      var source = typeof entry === 'string' ? { code: entry } : entry || {};
      var host = doc.getElementById('toasts');
      if (!host) return null;
      var node = el('div', {
        class: 'toast is-' + (source.severity || 'info')
      }, [el('span', { text: t(source.code, source.params) })]);
      host.appendChild(node);
      toasts.push(node);
      while (toasts.length > 4) {
        var old = toasts.shift();
        if (old && old.parentNode) old.parentNode.removeChild(old);
      }
      if (typeof setTimeout === 'function') {
        setTimeout(function () {
          if (node.parentNode) node.parentNode.removeChild(node);
          toasts = toasts.filter(function (item) {
            return item !== node;
          });
        }, 6000);
      }
      return node;
    }

    function toastCodes(codes) {
      (codes || []).forEach(function (entry) {
        toast(entry);
      });
    }

    /* --- Tooltips reutilizables (E-3) ------------------------------- */

    function tooltipNode() {
      var node = doc.getElementById('tooltip');
      if (node) return node;
      node = el('div', { id: 'tooltip', class: 'tooltip', role: 'tooltip', hidden: true });
      if (doc.body) doc.body.appendChild(node);
      return node;
    }

    function placeTooltip(node, target) {
      if (!target || typeof target.getBoundingClientRect !== 'function') return;
      var rect = target.getBoundingClientRect();
      var width = win && win.innerWidth ? win.innerWidth : 1280;
      var height = win && win.innerHeight ? win.innerHeight : 800;
      node.style.left = Math.max(8, Math.min(rect.left, width - 340)) + 'px';
      var top = rect.bottom + 6;
      if (top > height - 80) top = Math.max(8, rect.top - 60);
      node.style.top = top + 'px';
    }

    /** Asocia un tooltip a un nodo; el texto se calcula al mostrarlo (idioma vivo). */
    function tooltip(target, content) {
      if (!target || typeof target.addEventListener !== 'function') return target;
      function show() {
        var text;
        try {
          text = typeof content === 'function' ? content() : content;
        } catch (error) {
          text = '';
        }
        if (!text) return;
        var node = tooltipNode();
        node.textContent = text;
        node.hidden = false;
        placeTooltip(node, target);
      }
      function hide() {
        var node = doc.getElementById('tooltip');
        if (node) node.hidden = true;
      }
      target.addEventListener('mouseenter', show);
      target.addEventListener('focus', show);
      target.addEventListener('mouseleave', hide);
      target.addEventListener('blur', hide);
      target.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') hide();
      });
      return target;
    }

    /* --- Superposiciones -------------------------------------------- */

    function focusables(container) {
      if (!container || typeof container.querySelectorAll !== 'function') return [];
      return Array.prototype.slice.call(
        container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
      );
    }

    function closeOverlay() {
      if (overlayKeyHandler && doc && typeof doc.removeEventListener === 'function') {
        doc.removeEventListener('keydown', overlayKeyHandler, true);
        overlayKeyHandler = null;
      }
      var host = doc.getElementById('overlays');
      if (host) {
        Array.prototype.slice.call(host.children).forEach(function (child) {
          if (child.getAttribute('data-keep') !== 'tutorial') host.removeChild(child);
        });
      }
      overlayNode = null;
      var back = state.overlayReturnFocus;
      state.overlayReturnFocus = null;
      if (back && typeof back.focus === 'function') back.focus();
    }

    function openOverlay(build) {
      if (!doc) return null;
      var host = doc.getElementById('overlays');
      if (!host) return null;
      state.overlayReturnFocus = doc.activeElement;
      var overlay = el('div', { class: 'overlay' });
      var dialog = el('div', {
        class: 'dialog',
        role: 'dialog',
        'aria-modal': 'true'
      });
      var content = build(dialog);
      if (content) dialog.appendChild(content);
      overlay.appendChild(dialog);
      overlay.addEventListener('click', function (event) {
        if (event.target === overlay) closeOverlay();
      });
      host.appendChild(overlay);
      overlayNode = overlay;
      overlayKeyHandler = function (event) {
        if (!overlayNode) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          closeOverlay();
          return;
        }
        if (event.key === 'Tab') {
          var items = focusables(dialog);
          if (items.length === 0) return;
          var firstItem = items[0];
          var lastItem = items[items.length - 1];
          if (event.shiftKey && doc.activeElement === firstItem) {
            event.preventDefault();
            lastItem.focus();
          } else if (!event.shiftKey && doc.activeElement === lastItem) {
            event.preventDefault();
            firstItem.focus();
          }
        }
      };
      doc.addEventListener('keydown', overlayKeyHandler, true);
      var first = focusables(dialog)[0];
      if (first) first.focus();
      return dialog;
    }

    /** Glosario accesible desde cualquier pantalla (E-2, S63). */
    function openGlossary(termId) {
      if (!doc) return;
      closeOverlay();
      openOverlay(function (dialog) {
        var head = el('div', { class: 'dialog__head' }, [
          el('h2', { id: 'glossary-title', text: t('glossary.title') }),
          el('button', { type: 'button', text: t('common.close'), onclick: closeOverlay })
        ]);
        dialog.setAttribute('aria-labelledby', 'glossary-title');
        var body = el('div', { class: 'dialog__body' });
        var search = el('input', {
          type: 'search',
          'aria-label': t('glossary.search'),
          placeholder: t('glossary.search')
        });
        body.appendChild(search);
        var list = el('dl', { class: 'glossary-list' });
        var terms = [];
        try {
          terms = catalog.glossary() || [];
        } catch (error) {
          terms = [];
        }
        if (terms.length === 0) {
          body.appendChild(el('p', { class: 'muted', text: t('glossary.empty') }));
        }
        terms.forEach(function (term) {
          var box = el('div', {
            class: 'glossary-term' + (termId === term.id ? ' is-target' : ''),
            'data-term': term.id,
            tabindex: termId === term.id ? '-1' : null
          }, [
            el('dt', { text: t(term.termKey) }),
            el('dd', { text: t(term.defKey) })
          ]);
          list.appendChild(box);
        });
        body.appendChild(list);
        search.addEventListener('input', function () {
          var needle = String(search.value || '').toLowerCase();
          Array.prototype.forEach.call(list.children, function (item) {
            var text = String(item.textContent || '').toLowerCase();
            item.hidden = needle !== '' && text.indexOf(needle) === -1;
          });
        });
        var target = termId ? list.querySelector('.glossary-term.is-target') : null;
        if (target) {
          search.addEventListener('focus', function () {
            target.scrollIntoView({ block: 'center' });
          });
        }
        body.appendChild(list);
        body.appendChild(el('div', { class: 'dialog__actions' }, [
          el('button', { type: 'button', text: t('common.close'), onclick: closeOverlay })
        ]));
        dialog.appendChild(head);
        dialog.appendChild(body);
        return null;
      });
    }

    /** Repaso del tutorial desde el menú, sin activarlo en la partida. */
    function showTutorialOverview() {
      if (!doc) return;
      closeOverlay();
      openOverlay(function (dialog) {
        dialog.classList.add('dialog--narrow');
        dialog.setAttribute('aria-labelledby', 'tutorial-title');
        dialog.appendChild(el('h2', { id: 'tutorial-title', text: t('tutorial.title') }));
        dialog.appendChild(tutorial.create(shell, { preview: true }));
        return null;
      });
    }

    /* --- Tutorial ---------------------------------------------------- */

    function renderTutorial() {
      if (!doc) return;
      tutorial.clearHighlight(shell);
      var host = doc.getElementById('tutorial-host');
      if (!host) {
        host = el('div', { id: 'tutorial-host', 'data-keep': 'tutorial' });
        var overlays = doc.getElementById('overlays');
        if (overlays) overlays.appendChild(host);
      }
      if (!host) return;
      while (host.firstChild) host.removeChild(host.firstChild);
      var visible = state.screen === 'design' || state.screen === 'travel';
      if (!visible || !tutorial.isActive(currentPrefs, state.difficultyId, state)) return;
      var info = tutorial.currentStep(shell);
      host.appendChild(tutorial.create(shell));
      if (info.step && info.step.target) tutorial.highlight(shell, info.step.target);
    }

    function notifyTutorial(eventId) {
      return tutorial.notify(shell, eventId);
    }

    /* --- Router ------------------------------------------------------ */

    function buildTopbar() {
      var bar = doc.getElementById('topbar');
      if (!bar) return;
      while (bar.firstChild) bar.removeChild(bar.firstChild);
      bar.appendChild(
        el('button', {
          type: 'button',
          class: 'brand',
          text: t('app.title'),
          onclick: function () {
            go('title');
          }
        })
      );
      var context = null;
      if (state.game) {
        context = t('topbar.mission', {
          scenario: t('scenario.' + state.game.scenarioId + '.name'),
          difficulty: t('diff.' + state.game.difficultyId + '.name')
        });
      } else if (state.design) {
        context = t('topbar.design', {
          scenario: t('scenario.' + state.design.scenarioId + '.name'),
          difficulty: t('diff.' + state.design.difficultyId + '.name')
        });
      }
      if (context) bar.appendChild(el('span', { class: 'context', text: context }));
      bar.appendChild(el('span', { class: 'spacer' }));
      var nextLocale = translator.locale() === 'es' ? 'en' : 'es';
      bar.appendChild(
        el('button', {
          type: 'button',
          text: t(nextLocale === 'es' ? 'settings.language_es' : 'settings.language_en'),
          'aria-label': t('settings.language_toggle'),
          onclick: function () {
            setLanguage(nextLocale);
          }
        })
      );
      bar.appendChild(
        el('button', {
          type: 'button',
          text: t('menu.glossary'),
          onclick: function () {
            openGlossary();
          }
        })
      );
      bar.appendChild(
        el('button', {
          type: 'button',
          text: t('menu.settings'),
          onclick: function () {
            go('settings');
          }
        })
      );
      if (state.screen !== 'title') {
        bar.appendChild(
          el('button', {
            type: 'button',
            class: 'ghost',
            text: t('common.back'),
            onclick: function () {
              back();
            }
          })
        );
      }
    }

    function buildTitle() {
      var actions = el('div', { class: 'title-actions' });
      actions.appendChild(
        el('button', {
          type: 'button',
          class: 'primary',
          text: t('menu.new_game'),
          onclick: function () {
            go('setup');
          }
        })
      );
      var saved = [];
      try {
        saved = saves.listSaves();
      } catch (error) {
        saved = [];
      }
      var continueButton = el('button', {
        type: 'button',
        text: t('menu.continue'),
        disabled: saved.length === 0,
        onclick: continueSaved
      });
      tooltip(continueButton, function () {
        return saved.length === 0 ? t('save.none') : t('save.continue_hint', { count: saved.length });
      });
      actions.appendChild(continueButton);
      actions.appendChild(
        el('button', {
          type: 'button',
          text: t('menu.comparator'),
          onclick: function () {
            go('compare');
          }
        })
      );
      actions.appendChild(
        el('button', {
          type: 'button',
          text: t('menu.leaderboard'),
          onclick: function () {
            go('leaderboard');
          }
        })
      );
      actions.appendChild(
        el('button', {
          type: 'button',
          text: t('menu.tutorial'),
          onclick: showTutorialOverview
        })
      );
      actions.appendChild(
        el('button', {
          type: 'button',
          text: t('menu.settings'),
          onclick: function () {
            go('settings');
          }
        })
      );
      actions.appendChild(
        el('button', {
          type: 'button',
          text: t('menu.glossary'),
          onclick: function () {
            openGlossary();
          }
        })
      );
      return el('section', { class: 'title-screen', 'aria-label': t('app.title') }, [
        el('h1', { text: t('app.title') }),
        el('p', { class: 'muted', text: t('app.subtitle') }),
        el('p', { class: 'faint', text: t('app.tagline') }),
        actions
      ]);
    }

    function buildSetup() {
      var root = el('section', { id: 'setup-screen', class: 'stack', 'aria-label': t('setup.title') });
      root.appendChild(el('h1', { text: t('setup.title') }));

      // Modo (M-1 … M-4).
      var modes = el('div', { class: 'setup-grid' });
      [
        { id: 'campaign', note: 'setup.note_campaign' },
        { id: 'sandbox', note: 'setup.note_sandbox' },
        { id: 'competitive', note: 'setup.note_competitive' },
        { id: 'coop', note: 'setup.note_coop' }
      ].forEach(function (mode) {
        modes.appendChild(
          el('button', {
            type: 'button',
            class: 'choice' + (state.mode === mode.id ? ' is-selected' : ''),
            'aria-pressed': state.mode === mode.id ? 'true' : 'false',
            onclick: function () {
              state.mode = mode.id;
              render(true);
            }
          }, [
            el('strong', { text: t('mode.' + mode.id + '.name') }),
            el('span', { text: t('mode.' + mode.id + '.desc') }),
            el('span', { text: t(mode.note) })
          ])
        );
      });
      root.appendChild(cardWith('setup.mode', modes));

      // Escenario (DM-12).
      var scenarios = el('div', { class: 'setup-grid' });
      catalog.scenarios().forEach(function (scenario) {
        var objective = catalog.findObjective(scenario.objectiveId);
        scenarios.appendChild(
          el('button', {
            type: 'button',
            class: 'choice' + (state.scenarioId === scenario.id ? ' is-selected' : ''),
            'aria-pressed': state.scenarioId === scenario.id ? 'true' : 'false',
            onclick: function () {
              state.scenarioId = scenario.id;
              render(true);
            }
          }, [
            el('strong', { text: t(scenario.nameKey) }),
            el('span', { text: t(scenario.descKey) }),
            el('span', {
              text: t('setup.scenario_meta', {
                objective: objective ? t(objective.nameKey) : t('common.none'),
                critical: t('res.' + (scenario.critical || 'power') + '.name'),
                data: translator.formatUnit(scenario.requiredData || 0, 'unit.kb')
              })
            })
          ])
        );
      });
      root.appendChild(cardWith('setup.scenario', scenarios));

      // Dificultad (DM-13, S-10, S-11).
      var difficulties = el('div', { class: 'setup-grid' });
      ['basic', 'intermediate', 'advanced'].forEach(function (difficultyId) {
        var profile = gameModuleProfile(difficultyId);
        difficulties.appendChild(
          el('button', {
            type: 'button',
            class: 'choice' + (state.difficultyId === difficultyId ? ' is-selected' : ''),
            'aria-pressed': state.difficultyId === difficultyId ? 'true' : 'false',
            onclick: function () {
              state.difficultyId = difficultyId;
              setPrefs({ lastDifficulty: difficultyId });
              render(true);
            }
          }, [
            el('strong', { text: t('diff.' + difficultyId + '.name') }),
            el('span', { text: t('diff.' + difficultyId + '.desc') }),
            el('span', {
              text: t('setup.difficulty_meta', {
                budget: translator.formatUnit(profile.budget, 'unit.meur'),
                days: translator.formatUnit(profile.missionDays, 'unit.days')
              })
            })
          ])
        );
      });
      root.appendChild(cardWith('setup.difficulty', difficulties));

      // Jugadores y roles (S7, S9).
      var crewBox = el('div', { class: 'stack' });
      var counts = el('div', { class: 'row' });
      for (var count = 1; count <= 4; count += 1) {
        counts.appendChild(
          el('button', {
            type: 'button',
            'aria-pressed': state.playerCount === count ? 'true' : 'false',
            text: translator.formatNumber(count),
            'aria-label': t('setup.players_count', { count: count }),
            onclick: function () {
              setPlayerCount(count);
              render(true);
            }
          })
        );
      }
      crewBox.appendChild(counts);
      if (state.playerCount === 1) crewBox.appendChild(el('p', { class: 'faint', text: t('setup.note_solo') }));
      var roles = el('div', { class: 'grid cols-2' });
      for (var index = 0; index < state.playerCount; index += 1) {
        (function (playerIndex) {
          var select = el('select', { 'aria-label': t('setup.role_for', { player: playerIndex + 1 }) });
          ROLE_ORDER.forEach(function (role) {
            select.appendChild(el('option', { value: role, text: t('role.' + role + '.name') }));
          });
          select.value = state.roles[playerIndex] || 'engineer';
          select.addEventListener('change', function () {
            state.roles[playerIndex] = select.value;
          });
          roles.appendChild(
            el('div', { class: 'stack' }, [
              el('label', { text: t('setup.role_for', { player: playerIndex + 1 }) }),
              select,
              el('span', { class: 'faint', text: t('role.' + select.value + '.desc') })
            ])
          );
        })(index);
      }
      crewBox.appendChild(roles);
      root.appendChild(cardWith('setup.players', crewBox));

      root.appendChild(
        el('div', { class: 'row' }, [
          el('button', {
            type: 'button',
            class: 'primary',
            text: t('setup.start'),
            onclick: startDesign
          }),
          el('button', {
            type: 'button',
            class: 'ghost',
            text: t('common.back'),
            onclick: function () {
              go('title');
            }
          })
        ])
      );
      return root;
    }

    function cardWith(titleKey, content) {
      return el('section', { class: 'card stack' }, [el('h2', { text: t(titleKey) }), content]);
    }

    function gameModuleProfile(difficultyId) {
      return designModule.profileOf({ difficultyId: difficultyId });
    }

    function setPlayerCount(count) {
      state.playerCount = Math.max(1, Math.min(4, count));
      var defaults = ['engineer', 'medic_cook', 'scientist', 'communications'];
      var next = [];
      for (var i = 0; i < state.playerCount; i += 1) {
        next.push(state.roles[i] || defaults[i] || 'engineer');
      }
      state.roles = next;
    }

    function buildLeaderboard() {
      var root = el('section', { id: 'leaderboard-screen', class: 'stack', 'aria-label': t('lb.title') });
      root.appendChild(el('h1', { text: t('lb.title') }));
      var scenarioFilter = el('select', { 'aria-label': t('lb.scenario') });
      scenarioFilter.appendChild(el('option', { value: '', text: t('lb.all_scenarios') }));
      catalog.scenarios().forEach(function (scenario) {
        scenarioFilter.appendChild(el('option', { value: scenario.id, text: t(scenario.nameKey) }));
      });
      var difficultyFilter = el('select', { 'aria-label': t('lb.difficulty') });
      difficultyFilter.appendChild(el('option', { value: '', text: t('lb.all_difficulties') }));
      ['basic', 'intermediate', 'advanced'].forEach(function (difficultyId) {
        difficultyFilter.appendChild(el('option', { value: difficultyId, text: t('diff.' + difficultyId + '.name') }));
      });
      var tableHost = el('div', { class: 'card stack' });

      function paintTable() {
        while (tableHost.firstChild) tableHost.removeChild(tableHost.firstChild);
        var entries = leaderboard.list(scenarioFilter.value, difficultyFilter.value);
        if (entries.length === 0) {
          tableHost.appendChild(el('p', { class: 'muted', text: t('lb.empty') }));
          return;
        }
        var table = el('table', { class: 'table' });
        table.appendChild(
          el('thead', null, [
            el('tr', null, [
              el('th', { text: t('lb.rank') }),
              el('th', { text: t('lb.scenario') }),
              el('th', { text: t('lb.difficulty') }),
              el('th', { text: t('lb.score') }),
              el('th', { text: t('lb.end_day') }),
              el('th', { text: t('lb.result') })
            ])
          ])
        );
        var body = el('tbody');
        entries.forEach(function (entry, index) {
          body.appendChild(
            el('tr', null, [
              el('td', { text: translator.formatNumber(index + 1) }),
              el('td', { text: t('scenario.' + entry.scenarioId + '.name') }),
              el('td', { text: t('diff.' + entry.difficultyId + '.name') }),
              el('td', { text: translator.formatNumber(entry.score) }),
              el('td', { text: translator.formatNumber(entry.endDay) }),
              el('td', { text: t('report.outcome.' + entry.outcome) })
            ])
          );
        });
        table.appendChild(body);
        tableHost.appendChild(table);
      }

      scenarioFilter.addEventListener('change', paintTable);
      difficultyFilter.addEventListener('change', paintTable);
      root.appendChild(el('div', { class: 'row' }, [scenarioFilter, difficultyFilter]));
      root.appendChild(tableHost);
      root.appendChild(
        el('div', { class: 'row' }, [
          el('button', {
            type: 'button',
            class: 'danger',
            text: t('lb.clear'),
            onclick: function () {
              if (win && typeof win.confirm === 'function' && !win.confirm(t('lb.confirm_clear'))) return;
              leaderboard.clear();
              paintTable();
            }
          }),
          el('button', {
            type: 'button',
            class: 'ghost',
            text: t('common.back'),
            onclick: function () {
              back();
            }
          })
        ])
      );
      paintTable();
      return root;
    }

    function render(focusScreen) {
      if (!doc || !translator) return shell;
      if (state.screenHandle && typeof state.screenHandle.destroy === 'function') {
        try {
          state.screenHandle.destroy();
        } catch (error) {
          if (opts.logger && opts.logger.error) opts.logger.error(error);
        }
      }
      state.screenHandle = null;
      buildTopbar();
      var host = doc.getElementById('screen');
      if (!host) return shell;
      while (host.firstChild) host.removeChild(host.firstChild);
      var handle = null;
      if (state.screen === 'title') handle = { id: 'title', node: buildTitle() };
      else if (state.screen === 'setup') handle = { id: 'setup', node: buildSetup() };
      else if (state.screen === 'leaderboard') handle = { id: 'leaderboard', node: buildLeaderboard() };
      else if (SCREEN_FACTORIES[state.screen]) handle = SCREEN_FACTORIES[state.screen].create(shell);
      if (!handle) handle = { id: state.screen, node: buildTitle() };
      state.screenHandle = handle;
      host.appendChild(handle.node);
      renderTutorial();
      if (focusScreen) {
        host.focus();
      }
      return shell;
    }

    function go(screen, options) {
      var next = options || {};
      if (screen !== state.screen) {
        state.history.push(state.screen);
        if (state.history.length > 30) state.history.shift();
      }
      state.screen = screen;
      return render(next.focus !== false);
    }

    function back() {
      var previous = state.history.pop();
      state.screen = previous || 'title';
      return render(true);
    }

    function rerender() {
      return render(false);
    }

    function setLanguage(locale) {
      setPrefs({ locale: locale });
      // `translator.setLocale` dispara `onChange`, que re-aplica accesibilidad y
      // vuelve a montar la pantalla activa sin recargar (I-2, S71).
      translator.setLocale(locale);
      applyAccessibility();
      return translator.locale();
    }

    function startDesign() {
      state.design = designModule.createDesign({
        scenarioId: state.scenarioId,
        difficultyId: state.difficultyId,
        mode: state.mode
      });
      state.game = null;
      state.world = null;
      state.worldInput = null;
      state.runtime = {};
      setPrefs({ lastScenario: state.scenarioId, lastDifficulty: state.difficultyId });
      return go('design');
    }

    function startTravel(design) {
      var scenario = catalog.findScenario(design.scenarioId);
      var players = state.roles.slice(0, state.playerCount).map(function (role, index) {
        return { id: 'p' + (index + 1), role: role };
      });
      var game = gameModule.createGame({
        mode: state.mode,
        scenario: scenario,
        difficulty: designModule.profileOf(design),
        design: designModule.toGameDesign(design),
        players: players,
        seed: designModule.seedFor(design, Date.now()),
        catalogs: { events: catalog.events(), food: catalog.foodItems() },
        evaluateObjective: objectives.runtime,
        now: Date.now()
      });
      state.game = game;
      state.design = design;
      state.world = null;
      state.worldInput = null;
      state.runtime = {};
      state.report = null;
      state.analysis = null;
      tutorial.notify(shell, 'launch_check');
      return go('travel');
    }

    function continueSaved() {
      var list = [];
      try {
        list = saves.listSaves();
      } catch (error) {
        list = [];
      }
      if (list.length === 0) {
        toast({ code: 'save.none', severity: 'warn' });
        return;
      }
      var payload = saves.loadGame(list[0].id);
      if (!payload) {
        toast({ code: 'save.not_found', severity: 'warn' });
        return;
      }
      var game = gameModule.restoreGame(payload.state, {
        events: catalog.events(),
        food: catalog.foodItems(),
        evaluateObjective: objectives.runtime
      });
      state.game = game;
      state.scenarioId = game.scenarioId;
      state.difficultyId = game.difficultyId;
      state.mode = game.mode;
      state.design = null;
      state.world = null;
      state.worldInput = null;
      state.runtime = {};
      if (game.status === 'report' && game.report) {
        state.report = game.report;
        state.analysis = scoring.analyze(game.report);
        go('report');
      } else {
        go('travel');
      }
      toast({ code: 'save.loaded' });
    }

    function finishMission() {
      var game = state.game;
      if (!game) return;
      state.report = game.report || null;
      state.analysis = state.report ? scoring.analyze(state.report) : null;
      state.lbRank = null;
      if (state.report && state.report.mode !== 'sandbox') {
        var added = leaderboard.add(state.report);
        if (added && added.ok) state.lbRank = added.rank;
      }
      if (tutorial.isActive(currentPrefs, state.difficultyId, state)) {
        tutorial.markSeen(shell);
      }
      go('report');
      if (state.lbRank) toast({ code: 'lb.added', params: { rank: state.lbRank } });
    }

    /** Vacía un contenedor sin reconstruir la pantalla (S5). */
    function clear(node) {
      if (!node) return node;
      while (node.firstChild) node.removeChild(node.firstChild);
      return node;
    }

    var shell = {
      state: state,
      el: el,
      clear: clear,
      t: t,
      tr: translator,
      doc: doc,
      win: win,
      getPrefs: getPrefs,
      setPrefs: setPrefs,
      applyAccessibility: applyAccessibility,
      setLanguage: setLanguage,
      toast: toast,
      toastCodes: toastCodes,
      tooltip: tooltip,
      openGlossary: openGlossary,
      closeOverlay: closeOverlay,
      showTutorialOverview: showTutorialOverview,
      renderTutorial: renderTutorial,
      notifyTutorial: notifyTutorial,
      go: go,
      back: back,
      rerender: rerender,
      startDesign: startDesign,
      startTravel: startTravel,
      continueSaved: continueSaved,
      finishMission: finishMission
    };

    // El cambio de idioma re-renderiza sin recargar y conserva `state` (I-2).
    translator.onChange(function () {
      applyAccessibility();
      render(false);
    });

    shell.start = function start() {
      applyAccessibility();
      state.screen = 'title';
      return render(true);
    };

    return shell;
  }

  return { mount: mount, SCREEN_FACTORIES: SCREEN_FACTORIES };
});
