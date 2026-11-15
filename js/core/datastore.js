/*
 * Scientific data memory (C-1, C-3, C-4).
 *
 * The instruments produce data at their own rate; the memory has a fixed limit
 * and whatever does not fit is lost. Data is only transmitted during a comm
 * window and in the priority order the crew chooses. When the mission closes,
 * the data that was not transmitted is worth less: that is why it pays to decide.
 */
(function (global, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    var GS = (global.GS = global.GS || {});
    GS.core = GS.core || {};
    GS.core.datastore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var LEFTOVER_VALUE = 0.6;

  function round1(value) {
    return Math.round(value * 10) / 10;
  }

  function createStore(capacity) {
    return {
      capacity: isFinite(capacity) ? capacity : 60,
      total: 0,
      // Data per instrument, so it can be prioritized by origin.
      items: {},
      transmitted: 0,
      lost: 0
    };
  }

  /** Adds produced data. Returns how much went in and how much was lost (C-1). */
  function produce(store, instrumentId, amount) {
    var incoming = Math.max(0, Number(amount) || 0);
    if (incoming === 0) return { stored: 0, lost: 0 };
    var free = Math.max(0, store.capacity - store.total);
    var stored = Math.min(incoming, free);
    var lost = round1(incoming - stored);
    if (stored > 0) {
      store.total = round1(store.total + stored);
      store.items[instrumentId] = round1((store.items[instrumentId] || 0) + stored);
    }
    store.lost = round1(store.lost + lost);
    return { stored: round1(stored), lost: lost };
  }

  /**
   * Transmits by priority (C-3). `priority` is the desired order of origins;
   * `capacity` is what the window allows sending.
   */
  function transmit(store, priority, capacity) {
    var budget = Math.max(0, Number(capacity) || 0);
    var order = (priority && priority.length ? priority : Object.keys(store.items)).filter(function (id) {
      return (store.items[id] || 0) > 0;
    });
    var sent = {};
    var totalSent = 0;

    order.forEach(function (id) {
      if (budget <= 0) return;
      var available = store.items[id] || 0;
      var amount = Math.min(available, budget);
      if (amount <= 0) return;
      sent[id] = round1(amount);
      totalSent = round1(totalSent + amount);
      budget = round1(budget - amount);
      store.items[id] = round1(available - amount);
      store.total = round1(Math.max(0, store.total - amount));
    });

    store.transmitted = round1(store.transmitted + totalSent);
    return { sent: sent, total: totalSent, remaining: store.total, capacityLeft: round1(budget) };
  }

  /** Effective scientific value when the mission closes (C-4). */
  function scienceValue(store) {
    return round1(store.transmitted + store.total * LEFTOVER_VALUE);
  }

  function storedOf(store, instrumentId) {
    return store.items[instrumentId] || 0;
  }

  /** Default priority order: whatever there is most of goes first. */
  function defaultPriority(store) {
    return Object.keys(store.items).sort(function (a, b) {
      return (store.items[b] || 0) - (store.items[a] || 0);
    });
  }

  return {
    LEFTOVER_VALUE: LEFTOVER_VALUE,
    createStore: createStore,
    produce: produce,
    transmit: transmit,
    scienceValue: scienceValue,
    storedOf: storedOf,
    defaultPriority: defaultPriority
  };
});
