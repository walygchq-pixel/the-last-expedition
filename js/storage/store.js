/*
 * Access to `localStorage` with clean degradation (S-17, G-1).
 *
 * In the browser it uses `localStorage`; without it (Node, blocked private mode)
 * it falls back to an in-memory store so the logic stays testable. The 5 MB limit
 * is checked before writing and reported as a code, never as text.
 */
(function (global, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    var GS = (global.GS = global.GS || {});
    GS.storage = GS.storage || {};
    GS.storage.store = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var LIMIT_BYTES = 5 * 1024 * 1024;
  var memory = new Map();
  var memoryBytes = 0;

  function nativeStore() {
    try {
      if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
        var probe = '__tle_probe__';
        globalThis.localStorage.setItem(probe, '1');
        globalThis.localStorage.removeItem(probe);
        return globalThis.localStorage;
      }
    } catch (error) {
      return null;
    }
    return null;
  }

  function bytesOf(value) {
    try {
      return new TextEncoder().encode(value).length;
    } catch (error) {
      return value.length * 2;
    }
  }

  /** Reads a key. Returns `null` if it does not exist or if the JSON is corrupt. */
  function read(key, fallback) {
    var raw = null;
    var store = nativeStore();
    if (store) {
      raw = store.getItem(key);
    } else if (memory.has(key)) {
      raw = memory.get(key);
    }
    if (raw === null || raw === undefined) return fallback === undefined ? null : fallback;
    try {
      return JSON.parse(raw);
    } catch (error) {
      return fallback === undefined ? null : fallback;
    }
  }

  /**
   * Writes a serializable value, enforcing the 5 MB limit (S-17).
   * @returns {{ok:boolean, code?:string, bytes:number}}
   */
  function write(key, value) {
    var text;
    try {
      text = JSON.stringify(value);
    } catch (error) {
      return { ok: false, code: 'save.unserializable', bytes: 0 };
    }
    // `JSON.stringify(undefined)` returns undefined: storing it would leave an
    // unreadable key answering `ok` (R3-003).
    if (text === undefined) return { ok: false, code: 'save.unserializable', bytes: 0 };
    var bytes = bytesOf(text);
    if (bytes > LIMIT_BYTES) return { ok: false, code: 'save.too_large', bytes: bytes };

    var store = nativeStore();
    if (store) {
      try {
        // Overwriting a key discounts what it already occupied: otherwise an
        // update near the cap fails for no reason (R3-002).
        var previous = store.getItem(key);
        var freed = previous ? bytesOf(key) + bytesOf(previous) : 0;
        var projected = usedBytes(store) - freed + bytesOf(key) + bytes;
        if (projected > LIMIT_BYTES) return { ok: false, code: 'save.quota', bytes: bytes };
        store.setItem(key, text);
        return { ok: true, bytes: bytes };
      } catch (error) {
        return { ok: false, code: 'save.quota', bytes: bytes };
      }
    }
    var previousMemory = memory.has(key) ? bytesOf(memory.get(key)) : 0;
    if (memoryBytes - previousMemory + bytes > LIMIT_BYTES) return { ok: false, code: 'save.quota', bytes: bytes };
    memoryBytes += bytes - previousMemory;
    memory.set(key, text);
    return { ok: true, bytes: bytes };
  }

  function usedBytes(store) {
    var total = 0;
    try {
      for (var i = 0; i < store.length; i += 1) {
        var key = store.key(i);
        var value = store.getItem(key) || '';
        total += bytesOf(key) + bytesOf(value);
      }
    } catch (error) {
      return 0;
    }
    return total;
  }

  function remove(key) {
    var store = nativeStore();
    if (store) {
      store.removeItem(key);
      return true;
    }
    memory.delete(key);
    return true;
  }

  /** All keys with a given prefix (to list saved games). */
  function keysWithPrefix(prefix) {
    var out = [];
    var store = nativeStore();
    if (store) {
      for (var i = 0; i < store.length; i += 1) {
        var key = store.key(i);
        if (key && key.indexOf(prefix) === 0) out.push(key);
      }
    } else {
      memory.forEach(function (value, key) {
        if (key.indexOf(prefix) === 0) out.push(key);
      });
    }
    return out.sort();
  }

  function usage() {
    var store = nativeStore();
    return { used: store ? usedBytes(store) : memoryBytes, limit: LIMIT_BYTES };
  }

  /** Tests only: empties the in-memory store. */
  function clearMemory() {
    memory.clear();
    memoryBytes = 0;
  }

  return {
    LIMIT_BYTES: LIMIT_BYTES,
    read: read,
    write: write,
    remove: remove,
    keysWithPrefix: keysWithPrefix,
    usage: usage,
    clearMemory: clearMemory,
    hasNativeStorage: function () {
      return !!nativeStore();
    }
  };
});
