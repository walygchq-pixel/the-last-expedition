/*
 * Libro de consecuencias (V-10 … V-13, S-5, S-7).
 *
 * Es el núcleo del juego: toda decisión importante se registra acá con un
 * disparador temporal o de evento y se resuelve más tarde. El libro guarda
 * códigos y parámetros (nunca texto) para que la UI los traduzca al mostrarlos.
 */
(function (global, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    var GS = (global.GS = global.GS || {});
    GS.core = GS.core || {};
    GS.core.consequences = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function createLog() {
    return {
      entries: [],
      nextId: 1,
      // Posición actual de la misión usada para evaluar los disparadores.
      now: { day: 0, events: 0 }
    };
  }

  /**
   * Agenda una consecuencia.
   * @param {Object} log
   * @param {Object} entry `{code, params, whyKey, severity, dueDay, dueEvents,
   *   cause, origin}`. `dueDay`/`dueEvents` son absolutos; se dispara el primero.
   */
  function schedule(log, entry) {
    var source = entry || {};
    var scheduled = {
      id: 'c' + log.nextId,
      code: source.code || 'consequence.generic',
      params: source.params || {},
      whyKey: source.whyKey || 'cons.why.generic',
      severity: source.severity || 'info',
      cause: source.cause || 'decision',
      // Efectos declarativos que se aplican cuando el disparador vence.
      effects: (source.effects || []).slice(),
      origin: source.origin || null,
      createdDay: log.now.day,
      createdEvents: log.now.events,
      // Un disparador puramente por eventos no tiene día: si se calculara 0 + hoy,
      // la consecuencia vencería en el acto y la deuda técnica sería instantánea.
      dueDay: isFinite(source.dueDay)
        ? source.dueDay
        : source.dueInDays === undefined
          ? Infinity
          : Number(source.dueInDays) + log.now.day,
      dueEvents: isFinite(source.dueEvents) ? source.dueEvents : source.dueAfterEvents ? log.now.events + source.dueAfterEvents : null,
      resolved: false,
      resolvedDay: null
    };
    if (scheduled.dueEvents === null) {
      // Disparador puramente temporal: se evalúa contra el día de misión.
      scheduled.dueEvents = Infinity;
    }
    log.nextId += 1;
    log.entries.push(scheduled);
    return scheduled;
  }

  /** Actualiza la posición de la misión y devuelve las consecuencias vencidas. */
  function advance(log, position) {
    var next = position || {};
    if (isFinite(next.day)) log.now.day = next.day;
    if (isFinite(next.events)) log.now.events = next.events;
    return due(log);
  }

  function isDue(entry, now) {
    if (entry.resolved) return false;
    var dayHit = isFinite(entry.dueDay) && now.day >= entry.dueDay;
    var eventHit = isFinite(entry.dueEvents) && entry.dueEvents !== Infinity && now.events >= entry.dueEvents;
    return dayHit || eventHit;
  }

  /** Consecuencias cuyo disparador ya se cumplió y todavía no se resolvieron. */
  function due(log) {
    return log.entries.filter(function (entry) {
      return isDue(entry, log.now);
    });
  }

  /** Marca una consecuencia como resuelta (el efecto ya se aplicó). */
  function resolve(log, id) {
    var entry = log.entries.find(function (item) {
      return item.id === id;
    });
    if (!entry || entry.resolved) return null;
    entry.resolved = true;
    entry.resolvedDay = log.now.day;
    return entry;
  }

  /** Consecuencias pendientes con su cuenta regresiva, para el panel de pausa. */
  function pending(log) {
    return log.entries
      .filter(function (entry) {
        return !entry.resolved;
      })
      .map(function (entry) {
        return {
          id: entry.id,
          code: entry.code,
          params: entry.params,
          whyKey: entry.whyKey,
          severity: entry.severity,
          createdDay: entry.createdDay,
          daysLeft: isFinite(entry.dueDay) ? Math.max(0, entry.dueDay - log.now.day) : null,
          eventsLeft: isFinite(entry.dueEvents) && entry.dueEvents !== Infinity ? Math.max(0, entry.dueEvents - log.now.events) : null
        };
      })
      .sort(function (a, b) {
        return (a.daysLeft === null ? Infinity : a.daysLeft) - (b.daysLeft === null ? Infinity : b.daysLeft);
      });
  }

  /** Historial completo para el informe de misión (P-2). */
  function history(log) {
    return log.entries.map(function (entry) {
      return {
        id: entry.id,
        code: entry.code,
        params: entry.params,
        whyKey: entry.whyKey,
        createdDay: entry.createdDay,
        resolved: entry.resolved,
        resolvedDay: entry.resolvedDay
      };
    });
  }

  /**
   * Invalida (sin disparar) las consecuencias que cumplan un predicado.
   * Se usa cuando una reparación completa o una decisión posterior neutraliza
   * el disparador: la consecuencia queda como anulada y se informa.
   */
  function cancel(log, predicate) {
    var cancelled = [];
    log.entries.forEach(function (entry) {
      if (!entry.resolved && predicate(entry)) {
        entry.resolved = true;
        entry.resolvedDay = log.now.day;
        entry.cancelled = true;
        cancelled.push(entry);
      }
    });
    return cancelled;
  }

  return {
    createLog: createLog,
    schedule: schedule,
    advance: advance,
    due: due,
    resolve: resolve,
    pending: pending,
    history: history,
    cancel: cancel
  };
});
