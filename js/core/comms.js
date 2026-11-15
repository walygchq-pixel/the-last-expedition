/*
 * Communications windows (C-2, C-3, S-9).
 *
 * The orbit defines the cycle and the duration of the window; the health of the
 * antenna and of the comms system defines the useful bandwidth. With low
 * bandwidth one has to choose which data gets transmitted (C-3).
 */
(function (global, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    var GS = (global.GS = global.GS || {});
    GS.core = GS.core || {};
    GS.core.comms = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function clamp(value, min, max) {
    var n = Number(value);
    if (!isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  /**
   * State of the link window at a given mission hour.
   * @param {Object} ctx `{orbit, hours, antennaHealth, commsHealth}`
   *   `orbit.comms = {cycleMinutes, windowMinutes, bandwidthFactor, continuous}`
   * @returns {{open:boolean, bandwidth:number, fraction:number,
   *   nextOpenInMinutes:number, cycleMinutes:number}}
   */
  function windowState(ctx) {
    var context = ctx || {};
    var orbit = context.orbit || {};
    var spec = orbit.comms || { cycleMinutes: 90, windowMinutes: 10, bandwidthFactor: 1 };
    var hours = isFinite(context.hours) ? context.hours : 0;
    var antenna = clamp(isFinite(context.antennaHealth) ? context.antennaHealth : 100, 0, 100) / 100;
    var comms = clamp(isFinite(context.commsHealth) ? context.commsHealth : 100, 0, 100) / 100;
    // A degraded antenna does not reach the nominal bandwidth (V-7, C-2).
    var quality = Math.min(antenna, comms);
    var factor = clamp((spec.bandwidthFactor === undefined ? 1 : spec.bandwidthFactor) * quality, 0, 1);

    if (spec.continuous) {
      return {
        open: true,
        bandwidth: factor,
        fraction: factor,
        nextOpenInMinutes: 0,
        cycleMinutes: 0
      };
    }

    var cycle = Math.max(1, spec.cycleMinutes || 90);
    var windowMinutes = Math.max(1, spec.windowMinutes || 10);
    var minutes = hours * 60;
    var position = minutes % cycle;
    var open = position < windowMinutes;
    return {
      open: open,
      bandwidth: open ? factor : 0,
      fraction: factor,
      nextOpenInMinutes: open ? 0 : Math.ceil(cycle - position),
      cycleMinutes: cycle,
      windowMinutes: windowMinutes
    };
  }

  function canTransmit(ctx) {
    return windowState(ctx).open;
  }

  /**
   * Total transmission capacity of a window, expressed in data units.
   * Bandwidth is combined with the duration of the window so that low orbits
   * transmit little and often and high orbits a lot at once.
   */
  function windowCapacity(ctx) {
    var state = windowState(ctx);
    if (!state.open) return 0;
    var spec = (ctx && ctx.orbit && ctx.orbit.comms) || {};
    var windowHours = spec.continuous ? 24 : Math.max(1, spec.windowMinutes || 10) / 60;
    return Math.round(state.bandwidth * windowHours * 12 * 10) / 10;
  }

  return {
    windowState: windowState,
    canTransmit: canTransmit,
    windowCapacity: windowCapacity
  };
});
