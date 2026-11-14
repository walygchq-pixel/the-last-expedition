/*
 * Búsqueda de caminos sobre la cuadrícula de la nave (S86, T-2).
 *
 * A* determinista con vecinos en cuatro direcciones (sin diagonales). El módulo
 * no conoce el DOM ni el contenido de la nave: solo lee `map.tiles`, que es el
 * arreglo plano de `ancho × alto` que construye `world/shipMap`.
 *
 * Valores de casilla (los mismos que declara `data/shipLayout.json`):
 *   0 = vacío (fuera del casco), 1 = suelo, 2 = pared, 3 = puerta.
 * Solo suelo y puerta son transitables.
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

  // Orden fijo de exploración: hace que dos ejecuciones den exactamente la misma
  // ruta cuando hay varios caminos de igual longitud (C-4).
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

  /** Valor de la casilla; `-1` si está fuera del mapa o no hay mapa. */
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

  /** Una casilla es transitable si es suelo o puerta. */
  function walkable(map, cell) {
    if (!cell) return false;
    var value = tileAt(map, cell.x, cell.y);
    return value === TILES.floor || value === TILES.door;
  }

  /** Vecinos transitables en orden fijo (arriba, derecha, abajo, izquierda). */
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

  /* Cola de prioridad mínima: ordena por f, luego por h y luego por orden de
     inserción, para que el desempate sea estable. */
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
   * Calcula la ruta más corta entre dos casillas.
   * @returns {Array<{x:number,y:number}>|null} casillas desde `from` hasta `to`
   *   (ambas incluidas), o `null` si no hay camino posible.
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
