/*
 * Application boot (T8, S1, I-8).
 *
 * Mandatory order: preferences → translator → data catalog → accessibility
 * classes → shell → title screen. It does not create runs nor touch the engine:
 * it only wires the modules that are already written.
 *
 * `window.TLE` stays exposed only as a debugging aid (browser console); the
 * game never reads from there.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(root);
  } else {
    factory(root);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  function boot() {
    var GS = root.GS;
    if (!GS || !GS.ui || !GS.ui.shell) {
      if (typeof console !== 'undefined' && console.error) console.error('[TLE] faltan módulos de UI');
      return null;
    }

    var logger = typeof console !== 'undefined' ? console : null;

    // 1. Translator with the saved language, the browser one or English (I-8).
    var translator = GS.i18n.createTranslator({
      dicts: GS.i18n.dictsFromRegistry(GS.data),
      locale: GS.storage.prefs.initialLocale(),
      logger: logger
    });

    // 2. Data catalog: `mission/*` reads from `GS.data` (C-2).
    GS.mission.catalog.init(GS.data);

    // 3. Shell mounted on the container; `start()` applies accessibility and paints
    //    the title screen (S1).
    var shell = GS.ui.shell.mount({
      root: typeof document !== 'undefined' ? document.getElementById('app') : null,
      document: typeof document !== 'undefined' ? document : null,
      window: typeof window !== 'undefined' ? window : null,
      translator: translator,
      logger: logger
    });
    shell.start();

    // 4. Debug aid (not part of the game flow).
    try {
      Object.defineProperty(root, 'TLE', {
        configurable: true,
        get: function () {
          return { game: shell.state.game, translator: translator, shell: shell };
        }
      });
    } catch (error) {
      root.TLE = { game: shell.state.game, translator: translator, shell: shell };
    }

    return shell;
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  }

  return { boot: boot };
});
