/*
 * Players inside the ship (S7, S8, S19, S34).
 *
 * Cell movement with collision against walls only: players **can** share the
 * same cell, because S19 forbids collision between players. The inventory is
 * limited (2 objects, 3 with the upgraded backpack) and objects can be
 * exchanged between players.
 *
 * No DOM and no text: it returns codes and keys (C-3, RG-4).
 */
(function (global, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./pathfinding.js'), require('./objects.js'));
  } else {
    var GS = (global.GS = global.GS || {});
    GS.world = GS.world || {};
    GS.world.players = factory(GS.world.pathfinding, GS.world.objects);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (pathfinding, objects) {
  'use strict';

  var DEFAULT_SPEED = 2.4; // cells per second
  var DEFAULT_CAPACITY = 2;
  var UPGRADED_CAPACITY = 3;
  var REACH = 2.5;
  var MAX_STEP = 0.25; // prevents walking through walls with large dt

  function code(name, params) {
    return { code: name, params: params || {} };
  }

  function fail(name, params) {
    return { ok: false, codes: [code(name, params || {})] };
  }

  function playersOf(target) {
    if (!target) return null;
    if (target.players && target.players.list) return target.players;
    if (target.list) return target;
    return null;
  }

  function mapOf(target, grid) {
    if (!target) return grid || null;
    if (target.map && target.map.tiles) return target.map;
    if (target.players && target.players.map) return target.players.map;
    if (target.map && target.map.grid) return target.map;
    return grid || null;
  }

  function normalizeRole(entry, index) {
    if (typeof entry === 'string') return { id: 'p' + (index + 1), role: entry };
    if (entry && entry.role) return { id: entry.id || 'p' + (index + 1), role: entry.role };
    return { id: 'p' + (index + 1), role: 'engineer' };
  }

  /**
   * Creates the players on their spawn points.
   * @param {Object} map map from `world/shipMap`
   * @param {Array<string|{id:string,role:string}>} roles 1–4 crew roles
   * @param {Object} [options] `{speed, capacity}`
   */
  function create(map, roles, options) {
    var opts = options || {};
    var players = (roles && roles.length ? roles : ['engineer']).slice(0, 4);
    var list = players.map(function (entry, index) {
      var base = normalizeRole(entry, index);
      var cell = { x: 0, y: 0 };
      // `map.spawn` is already validated by `world/shipMap`; it wraps around.
      if (map && map.spawn && map.spawn.length) {
        var point = map.spawn[index % map.spawn.length];
        cell = { x: point.x, y: point.y };
      }
      return {
        id: base.id,
        role: base.role,
        x: cell.x,
        y: cell.y,
        facing: 'down',
        moving: false,
        walked: 0,
        inventory: [],
        capacity: isFinite(opts.capacity) ? opts.capacity : DEFAULT_CAPACITY
      };
    });
    return {
      map: map || null,
      list: list,
      speed: isFinite(opts.speed) ? opts.speed : DEFAULT_SPEED
    };
  }

  function byId(target, playerId) {
    var state = playersOf(target);
    if (!state) return null;
    return state.list.find(function (player) {
      return player.id === playerId;
    }) || null;
  }

  function canStand(map, x, y) {
    if (!map) return false;
    // The cell the player occupies is the one holding its position: that way
    // the body never overlaps a wall (travel collides with walls only, S19).
    return pathfinding.walkable(map, { x: Math.floor(x), y: Math.floor(y) });
  }

  /** Moves one player in a straight line with small steps and per-axis collision. */
  function movePlayer(map, player, dx, dy) {
    if (dx === 0 && dy === 0) {
      player.moving = false;
      return 0;
    }
    if (Math.abs(dx) >= Math.abs(dy)) player.facing = dx > 0 ? 'right' : 'left';
    else player.facing = dy > 0 ? 'down' : 'up';

    var distance = Math.sqrt(dx * dx + dy * dy);
    var steps = Math.max(1, Math.ceil(distance / MAX_STEP));
    var stepX = dx / steps;
    var stepY = dy / steps;
    var moved = 0;
    for (var i = 0; i < steps; i += 1) {
      if (stepX !== 0 && canStand(map, player.x + stepX, player.y)) {
        player.x += stepX;
        moved += Math.abs(stepX);
      }
      if (stepY !== 0 && canStand(map, player.x, player.y + stepY)) {
        player.y += stepY;
        moved += Math.abs(stepY);
      }
    }
    player.walked = Math.round((player.walked + moved) * 100) / 100;
    player.moving = moved > 0.0001;
    return moved;
  }

  /**
   * Advances every player with one frame's input state.
   * @param {Object} target world or players state
   * @param {Object} input state from `world/input.poll` (or the whole controller)
   * @param {number} dt real seconds elapsed
   * @param {Object} [grid] map when the players state is passed on its own
   * @returns {{moved:number, blocked:number}} cells travelled in total
   */
  function move(target, input, dt, grid) {
    var state = playersOf(target);
    var map = mapOf(target, grid);
    if (!state || !map) return { moved: 0, blocked: 0 };
    var actions = input && typeof input.poll === 'function' ? input.poll(input) : input || {};
    var seconds = Number(dt);
    if (!isFinite(seconds) || seconds <= 0) seconds = 0;
    var distance = state.speed * seconds;
    var total = 0;
    var active = 0;

    state.list.forEach(function (player) {
      var table = actions[player.id];
      if (!table) return;
      var dx = (table.right ? 1 : 0) - (table.left ? 1 : 0);
      var dy = (table.down ? 1 : 0) - (table.up ? 1 : 0);
      if (dx === 0 && dy === 0) {
        player.moving = false;
        return;
      }
      active += 1;
      if (dx !== 0 && dy !== 0) {
        var diagonal = distance / Math.SQRT2;
        total += movePlayer(map, player, dx * diagonal, dy * diagonal);
      } else {
        total += movePlayer(map, player, dx * distance, dy * distance);
      }
    });

    return { moved: Math.round(total * 100) / 100, active: active };
  }

  /** Inventory capacity, with the backpack upgrade (S34). */
  function capacityOf(world, player) {
    if (!player) return DEFAULT_CAPACITY;
    var upgraded = world && world.game && world.game.flags && world.game.flags.backpackUpgraded;
    if (upgraded) return Math.max(UPGRADED_CAPACITY, player.capacity || 0);
    return isFinite(player.capacity) ? player.capacity : DEFAULT_CAPACITY;
  }

  function distanceTo(player, object) {
    var dx = Number(player.x) - Number(object.x);
    var dy = Number(player.y) - Number(object.y);
    if (!isFinite(dx) || !isFinite(dy)) return 0;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Picks up a portable object and stores it in the player's inventory.
   * It honours the limit of 2 objects (3 with the upgraded backpack) and keeps
   * two players from carrying the same object.
   */
  function pickup(world, playerId, objectId) {
    var state = playersOf(world);
    if (!state || !world || !world.objects) return fail('err.world_no_world');
    var player = byId(world, playerId);
    if (!player) return fail('err.world_unknown_player');
    var object = objects.find(world, objectId);
    if (!object) return fail('err.world_unknown_object', { object: objectId });
    if (!object.item) return fail('err.world_not_portable', { object: object.nameKey });
    if (object.carriedBy) return fail('err.world_already_carried', { object: object.nameKey });
    if (distanceTo(player, object) > REACH) return fail('err.world_too_far', { object: object.nameKey });

    var capacity = capacityOf(world, player);
    if (player.inventory.length >= capacity) return fail('err.world_inventory_full', { max: capacity });

    player.inventory.push(object.id);
    objects.setCarrier(world, object.id, player.id);
    return {
      ok: true,
      codes: [code('msg.world_pickup', { item: object.nameKey })],
      inventory: player.inventory.slice()
    };
  }

  function resolvePlayer(world, ref) {
    if (!ref) return null;
    if (typeof ref === 'string') return byId(world, ref);
    if (ref.inventory && ref.id) return byId(world, ref.id) || ref;
    return null;
  }

  /**
   * Exchanges an object between two players (V-5, S34).
   * @param {Object} world
   * @param {string|Object} fromId player handing it over
   * @param {string|Object} toId player receiving it
   * @param {string} itemId object the first one already carries
   */
  function give(world, fromId, toId, itemId) {
    var state = playersOf(world);
    if (!state || !world || !world.objects) return fail('err.world_no_world');
    var from = resolvePlayer(world, fromId);
    var to = resolvePlayer(world, toId);
    if (!from || !to) return fail('err.world_unknown_player');
    if (from.id === to.id) return fail('err.world_give_self');
    if (from.inventory.indexOf(itemId) === -1) return fail('err.world_item_not_held', { item: 'object.' + itemId + '.name' });

    var object = objects.find(world, itemId);
    if (object && object.carriedBy && object.carriedBy !== from.id) {
      return fail('err.world_already_carried', { object: object.nameKey });
    }

    var capacity = capacityOf(world, to);
    if (to.inventory.length >= capacity) return fail('err.world_inventory_full', { max: capacity });

    from.inventory.splice(from.inventory.indexOf(itemId), 1);
    to.inventory.push(itemId);
    if (object) objects.setCarrier(world, itemId, to.id);
    return {
      ok: true,
      codes: [code('msg.world_give', {
        sender: from.id,
        item: object ? object.nameKey : 'object.' + itemId + '.name',
        receiver: to.id
      })],
      inventory: { from: from.inventory.slice(), to: to.inventory.slice() }
    };
  }

  return {
    DEFAULT_CAPACITY: DEFAULT_CAPACITY,
    UPGRADED_CAPACITY: UPGRADED_CAPACITY,
    REACH: REACH,
    create: create,
    byId: byId,
    move: move,
    capacityOf: capacityOf,
    pickup: pickup,
    give: give
  };
});
