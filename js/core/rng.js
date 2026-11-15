/*
 * Deterministic pseudo-random generator (contract C-4).
 *
 * All the randomness of the simulation goes through here with an explicit seed,
 * so a game can be repeated, saved and compared, and the tests do not depend on
 * real chance. `Math.random()` is not used in `core/`, `mission/` or `world/`.
 */
(function (global, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    var GS = (global.GS = global.GS || {});
    GS.core = GS.core || {};
    GS.core.rng = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** Turns a text into a stable 32-bit integer (FNV-1a). */
  function hashSeed(text) {
    var source = String(text === undefined || text === null ? 'seed' : text);
    var hash = 0x811c9dc5;
    for (var i = 0; i < source.length; i += 1) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
  }

  /**
   * Creates a deterministic generator (mulberry32) from a numeric or text seed.
   * It also returns the internal state so that it can be saved.
   */
  function createRng(seed) {
    var state = (typeof seed === 'number' && isFinite(seed) ? seed : hashSeed(seed)) >>> 0;

    function next() {
      state = (state + 0x6d2b79f5) >>> 0;
      var t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    /** Uniform integer in [min, max] (both inclusive). */
    function int(min, max) {
      var low = Math.ceil(Math.min(min, max));
      var high = Math.floor(Math.max(min, max));
      return low + Math.floor(next() * (high - low + 1));
    }

    /** Uniform real number in [min, max). */
    function float(min, max) {
      return min + next() * (max - min);
    }

    /** Random element of an array (or `undefined` if it is empty). */
    function pick(items) {
      if (!items || items.length === 0) return undefined;
      return items[Math.floor(next() * items.length)];
    }

    /** `true` with probability `p` (0..1). */
    function chance(p) {
      var probability = Number(p);
      if (!isFinite(probability) || probability <= 0) return false;
      if (probability >= 1) return true;
      return next() < probability;
    }

    /** Picks an element by weight: `[{value, weight}]`. */
    function weighted(entries) {
      if (!entries || entries.length === 0) return undefined;
      var total = 0;
      for (var i = 0; i < entries.length; i += 1) total += Math.max(0, entries[i].weight || 0);
      if (total <= 0) return entries[0].value;
      var roll = next() * total;
      var accumulated = 0;
      for (var j = 0; j < entries.length; j += 1) {
        accumulated += Math.max(0, entries[j].weight || 0);
        if (roll < accumulated) return entries[j].value;
      }
      return entries[entries.length - 1].value;
    }

    /** Shuffles a copy of the array (Fisher-Yates). */
    function shuffle(items) {
      var copy = items.slice();
      for (var i = copy.length - 1; i > 0; i -= 1) {
        var j = Math.floor(next() * (i + 1));
        var tmp = copy[i];
        copy[i] = copy[j];
        copy[j] = tmp;
      }
      return copy;
    }

    return {
      next: next,
      int: int,
      float: float,
      pick: pick,
      chance: chance,
      weighted: weighted,
      shuffle: shuffle,
      state: function () {
        return state >>> 0;
      },
      seed: function () {
        return state >>> 0;
      }
    };
  }

  return { createRng: createRng, hashSeed: hashSeed };
});
