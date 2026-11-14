/*
 * Arranque de la aplicación (T8, S1, I-8).
 *
 * Orden obligatorio: preferencias → traductor → catálogo de datos → clases de
 * accesibilidad → shell → pantalla de título. No crea partidas ni toca el motor:
 * sólo conecta los módulos que ya están escritos.
 *
 * `window.TLE` queda expuesto únicamente como ayuda de depuración (consola del
 * navegador); el juego nunca lee de ahí.
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

    // 1. Traductor con el idioma guardado, el del navegador o inglés (I-8).
    var translator = GS.i18n.createTranslator({
      dicts: GS.i18n.dictsFromRegistry(GS.data),
      locale: GS.storage.prefs.initialLocale(),
      logger: logger
    });

    // 2. Catálogo de datos: `mission/*` lee de `GS.data` (C-2).
    GS.mission.catalog.init(GS.data);

    // 3. Shell montado sobre el contenedor; `start()` aplica accesibilidad y pinta
    //    la pantalla de título (S1).
    var shell = GS.ui.shell.mount({
      root: typeof document !== 'undefined' ? document.getElementById('app') : null,
      document: typeof document !== 'undefined' ? document : null,
      window: typeof window !== 'undefined' ? window : null,
      translator: translator,
      logger: logger
    });
    shell.start();

    // 4. Ayuda de depuración (no forma parte del flujo del juego).
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
