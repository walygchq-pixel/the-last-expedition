/*
 * Settings (I-2, E-5, S-18, RG-8).
 *
 * Language, text size, contrast, animations, captions, tutorial and per-player
 * control rebinding. Changes apply at once: the language changes without
 * reloading (I-2) and the accessibility classes live on `<html>` so they scale
 * the whole design (S66). They are persisted with `storage/prefs`, which only
 * stores keys and values (I-10).
 */
(function (global, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('../world/input.js'), require('../storage/prefs.js'));
  } else {
    var GS = (global.GS = global.GS || {});
    GS.ui = GS.ui || {};
    GS.ui.settingsScreen = factory(GS.world.input, GS.storage.prefs);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (inputModule, prefs) {
  'use strict';

  var PLAYER_IDS = ['p1', 'p2', 'p3', 'p4'];

  /** Complete settings screen. */
  function create(ctx) {
    var t = ctx.t;
    var root = ctx.el('section', { id: 'settings-screen', class: 'stack', 'aria-label': t('settings.title') });

    var current = ctx.getPrefs();
    var input = inputModule.createInput(current.bindings || inputModule.defaults());
    var capture = ctx.state.settingsCapture || null;
    var captureHandler = null;

    function persist(patch, messageKey) {
      ctx.setPrefs(patch);
      if (messageKey) ctx.toast({ code: messageKey });
      ctx.rerender();
    }

    function stopCapture() {
      if (captureHandler && ctx.doc && typeof ctx.doc.removeEventListener === 'function') {
        ctx.doc.removeEventListener('keydown', captureHandler, true);
      }
      captureHandler = null;
      ctx.state.settingsCapture = null;
      capture = null;
    }

    /**
     * Waits for the next key to rebind it (RG-8). Does not re-render: it changes
     * only the button label, so the listener is not lost with the re-mount.
     */
    function startCapture(playerId, action, buttonNode) {
      stopCapture();
      ctx.state.settingsCapture = { playerId: playerId, action: action };
      capture = ctx.state.settingsCapture;
      if (buttonNode) {
        buttonNode.textContent = t('settings.press_key');
        buttonNode.classList.add('is-selected');
      }
      if (!ctx.doc || typeof ctx.doc.addEventListener !== 'function') return;
      captureHandler = function (event) {
        if (event.type !== 'keydown') return;
        event.preventDefault();
        if (event.code === 'Escape') {
          stopCapture();
          ctx.rerender();
          return;
        }
        inputModule.bind(input, playerId, action, event.code);
        stopCapture();
        persist({ bindings: cloneBindings(input.bindings) }, 'settings.saved');
      };
      ctx.doc.addEventListener('keydown', captureHandler, true);
    }

    function cloneBindings(bindings) {
      var out = {};
      Object.keys(bindings || {}).forEach(function (playerId) {
        out[playerId] = Object.assign({}, bindings[playerId]);
      });
      return out;
    }

    function resetPlayer(playerId) {
      var defaults = inputModule.defaults();
      input.bindings[playerId] = Object.assign({}, defaults[playerId]);
      persist({ bindings: cloneBindings(input.bindings) }, 'settings.saved');
    }

    /* --- Language ---------------------------------------------------- */

    function languageSection() {
      var card = ctx.el('section', { class: 'card settings-section' }, [
        ctx.el('h2', { text: t('settings.language') }),
        ctx.el('p', { class: 'faint', text: t('settings.language_hint') })
      ]);
      var options = ctx.el('div', { class: 'settings-options', role: 'group', 'aria-label': t('settings.language') });
      [
        { locale: 'en', labelKey: 'settings.language_en' },
        { locale: 'es', labelKey: 'settings.language_es' }
      ].forEach(function (option) {
        options.appendChild(
          ctx.el('button', {
            type: 'button',
            'aria-pressed': ctx.tr.locale() === option.locale ? 'true' : 'false',
            text: t(option.labelKey),
            onclick: function () {
              ctx.setLanguage(option.locale);
            }
          })
        );
      });
      card.appendChild(options);
      return card;
    }

    /* --- Accessibility ----------------------------------------------- */

    function accessibilitySection() {
      var card = ctx.el('section', { class: 'card settings-section' }, [ctx.el('h2', { text: t('settings.accessibility') })]);

      card.appendChild(ctx.el('h3', { text: t('a11y.text_size') }));
      var sizes = ctx.el('div', { class: 'settings-options', role: 'group', 'aria-label': t('a11y.text_size') });
      [
        { size: 'normal', labelKey: 'a11y.text_size_normal' },
        { size: 'large', labelKey: 'a11y.text_size_large' },
        { size: 'xlarge', labelKey: 'a11y.text_size_xlarge' }
      ].forEach(function (option) {
        sizes.appendChild(
          ctx.el('button', {
            type: 'button',
            'aria-pressed': current.textSize === option.size ? 'true' : 'false',
            text: t(option.labelKey),
            onclick: function () {
              ctx.setPrefs({ textSize: option.size });
              ctx.applyAccessibility();
              ctx.rerender();
            }
          })
        );
      });
      card.appendChild(sizes);

      card.appendChild(toggle('highContrast', 'a11y.high_contrast', 'a11y.shapes_hint'));
      card.appendChild(toggle('reduceMotion', 'a11y.reduce_motion', null));
      card.appendChild(toggle('captions', 'a11y.captions', 'a11y.captions_hint'));
      card.appendChild(ctx.el('p', { class: 'faint', text: t('a11y.shapes_hint') }));
      return card;
    }

    function toggle(field, labelKey, hintKey) {
      var id = 'settings-' + field;
      var label = ctx.el('label', { class: 'checkbox-row', for: id }, [
        ctx.el('input', {
          type: 'checkbox',
          id: id,
          checked: !!current[field],
          onchange: function (event) {
            ctx.setPrefs({ [field]: !!event.target.checked });
            ctx.applyAccessibility();
            ctx.rerender();
          }
        }),
        ctx.el('span', { text: t(labelKey) })
      ]);
      if (!hintKey) return label;
      var wrap = ctx.el('div', { class: 'stack' }, [label, ctx.el('p', { class: 'faint', text: t(hintKey) })]);
      return wrap;
    }

    /* --- Tutorial ---------------------------------------------------- */

    function tutorialSection() {
      var card = ctx.el('section', { class: 'card settings-section' }, [ctx.el('h2', { text: t('tutorial.title') })]);
      card.appendChild(toggle('tutorialEnabled', 'settings.tutorial_toggle', 'tutorial.settings_hint'));
      card.appendChild(
        ctx.el('div', { class: 'row' }, [
          ctx.el('button', {
            type: 'button',
            text: t('menu.tutorial'),
            onclick: function () {
              ctx.showTutorialOverview();
            }
          })
        ])
      );
      return card;
    }

    /* --- Controls (RG-8) --------------------------------------------- */

    function controlsSection() {
      var card = ctx.el('section', { class: 'card settings-section' }, [
        ctx.el('h2', { text: t('settings.controls') }),
        ctx.el('p', { class: 'faint', text: t('settings.controls_hint') })
      ]);
      var table = ctx.el('table', { class: 'controls-table' });
      table.appendChild(
        ctx.el('thead', null, [
          ctx.el('tr', null, [
            ctx.el('th', { text: t('settings.player') }),
            ctx.el('th', { text: t('settings.action.up') }),
            ctx.el('th', { text: t('settings.action.down') }),
            ctx.el('th', { text: t('settings.action.left') }),
            ctx.el('th', { text: t('settings.action.right') }),
            ctx.el('th', { text: t('settings.action.interact') }),
            ctx.el('th', { text: t('common.reset') })
          ])
        ])
      );
      var body = ctx.el('tbody');
      PLAYER_IDS.forEach(function (playerId) {
        var row = ctx.el('tr', null, [
          ctx.el('td', { text: t('settings.player_number', { n: PLAYER_IDS.indexOf(playerId) + 1 }) })
        ]);
        inputModule.ACTIONS.forEach(function (action) {
          var isCapturing = capture && capture.playerId === playerId && capture.action === action;
          row.appendChild(
            ctx.el('td', null, [
              (function () {
                var button = ctx.el('button', {
                  type: 'button',
                  class: isCapturing ? 'is-selected' : '',
                  text: isCapturing ? t('settings.press_key') : String((input.bindings[playerId] || {})[action] || ''),
                  'aria-label': t('settings.bind_action', {
                    player: t('settings.player_number', { n: PLAYER_IDS.indexOf(playerId) + 1 }),
                    action: t('settings.action.' + action)
                  }),
                  onclick: function () {
                    startCapture(playerId, action, button);
                  }
                });
                return button;
              })()
            ])
          );
        });
        row.appendChild(
          ctx.el('td', null, [
            ctx.el('button', {
              type: 'button',
              text: t('common.reset'),
              onclick: function () {
                resetPlayer(playerId);
              }
            })
          ])
        );
        body.appendChild(row);
      });
      table.appendChild(body);
      card.appendChild(table);
      return card;
    }

    /* --- Data and reset --------------------------------------------- */

    function dataSection() {
      return ctx.el('section', { class: 'card settings-section' }, [
        ctx.el('h2', { text: t('settings.data') }),
        ctx.el('p', { class: 'faint', text: t('settings.data_hint') }),
        ctx.el('div', { class: 'row' }, [
          ctx.el('button', {
            type: 'button',
            class: 'danger',
            text: t('settings.reset_all'),
            onclick: function () {
              if (ctx.win && typeof ctx.win.confirm === 'function' && !ctx.win.confirm(t('settings.confirm_reset'))) return;
              prefs.reset();
              stopCapture();
              ctx.applyAccessibility();
              ctx.rerender();
              ctx.toast({ code: 'settings.reset_done' });
            }
          })
        ])
      ]);
    }

    root.appendChild(ctx.el('h1', { text: t('settings.title') }));
    root.appendChild(languageSection());
    root.appendChild(accessibilitySection());
    root.appendChild(tutorialSection());
    root.appendChild(controlsSection());
    root.appendChild(dataSection());
    root.appendChild(
      ctx.el('div', { class: 'row' }, [
        ctx.el('button', {
          type: 'button',
          text: t('common.back'),
          onclick: function () {
            ctx.back();
          }
        })
      ])
    );

    return {
      id: 'settings',
      node: root,
      destroy: function () {
        stopCapture();
      }
    };
  }

  return { create: create };
});
