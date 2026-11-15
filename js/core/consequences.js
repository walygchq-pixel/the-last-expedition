/*
 * Consequence book (V-10 … V-13, S-5, S-7).
 *
 * It is the core of the game: every important decision is recorded here with a
 * time or event trigger and is resolved later. The book stores codes and
 * parameters (never text) so that the UI translates them when showing them.
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
      // Current mission position used to evaluate the triggers.
      now: { day: 0, events: 0 }
    };
  }

  /**
   * Schedules a consequence.
   * @param {Object} log
   * @param {Object} entry `{code, params, whyKey, severity, dueDay, dueEvents,
   *   cause, origin}`. `dueDay`/`dueEvents` are absolute; the first one fires.
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
      // Declarative effects that are applied when the trigger expires.
      effects: (source.effects || []).slice(),
      origin: source.origin || null,
      createdDay: log.now.day,
      createdEvents: log.now.events,
      // A purely event-based trigger has no day: computing 0 + today would make
      // the consequence expire on the spot and the technical debt instantaneous.
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
      // Purely time-based trigger: it is evaluated against the mission day.
      scheduled.dueEvents = Infinity;
    }
    log.nextId += 1;
    log.entries.push(scheduled);
    return scheduled;
  }

  /** Updates the mission position and returns the consequence that came due. */
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

  /** Consequences whose trigger was already met and were not resolved yet. */
  function due(log) {
    return log.entries.filter(function (entry) {
      return isDue(entry, log.now);
    });
  }

  /** Marks a consequence as resolved (the effect was already applied). */
  function resolve(log, id) {
    var entry = log.entries.find(function (item) {
      return item.id === id;
    });
    if (!entry || entry.resolved) return null;
    entry.resolved = true;
    entry.resolvedDay = log.now.day;
    return entry;
  }

  /** Pending consequences with their countdown, for the pause panel. */
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

  /** Full history for the mission report (P-2). */
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
   * Invalidates (without firing) the consequences that match a predicate.
   * It is used when a full repair or a later decision neutralizes the trigger:
   * the consequence stays as cancelled and this is reported.
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
