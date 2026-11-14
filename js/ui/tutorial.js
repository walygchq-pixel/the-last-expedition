/*
 * Tutorial de 5 pasos (E-1, S-18, S62).
 *
 * Se muestra solo en dificultad Basic y en la primera partida, y se puede
 * desactivar desde los ajustes o desde el propio tutorial. Cada paso vive en
 * `data/tutorial.json` con la forma `{id, titleKey, bodyKey, target}`; `target`
 * es un selector CSS del elemento que conviene mirar en la pantalla activa.
 *
 * Este módulo no toca el DOM al cargarse: toda la construcción se hace dentro de
 * `create()`, con los ayudantes que presta `js/ui/shell`.
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

  // Copia de seguridad si `data-bundle.js` todavía no incluye el archivo: los
  // identificadores y las claves son los mismos que publica `data/tutorial.json`.
  var FALLBACK = [
    { id: 'design_basic', titleKey: 'tutorial.design_basic.title', bodyKey: 'tutorial.design_basic.body', target: '#design-objective' },
    { id: 'tradeoffs', titleKey: 'tutorial.tradeoffs.title', bodyKey: 'tutorial.tradeoffs.body', target: '#design-parts' },
    { id: 'launch_check', titleKey: 'tutorial.launch_check.title', bodyKey: 'tutorial.launch_check.body', target: '#design-launch' },
    { id: 'first_repair', titleKey: 'tutorial.first_repair.title', bodyKey: 'tutorial.first_repair.body', target: '#travel-actions' },
    { id: 'deferred_consequence', titleKey: 'tutorial.deferred_consequence.title', bodyKey: 'tutorial.deferred_consequence.body', target: '#travel-consequences' }
  ];

  /** Pasos del tutorial: datos canónicos o la copia de seguridad. */
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
        titleKey: step.titleKey,
        bodyKey: step.bodyKey,
        target: step.target || null
      };
    });
  }

  /** Índice de un paso por identificador, o `-1`. */
  function indexOf(stepId) {
    return steps().findIndex(function (step) {
      return step.id === stepId;
    });
  }

  /**
   * El tutorial está activo solo si la preferencia lo permite y la partida es la
   * primera en dificultad Basic (S62, S-18).
   */
  function isActive(prefs, difficultyId, state) {
    if (!prefs || prefs.tutorialEnabled === false) return false;
    if (prefs.tutorialSeen) return false;
    if (state && state.tutorialDismissed) return false;
    if (difficultyId !== 'basic') return false;
    return steps().length > 0;
  }

  /** Marca el tutorial como visto para que no reaparezca en la próxima partida. */
  function markSeen(ctx) {
    ctx.setPrefs({ tutorialSeen: true });
  }

  function currentStep(ctx) {
    var list = steps();
    var index = Math.min(Math.max(0, ctx.state.tutorialStep || 0), list.length - 1);
    return { step: list[index], index: index, total: list.length };
  }

  /**
   * Avanza el tutorial. `eventId` permite el avance automático cuando el jugador
   * ya hizo lo que el paso pedía (comprobó el lanzador, reparó, etc.).
   */
  function advance(ctx, eventId) {
    var info = currentStep(ctx);
    if (eventId && info.step && info.step.id !== eventId) return false;
    var next = info.index + 1;
    if (next >= info.total) {
      markSeen(ctx);
      ctx.state.tutorialStep = 0;
      if (typeof ctx.renderTutorial === 'function') ctx.renderTutorial();
      return true;
    }
    ctx.state.tutorialStep = next;
    if (typeof ctx.renderTutorial === 'function') ctx.renderTutorial();
    return true;
  }

  function back(ctx) {
    ctx.state.tutorialStep = Math.max(0, (ctx.state.tutorialStep || 0) - 1);
    if (typeof ctx.renderTutorial === 'function') ctx.renderTutorial();
  }

  /** Cierra el tutorial de esta partida sin desactivarlo para siempre. */
  function dismiss(ctx) {
    ctx.state.tutorialDismissed = true;
    markSeen(ctx);
    if (typeof ctx.renderTutorial === 'function') ctx.renderTutorial();
  }

  /** Desactiva el tutorial en los ajustes (S-18). */
  function disablePermanently(ctx) {
    ctx.state.tutorialDismissed = true;
    ctx.setPrefs({ tutorialEnabled: false, tutorialSeen: true });
    if (typeof ctx.renderTutorial === 'function') ctx.renderTutorial();
  }

  /** Llamado por las pantallas cuando ocurre el hecho que enseña el paso. */
  function notify(ctx, eventId) {
    if (!ctx.state || !isActive(ctx.getPrefs(), ctx.state.difficultyId, ctx.state)) return false;
    var info = currentStep(ctx);
    if (!info.step || info.step.id !== eventId) return false;
    return advance(ctx, eventId);
  }

  function clearHighlight(ctx) {
    if (ctx.state && ctx.state.tutorialHighlight && ctx.state.tutorialHighlight.classList) {
      ctx.state.tutorialHighlight.classList.remove('tutorial-highlight');
    }
    if (ctx.state) ctx.state.tutorialHighlight = null;
  }

  function highlight(ctx, selector) {
    if (!selector || !ctx.doc) return;
    var node = null;
    try {
      node = ctx.doc.querySelector(selector);
    } catch (error) {
      node = null;
    }
    if (!node) return;
    node.classList.add('tutorial-highlight');
    ctx.state.tutorialHighlight = node;
  }

  /**
   * Construye el panel flotante del tutorial.
   * @param {Object} ctx shell de `js/ui/shell`
   * @param {Object} [options] `{preview:true}` para el repaso desde el menú
   */
  function create(ctx, options) {
    var opts = options || {};
    var t = ctx.t;
    var info = currentStep(ctx);
    var preview = !!opts.preview;

    var panel = ctx.el('aside', {
      class: preview ? 'tutorial-preview' : 'tutorial-overlay',
      role: 'region',
      'aria-label': t('tutorial.title')
    });

    if (preview) {
      var list = ctx.el('ul', { class: 'list' });
      steps().forEach(function (step) {
        list.appendChild(
          ctx.el('li', { class: 'card' }, [
            ctx.el('strong', { text: t(step.titleKey) }),
            ctx.el('p', { class: 'muted', text: t(step.bodyKey) })
          ])
        );
      });
      panel.appendChild(ctx.el('h3', { text: t('tutorial.title') }));
      panel.appendChild(list);
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

    panel.appendChild(
      ctx.el('div', { class: 'tutorial-step-count', text: t('tutorial.step_of', { current: info.index + 1, total: info.total }) })
    );
    panel.appendChild(ctx.el('h3', { text: t(info.step.titleKey) }));
    panel.appendChild(ctx.el('p', { text: t(info.step.bodyKey) }));

    var actions = ctx.el('div', { class: 'row tight' });
    actions.appendChild(
      ctx.el('button', {
        type: 'button',
        text: t('common.back'),
        disabled: info.index === 0,
        onclick: function () {
          back(ctx);
        }
      })
    );
    actions.appendChild(
      ctx.el('button', {
        type: 'button',
        class: 'primary',
        text: info.index + 1 >= info.total ? t('tutorial.finish') : t('common.next'),
        onclick: function () {
          advance(ctx, null);
        }
      })
    );
    actions.appendChild(
      ctx.el('button', {
        type: 'button',
        class: 'ghost',
        text: t('tutorial.disable'),
        onclick: function () {
          disablePermanently(ctx);
        }
      })
    );
    panel.appendChild(actions);
    panel.appendChild(
      ctx.el('button', {
        type: 'button',
        class: 'ghost',
        text: t('tutorial.skip'),
        onclick: function () {
          dismiss(ctx);
        }
      })
    );
    return panel;
  }

  return {
    steps: steps,
    indexOf: indexOf,
    isActive: isActive,
    currentStep: currentStep,
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
