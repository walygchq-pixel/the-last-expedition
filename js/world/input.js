/*
 * Local input for 1–4 players (S8, S14).
 *
 * Default keyboards: P1 WASD + E, P2 arrows + Enter, P3 IJKL + Ñ, P4 numeric
 * keypad. Bindings can be reassigned (`bind`) and a gamepad can optionally be
 * added through the Gamepad API.
 *
 * The module does not touch the DOM at load time: listeners are registered only
 * on the first `poll` and only if `document` exists (C-1). Tests use `press` and
 * `release` to simulate keys without a browser.
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
   * Default bindings. The Ñ key has the physical code `Semicolon` on Latin
   * American and Spanish layouts, which is what the DOM reports.
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

  /** Creates the input controller from some bindings (or the factory ones). */
  function createInput(bindings) {
    return {
      bindings: cloneBindings(bindings || defaults()),
      down: {},
      pressed: {},
      attached: false,
      handler: null
    };
  }

  /** Rebinds one player's key (S8). Returns `false` if the action does not exist. */
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

  /** Registers the keyboard listeners only once and only if a DOM exists. */
  function attach(input) {
    if (!input || input.attached) return false;
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return false;
    input.handler = function (event) {
      if (event.type === 'keydown') {
        // `event.repeat` marks the system's automatic repeat: for the game it
        // is not a new press (R3-002).
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
   * State of the connected gamepads (S14). Returns an array with one state per
   * pad (empty entries for the unconnected ones) and `[]` if there is no Gamepad API.
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
   * Reads the frame's state. Returns `{p1:{up,down,left,right,interact}, …}`.
   * `interact` is edge-triggered: it is only `true` on the frame it was pressed.
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
