/*
 * Mission clock (V-17, S-1).
 *
 * One mission day lasts 15 real seconds at speed ×1 (S-1 allows 10–20 s) and it
 * can be accelerated ×2, ×4 and ×8. The clock does not know the DOM: `advance()`
 * receives real milliseconds and returns how far the mission advanced.
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
      // Fraction of the day the ship spends in shadow (depends on the orbit).
      eclipseFraction: isFinite(opts.eclipseFraction) ? opts.eclipseFraction : 0.35,
      elapsedRealMs: 0
    };
  }

  /**
   * Advances the clock. Returns the mission days elapsed in this step (it can be
   * fractional) so that the simulation uses the same delta as the UI.
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

  /** Mission day elapsed (0 at the start, fractional). */
  function days(clock) {
    return clock.hours / HOURS_PER_DAY;
  }

  function daysLeft(clock) {
    return Math.max(0, clock.missionDays - days(clock));
  }

  /** `true` if the ship is in shadow; without panels the battery covers the peak. */
  function isEclipse(clock) {
    var fraction = Math.min(0.95, Math.max(0, clock.eclipseFraction));
    if (fraction <= 0) return false;
    var positionInDay = (clock.hours % HOURS_PER_DAY) / HOURS_PER_DAY;
    return positionInDay < fraction;
  }

  /** The service life of the scenario is over (V-18, S-10). */
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
