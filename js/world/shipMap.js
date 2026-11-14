/*
 * Construcción del mapa navegable de la nave (S85, V-2, S31).
 *
 * Toma la geometría declarativa de `data/shipLayout.json` y los objetos de
 * `data/objects.json` y devuelve una cuadrícula de 40 × 30 casillas con salas,
 * puertas, puntos de aparición y objetos colocados. El mapa es datos planos y
 * serializables: no conoce el DOM ni el idioma (C-3, C-5).
 *
 * Formato del layout (documentado también en el informe de la tarea T6):
 *   - `rooms[].rect` es el **interior** transitable de la sala, sin paredes.
 *   - Las paredes del casco se generan automáticamente alrededor de todo suelo.
 *   - `doors[]` son casillas sueltas que perforan esa pared y unen dos salas.
 *   - `spawns[]` (a nivel de mapa) son las posiciones iniciales de 1–4 jugadores;
 *     cada sala trae además sus propios `spawns` (1–4) para reapariciones.
 */
(function (global, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./pathfinding.js'), require('../mission/catalog.js'));
  } else {
    var GS = (global.GS = global.GS || {});
    GS.world = GS.world || {};
    GS.world.shipMap = factory(GS.world.pathfinding, GS.mission && GS.mission.catalog);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (pathfinding, catalog) {
  'use strict';

  var TILES = pathfinding.TILES;

  function defaultCatalog() {
    if (catalog) return catalog;
    if (typeof globalThis !== 'undefined' && globalThis.GS && globalThis.GS.mission) {
      return globalThis.GS.mission.catalog || null;
    }
    return null;
  }

  /**
   * Lee una fuente de datos con tolerancia a las tres formas que usan las
   * pruebas y el navegador: catálogo (`catalog.shipLayout()`), registro de datos
   * (`GS.data['shipLayout']`) o inyección directa (`{layout, objects}`).
   */
  function readSource(source, name, aliases) {
    if (!source) return null;
    if (typeof source[name] === 'function') return source[name]();
    if (source[name] !== undefined) return source[name];
    var keys = aliases || [];
    for (var i = 0; i < keys.length; i += 1) {
      var alias = keys[i];
      if (typeof source[alias] === 'function') return source[alias]();
      if (source[alias] !== undefined) return source[alias];
    }
    return null;
  }

  function readLayout(source, design) {
    var direct = source && source.width && source.rooms ? source : null;
    if (direct) return direct;
    var layout = readSource(source, 'shipLayout', ['layout']);
    if (layout && layout.width && layout.rooms) return layout;
    // Un diseño puede seleccionar variante; por ahora la nave es una sola (S85).
    if (layout && Array.isArray(layout.layouts)) {
      var wanted = design && design.shipLayoutId;
      return layout.layouts.find(function (item) { return item.id === wanted; }) || layout.layouts[0];
    }
    return null;
  }

  function readObjects(source) {
    var list = readSource(source, 'objects', ['items']);
    if (Array.isArray(list)) return list;
    if (list && Array.isArray(list.items)) return list.items;
    if (source && Array.isArray(source.items)) return source.items;
    return [];
  }

  function paintRect(tiles, width, rect, value, roomIndex, roomIndexValue) {
    if (!rect) return;
    var x0 = Math.round(rect.x);
    var y0 = Math.round(rect.y);
    var w = Math.round(rect.w);
    var h = Math.round(rect.h);
    for (var y = y0; y < y0 + h; y += 1) {
      for (var x = x0; x < x0 + w; x += 1) {
        if (x < 0 || y < 0 || x >= width) continue;
        tiles[y * width + x] = value;
        if (roomIndex && roomIndexValue !== undefined) roomIndex[y * width + x] = roomIndexValue;
      }
    }
  }

  /** Añade una pared de una casilla alrededor de todo el suelo pintado. */
  function buildHull(tiles, width, height) {
    for (var y = 0; y < height; y += 1) {
      for (var x = 0; x < width; x += 1) {
        if (tiles[y * width + x] !== TILES.void) continue;
        var touchesFloor =
          (x > 0 && tiles[y * width + x - 1] === TILES.floor) ||
          (x < width - 1 && tiles[y * width + x + 1] === TILES.floor) ||
          (y > 0 && tiles[(y - 1) * width + x] === TILES.floor) ||
          (y < height - 1 && tiles[(y + 1) * width + x] === TILES.floor);
        if (touchesFloor) tiles[y * width + x] = TILES.wall;
      }
    }
  }

  function centerOf(rect) {
    return {
      x: Math.round(rect.x + (rect.w - 1) / 2),
      y: Math.round(rect.y + (rect.h - 1) / 2)
    };
  }

  function copyCell(cell) {
    return { x: Math.round(cell.x), y: Math.round(cell.y) };
  }

  function isWalkableAt(tiles, width, height, cell) {
    if (!cell) return false;
    var x = Math.round(cell.x);
    var y = Math.round(cell.y);
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    var value = tiles[y * width + x];
    return value === TILES.floor || value === TILES.door;
  }

  /**
   * Construye el mapa de la nave.
   * @param {Object} [design] diseño de misión (selección de variante de layout)
   * @param {Object} [source] catálogo, registro de datos o `{layout, objects}`
   */
  function build(design, source) {
    var data = source || defaultCatalog();
    var layout = readLayout(data, design);
    if (!layout) throw new Error('world/shipMap: falta data/shipLayout.json');
    var objectDefs = readObjects(data);

    var width = Math.round(layout.width);
    var height = Math.round(layout.height);
    var size = width * height;
    var tiles = new Array(size);
    var roomIndex = new Array(size);
    for (var i = 0; i < size; i += 1) {
      tiles[i] = TILES.void;
      roomIndex[i] = -1;
    }

    var rooms = (layout.rooms || []).map(function (room, index) {
      return {
        id: room.id,
        index: index,
        nameKey: room.nameKey || 'room.' + room.id + '.name',
        system: room.system || null,
        rect: {
          x: Math.round(room.rect.x),
          y: Math.round(room.rect.y),
          w: Math.round(room.rect.w),
          h: Math.round(room.rect.h)
        },
        center: centerOf(room.rect),
        spawns: (room.spawns || []).slice(0, 4).map(copyCell)
      };
    });

    rooms.forEach(function (room) {
      paintRect(tiles, width, room.rect, TILES.floor, roomIndex, room.index);
    });
    buildHull(tiles, width, height);

    var doors = (layout.doors || []).map(function (door) {
      var cell = { x: Math.round(door.x), y: Math.round(door.y) };
      if (cell.x >= 0 && cell.y >= 0 && cell.x < width && cell.y < height) {
        tiles[cell.y * width + cell.x] = TILES.door;
      }
      return {
        id: door.id || 'door.' + cell.x + '.' + cell.y,
        x: cell.x,
        y: cell.y,
        rooms: (door.rooms || []).slice()
      };
    });

    var spawn = (layout.spawns || [])
      .map(copyCell)
      .filter(function (cell) {
        return isWalkableAt(tiles, width, height, cell);
      });
    if (spawn.length === 0 && rooms.length > 0) spawn.push({ x: rooms[0].center.x, y: rooms[0].center.y });

    var roomById = {};
    rooms.forEach(function (room) {
      roomById[room.id] = room;
    });

    var objects = objectDefs
      .filter(function (def) {
        return def && def.id && roomById[def.roomId];
      })
      .map(function (def) {
        var room = roomById[def.roomId];
        var cell = { x: Math.round(def.x), y: Math.round(def.y) };
        if (!isWalkableAt(tiles, width, height, cell)) cell = { x: room.center.x, y: room.center.y };
        return {
          id: def.id,
          roomId: def.roomId,
          roomIndex: room.index,
          x: cell.x,
          y: cell.y,
          icon: def.icon || 'box',
          item: !!def.item,
          nameKey: def.nameKey || 'object.' + def.id + '.name',
          descKey: def.descKey || 'object.' + def.id + '.desc',
          actions: (def.actions || []).map(function (action) {
            return Object.assign({}, action);
          })
        };
      });

    var map = {
      id: layout.id || 'ship',
      version: 1,
      nameKey: layout.nameKey || 'room.ship.name',
      width: width,
      height: height,
      tileSize: layout.tileSize || 48,
      tiles: tiles,
      // Alias pedido por el contrato C-9 (`{grid, rooms, doors, spawn, objects}`).
      grid: tiles,
      roomIndex: roomIndex,
      rooms: rooms,
      doors: doors,
      spawn: spawn,
      objects: objects
    };
    return map;
  }

  /** Valor de casilla; `-1` fuera del mapa. */
  function tileAt(map, x, y) {
    return pathfinding.tileAt(map, x, y);
  }

  function isWalkable(map, x, y) {
    return pathfinding.walkable(map, { x: x, y: y });
  }

  /** Sala que contiene la casilla, o `null`. */
  function roomAt(map, x, y) {
    if (!map || !map.roomIndex) return null;
    var ix = Math.round(x);
    var iy = Math.round(y);
    if (!isFinite(ix) || !isFinite(iy) || ix < 0 || iy < 0 || ix >= map.width || iy >= map.height) return null;
    var index = map.roomIndex[iy * map.width + ix];
    if (index === undefined || index < 0) return null;
    return map.rooms[index] || null;
  }

  /** Puerta en la casilla, o `null`. */
  function doorAt(map, x, y) {
    if (!map || !map.doors) return null;
    var ix = Math.round(x);
    var iy = Math.round(y);
    return map.doors.find(function (door) {
      return door.x === ix && door.y === iy;
    }) || null;
  }

  /**
   * Punto de aparición de un jugador (0–3). Reparte entre los `spawns` del mapa
   * y repite en ciclo si se pide un índice mayor que el número de puntos.
   */
  function spawnFor(map, playerIndex) {
    if (!map || !map.spawn || map.spawn.length === 0) return { x: 0, y: 0 };
    var index = Number(playerIndex);
    if (!isFinite(index) || index < 0) index = 0;
    index = Math.floor(index) % map.spawn.length;
    return copyCell(map.spawn[index]);
  }

  /** Objetos colocados en una sala concreta. */
  function objectsInRoom(map, roomId) {
    if (!map) return [];
    return map.objects.filter(function (object) {
      return object.roomId === roomId;
    });
  }

  return {
    TILES: TILES,
    build: build,
    tileAt: tileAt,
    isWalkable: isWalkable,
    roomAt: roomAt,
    doorAt: doorAt,
    spawnFor: spawnFor,
    objectsInRoom: objectsInRoom
  };
});
