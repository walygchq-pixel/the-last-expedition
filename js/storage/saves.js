/*
 * Saves and designs stored in `localStorage` (G-1, S-17).
 *
 * It stores the serializable simulation state (contract C-5) and the mission
 * design as keys and values, never translated text (G-2, I-10): a save written in
 * English can be opened in Spanish and vice versa.
 */
(function (global, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./store.js'));
  } else {
    var GS = (global.GS = global.GS || {});
    GS.storage = GS.storage || {};
    GS.storage.saves = factory(GS.storage.store);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (store) {
  'use strict';

  var SAVE_PREFIX = 'tle.save.v1.';
  var DESIGN_PREFIX = 'tle.design.v1.';
  var MAX_SLOTS = 20;

  function stamp(now) {
    return new Date(now || Date.now()).toISOString();
  }

  function newId(prefix, now) {
    return prefix + String(now || Date.now()) + '-' + Math.floor((now || Date.now()) % 1000);
  }

  /** Saves a game in progress. */
  function saveGame(state, options) {
    var opts = options || {};
    var id = opts.id || newId('g', opts.now);
    var payload = {
      kind: 'save',
      version: 1,
      id: id,
      savedAt: stamp(opts.now),
      day: state.clock ? Math.floor(state.clock.hours / 24) + 1 : 1,
      scenarioId: state.scenarioId,
      difficultyId: state.difficultyId,
      mode: state.mode,
      outcome: state.outcome || null,
      state: state
    };
    var result = store.write(SAVE_PREFIX + id, payload);
    if (result.ok) {
      // Slot cap: the oldest saves are dropped (R3-004).
      var all = listSaves();
      if (all.length > MAX_SLOTS) {
        all.slice(MAX_SLOTS).forEach(function (save) {
          removeSave(save.id);
        });
      }
    }
    return { ok: result.ok, code: result.code || null, id: id, bytes: result.bytes };
  }

  function loadGame(id) {
    var payload = store.read(SAVE_PREFIX + id, null);
    if (!payload || payload.kind !== 'save' || !payload.state) return null;
    return payload;
  }

  function listSaves() {
    return store
      .keysWithPrefix(SAVE_PREFIX)
      .map(function (key) {
        return store.read(key, null);
      })
      .filter(Boolean)
      .map(function (payload) {
        return {
          id: payload.id,
          savedAt: payload.savedAt,
          day: payload.day,
          scenarioId: payload.scenarioId,
          difficultyId: payload.difficultyId,
          mode: payload.mode,
          outcome: payload.outcome
        };
      })
      .sort(function (a, b) {
        return String(b.savedAt).localeCompare(String(a.savedAt));
      });
  }

  function removeSave(id) {
    return store.remove(SAVE_PREFIX + id);
  }

  /** Saves a mission design (phase 1). */
  function saveDesign(design, options) {
    var opts = options || {};
    var id = opts.id || newId('d', opts.now);
    var payload = {
      kind: 'design',
      version: 1,
      id: id,
      savedAt: stamp(opts.now),
      scenarioId: design.scenarioId,
      difficultyId: design.difficultyId,
      mode: design.mode,
      design: design
    };
    var result = store.write(DESIGN_PREFIX + id, payload);
    return { ok: result.ok, code: result.code || null, id: id, bytes: result.bytes };
  }

  function loadDesign(id) {
    var payload = store.read(DESIGN_PREFIX + id, null);
    if (!payload || payload.kind !== 'design' || !payload.design) return null;
    return payload;
  }

  function listDesigns() {
    return store
      .keysWithPrefix(DESIGN_PREFIX)
      .map(function (key) {
        return store.read(key, null);
      })
      .filter(Boolean)
      .map(function (payload) {
        return {
          id: payload.id,
          savedAt: payload.savedAt,
          scenarioId: payload.scenarioId,
          difficultyId: payload.difficultyId,
          mode: payload.mode
        };
      })
      .sort(function (a, b) {
        return String(b.savedAt).localeCompare(String(a.savedAt));
      })
      .slice(0, MAX_SLOTS);
  }

  function removeDesign(id) {
    return store.remove(DESIGN_PREFIX + id);
  }

  /** Prunes the oldest saves once the slot limit is exceeded. */
  function prune(now) {
    var cutoff = (now || Date.now()) - 1000 * 60 * 60 * 24 * 30;
    listSaves().forEach(function (save) {
      if (new Date(save.savedAt).getTime() < cutoff) removeSave(save.id);
    });
  }

  return {
    SAVE_PREFIX: SAVE_PREFIX,
    DESIGN_PREFIX: DESIGN_PREFIX,
    saveGame: saveGame,
    loadGame: loadGame,
    listSaves: listSaves,
    removeSave: removeSave,
    saveDesign: saveDesign,
    loadDesign: loadDesign,
    listDesigns: listDesigns,
    removeDesign: removeDesign,
    prune: prune
  };
});
