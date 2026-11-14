/*
 * Reloj de misión (V-17, S-1).
 *
 * Un día de misión dura 15 segundos reales a velocidad ×1 (S-1 permite 10–20 s)
 * y se puede acelerar ×2, ×4 y ×8. El reloj no conoce el DOM: `advance()` recibe
 * milisegundos reales y devuelve cuánto avanzó la misión.
 */
(function (global, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    var GS = (global.GS = global.GS || {});
    GS.core = GS.core || {};
    GS.core.time = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DAY_MS = 15000;
  var SPEEDS = [1, 2, 4, 8];
  var HOURS_PER_DAY = 24;

  function createClock(missionDays, options) {
    var opts = options || {};
    return {
      missionDays: isFinite(missionDays) ? missionDays : 90,
      hours: isFinite(opts.startHours) ? opts.startHours : 0,
      speed: 1,
      paused: false,
      // Fracción del día que la nave pasa en sombra (depende de la órbita).
      eclipseFraction: isFinite(opts.eclipseFraction) ? opts.eclipseFraction : 0.35,
      elapsedRealMs: 0
    };
  }

  /**
   * Avanza el reloj. Devuelve los días de misión transcurridos en este paso
   * (puede ser fraccionario) para que la simulación use el mismo delta que la UI.
   */
  function advance(clock, realMs) {
    var ms = Number(realMs);
    if (!isFinite(ms) || ms <= 0 || clock.paused) return { deltaDays: 0, deltaHours: 0 };
    var scaled = ms * clock.speed;
    clock.elapsedRealMs += ms;
    var deltaHours = (scaled / DAY_MS) * HOURS_PER_DAY;
    clock.hours += deltaHours;
    return { deltaDays: deltaHours / HOURS_PER_DAY, deltaHours: deltaHours };
  }

  function setSpeed(clock, speed) {
    var value = Number(speed);
    if (SPEEDS.indexOf(value) !== -1) {
      clock.speed = value;
      clock.paused = false;
    }
    return clock.speed;
  }

  function cycleSpeed(clock) {
    var index = SPEEDS.indexOf(clock.speed);
    clock.speed = SPEEDS[(index + 1) % SPEEDS.length];
    clock.paused = false;
    return clock.speed;
  }

  function pause(clock) {
    clock.paused = true;
    return clock.paused;
  }

  function resume(clock) {
    clock.paused = false;
    return clock.paused;
  }

  function togglePause(clock) {
    clock.paused = !clock.paused;
    return clock.paused;
  }

  function dayNumber(clock) {
    return Math.floor(clock.hours / HOURS_PER_DAY) + 1;
  }

  function hourOfDay(clock) {
    return clock.hours % HOURS_PER_DAY;
  }

  /** Día de misión transcurrido (0 al inicio, fraccionario). */
  function days(clock) {
    return clock.hours / HOURS_PER_DAY;
  }

  function daysLeft(clock) {
    return Math.max(0, clock.missionDays - days(clock));
  }

  /** `true` si la nave está en sombra; sin paneles la batería cubre el pico. */
  function isEclipse(clock) {
    var fraction = Math.min(0.95, Math.max(0, clock.eclipseFraction));
    if (fraction <= 0) return false;
    var positionInDay = (clock.hours % HOURS_PER_DAY) / HOURS_PER_DAY;
    return positionInDay < fraction;
  }

  /** Se acabó la vida útil del escenario (V-18, S-10). */
  function expired(clock) {
    return days(clock) >= clock.missionDays;
  }

  return {
    DAY_MS: DAY_MS,
    SPEEDS: SPEEDS,
    HOURS_PER_DAY: HOURS_PER_DAY,
    createClock: createClock,
    advance: advance,
    setSpeed: setSpeed,
    cycleSpeed: cycleSpeed,
    pause: pause,
    resume: resume,
    togglePause: togglePause,
    dayNumber: dayNumber,
    hourOfDay: hourOfDay,
    days: days,
    daysLeft: daysLeft,
    isEclipse: isEclipse,
    expired: expired
  };
});
