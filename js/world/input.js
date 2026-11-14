/*
 * Entrada local para 1–4 jugadores (S8, S14).
 *
 * Teclados por defecto: P1 WASD + E, P2 flechas + Enter, P3 IJKL + Ñ, P4 teclado
 * numérico. Los enlaces son reasignables (`bind`) y opcionalmente se puede sumar
 * un mando por la Gamepad API.
 *
 * El módulo no toca el DOM al cargarse: los listeners se registran recién en el
 * primer `poll` y solo si existe `document` (C-1). Las pruebas usan `press` y
 * `release` para simular teclas sin navegador.
 */
(function (global, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    var GS = (global.GS = global.GS || {});
    GS.world = GS.world || {};
    GS.world.input = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ACTIONS = ['up', 'down', 'left', 'right', 'interact'];
  var MAX_PLAYERS = 4;

  /**
   * Enlaces por defecto. La tecla Ñ tiene el código físico `Semicolon` en las
   * distribuciones latinoamericanas y españolas, que es lo que entrega el DOM.
   */
  function defaults() {
    return {
      p1: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', interact: 'KeyE' },
      p2: { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', interact: 'Enter' },
      p3: { up: 'KeyI', down: 'KeyK', left: 'KeyJ', right: 'KeyL', interact: 'Semicolon' },
      p4: { up: 'Numpad8', down: 'Numpad2', left: 'Numpad4', right: 'Numpad6', interact: 'Numpad0' }
    };
  }

  function cloneBindings(bindings) {
    var out = {};
    Object.keys(bindings || {}).forEach(function (playerId) {
      out[playerId] = Object.assign({}, bindings[playerId]);
    });
    return out;
  }

  /** Crea el controlador de entrada a partir de unos enlaces (o los de fábrica). */
  function createInput(bindings) {
    return {
      bindings: cloneBindings(bindings || defaults()),
      down: {},
      pressed: {},
      attached: false,
      handler: null
    };
  }

  /** Reasigna una tecla de un jugador (S8). Devuelve `false` si la acción no existe. */
  function bind(input, playerId, action, code) {
    if (!input || ACTIONS.indexOf(action) === -1 || !playerId || !code) return false;
    input.bindings[playerId] = input.bindings[playerId] || {};
    input.bindings[playerId][action] = code;
    return true;
  }

  function press(input, code) {
    if (!input || !code) return;
    input.down[code] = true;
    input.pressed[code] = true;
  }

  function release(input, code) {
    if (!input || !code) return;
    input.down[code] = false;
  }

  function isGameCode(input, code) {
    return Object.keys(input.bindings).some(function (playerId) {
      var table = input.bindings[playerId];
      return ACTIONS.some(function (action) {
        return table[action] === code;
      });
    });
  }

  /** Registra los listeners de teclado una sola vez y solo si hay DOM. */
  function attach(input) {
    if (!input || input.attached) return false;
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return false;
    input.handler = function (event) {
      if (event.type === 'keydown') {
        // `event.repeat` marca la repetición automática del sistema: para el
        // juego no es una pulsación nueva (R3-002).
        if (!event.repeat) press(input, event.code);
        if (event.preventDefault && isGameCode(input, event.code)) event.preventDefault();
      } else {
        release(input, event.code);
      }
    };
    document.addEventListener('keydown', input.handler);
    document.addEventListener('keyup', input.handler);
    input.attached = true;
    return true;
  }

  function detach(input) {
    if (!input || !input.attached || typeof document === 'undefined') return false;
    document.removeEventListener('keydown', input.handler);
    document.removeEventListener('keyup', input.handler);
    input.attached = false;
    input.handler = null;
    return true;
  }

  /**
   * Estado de los mandos conectados (S14). Devuelve un arreglo con un estado por
   * mando (posiciones vacías para los no conectados) y `[]` si no hay Gamepad API.
   */
  function gamepad() {
    var nav = typeof navigator !== 'undefined' ? navigator : null;
    if (!nav || typeof nav.getGamepads !== 'function') return [];
    var pads;
    try {
      pads = nav.getGamepads();
    } catch (error) {
      return [];
    }
    var out = [];
    if (!pads) return out;
    for (var i = 0; i < Math.min(MAX_PLAYERS, pads.length); i += 1) {
      var pad = pads[i];
      if (!pad) {
        out.push(null);
        continue;
      }
      var axes = pad.axes || [];
      var buttons = pad.buttons || [];
      var pressed = function (index) {
        return !!(buttons[index] && buttons[index].pressed);
      };
      out.push({
        up: (axes[1] || 0) < -0.4 || pressed(12),
        down: (axes[1] || 0) > 0.4 || pressed(13),
        left: (axes[0] || 0) < -0.4 || pressed(14),
        right: (axes[0] || 0) > 0.4 || pressed(15),
        interact: pressed(0)
      });
    }
    return out;
  }

  function mergePads(input, out) {
    var pads = gamepad();
    if (!pads || pads.length === 0) return;
    Object.keys(input.bindings).forEach(function (playerId, index) {
      var pad = pads[index];
      if (!pad) return;
      var state = out[playerId];
      ACTIONS.forEach(function (action) {
        if (pad[action]) state[action] = true;
      });
    });
  }

  /**
   * Lee el estado del cuadro. Devuelve `{p1:{up,down,left,right,interact}, …}`.
   * `interact` es de flanco: solo es `true` en el cuadro en que se presionó.
   */
  function poll(input) {
    var out = {};
    if (!input) return out;
    attach(input);
    Object.keys(input.bindings).forEach(function (playerId) {
      var table = input.bindings[playerId] || {};
      var state = {};
      ACTIONS.forEach(function (action) {
        var key = table[action];
        state[action] = action === 'interact' ? !!input.pressed[key] : !!input.down[key];
      });
      out[playerId] = state;
    });
    mergePads(input, out);
    input.pressed = {};
    return out;
  }

  return {
    ACTIONS: ACTIONS,
    MAX_PLAYERS: MAX_PLAYERS,
    defaults: defaults,
    createInput: createInput,
    bind: bind,
    press: press,
    release: release,
    poll: poll,
    attach: attach,
    detach: detach,
    gamepad: gamepad
  };
});
