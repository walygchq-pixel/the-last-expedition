/*
 * Path search over the grid of the ship (S86, T-2).
 *
 * Deterministic A* with neighbours in four directions (no diagonals). The module
 * knows neither the DOM nor the contents of the ship: it only reads `map.tiles`,
 * which is the flat `width × height` array that `world/shipMap` builds.
 *
 * Cell values (the same ones declared by `data/shipLayout.json`):
 *   0 = void (outside the hull), 1 = floor, 2 = wall, 3 = door.
 * Only floor and door are walkable.
 */
(function (global, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    var GS = (global.GS = global.GS || {});
    GS.world = GS.world || {};
    GS.world.pathfinding = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var TILES = { void: 0, floor: 1, wall: 2, door: 3 };

  // Fixed exploration order: it makes two runs give exactly the same
  // route when there are several paths of equal length (C-4).
  var DIRECTIONS = [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 }
  ];

  function tilesOf(map) {
    if (!map) return null;
    return map.tiles || map.grid || null;
  }

  /** Value of the cell; `-1` if it is out of the map or there is no map. */
  function tileAt(map, x, y) {
    if (!map || !isFinite(x) || !isFinite(y)) return -1;
    var width = map.width | 0;
    var height = map.height | 0;
    var ix = Math.round(x);
    var iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= width || iy >= height) return -1;
    var tiles = tilesOf(map);
    if (!tiles) return -1;
    var value = tiles[iy * width + ix];
    return value === undefined ? -1 : value;
  }

  /** A cell is walkable if it is floor or door. */
  function walkable(map, cell) {
    if (!cell) return false;
    var value = tileAt(map, cell.x, cell.y);
    return value === TILES.floor || value === TILES.door;
  }

  /** Walkable neighbours in fixed order (up, right, down, left). */
  function neighbors(map, cell) {
    var out = [];
    if (!cell) return out;
    for (var i = 0; i < DIRECTIONS.length; i += 1) {
      var candidate = { x: cell.x + DIRECTIONS[i].x, y: cell.y + DIRECTIONS[i].y };
      if (walkable(map, candidate)) out.push(candidate);
    }
    return out;
  }

  function manhattan(ax, ay, bx, by) {
    return Math.abs(ax - bx) + Math.abs(ay - by);
  }

  /* Minimum priority queue: it sorts by f, then by h and then by insertion
   * order, so that the tie-break is stable. */
  function heapPush(heap, node) {
    heap.push(node);
    var index = heap.length - 1;
    while (index > 0) {
      var parent = (index - 1) >> 1;
      if (compare(heap[parent], heap[index]) <= 0) break;
      var swap = heap[parent];
      heap[parent] = heap[index];
      heap[index] = swap;
      index = parent;
    }
  }

  function heapPop(heap) {
    var top = heap[0];
    var last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      var index = 0;
      for (;;) {
        var left = index * 2 + 1;
        var right = left + 1;
        var smallest = index;
        if (left < heap.length && compare(heap[left], heap[smallest]) < 0) smallest = left;
        if (right < heap.length && compare(heap[right], heap[smallest]) < 0) smallest = right;
        if (smallest === index) break;
        var swap = heap[smallest];
        heap[smallest] = heap[index];
        heap[index] = swap;
        index = smallest;
      }
    }
    return top;
  }

  function compare(a, b) {
    if (a.f !== b.f) return a.f - b.f;
    if (a.h !== b.h) return a.h - b.h;
    return a.order - b.order;
  }

  /**
   * Computes the shortest route between two cells.
   * @returns {Array<{x:number,y:number}>|null} cells from `from` to `to`
   *   (both included), or `null` if there is no possible path.
   */
  function findPath(map, from, to) {
    if (!map || !walkable(map, from) || !walkable(map, to)) return null;
    var width = map.width | 0;
    var sx = Math.round(from.x);
    var sy = Math.round(from.y);
    var tx = Math.round(to.x);
    var ty = Math.round(to.y);
    if (sx === tx && sy === ty) return [{ x: sx, y: sy }];

    var size = width * (map.height | 0);
    var start = sy * width + sx;
    var goal = ty * width + tx;
    var gScore = new Float64Array(size);
    var cameFrom = new Int32Array(size);
    var closed = new Uint8Array(size);
    for (var i = 0; i < size; i += 1) {
      gScore[i] = Infinity;
      cameFrom[i] = -1;
    }
    gScore[start] = 0;

    var open = [];
    var order = 0;
    heapPush(open, { index: start, f: manhattan(sx, sy, tx, ty), h: 0, order: order });

    while (open.length > 0) {
      var current = heapPop(open);
      if (current.index === goal) return reconstruct(cameFrom, current.index, width);
      if (closed[current.index]) continue;
      closed[current.index] = 1;

      var cx = current.index % width;
      var cy = (current.index - cx) / width;
      for (var d = 0; d < DIRECTIONS.length; d += 1) {
        var nx = cx + DIRECTIONS[d].x;
        var ny = cy + DIRECTIONS[d].y;
        if (!walkable(map, { x: nx, y: ny })) continue;
        var next = ny * width + nx;
        if (closed[next]) continue;
        var tentative = gScore[current.index] + 1;
        if (tentative >= gScore[next]) continue;
        gScore[next] = tentative;
        cameFrom[next] = current.index;
        var h = manhattan(nx, ny, tx, ty);
        order += 1;
        heapPush(open, { index: next, f: tentative + h, h: h, order: order });
      }
    }
    return null;
  }

  function reconstruct(cameFrom, index, width) {
    var path = [];
    var cursor = index;
    while (cursor !== -1) {
      var x = cursor % width;
      path.push({ x: x, y: (cursor - x) / width });
      cursor = cameFrom[cursor];
    }
    path.reverse();
    return path;
  }

  return {
    TILES: TILES,
    DIRECTIONS: DIRECTIONS,
    tileAt: tileAt,
    walkable: walkable,
    neighbors: neighbors,
    findPath: findPath
  };
});
