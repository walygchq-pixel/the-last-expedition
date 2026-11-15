/*
 * Interactable objects of the ship (S32, S33, V-3, V-4).
 *
 * Every object placed by `world/shipMap` is instantiated here with its own state
 * (uses, consumed actions and who carries it). `interact` applies the object's
 * declarative effects to the game through `core/effects`, which is the only
 * interpreter of consequences in the game.
 *
 * No text and no DOM from this module: it returns codes and keys (C-3).
 */
(function (global, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('../core/effects.js'));
  } else {
    var GS = (global.GS = global.GS || {});
    GS.world = GS.world || {};
    GS.world.objects = factory(GS.core.effects);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (effects) {
  'use strict';

  // Maximum distance (in cells) at which an object can be used.
  var REACH = 2.5;

  function round1(value) {
    return Math.round(Number(value) * 10) / 10;
  }

  function code(name, params) {
    return { code: name, params: params || {} };
  }

  function fail(name, params) {
    return { ok: false, codes: [code(name, params)], estimate: null, applied: [] };
  }

  /** Current mission day, without depending on `core/time` (the game tracks it). */
  function currentDay(game) {
    if (!game) return 0;
    if (game.log && game.log.now && isFinite(game.log.now.day)) return round1(game.log.now.day);
    if (game.clock && isFinite(game.clock.hours)) return round1(game.clock.hours / 24);
    return 0;
  }

  function severityOf(game) {
    if (game && game.difficulty && isFinite(game.difficulty.severity)) return game.difficulty.severity;
    return 1;
  }

  /**
   * Creates the object instances of one map.
   * @returns {{map:Object, items:Object, order:Array<string>}}
   */
  function create(map) {
    var items = {};
    var order = [];
    var defs = (map && map.objects) || [];
    defs.forEach(function (def) {
      if (!def || !def.id || items[def.id]) return;
      items[def.id] = {
        id: def.id,
        roomId: def.roomId,
        roomIndex: def.roomIndex,
        x: def.x,
        y: def.y,
        icon: def.icon || 'box',
        item: !!def.item,
        nameKey: def.nameKey,
        descKey: def.descKey,
        actions: (def.actions || []).map(function (action) {
          return Object.assign({}, action);
        }),
        uses: {},
        done: {},
        carriedBy: null,
        lastDay: null
      };
      order.push(def.id);
    });
    return { map: map || null, items: items, order: order };
  }

  /** Object state of a world (`world.objects`) or `null`. */
  function store(world) {
    if (!world) return null;
    if (world.objects && world.objects.items) return world.objects;
    if (world.items && world.map) return world;
    return null;
  }

  function find(world, objectId) {
    var container = store(world);
    if (!container || !objectId) return null;
    return container.items[objectId] || null;
  }

  /** Object list in placement order (handy for panels and tests). */
  function list(world) {
    var container = store(world);
    if (!container) return [];
    return container.order.map(function (id) {
      return container.items[id];
    });
  }

  /**
   * Available actions of an object. Single-use ones disappear once consumed;
   * every descriptor keeps its `labelKey` and its `estimateKey` (S33).
   */
  function actions(object) {
    if (!object || !object.actions) return [];
    return object.actions
      .filter(function (action) {
        return !(action.once && object.done[action.id]);
      })
      .map(function (action) {
        var copy = Object.assign({}, action);
        copy.used = object.uses[action.id] || 0;
        return copy;
      });
  }

  /** Resolves the world and the game accepting several call shapes. */
  function resolveContext(target) {
    if (!target) return { world: null, game: null };
    if (target.world && store(target.world)) {
      return { world: target.world, game: target.world.game || target.game || (target.systems ? target : null) };
    }
    if (store(target)) return { world: target, game: target.game || null };
    return { world: null, game: target.systems ? target : null };
  }

  function playerOf(world, playerId) {
    if (!world || !world.players || !world.players.list) return null;
    return world.players.list.find(function (player) {
      return player.id === playerId;
    }) || null;
  }

  function distanceBetween(player, object) {
    var dx = Number(player.x) - Number(object.x);
    var dy = Number(player.y) - Number(object.y);
    if (!isFinite(dx) || !isFinite(dy)) return 0;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Applies one action of an object.
   * @param {Object} target world (`{map, game, objects, players}`), `{world, game}`
   *   or the game with `game.world`
   * @param {string} objectId
   * @param {string} actionId
   * @param {string} playerId player who interacts
   * @returns {{ok:boolean, codes:Array, estimate:(string|null), applied:Array}}
   */
  function interact(target, objectId, actionId, playerId) {
    var context = resolveContext(target);
    var world = context.world;
    var game = context.game;
    if (!world) return fail('err.world_no_world');
    if (!game || !game.systems || !game.crew || !game.log || !game.pantry) return fail('err.world_no_game');

    var object = find(world, objectId);
    if (!object) return fail('err.world_unknown_object', { object: objectId });
    // If a player carries it, it is no longer on the map to be used (R3-003).
    if (object.carriedBy) return fail('err.world_object_carried', { object: object.nameKey });

    var action = object.actions.find(function (item) {
      return item.id === actionId;
    });
    if (!action) return fail('err.world_unknown_action', { object: object.nameKey, action: actionId });
    if (action.once && object.done[actionId]) return fail('err.world_action_used', { object: object.nameKey });

    var actor = playerOf(world, playerId);
    if (playerId !== undefined && playerId !== null && !actor) return fail('err.world_unknown_player');

    // In solo play (S10) one player covers every role on the ship.
    var solo = !world.players || !world.players.list || world.players.list.length === 1;
    if (action.requiresRole && !solo && (!actor || actor.role !== action.requiresRole)) {
      return fail('err.world_role_required', { role: 'role.' + action.requiresRole + '.name' });
    }

    if (action.requiresItem) {
      var inventory = (actor && actor.inventory) || [];
      if (inventory.indexOf(action.requiresItem) === -1) {
        return fail('err.world_item_required', { item: 'object.' + action.requiresItem + '.name' });
      }
    }

    if (actor && distanceBetween(actor, object) > REACH) {
      return fail('err.world_too_far', { object: object.nameKey });
    }

    var result = effects.applyEffects(game, action.effects || [], {
      rng: game.rng,
      day: currentDay(game),
      severity: severityOf(game),
      actorRole: actor ? actor.role : null,
      origin: { kind: 'object', id: object.id, actionId: action.id }
    });

    object.uses[action.id] = (object.uses[action.id] || 0) + 1;
    if (action.once) object.done[action.id] = true;
    object.lastDay = currentDay(game);

    var codes = [code('msg.world_object_used', { object: object.nameKey, action: action.labelKey })];
    Array.prototype.push.apply(codes, result.codes || []);

    return {
      ok: true,
      codes: codes,
      estimate: action.estimateKey || null,
      applied: result.applied || []
    };
  }

  /** Marks who carries an object (used by `world/players`). */
  function setCarrier(world, objectId, playerId) {
    var object = find(world, objectId);
    if (!object) return false;
    object.carriedBy = playerId || null;
    return true;
  }

  function carrierOf(world, objectId) {
    var object = find(world, objectId);
    return object ? object.carriedBy : null;
  }

  return {
    REACH: REACH,
    create: create,
    find: find,
    list: list,
    actions: actions,
    interact: interact,
    setCarrier: setCarrier,
    carrierOf: carrierOf,
    currentDay: currentDay
  };
});
