/*
 * Memoria de datos científicos (C-1, C-3, C-4).
 *
 * Los instrumentos producen datos a un ritmo propio; la memoria tiene un límite
 * fijo y lo que no entra se pierde. Solo se transmiten datos durante una ventana
 * de comunicación y en el orden de prioridad que elija la tripulación. Al cerrar
 * la misión, los datos no transmitidos valen menos: por eso conviene decidir.
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
      // Datos por instrumento, para poder priorizar por origen.
      items: {},
      transmitted: 0,
      lost: 0
    };
  }

  /** Agrega datos producidos. Devuelve cuánto entró y cuánto se perdió (C-1). */
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
   * Transmite según prioridad (C-3). `priority` es el orden deseado de orígenes;
   * `capacity` es lo que la ventana permite enviar.
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

  /** Valor científico efectivo al cerrar la misión (C-4). */
  function scienceValue(store) {
    return round1(store.transmitted + store.total * LEFTOVER_VALUE);
  }

  function storedOf(store, instrumentId) {
    return store.items[instrumentId] || 0;
  }

  /** Orden de prioridad por defecto: lo que más hay primero. */
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
