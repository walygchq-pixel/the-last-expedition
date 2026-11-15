/*
 * Coaching tutorial (E-1, S-18, S62).
 *
 * Nine short callouts anchored to the control they teach, not a fixed panel at
 * the bottom: each step declares which screen it lives on (`design` or `travel`),
 * which element it points at (`target`) and on which side it is best placed
 * (`place`). When the screen changes the tutorial jumps to the first pending step
 * of that screen, so it never sits showing «step 1 of 5» on top of the travel screen.
 *
 * It shows only on Basic difficulty and in the first game, and it can be
 * turned off from the settings or from the callout itself (S-18).
 *
 * This module does not touch the DOM on load: everything is built inside `create()`.
 */
(function (global, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('../mission/catalog.js'));
  } else {
    var GS = (global.GS = global.GS || {});
    GS.ui = GS.ui || {};
    GS.ui.tutorial = factory(GS.mission.catalog);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (catalog) {
  'use strict';

  // Fallback copy if the bundle does not include `data/tutorial.json` yet.
  var FALLBACK = [
    { id: 'design_objective', screen: 'design', titleKey: 'tutorial.design_objective.title', bodyKey: 'tutorial.design_objective.body', target: '[data-tutorial="design-objective"]', place: 'bottom' },
    { id: 'design_components', screen: 'design', titleKey: 'tutorial.design_components.title', bodyKey: 'tutorial.design_components.body', target: '[data-tutorial="design-component"]', place: 'right' },
    { id: 'design_launch', screen: 'design', titleKey: 'tutorial.design_launch.title', bodyKey: 'tutorial.design_launch.body', target: '[data-tutorial="design-launch"]', place: 'top' },
    { id: 'travel_move', screen: 'travel', titleKey: 'tutorial.travel_move.title', bodyKey: 'tutorial.travel_move.body', target: '[data-tutorial="travel-clock"]', place: 'bottom' },
    { id: 'travel_actions', screen: 'travel', titleKey: 'tutorial.travel_actions.title', bodyKey: 'tutorial.travel_actions.body', target: '[data-tutorial="travel-actions"]', place: 'top' },
    { id: 'travel_systems', screen: 'travel', titleKey: 'tutorial.travel_systems.title', bodyKey: 'tutorial.travel_systems.body', target: '[data-tutorial="travel-systems"]', place: 'left' }
  ];

  var PANEL_WIDTH_REM = 19;

  /** Tutorial steps: canonical data or the fallback copy. */
  function steps() {
    var fromData = [];
    try {
      fromData = catalog.tutorial() || [];
    } catch (error) {
      fromData = [];
    }
    var list = Array.isArray(fromData) && fromData.length > 0 ? fromData : FALLBACK;
    return list.map(function (step) {
      return {
        id: step.id,
        screen: step.screen || null,
        titleKey: step.titleKey,
        bodyKey: step.bodyKey,
        target: step.target || null,
        place: step.place || 'bottom',
        advanceOn: step.advanceOn || null
      };
    });
  }

  function indexOf(stepId) {
    return steps().findIndex(function (step) {
      return step.id === stepId;
    });
  }

  /** The tutorial is active only if the preference allows it and it is the first game on Basic. */
  function isActive(prefs, difficultyId, state) {
    if (!prefs || prefs.tutorialEnabled === false) return false;
    if (prefs.tutorialSeen) return false;
    if (state && state.tutorialDismissed) return false;
    if (difficultyId !== 'basic') return false;
    return steps().length > 0;
  }

  function markSeen(ctx) {
    ctx.setPrefs({ tutorialSeen: true });
  }

  /**
   * Active screen deduced from the `data-tutorial` hooks the screens left
   * behind. Avoids coupling the tutorial to the shell router.
   */
  function detectScreen(ctx) {
    var doc = ctx && ctx.doc;
    if (!doc || typeof doc.querySelector !== 'function') return null;
    if (doc.querySelector('[data-tutorial^="travel-"]')) return 'travel';
    if (doc.querySelector('[data-tutorial^="design-"]')) return 'design';
    return null;
  }

  function doneMap(ctx) {
    if (!ctx.state.tutorialDone || typeof ctx.state.tutorialDone !== 'object') ctx.state.tutorialDone = {};
    return ctx.state.tutorialDone;
  }

  function isDone(ctx, stepId) {
    return doneMap(ctx)[stepId] === true;
  }

  /** Steps of one screen, in data order. */
  function stepsFor(screen) {
    return steps().filter(function (step) {
      return !screen || step.screen === screen;
    });
  }

  /** First pending step of the active screen, or `null` if none is left. */
  function currentStep(ctx) {
    var screen = detectScreen(ctx);
    var list = stepsFor(screen);
    var pending = list.filter(function (step) {
      return !isDone(ctx, step.id);
    });
    if (pending.length === 0) return { step: null, index: -1, total: list.length, done: list.length, screen: screen };
    var step = pending[0];
    return {
      step: step,
      index: indexOf(step.id),
      total: list.length,
      done: list.length - pending.length,
      screen: screen
    };
  }

  /** Marks the current step as done and repaints. */
  function advance(ctx, eventId) {
    var info = currentStep(ctx);
    if (!info.step) return false;
    if (eventId && info.step.id !== eventId && info.step.advanceOn !== eventId) return false;
    doneMap(ctx)[info.step.id] = true;
    clearHighlight(ctx);
    if (typeof ctx.renderTutorial === 'function') ctx.renderTutorial();
    var after = currentStep(ctx);
    if (!after.step) {
      // The steps of this screen ran out; if none are left on the other one
      // either, the tutorial stays seen so it never appears again in the next game.
      var left = steps().filter(function (step) {
        return !isDone(ctx, step.id);
      });
      if (left.length === 0) markSeen(ctx);
    }
    return true;
  }

  /** Goes back to the previous step of the same screen. */
  function back(ctx) {
    var list = stepsFor(detectScreen(ctx));
    var pending = list.filter(function (step) {
      return !isDone(ctx, step.id);
    });
    var previous = pending.length > 1 ? pending[pending.length - 2] : null;
    if (previous) {
      delete doneMap(ctx)[previous.id];
    }
    if (typeof ctx.renderTutorial === 'function') ctx.renderTutorial();
  }

  /** Closes the tutorial for this game without disabling it for good. */
  function dismiss(ctx) {
    ctx.state.tutorialDismissed = true;
    markSeen(ctx);
    clearHighlight(ctx);
    if (typeof ctx.renderTutorial === 'function') ctx.renderTutorial();
  }

  /** Turns the tutorial off in the settings (S-18). */
  function disablePermanently(ctx) {
    ctx.state.tutorialDismissed = true;
    ctx.setPrefs({ tutorialEnabled: false, tutorialSeen: true });
    clearHighlight(ctx);
    if (typeof ctx.renderTutorial === 'function') ctx.renderTutorial();
  }

  /** The screens report when the event taught by the current step happens. */
  function notify(ctx, eventId) {
    if (!ctx.state || !isActive(ctx.getPrefs(), ctx.state.difficultyId, ctx.state)) return false;
    return advance(ctx, eventId);
  }

  function clearHighlight(ctx) {
    if (ctx.state && ctx.state.tutorialHighlight && ctx.state.tutorialHighlight.classList) {
      ctx.state.tutorialHighlight.classList.remove('tutorial-highlight');
    }
    if (ctx.state) ctx.state.tutorialHighlight = null;
  }

  function highlight(ctx, selector) {
    if (!selector || !ctx.doc) return null;
    var node = null;
    try {
      node = ctx.doc.querySelector(selector);
    } catch (error) {
      node = null;
    }
    if (!node) return null;
    if (node.classList && !node.classList.contains('tutorial-highlight')) node.classList.add('tutorial-highlight');
    ctx.state.tutorialHighlight = node;
    return node;
  }

  /** Places the callout next to its target, without covering it or leaving the window. */
  function place(panel, node, hint, win) {
    if (!panel || !panel.style || !node || typeof node.getBoundingClientRect !== 'function') return;
    var doc = panel.ownerDocument;
    var rootPx = 16;
    try {
      rootPx = parseFloat(win.getComputedStyle(doc.documentElement).fontSize) || 16;
    } catch (error) {
      rootPx = 16;
    }
    var width = PANEL_WIDTH_REM * rootPx;
    var margin = 12;
    var rect = node.getBoundingClientRect();
    var viewportWidth = win.innerWidth || doc.documentElement.clientWidth;
    var viewportHeight = win.innerHeight || doc.documentElement.clientHeight;
    var top;
    var left;

    if (hint === 'right') {
      left = rect.right + margin;
      top = rect.top;
      if (left + width > viewportWidth - margin) {
        left = rect.left - width - margin;
        if (left < margin) {
          left = Math.max(margin, Math.min(viewportWidth - width - margin, rect.left));
          top = rect.bottom + margin;
        }
      }
    } else if (hint === 'left') {
      left = rect.left - width - margin;
      top = rect.top;
      if (left < margin) {
        left = Math.max(margin, Math.min(viewportWidth - width - margin, rect.left));
        top = rect.bottom + margin;
      }
    } else if (hint === 'top') {
      left = rect.left;
      top = rect.top - margin - panel.offsetHeight;
      if (top < margin) top = rect.bottom + margin;
    } else {
      left = rect.left;
      top = rect.bottom + margin;
    }

    left = Math.max(margin, Math.min(viewportWidth - width - margin, left));
    var panelHeight = panel.offsetHeight || 0;
    top = Math.max(margin, Math.min(viewportHeight - panelHeight - margin, top));
    panel.style.left = Math.round(left) + 'px';
    panel.style.top = Math.round(top) + 'px';
  }

  /**
   * Builds the tutorial callout.
   * @param {Object} ctx shell from `js/ui/shell`
   * @param {Object} [options] `{preview:true}` for the review from the menu
   */
  function create(ctx, options) {
    var opts = options || {};
    var t = ctx.t;
    var info = currentStep(ctx);
    var preview = !!opts.preview;

    if (preview) return buildPreview(ctx, t);

    if (!info.step) {
      clearHighlight(ctx);
      return ctx.el('div', { class: 'tutorial-hidden', hidden: true });
    }

    var win = ctx.win || (typeof window !== 'undefined' ? window : null);
    var doc = ctx.doc;
    var panel = ctx.el('aside', {
      class: 'tutorial-callout',
      role: 'dialog',
      'aria-modal': 'false',
      'aria-live': 'polite',
      'aria-labelledby': 'tutorial-title',
      'data-step': info.step.id
    });
    var head = ctx.el('div', { class: 'tutorial-callout__head' }, [
      ctx.el('span', { class: 'tutorial-callout__count', text: t('tutorial.step_of', { current: info.done + 1, total: info.total }) }),
      ctx.el('span', { class: 'tutorial-callout__tag', text: t(info.screen === 'travel' ? 'tutorial.screen_travel' : 'tutorial.screen_design') })
    ]);
    panel.appendChild(head);
    var title = ctx.el('h3', { id: 'tutorial-title', text: t(info.step.titleKey) });
    panel.appendChild(title);
    panel.appendChild(ctx.el('p', { text: t(info.step.bodyKey) }));

    var actions = ctx.el('div', { class: 'tutorial-callout__actions' });
    actions.appendChild(
      ctx.el('button', {
        type: 'button',
        class: 'primary',
        text: t('tutorial.understood'),
        onclick: function () {
          advance(ctx, null);
        }
      })
    );
    actions.appendChild(
      ctx.el('button', {
        type: 'button',
        class: 'ghost',
        text: t('tutorial.later'),
        onclick: function () {
          dismiss(ctx);
        }
      })
    );
    panel.appendChild(actions);
    panel.appendChild(
      ctx.el('button', {
        type: 'button',
        class: 'tutorial-callout__never link',
        text: t('tutorial.never'),
        onclick: function () {
          disablePermanently(ctx);
        }
      })
    );

    var target = null;
    if (info.step.target) {
      try {
        target = doc.querySelector(info.step.target);
      } catch (error) {
        target = null;
      }
    }
    if (target) {
      highlight(ctx, info.step.target);
      if (typeof target.scrollIntoView === 'function') {
        try {
          target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
        } catch (error) {
          /* browsers that do not accept `behavior: instant` */
        }
      }
    }

    // It is positioned after mounting: the shell adds it to the document and only
    // then are there real measurements of the target and of the panel itself.
    var reposition = function () {
      if (target) place(panel, target, info.step.place, win);
      else if (panel.style) panel.classList.add('tutorial-callout--corner');
    };
    if (win && typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(reposition);
    if (win && typeof win.addEventListener === 'function') {
      var onResize = function () {
        reposition();
      };
      win.addEventListener('resize', onResize);
      panel.destroy = function () {
        win.removeEventListener('resize', onResize);
      };
    } else {
      reposition();
    }
    return panel;
  }

  /** Full review from the menu: the steps grouped by screen. */
  function buildPreview(ctx, t) {
    var panel = ctx.el('div', { class: 'tutorial-preview' });
    panel.appendChild(ctx.el('h3', { text: t('tutorial.title') }));
    ['design', 'travel'].forEach(function (screen) {
      var list = stepsFor(screen);
      if (list.length === 0) return;
      panel.appendChild(ctx.el('h4', { text: t(screen === 'travel' ? 'tutorial.screen_travel' : 'tutorial.screen_design') }));
      var items = ctx.el('ul', { class: 'list' });
      list.forEach(function (step) {
        items.appendChild(
          ctx.el('li', { class: 'card' }, [
            ctx.el('strong', { text: t(step.titleKey) }),
            ctx.el('p', { class: 'muted', text: t(step.bodyKey) })
          ])
        );
      });
      panel.appendChild(items);
    });
    panel.appendChild(
      ctx.el('div', { class: 'row' }, [
        ctx.el('button', {
          type: 'button',
          text: t('common.close'),
          onclick: function () {
            if (typeof ctx.closeOverlay === 'function') ctx.closeOverlay();
          }
        })
      ])
    );
    return panel;
  }

  return {
    steps: steps,
    stepsFor: stepsFor,
    indexOf: indexOf,
    isActive: isActive,
    currentStep: currentStep,
    detectScreen: detectScreen,
    create: create,
    advance: advance,
    back: back,
    dismiss: dismiss,
    disablePermanently: disablePermanently,
    notify: notify,
    markSeen: markSeen,
    highlight: highlight,
    clearHighlight: clearHighlight
  };
});
