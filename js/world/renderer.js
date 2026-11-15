/*
 * Isometric render in Canvas 2D (V-1, V-7, RG-6, S30, S5).
 *
 * Visual direction: holographic deck viewer. The ship is drawn as translucent
 * plates with an edge, a fine grid and three-faced objects with their own
 * details (grilles, screens, knobs, feet and a halo when they are lit).
 * Everything is procedural: no external images or fonts (RG-6).
 *
 * Performance rules (S5, 60 FPS with 4 players):
 *  - the geometry of each room is grouped into few paths and cached on the map;
 *  - the drawing order of the objects is precomputed by depth and is
 *    mixed with the players without sorting again;
 *  - no gradients or patterns are created per frame (the Node tests use a
 *    mock context that does not return them) nor objects per cell.
 *
 * Lighting: the multipliers come from `core/systems.effects()`, so that the
 * degradation of light, temperature and link is visible on the ship (V-7).
 * Accessibility: `a11y.highContrast` reinforces outlines and adds one shape per
 * degraded room; `a11y.reduceMotion` turns the pulse off (S66, E-5).
 */
(function (global, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./pathfinding.js'), require('../core/systems.js'));
  } else {
    var GS = (global.GS = global.GS || {});
    GS.world = GS.world || {};
    GS.world.renderer = factory(GS.world.pathfinding, GS.core.systems);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (pathfinding, systems) {
  'use strict';

  var TILES = pathfinding.TILES;
  var TILE_W = 48;
  var TILE_H = 24;
  var WALL_H = 18;
  var LIP = 9;

  // Geometry cache outside the map, so that the state is still plain and
  // serializable JSON (C-5).
  var CACHE = typeof WeakMap === 'function' ? new WeakMap() : null;

  // Holographic palette derived from the theme tokens: accent, text and
  // background with alpha. No new colour, only the same RGB with transparency.
  var PAL = {
    bg: '#04060b',
    plate: 'rgba(111, 211, 199, 0.045)',
    plateEdge: 'rgba(111, 211, 199, 0.42)',
    plateSide: 'rgba(111, 211, 199, 0.09)',
    grid: 'rgba(111, 211, 199, 0.16)',
    door: 'rgba(111, 211, 199, 0.32)',
    doorEdge: '#6fd3c7',
    wallTop: 'rgba(111, 211, 199, 0.12)',
    wallLeft: 'rgba(38, 54, 90, 0.92)',
    wallRight: 'rgba(9, 13, 22, 0.95)',
    wallEdge: 'rgba(111, 211, 199, 0.28)',
    objTop: 'rgba(111, 211, 199, 0.16)',
    objTopHot: 'rgba(111, 211, 199, 0.44)',
    objLeft: 'rgba(111, 211, 199, 0.06)',
    objRight: 'rgba(13, 18, 32, 0.62)',
    objEdge: 'rgba(111, 211, 199, 0.55)',
    objEdgeSoft: 'rgba(111, 211, 199, 0.32)',
    detail: 'rgba(230, 236, 251, 0.38)',
    detailHi: 'rgba(230, 236, 251, 0.62)',
    screen: 'rgba(111, 211, 199, 0.5)',
    screenOff: 'rgba(111, 211, 199, 0.14)',
    warm: 'rgba(255, 207, 107, 0.55)',
    glow: 'rgba(111, 211, 199, 0.09)',
    focus: '#ffe082',
    text: '#e6ecfb',
    shadow: 'rgba(0, 0, 0, 0.45)',
    labelPlate: 'rgba(4, 7, 12, 0.78)',
    labelEdge: 'rgba(111, 211, 199, 0.25)',
    roomLabel: 'rgba(111, 211, 199, 0.82)',
    playerChip: 'rgba(5, 7, 13, 0.85)',
    reticle: 'rgba(38, 54, 90, 0.55)',
    bracket: 'rgba(111, 211, 199, 0.5)'
  };

  // High contrast: light outlines and more opaque fills (S66).
  var PAL_CONTRAST = {
    bg: '#000000',
    plate: 'rgba(255, 255, 255, 0.07)',
    plateEdge: '#ffffff',
    plateSide: 'rgba(255, 255, 255, 0.12)',
    grid: 'rgba(255, 255, 255, 0.28)',
    door: 'rgba(255, 255, 255, 0.35)',
    doorEdge: '#ffffff',
    wallTop: 'rgba(255, 255, 255, 0.3)',
    wallLeft: 'rgba(200, 214, 245, 0.28)',
    wallRight: 'rgba(0, 0, 0, 0.85)',
    wallEdge: '#ffffff',
    objTop: 'rgba(255, 255, 255, 0.22)',
    objTopHot: 'rgba(255, 255, 255, 0.6)',
    objLeft: 'rgba(255, 255, 255, 0.1)',
    objRight: 'rgba(0, 0, 0, 0.85)',
    objEdge: '#ffffff',
    objEdgeSoft: 'rgba(255, 255, 255, 0.6)',
    detail: 'rgba(255, 255, 255, 0.8)',
    detailHi: '#ffffff',
    screen: 'rgba(255, 255, 255, 0.6)',
    screenOff: 'rgba(255, 255, 255, 0.25)',
    warm: '#ffe08a',
    glow: 'rgba(255, 255, 255, 0.12)',
    focus: '#ffe082',
    text: '#ffffff',
    shadow: 'rgba(0, 0, 0, 0.7)',
    labelPlate: 'rgba(0, 0, 0, 0.88)',
    labelEdge: '#ffffff',
    roomLabel: '#ffffff',
    playerChip: 'rgba(0, 0, 0, 0.9)',
    reticle: 'rgba(255, 255, 255, 0.22)',
    bracket: '#ffffff'
  };

  var SYSTEM_COLORS = {
    power: '#ffb347',
    lifeSupport: '#59b0ff',
    thermal: '#ff6b6b',
    comms: '#b388ff',
    attitude: '#7ce0c0',
    instruments: '#ffe082'
  };

  var ROLE_COLORS = {
    mission_planner: '#7ce0c0',
    engineer: '#ffb347',
    scientist: '#59b0ff',
    communications: '#b388ff',
    medic_cook: '#ff8fa3'
  };

  function clamp(value, min, max) {
    var n = Number(value);
    if (!isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  function lerp3(a, b, t) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  function lift(point, dy) {
    return { x: point.x, y: point.y - dy };
  }

  /** Cache of the map geometry: rooms, doors, walls and objects in order. */
  function prepare(map) {
    if (!map) return { rooms: [], doors: [], walls: [], objects: [] };
    var cached = CACHE ? CACHE.get(map) : map.renderCache;
    if (cached) return cached;
    var cache = { rooms: [], doors: [], walls: [], objects: [] };
    (map.rooms || []).forEach(function (room) {
      cache.rooms.push({ room: room, tiles: [], rect: null });
    });
    var tiles = map.tiles || map.grid || [];
    var roomIndex = map.roomIndex || [];
    var groupOf = {};
    for (var i = 0; i < tiles.length; i += 1) {
      var value = tiles[i];
      if (value === TILES.wall) {
        cache.walls.push(i);
      } else if (value === TILES.floor || value === TILES.door) {
        var index = roomIndex[i];
        if (index !== undefined && index >= 0 && cache.rooms[index]) {
          cache.rooms[index].tiles.push(i);
          groupOf[index] = cache.rooms[index];
        } else {
          cache.doors.push(i);
        }
      }
    }
    var width = map.width;
    cache.rooms.forEach(function (group) {
      var x0 = Infinity;
      var y0 = Infinity;
      var x1 = -Infinity;
      var y1 = -Infinity;
      for (var t = 0; t < group.tiles.length; t += 1) {
        var idx = group.tiles[t];
        var cx = idx % width;
        var cy = (idx - (idx % width)) / width;
        if (cx < x0) x0 = cx;
        if (cx > x1) x1 = cx;
        if (cy < y0) y0 = cy;
        if (cy > y1) y1 = cy;
      }
      if (!isFinite(x0)) {
        var fallback = group.room.rect || { x: 0, y: 0, w: 1, h: 1 };
        x0 = fallback.x;
        y0 = fallback.y;
        x1 = fallback.x + fallback.w - 1;
        y1 = fallback.y + fallback.h - 1;
      }
      group.rect = { x0: x0, y0: y0, x1: x1, y1: y1 };
    });
    cache.objects = (map.objects || []).slice().sort(function (a, b) {
      return a.x + a.y - (b.x + b.y);
    });
    if (CACHE) CACHE.set(map, cache);
    else map.renderCache = cache;
    return cache;
  }

  /** Isometric position of a cell, in pixels without the camera. */
  function project(cell) {
    var x = cell && isFinite(cell.x) ? cell.x : 0;
    var y = cell && isFinite(cell.y) ? cell.y : 0;
    return {
      x: (x - y) * (TILE_W / 2),
      y: (x + y) * (TILE_H / 2)
    };
  }

  function toScreen(point, camera, origin, zoom) {
    var camX = (camera.x - camera.y) * (TILE_W / 2);
    var camY = (camera.x + camera.y) * (TILE_H / 2);
    return {
      x: origin.x + (point.x - camX) * zoom,
      y: origin.y + (point.y - camY) * zoom
    };
  }

  /**
   * Third-person camera: it follows the player when they are alone and frames
   * the whole group when there are several (V-1).
   */
  function computeCamera(map, world, viewport) {
    var view = viewport || { width: 960, height: 540 };
    var list = world && world.players && world.players.list ? world.players.list : [];
    var focus;
    if (list.length === 0) {
      focus = { x: (map.width - 1) / 2, y: (map.height - 1) / 2 };
    } else if (list.length === 1) {
      focus = { x: list[0].x, y: list[0].y };
      return { x: focus.x, y: focus.y, zoom: 1.25, follow: 'player' };
    } else {
      focus = list.reduce(function (acc, player) {
        acc.x += player.x;
        acc.y += player.y;
        return acc;
      }, { x: 0, y: 0 });
      focus.x /= list.length;
      focus.y /= list.length;
    }

    var minX = Infinity;
    var maxX = -Infinity;
    var minY = Infinity;
    var maxY = -Infinity;
    var points = list.length > 0 ? list : [{ x: focus.x, y: focus.y }];
    points.forEach(function (player) {
      var iso = project(player);
      minX = Math.min(minX, iso.x);
      maxX = Math.max(maxX, iso.x);
      minY = Math.min(minY, iso.y);
      maxY = Math.max(maxY, iso.y);
    });
    var spanX = Math.max(TILE_W * 4, maxX - minX + TILE_W * 3);
    var spanY = Math.max(TILE_H * 4, maxY - minY + TILE_H * 4);
    var zoom = clamp(Math.min(view.width / spanX, view.height / spanY), 0.5, 1.6);
    return { x: focus.x, y: focus.y, zoom: zoom, follow: 'group' };
  }

  function roomHealth(game, room) {
    if (!game || !game.systems || !room || !room.system) return { health: 100, color: null };
    var system = game.systems[room.system];
    if (!system) return { health: 100, color: null };
    return { health: clamp(system.health, 0, 100), color: SYSTEM_COLORS[room.system] || null };
  }

  /* --- Drawing helpers ---------------------------------------------- */

  function polyPath(c, quad) {
    c.beginPath();
    c.moveTo(quad[0].x, quad[0].y);
    for (var i = 1; i < quad.length; i += 1) c.lineTo(quad[i].x, quad[i].y);
    c.closePath();
  }

  function fillPoly(c, quad, fill, stroke, width) {
    polyPath(c, quad);
    c.fillStyle = fill;
    c.fill();
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = width || 1;
      c.stroke();
    }
  }

  function line(c, a, b, stroke, width) {
    if (!a || !b) return;
    c.beginPath();
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    c.strokeStyle = stroke;
    c.lineWidth = width || 1;
    c.stroke();
  }

  function circle(c, point, radius, fill, stroke) {
    c.beginPath();
    c.arc(point.x, point.y, Math.max(0.4, radius), 0, Math.PI * 2);
    if (fill) {
      // Test proxy: `arc` returns nothing, the fill is one more call.
      c.fillStyle = fill;
      c.fill();
    }
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = 1;
      c.stroke();
    }
  }

  /** Rectangle over one face: `u` across, `v` from bottom to top. */
  function faceRect(c, geo, face, u0, v0, u1, v1, fill, stroke) {
    var at = face === 'left' ? geo.leftAt : face === 'right' ? geo.rightAt : geo.topAt;
    var quad = [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
    fillPoly(c, quad, fill, stroke, Math.max(0.6, geo.s));
  }

  /* --- Object kinds ------------------------------------------------- */

  function detailCabinet(c, g, on, pal) {
    faceRect(c, g, 'left', 0.16, 0.1, 0.84, 0.8, 'rgba(0, 0, 0, 0.2)', pal.objEdgeSoft);
    line(c, g.leftAt(0.8, 0.22), g.leftAt(0.8, 0.44), pal.detailHi, Math.max(1, 1.4 * g.s));
    for (var i = 0; i < 3; i += 1) {
      line(c, g.rightAt(0.2, 0.74 - i * 0.08), g.rightAt(0.82, 0.74 - i * 0.08), pal.detail, Math.max(0.6, 0.8 * g.s));
    }
    if (on) circle(c, g.topAt(0.5, 0.5), 1.8 * g.s, pal.focus);
  }

  function detailShelf(c, g, on, pal) {
    for (var i = 0; i < 3; i += 1) {
      faceRect(c, g, 'left', 0.12, 0.18 + i * 0.24, 0.88, 0.24 + i * 0.24, 'rgba(230, 236, 251, 0.1)', pal.objEdgeSoft);
    }
    faceRect(c, g, 'top', 0.2, 0.2, 0.45, 0.6, pal.detail, pal.objEdgeSoft);
    faceRect(c, g, 'top', 0.55, 0.3, 0.82, 0.75, 'rgba(230, 236, 251, 0.22)', pal.objEdgeSoft);
    if (on) circle(c, g.topAt(0.5, 0.8), 1.4 * g.s, pal.focus);
  }

  function detailStove(c, g, on, pal) {
    var left = g.topAt(0.32, 0.4);
    var right = g.topAt(0.7, 0.58);
    circle(c, left, 5.2 * g.s, pal.warm, pal.objEdgeSoft);
    circle(c, left, 2.4 * g.s, on ? pal.warm : 'rgba(0, 0, 0, 0.4)');
    circle(c, right, 4.2 * g.s, 'rgba(0, 0, 0, 0.3)', pal.objEdgeSoft);
    if (on) circle(c, right, 1.8 * g.s, pal.warm);
    faceRect(c, g, 'left', 0.18, 0.18, 0.82, 0.5, 'rgba(0, 0, 0, 0.28)', pal.objEdgeSoft);
    for (var i = 0; i < 3; i += 1) circle(c, g.leftAt(0.26 + i * 0.24, 0.68), 1.4 * g.s, pal.detailHi);
  }

  function detailCrate(c, g, on, pal) {
    line(c, g.topAt(0.1, 0.5), g.topAt(0.9, 0.5), pal.detail, Math.max(0.7, g.s));
    line(c, g.topAt(0.5, 0.1), g.topAt(0.5, 0.9), pal.detail, Math.max(0.7, g.s));
    faceRect(c, g, 'left', 0.15, 0.2, 0.85, 0.34, 'rgba(230, 236, 251, 0.14)', pal.objEdgeSoft);
    faceRect(c, g, 'right', 0.2, 0.16, 0.5, 0.6, pal.detail, null);
    if (on) circle(c, g.topAt(0.82, 0.82), 1.4 * g.s, pal.focus);
  }

  function detailTank(c, g, on, pal) {
    faceRect(c, g, 'left', 0.18, 0.2, 0.82, 0.32, 'rgba(111, 211, 199, 0.2)', pal.objEdgeSoft);
    faceRect(c, g, 'right', 0.22, 0.34, 0.78, 0.42, 'rgba(111, 211, 199, 0.14)', pal.objEdgeSoft);
    circle(c, g.topAt(0.5, 0.5), 3.4 * g.s, null, pal.detail);
    line(c, g.topAt(0.5, 0.5), g.rightAt(0.5, 0.9), pal.detailHi, Math.max(0.8, 1.2 * g.s));
    if (on) circle(c, g.topAt(0.28, 0.28), 1.4 * g.s, pal.focus);
  }

  function detailPump(c, g, on, pal) {
    circle(c, g.topAt(0.45, 0.45), 4.6 * g.s, null, pal.detailHi);
    for (var i = 0; i < 4; i += 1) {
      var a = (i / 4) * Math.PI * 2;
      var center = g.topAt(0.45, 0.45);
      line(
        c,
        center,
        { x: center.x + Math.cos(a) * 4.6 * g.s, y: center.y + Math.sin(a) * 1.6 * g.s },
        pal.detail,
        Math.max(0.6, g.s)
      );
    }
    line(c, g.rightAt(0.5, 0.55), g.rightAt(1, 0.35), pal.detailHi, Math.max(1, 1.6 * g.s));
    faceRect(c, g, 'left', 0.2, 0.14, 0.6, 0.34, 'rgba(0, 0, 0, 0.24)', pal.objEdgeSoft);
    if (on) circle(c, g.leftAt(0.82, 0.78), 1.5 * g.s, pal.focus);
  }

  function detailPanel(c, g, on, pal) {
    for (var row = 0; row < 4; row += 1) {
      for (var col = 0; col < 3; col += 1) {
        faceRect(
          c,
          g,
          'left',
          0.12 + col * 0.28,
          0.14 + row * 0.2,
          0.28 + col * 0.28,
          0.24 + row * 0.2,
          on ? 'rgba(111, 211, 199, 0.22)' : 'rgba(230, 236, 251, 0.1)',
          pal.objEdgeSoft
        );
      }
    }
    faceRect(c, g, 'right', 0.2, 0.2, 0.8, 0.3, on ? pal.warm : 'rgba(255, 207, 107, 0.2)', null);
    line(c, g.rightAt(0.5, 0.3), g.rightAt(0.5, 0.9), pal.detail, Math.max(0.7, g.s));
  }

  function detailConsole(c, g, on, pal) {
    faceRect(c, g, 'left', 0.16, 0.36, 0.84, 0.92, on ? pal.screen : pal.screenOff, pal.objEdge);
    for (var i = 0; i < 3; i += 1) {
      line(c, g.leftAt(0.2, 0.46 + i * 0.14), g.leftAt(0.8, 0.46 + i * 0.14), 'rgba(4, 7, 12, 0.45)', Math.max(0.6, 0.9 * g.s));
    }
    for (var k = 0; k < 4; k += 1) {
      faceRect(c, g, 'top', 0.16 + k * 0.18, 0.55, 0.28 + k * 0.18, 0.86, 'rgba(230, 236, 251, 0.14)', null);
    }
    circle(c, g.rightAt(0.7, 0.5), 1.6 * g.s, on ? pal.focus : pal.detail);
  }

  function detailScreen(c, g, on, pal) {
    faceRect(c, g, 'left', 0.12, 0.24, 0.88, 0.9, on ? pal.screen : pal.screenOff, pal.objEdge);
    line(c, g.leftAt(0.2, 0.5), g.leftAt(0.8, 0.5), 'rgba(4, 7, 12, 0.4)', Math.max(0.6, g.s));
    line(c, g.leftAt(0.2, 0.66), g.leftAt(0.6, 0.66), 'rgba(4, 7, 12, 0.4)', Math.max(0.6, g.s));
    line(c, g.topAt(0.3, 0.5), g.topAt(0.3, 0.5), pal.detail, 1);
  }

  function detailBed(c, g, on, pal) {
    faceRect(c, g, 'top', 0.14, 0.12, 0.86, 0.62, 'rgba(230, 236, 251, 0.14)', pal.objEdgeSoft);
    faceRect(c, g, 'top', 0.14, 0.66, 0.42, 0.9, 'rgba(230, 236, 251, 0.3)', pal.objEdgeSoft);
    line(c, g.topAt(0.5, 0.66), g.topAt(0.86, 0.66), pal.detail, Math.max(0.6, g.s));
    var leg = Math.max(2, 3 * g.s);
    [g.topAt(0.12, 0.12), g.topAt(0.88, 0.12), g.topAt(0.3, 0.9)].forEach(function (p) {
      line(c, p, { x: p.x, y: p.y + leg }, pal.objEdgeSoft, Math.max(0.7, g.s));
    });
    if (on) circle(c, g.topAt(0.78, 0.3), 1.3 * g.s, pal.focus);
  }

  function detailKit(c, g, on, pal) {
    faceRect(c, g, 'left', 0.3, 0.24, 0.44, 0.72, pal.detailHi, null);
    faceRect(c, g, 'left', 0.18, 0.42, 0.56, 0.54, pal.detailHi, null);
    faceRect(c, g, 'top', 0.42, 0.3, 0.66, 0.5, 'rgba(230, 236, 251, 0.14)', pal.objEdgeSoft);
    if (on) circle(c, g.topAt(0.8, 0.7), 1.3 * g.s, pal.focus);
  }

  function detailLamp(c, g, on, pal) {
    var base = g.topAt(0.5, 0.5);
    line(c, base, { x: base.x, y: base.y - 20 * g.s }, pal.detailHi, Math.max(1, 1.4 * g.s));
    var head = { x: base.x, y: base.y - 20 * g.s };
    line(c, head, { x: head.x - 5 * g.s, y: head.y - 3 * g.s }, pal.detail, Math.max(0.8, g.s));
    line(c, head, { x: head.x + 5 * g.s, y: head.y - 3 * g.s }, pal.detail, Math.max(0.8, g.s));
    if (on) {
      circle(c, { x: head.x, y: head.y + 2 * g.s }, 5 * g.s, 'rgba(255, 207, 107, 0.32)');
      circle(c, { x: head.x, y: head.y + 2 * g.s }, 2 * g.s, pal.warm);
    }
  }

  function detailBench(c, g, on, pal) {
    for (var i = 0; i < 4; i += 1) {
      faceRect(c, g, 'top', 0.16 + i * 0.17, 0.2, 0.3 + i * 0.17, 0.6, pal.detail, null);
    }
    faceRect(c, g, 'left', 0.16, 0.2, 0.84, 0.4, 'rgba(0, 0, 0, 0.24)', pal.objEdgeSoft);
    faceRect(c, g, 'left', 0.3, 0.26, 0.5, 0.32, pal.detailHi, null);
    faceRect(c, g, 'right', 0.2, 0.3, 0.6, 0.7, 'rgba(0, 0, 0, 0.3)', pal.objEdgeSoft);
    if (on) circle(c, g.topAt(0.82, 0.78), 1.3 * g.s, pal.focus);
  }

  function detailHatch(c, g, on, pal) {
    faceRect(c, g, 'top', 0.18, 0.18, 0.82, 0.82, 'rgba(111, 211, 199, 0.1)', pal.objEdge);
    circle(c, g.topAt(0.5, 0.5), 6 * g.s, null, pal.objEdge);
    line(c, g.topAt(0.2, 0.5), g.topAt(0.8, 0.5), pal.detail, Math.max(0.6, g.s));
    for (var i = 0; i < 4; i += 1) {
      circle(c, g.topAt(i < 2 ? 0.2 : 0.8, i % 2 === 0 ? 0.2 : 0.8), 1.1 * g.s, pal.detailHi);
    }
    if (on) circle(c, g.topAt(0.5, 0.5), 2 * g.s, pal.warm);
  }

  function detailFlat(c, g, on, pal) {
    line(c, g.topAt(0.1, 0.34), g.topAt(0.9, 0.34), pal.detail, Math.max(0.6, g.s));
    line(c, g.topAt(0.1, 0.66), g.topAt(0.9, 0.66), pal.detail, Math.max(0.6, g.s));
    line(c, g.topAt(0.5, 0.08), g.topAt(0.5, 0.92), pal.detail, Math.max(0.6, g.s));
    if (on) circle(c, g.topAt(0.5, 0.5), 1.4 * g.s, pal.focus);
  }

  function detailGauge(c, g, on, pal) {
    var base = g.topAt(0.5, 0.5);
    line(c, base, { x: base.x, y: base.y - 14 * g.s }, pal.detail, Math.max(0.8, g.s));
    var dial = { x: base.x, y: base.y - 14 * g.s };
    circle(c, dial, 4.6 * g.s, 'rgba(5, 7, 13, 0.7)', pal.detailHi);
    line(c, { x: dial.x, y: dial.y }, { x: dial.x + 3 * g.s, y: dial.y - 2 * g.s }, on ? pal.focus : pal.detail, Math.max(0.8, g.s));
  }

  function detailPipe(c, g, on, pal) {
    line(c, g.topAt(0.05, 0.5), g.topAt(0.95, 0.5), pal.detailHi, Math.max(1.2, 1.8 * g.s));
    circle(c, g.topAt(0.22, 0.5), 2 * g.s, null, pal.detail);
    circle(c, g.topAt(0.78, 0.5), 2 * g.s, null, pal.detail);
    if (on) circle(c, g.topAt(0.5, 0.5), 1.3 * g.s, pal.focus);
  }

  function detailRack(c, g, on, pal) {
    for (var i = 0; i < 4; i += 1) {
      faceRect(c, g, 'left', 0.14 + i * 0.19, 0.16, 0.26 + i * 0.19, 0.66, 'rgba(111, 211, 199, 0.16)', pal.objEdgeSoft);
    }
    faceRect(c, g, 'right', 0.2, 0.3, 0.8, 0.38, pal.detail, null);
    if (on) circle(c, g.topAt(0.5, 0.7), 1.6 * g.s, pal.focus);
  }

  function detailDoorframe(c, g, on, pal) {
    faceRect(c, g, 'left', 0.18, 0.1, 0.4, 0.9, 'rgba(0, 0, 0, 0.3)', pal.objEdgeSoft);
    faceRect(c, g, 'left', 0.6, 0.1, 0.82, 0.9, 'rgba(0, 0, 0, 0.3)', pal.objEdgeSoft);
    line(c, g.leftAt(0.4, 0.9), g.leftAt(0.6, 0.9), pal.detailHi, Math.max(0.8, g.s));
    if (on) circle(c, g.leftAt(0.5, 0.7), 1.4 * g.s, pal.warm);
  }

  function detailAppliance(c, g, on, pal) {
    faceRect(c, g, 'left', 0.18, 0.34, 0.82, 0.5, 'rgba(0, 0, 0, 0.28)', pal.objEdgeSoft);
    circle(c, g.topAt(0.5, 0.5), 2.6 * g.s, null, pal.detailHi);
    circle(c, g.topAt(0.5, 0.5), 1.8 * g.s, 'rgba(230, 236, 251, 0.16)');
    circle(c, g.leftAt(0.7, 0.7), 1.1 * g.s, on ? pal.focus : pal.detail);
  }

  function detailBoard(c, g, on, pal) {
    for (var i = 0; i < 3; i += 1) {
      line(c, g.topAt(0.2 + i * 0.22, 0.2), g.topAt(0.3 + i * 0.22, 0.8), pal.detail, Math.max(0.6, g.s));
    }
    if (on) circle(c, g.topAt(0.85, 0.2), 1.2 * g.s, pal.focus);
  }

  function detailSink(c, g, on, pal) {
    faceRect(c, g, 'top', 0.24, 0.24, 0.76, 0.76, 'rgba(5, 7, 13, 0.55)', pal.objEdge);
    faceRect(c, g, 'top', 0.34, 0.34, 0.66, 0.66, on ? 'rgba(111, 211, 199, 0.3)' : 'rgba(111, 211, 199, 0.12)', null);
    line(c, g.topAt(0.5, 0.5), g.topAt(0.5, 0.95), pal.detailHi, Math.max(0.9, 1.3 * g.s));
    line(c, g.topAt(0.5, 0.95), g.topAt(0.68, 0.95), pal.detailHi, Math.max(0.9, 1.3 * g.s));
  }

  function detailBin(c, g, on, pal) {
    faceRect(c, g, 'left', 0.14, 0.2, 0.86, 0.38, 'rgba(0, 0, 0, 0.26)', pal.objEdgeSoft);
    faceRect(c, g, 'top', 0.2, 0.2, 0.8, 0.8, 'rgba(230, 236, 251, 0.1)', pal.objEdgeSoft);
    line(c, g.leftAt(0.5, 0.08), g.leftAt(0.5, 0.16), pal.detail, Math.max(0.7, g.s));
    if (on) circle(c, g.topAt(0.3, 0.3), 1.2 * g.s, pal.focus);
  }

  var KIND = {
    cabinet: { ex: 0.5, ey: 0.34, h: 38, draw: detailCabinet, lit: true },
    shelf: { ex: 0.52, ey: 0.3, h: 26, draw: detailShelf, lit: true },
    stove: { ex: 0.5, ey: 0.34, h: 22, draw: detailStove, lit: true },
    crate: { ex: 0.44, ey: 0.34, h: 18, draw: detailCrate, lit: false },
    tank: { ex: 0.4, ey: 0.32, h: 32, draw: detailTank, lit: true },
    pump: { ex: 0.46, ey: 0.34, h: 24, draw: detailPump, lit: true },
    panel: { ex: 0.24, ey: 0.44, h: 48, draw: detailPanel, lit: true },
    console: { ex: 0.6, ey: 0.36, h: 28, draw: detailConsole, lit: true },
    screen: { ex: 0.5, ey: 0.22, h: 30, draw: detailScreen, lit: true },
    bed: { ex: 0.7, ey: 0.34, h: 12, draw: detailBed, lit: true },
    kit: { ex: 0.34, ey: 0.26, h: 16, draw: detailKit, lit: true },
    lamp: { ex: 0.22, ey: 0.22, h: 16, draw: detailLamp, lit: true },
    bench: { ex: 0.62, ey: 0.34, h: 20, draw: detailBench, lit: true },
    hatch: { ex: 0.5, ey: 0.5, h: 8, draw: detailHatch, lit: true },
    flat: { ex: 0.5, ey: 0.36, h: 3, draw: detailFlat, lit: true },
    gauge: { ex: 0.2, ey: 0.2, h: 8, draw: detailGauge, lit: true },
    pipe: { ex: 0.46, ey: 0.22, h: 10, draw: detailPipe, lit: true },
    rack: { ex: 0.5, ey: 0.32, h: 34, draw: detailRack, lit: true },
    doorframe: { ex: 0.5, ey: 0.24, h: 42, draw: detailDoorframe, lit: true },
    appliance: { ex: 0.32, ey: 0.26, h: 20, draw: detailAppliance, lit: true },
    board: { ex: 0.42, ey: 0.26, h: 7, draw: detailBoard, lit: true },
    sink: { ex: 0.42, ey: 0.32, h: 18, draw: detailSink, lit: true },
    bin: { ex: 0.36, ey: 0.3, h: 20, draw: detailBin, lit: true }
  };

  // One kind per identifier of `data/objects.json`: the silhouette has to
  // resemble the object, not a generic icon (V-3, S33).
  var OBJECT_KIND = {
    fridge: 'cabinet',
    pantry: 'shelf',
    stove: 'stove',
    waste_bins: 'bin',
    knives: 'board',
    sink: 'sink',
    cutting_board: 'board',
    coffee_maker: 'appliance',
    ration_crates: 'crate',
    water_tank: 'tank',
    spice_rack: 'shelf',
    grease_trap: 'pump',
    water_pump: 'pump',
    electrical_panel: 'panel',
    toolbox: 'crate',
    spare_parts: 'crate',
    conduits: 'pipe',
    air_scrubber: 'pump',
    battery_bank: 'rack',
    fuel_cells: 'crate',
    welding_bench: 'bench',
    pressure_valve: 'pump',
    coolant_loop: 'tank',
    diagnostic_terminal: 'console',
    medkit: 'kit',
    stretcher: 'bed',
    thermometer: 'kit',
    medication_pods: 'kit',
    scanner: 'console',
    oxygen_mask: 'kit',
    hygiene_station: 'sink',
    medical_log: 'shelf',
    comms_console: 'console',
    telemetry: 'console',
    orbit_control: 'console',
    logbook: 'shelf',
    star_chart: 'screen',
    nav_table: 'console',
    broadcast_mic: 'console',
    crew_terminal: 'console',
    light_panel: 'lamp',
    hatch: 'hatch',
    floor_plates: 'flat',
    fire_extinguisher: 'tank',
    pressure_gauge: 'gauge',
    storage_locker: 'cabinet',
    bunk_beds: 'bed',
    sleep_pods: 'bed',
    personal_lockers: 'cabinet',
    reading_lamp: 'lamp',
    hygiene_kit: 'kit',
    music_speaker: 'appliance',
    window_port: 'screen',
    outer_hatch: 'hatch',
    suit_locker: 'cabinet',
    decontamination: 'doorframe',
    tether_reel: 'crate',
    pressure_seal: 'pipe',
    eva_toolkit: 'crate'
  };

  function kindFor(def) {
    return KIND[OBJECT_KIND[def.id]] || KIND.crate;
  }

  function nearestToPlayer(map, world, player) {
    if (!map || !map.objects || !player) return null;
    var items = world && world.objects ? world.objects.items : {};
    var best = null;
    var bestDistance = 2.6;
    map.objects.forEach(function (def) {
      var instance = items[def.id];
      if (instance && instance.carriedBy) return;
      var distance = Math.sqrt(Math.pow(player.x - def.x, 2) + Math.pow(player.y - def.y, 2));
      if (distance < bestDistance) {
        bestDistance = distance;
        best = def;
      }
    });
    return best;
  }

  function drawStatusShape(c, x, y, size, health) {
    // Shape in addition to colour (S29, S66): square 0–33, triangle 34–66,
    // circle 67–100. A white outline is used so it does not depend on the hue.
    c.strokeStyle = '#f5f7ff';
    c.lineWidth = Math.max(1, size * 0.14);
    c.beginPath();
    if (health <= 33) {
      c.rect(x - size, y - size, size * 2, size * 2);
    } else if (health <= 66) {
      c.moveTo(x, y - size);
      c.lineTo(x + size, y + size);
      c.lineTo(x - size, y + size);
      c.closePath();
    } else {
      c.arc(x, y, size, 0, Math.PI * 2);
    }
    c.stroke();
  }

  function roundRectPath(c, x, y, w, h, r) {
    var radius = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + radius, y);
    c.lineTo(x + w - radius, y);
    c.lineTo(x + w, y + radius);
    c.lineTo(x + w, y + h - radius);
    c.lineTo(x + w - radius, y + h);
    c.lineTo(x + radius, y + h);
    c.lineTo(x, y + h - radius);
    c.lineTo(x, y + radius);
    c.closePath();
  }

  /**
   * Draws a full frame.
   * @param {CanvasRenderingContext2D} ctx2d
   * @param {{map:Object, game:Object, world:Object, camera:Object,
   *   a11y:Object, t:Function, viewport:Object, time:number, selected:string,
   *   near:string, hover:string}} options
   * @returns {{rooms:number, objects:number, players:number, zoom:number}}
   */
  function render(ctx2d, options) {
    var opts = options || {};
    var map = opts.map || (opts.world && opts.world.map);
    if (!ctx2d || !map) return { rooms: 0, objects: 0, players: 0, zoom: 1 };
    // C-9 calls the match state `state`; both names are accepted.
    var world = opts.world || (opts.state && opts.state.world) || null;
    var game = opts.game || (opts.state && opts.state.systems ? opts.state : null) || (world && world.game) || null;
    var a11y = opts.a11y || {};
    var translate = typeof opts.t === 'function' ? opts.t : null;
    var viewport = opts.viewport || (ctx2d.canvas && ctx2d.canvas.width
      ? { width: ctx2d.canvas.width, height: ctx2d.canvas.height }
      : { width: 960, height: 540 });
    var origin = { x: viewport.width / 2, y: viewport.height / 2 };
    var camera = opts.camera || computeCamera(map, world, viewport);
    if (!isFinite(camera.x)) camera.x = (map.width - 1) / 2;
    if (!isFinite(camera.y)) camera.y = (map.height - 1) / 2;
    camera.zoom = clamp(camera.zoom || 1, 0.3, 2.6);
    var zoom = camera.zoom;
    var pal = a11y.highContrast ? PAL_CONTRAST : PAL;

    var look = game && game.systems
      ? systems.effects(game.systems)
      : { lighting: 1, temperature: 1 };
    var motion = opts.time;
    if (!isFinite(motion) && game && game.clock && isFinite(game.clock.hours)) motion = game.clock.hours;
    if (!isFinite(motion)) motion = 0;

    var cache = prepare(map);
    var tileWidth = TILE_W * zoom;
    var tileHeight = TILE_H * zoom;
    var wallHeight = WALL_H * zoom;
    var lip = LIP * zoom;

    function screenX(x, y) {
      return origin.x + ((x - y) * (TILE_W / 2) - ((camera.x - camera.y) * (TILE_W / 2))) * zoom;
    }
    function screenY(x, y) {
      return origin.y + ((x + y) * (TILE_H / 2) - ((camera.x + camera.y) * (TILE_H / 2))) * zoom;
    }

    var width = map.width;
    function cellX(index) {
      return index % width;
    }
    function cellY(index) {
      return (index - (index % width)) / width;
    }

    ctx2d.save();
    ctx2d.fillStyle = pal.bg;
    ctx2d.fillRect(0, 0, viewport.width, viewport.height);

    // Cell counters: the HUD and the tests use them as a load measure.
    var tileCount = 0;

    // 1. Floor: one plate per room with an edge and a fine grid (not one figure
    //    per cell). The grid is drawn every two cells, like the viewer.
    cache.rooms.forEach(function (group) {
      var rect = group.rect;
      if (!rect) return;
      tileCount += group.tiles.length;
      var x0 = rect.x0 - 0.5;
      var y0 = rect.y0 - 0.5;
      var x1 = rect.x1 + 0.5;
      var y1 = rect.y1 + 0.5;
      var a = { x: screenX(x0, y0), y: screenY(x0, y0) };
      var b = { x: screenX(x1, y0), y: screenY(x1, y0) };
      var cc = { x: screenX(x1, y1), y: screenY(x1, y1) };
      var d = { x: screenX(x0, y1), y: screenY(x0, y1) };

      // Platform edge: two faces visible towards the front.
      fillPoly(ctx2d, [b, cc, { x: cc.x, y: cc.y + lip }, { x: b.x, y: b.y + lip }], pal.plateSide, null);
      fillPoly(ctx2d, [cc, d, { x: d.x, y: d.y + lip }, { x: cc.x, y: cc.y + lip }], pal.plateSide, null);
      fillPoly(ctx2d, [a, b, cc, d], pal.plate, pal.plateEdge, 1);

      var gx;
      var gy;
      ctx2d.beginPath();
      for (gx = rect.x0; gx <= rect.x1 + 1; gx += 2) {
        ctx2d.moveTo(screenX(gx - 0.5, y0), screenY(gx - 0.5, y0));
        ctx2d.lineTo(screenX(gx - 0.5, y1), screenY(gx - 0.5, y1));
      }
      for (gy = rect.y0; gy <= rect.y1 + 1; gy += 2) {
        ctx2d.moveTo(screenX(x0, gy - 0.5), screenY(x0, gy - 0.5));
        ctx2d.lineTo(screenX(x1, gy - 0.5), screenY(x1, gy - 0.5));
      }
      ctx2d.strokeStyle = pal.grid;
      ctx2d.lineWidth = 0.6;
      ctx2d.stroke();
    });

    // 2. Doors: highlighted cell between rooms.
    cache.doors.forEach(function (index) {
      tileCount += 1;
      var dx = cellX(index);
      var dy = cellY(index);
      var cx = screenX(dx, dy);
      var cy = screenY(dx, dy);
      var quad = [
        { x: cx, y: cy - tileHeight / 2 },
        { x: cx + tileWidth / 2, y: cy },
        { x: cx, y: cy + tileHeight / 2 },
        { x: cx - tileWidth / 2, y: cy }
      ];
      fillPoly(ctx2d, quad, pal.door, pal.doorEdge, 1);
    });

    // 3. Walls: three faces per cell, grouped into three paths.
    if (cache.walls.length > 0) {
      tileCount += cache.walls.length;
      ctx2d.beginPath();
      for (var w = 0; w < cache.walls.length; w += 1) {
        var wx = screenX(cellX(cache.walls[w]), cellY(cache.walls[w]));
        var wy = screenY(cellX(cache.walls[w]), cellY(cache.walls[w]));
        ctx2d.moveTo(wx - tileWidth / 2, wy);
        ctx2d.lineTo(wx, wy + tileHeight / 2);
        ctx2d.lineTo(wx, wy + tileHeight / 2 + wallHeight);
        ctx2d.lineTo(wx - tileWidth / 2, wy + wallHeight);
        ctx2d.closePath();
      }
      ctx2d.fillStyle = pal.wallLeft;
      ctx2d.fill();

      ctx2d.beginPath();
      for (var r = 0; r < cache.walls.length; r += 1) {
        var rx = screenX(cellX(cache.walls[r]), cellY(cache.walls[r]));
        var ry = screenY(cellX(cache.walls[r]), cellY(cache.walls[r]));
        ctx2d.moveTo(rx + tileWidth / 2, ry);
        ctx2d.lineTo(rx, ry + tileHeight / 2);
        ctx2d.lineTo(rx, ry + tileHeight / 2 + wallHeight);
        ctx2d.lineTo(rx + tileWidth / 2, ry + wallHeight);
        ctx2d.closePath();
      }
      ctx2d.fillStyle = pal.wallRight;
      ctx2d.fill();

      ctx2d.beginPath();
      for (var t = 0; t < cache.walls.length; t += 1) {
        var tx = screenX(cellX(cache.walls[t]), cellY(cache.walls[t]));
        var ty = screenY(cellX(cache.walls[t]), cellY(cache.walls[t]));
        ctx2d.moveTo(tx, ty - tileHeight / 2);
        ctx2d.lineTo(tx + tileWidth / 2, ty);
        ctx2d.lineTo(tx, ty + tileHeight / 2);
        ctx2d.lineTo(tx - tileWidth / 2, ty);
        ctx2d.closePath();
      }
      ctx2d.fillStyle = pal.wallTop;
      ctx2d.fill();
      if (a11y.highContrast) {
        ctx2d.strokeStyle = pal.wallEdge;
        ctx2d.lineWidth = 1;
        ctx2d.stroke();
      }
    }

    // 4. Visible degradation per room (V-7): tint and status shape.
    cache.rooms.forEach(function (group) {
      var state = roomHealth(game, group.room);
      if (state.health >= 99 || !state.color || !group.rect) return;
      var rect = group.rect;
      var alpha = ((100 - state.health) / 100) * 0.4;
      if (!a11y.reduceMotion) alpha *= 0.8 + Math.abs(Math.sin(motion * 0.6)) * 0.2;
      ctx2d.globalAlpha = clamp(alpha, 0, 0.5);
      var a = { x: screenX(rect.x0 - 0.5, rect.y0 - 0.5), y: screenY(rect.x0 - 0.5, rect.y0 - 0.5) };
      var b = { x: screenX(rect.x1 + 0.5, rect.y0 - 0.5), y: screenY(rect.x1 + 0.5, rect.y0 - 0.5) };
      var cc = { x: screenX(rect.x1 + 0.5, rect.y1 + 0.5), y: screenY(rect.x1 + 0.5, rect.y1 + 0.5) };
      var d = { x: screenX(rect.x0 - 0.5, rect.y1 + 0.5), y: screenY(rect.x0 - 0.5, rect.y1 + 0.5) };
      fillPoly(ctx2d, [a, b, cc, d], state.color, null);
      ctx2d.globalAlpha = 1;
      var cx = (rect.x0 + rect.x1) / 2;
      var cy = (rect.y0 + rect.y1) / 2;
      drawStatusShape(ctx2d, screenX(cx, cy), screenY(cx, cy) - tileHeight, 5 * zoom, state.health);
    });

    // 5. Objects and players, mixed by depth so that the bodies hide
    //    each other in the right order (volume, not flat icons).
    var items = world && world.objects ? world.objects.items : {};
    var players = world && world.players && world.players.list ? world.players.list : [];
    var selected = opts.selected || null;
    var nearId = opts.near || null;
    var hoverId = opts.hover || null;
    var powerHealth = game && game.systems && game.systems.power ? game.systems.power.health : 100;
    var objectCount = 0;

    var objectList = cache.objects;
    var playerList = players.slice().sort(function (p1, p2) {
      return p1.x + p1.y - (p2.x + p2.y);
    });
    var oi = 0;
    var pi = 0;
    var playerPos = {};
    var playerIndex = {};

    players.forEach(function (player, index) {
      playerIndex[player.id] = index + 1;
    });
    playerList.forEach(function (player) {
      playerPos[player.id] = { x: screenX(player.x, player.y), y: screenY(player.x, player.y) };
    });

    function objectGeo(def) {
      var kind = kindFor(def);
      var sx = screenX(def.x - kind.ex, def.y - kind.ey);
      var sy = screenY(def.x - kind.ex, def.y - kind.ey);
      var top0 = { x: sx, y: sy };
      var right0 = { x: screenX(def.x + kind.ex, def.y - kind.ey), y: screenY(def.x + kind.ex, def.y - kind.ey) };
      var front0 = { x: screenX(def.x + kind.ex, def.y + kind.ey), y: screenY(def.x + kind.ex, def.y + kind.ey) };
      var left0 = { x: screenX(def.x - kind.ex, def.y + kind.ey), y: screenY(def.x - kind.ex, def.y + kind.ey) };
      var h = kind.h * zoom;
      var top = [lift(top0, h), lift(right0, h), lift(front0, h), lift(left0, h)];
      var base = [top0, right0, front0, left0];
      var geo = {
        s: zoom,
        kind: kind,
        base: base,
        top: top,
        left: [base[3], base[2], top[2], top[3]],
        right: [base[2], base[1], top[1], top[2]],
        center: { x: (base[0].x + base[2].x) / 2, y: (base[0].y + base[2].y) / 2 }
      };
      geo.topAt = function (u, v) {
        return lerp3(lerp3(top[0], top[1], u), lerp3(top[3], top[2], u), v);
      };
      geo.leftAt = function (u, v) {
        return lerp3(lerp3(geo.left[0], geo.left[1], u), lerp3(geo.left[3], geo.left[2], u), v);
      };
      geo.rightAt = function (u, v) {
        return lerp3(lerp3(geo.right[0], geo.right[1], u), lerp3(geo.right[3], geo.right[2], u), v);
      };
      return geo;
    }

    function drawObject(def) {
      var instance = items[def.id];
      if (instance && instance.carriedBy) return;
      objectCount += 1;
      // Outside the viewer nothing is computed: only the visible volume matters.
      var cullX = screenX(def.x, def.y);
      var cullY = screenY(def.x, def.y);
      var marginX = 130;
      var marginY = 190;
      if (cullX < -marginX || cullX > viewport.width + marginX || cullY < -marginY || cullY > viewport.height + marginY) {
        return;
      }
      var hot = def.id === nearId || def.id === hoverId;
      var geo = objectGeo(def);
      var kind = geo.kind;
      var powered = !!kind.lit && powerHealth > 0;

      // Shadow cast under the object: it settles it on the deck.
      ctx2d.beginPath();
      ctx2d.ellipse(geo.center.x, geo.center.y + 1, (geo.base[1].x - geo.base[3].x) * 0.42, tileHeight * 0.32, 0, 0, Math.PI * 2);
      ctx2d.fillStyle = pal.shadow;
      ctx2d.fill();

      if (powered && (kind.draw === detailConsole || kind.draw === detailScreen || kind.draw === detailLamp)) {
        circle(ctx2d, geo.topAt(0.5, 0.5), 14 * zoom, pal.glow);
      }

      // Faces: left, right and top. The highlight changes only the top.
      fillPoly(ctx2d, geo.left, pal.objLeft, pal.objEdgeSoft, Math.max(0.5, zoom));
      fillPoly(ctx2d, geo.right, pal.objRight, pal.objEdgeSoft, Math.max(0.5, zoom));
      fillPoly(ctx2d, geo.top, hot ? pal.objTopHot : pal.objTop, pal.objEdge, Math.max(0.7, zoom));

      if (kind.draw) kind.draw(ctx2d, geo, powered, pal);

      if (hot) {
        // Focus corners around the box: same language as the viewer.
        var minX = Math.min(geo.top[3].x, geo.base[3].x) - 4 * zoom;
        var maxX = Math.max(geo.top[1].x, geo.base[1].x) + 4 * zoom;
        var minY = Math.min(geo.top[0].y, geo.top[1].y) - 4 * zoom;
        var maxY = Math.max(geo.base[2].y, geo.base[1].y) + 2 * zoom;
        var arm = Math.max(3, 5 * zoom);
        ctx2d.strokeStyle = pal.focus;
        ctx2d.lineWidth = Math.max(1, 1.2 * zoom);
        [
          [minX, minY, 1, 1],
          [maxX, minY, -1, 1],
          [minX, maxY, 1, -1],
          [maxX, maxY, -1, -1]
        ].forEach(function (corner) {
          ctx2d.beginPath();
          ctx2d.moveTo(corner[0] + arm * corner[2], corner[1]);
          ctx2d.lineTo(corner[0], corner[1]);
          ctx2d.lineTo(corner[0], corner[1] + arm * corner[3]);
          ctx2d.stroke();
        });
      }
    }

    function drawPlayer(player) {
      var point = playerPos[player.id];
      var px = point.x;
      var py = point.y;
      var s = zoom;
      var color = ROLE_COLORS[player.role] || pal.text;

      ctx2d.beginPath();
      ctx2d.ellipse(px + 1, py + 2 * s, 7 * s, 3.4 * s, 0, 0, Math.PI * 2);
      ctx2d.fillStyle = pal.shadow;
      ctx2d.fill();

      // Action ring of the selected player (V-4): dashed and with tick
      // marks, so that the radial of the UI stays anchored to the character.
      if (player.id === selected) {
        ctx2d.save();
        ctx2d.setLineDash([3 * s, 5 * s]);
        ctx2d.beginPath();
        ctx2d.arc(px, py - 6 * s, 30 * s, 0, Math.PI * 2);
        ctx2d.strokeStyle = 'rgba(111, 211, 199, 0.55)';
        ctx2d.lineWidth = Math.max(1, s);
        ctx2d.stroke();
        ctx2d.setLineDash([]);
        ctx2d.strokeStyle = 'rgba(111, 211, 199, 0.75)';
        for (var tick = 0; tick < 12; tick += 1) {
          var angle = (tick / 12) * Math.PI * 2;
          ctx2d.beginPath();
          ctx2d.moveTo(px + Math.cos(angle) * 27 * s, py - 6 * s + Math.sin(angle) * 27 * s);
          ctx2d.lineTo(px + Math.cos(angle) * 30 * s, py - 6 * s + Math.sin(angle) * 30 * s);
          ctx2d.stroke();
        }
        ctx2d.restore();
      }

      roundRectPath(ctx2d, px - 4.6 * s, py - 16 * s, 9.2 * s, 15 * s, 3.2 * s);
      ctx2d.fillStyle = 'rgba(111, 211, 199, 0.24)';
      ctx2d.fill();
      ctx2d.strokeStyle = a11y.highContrast ? '#ffffff' : color;
      ctx2d.lineWidth = Math.max(1, 1.2 * s);
      ctx2d.stroke();

      circle(ctx2d, { x: px, y: py - 19.5 * s }, 3.8 * s, a11y.highContrast ? '#ffffff' : color);

      var facing = player.facing || 'down';
      var fx = px + (facing === 'left' ? -5 * s : facing === 'right' ? 5 * s : 0);
      var fy = py + (facing === 'up' ? -17 * s : facing === 'down' ? -2 * s : 0);
      line(ctx2d, { x: px, y: py - 8 * s }, { x: fx, y: fy }, pal.bg, Math.max(1, 1.4 * s));

      // P1…P4 chip above the head, with the role colour.
      var label = 'P' + (playerIndex[player.id] || 1);
      var chipW = 22 * s;
      var chipH = 12 * s;
      roundRectPath(ctx2d, px - chipW / 2, py - 36 * s, chipW, chipH, 2);
      ctx2d.fillStyle = pal.playerChip;
      ctx2d.fill();
      ctx2d.strokeStyle = a11y.highContrast ? '#ffffff' : color;
      ctx2d.lineWidth = 1;
      ctx2d.stroke();
      ctx2d.fillStyle = a11y.highContrast ? '#ffffff' : color;
      ctx2d.textAlign = 'center';
      ctx2d.textBaseline = 'middle';
      ctx2d.font = '600 ' + Math.max(8, Math.round(9 * s)) + 'px ui-monospace, Menlo, Consolas, monospace';
      ctx2d.fillText(label, px, py - 30 * s);
    }

    while (oi < objectList.length || pi < playerList.length) {
      var objectDepth = oi < objectList.length ? objectList[oi].x + objectList[oi].y : Infinity;
      var playerDepth = pi < playerList.length ? playerList[pi].x + playerList[pi].y : Infinity;
      if (objectDepth <= playerDepth) {
        drawObject(objectList[oi]);
        oi += 1;
      } else {
        drawPlayer(playerList[pi]);
        pi += 1;
      }
    }

    // 6. Discreet room labels (only if the UI passes `t`).
    if (translate && !a11y.hideLabels) {
      ctx2d.textAlign = 'center';
      ctx2d.textBaseline = 'middle';
      ctx2d.font = '600 ' + Math.max(8, Math.round(10 * zoom)) + 'px ui-monospace, Menlo, Consolas, monospace';
      cache.rooms.forEach(function (group) {
        var rect = group.rect;
        if (!rect) return;
        var cx = (rect.x0 + rect.x1) / 2;
        var cy = (rect.y0 + rect.y1) / 2;
        var label = String(translate(group.room.nameKey) || '').toUpperCase();
        if (!label) return;
        var x = screenX(cx, cy);
        var y = screenY(cx, cy) - tileHeight * 1.25;
        var w = label.length * Math.max(4, 6.2 * zoom) + 12;
        roundRectPath(ctx2d, x - w / 2, y - 8, w, 16, 2);
        ctx2d.fillStyle = pal.labelPlate;
        ctx2d.fill();
        ctx2d.strokeStyle = pal.labelEdge;
        ctx2d.lineWidth = 1;
        ctx2d.stroke();
        ctx2d.fillStyle = pal.roomLabel;
        ctx2d.fillText(label, x, y + 0.5);
      });
    }

    // 7. Reticle of the viewer inside the canvas itself: one layer less to
    //    recompose over the canvas and the same console language (S5).
    var step = 48;
    ctx2d.beginPath();
    for (var rx = step; rx < viewport.width; rx += step) {
      ctx2d.moveTo(rx, 0);
      ctx2d.lineTo(rx, viewport.height);
    }
    for (var ry = step; ry < viewport.height; ry += step) {
      ctx2d.moveTo(0, ry);
      ctx2d.lineTo(viewport.width, ry);
    }
    ctx2d.strokeStyle = pal.reticle;
    ctx2d.lineWidth = 1;
    ctx2d.stroke();

    // 8. Global darkening according to power and life support (V-7).
    var darkness = clamp(1 - (isFinite(look.lighting) ? look.lighting : 1), 0, 1) * 0.55;
    if (darkness > 0.01) {
      ctx2d.fillStyle = 'rgba(2,4,10,' + darkness.toFixed(3) + ')';
      ctx2d.fillRect(0, 0, viewport.width, viewport.height);
    }

    // 9. Corner marks of the viewer (same measurements as the artboard).
    var arm = 34;
    var inset = 9;
    var corners = [
      [inset, inset, 1, 1],
      [viewport.width - inset, inset, -1, 1],
      [inset, viewport.height - inset, 1, -1],
      [viewport.width - inset, viewport.height - inset, -1, -1]
    ];
    ctx2d.beginPath();
    corners.forEach(function (corner) {
      ctx2d.moveTo(corner[0] + arm * corner[2], corner[1]);
      ctx2d.lineTo(corner[0], corner[1]);
      ctx2d.lineTo(corner[0], corner[1] + arm * corner[3]);
    });
    ctx2d.strokeStyle = pal.bracket;
    ctx2d.lineWidth = 1;
    ctx2d.stroke();

    ctx2d.restore();
    return {
      tiles: tileCount,
      rooms: cache.rooms.length,
      objects: objectCount,
      players: players.length,
      zoom: zoom,
      camera: camera
    };
  }

  return {
    TILE_W: TILE_W,
    TILE_H: TILE_H,
    WALL_H: WALL_H,
    OBJECT_KIND: OBJECT_KIND,
    project: project,
    toScreen: toScreen,
    computeCamera: computeCamera,
    prepare: prepare,
    render: render
  };
});
