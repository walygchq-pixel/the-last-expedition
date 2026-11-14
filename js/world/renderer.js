/*
 * Render isométrico en Canvas 2D (V-1, V-7, RG-6, S30, S5).
 *
 * Dibuja la nave vista desde arriba en tercera persona con gráficos
 * procedurales (sin imágenes ni fuentes externas) y una cámara que sigue al
 * grupo o usa encuadre compartido cuando hay más de un jugador.
 *
 * Reglas de rendimiento (S5, 60 FPS con 4 jugadores):
 *  - la geometría de cada sala se agrupa en pocas rutas (`beginPath` por sala,
 *    no por casilla) y se cachea en el mapa;
 *  - no se crean objetos por celda en cada cuadro;
 *  - el bucle de animación es externo: `render` dibuja un cuadro y nada más.
 *
 * Iluminación: los multiplicadores salen de `core/systems.effects()`, de modo
 * que la degradación de luz, temperatura y enlace se ve en la nave (V-7).
 * Accesibilidad: `a11y.highContrast` refuerza contornos y añade una forma por
 * sala degradada; `a11y.reduceMotion` apaga el parpadeo (S66, E-5).
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

  // Caché de geometría fuera del mapa, para que el estado siga siendo JSON
  // plano y serializable (C-5).
  var CACHE = typeof WeakMap === 'function' ? new WeakMap() : null;

  var ROOM_COLORS = {
    galley: { floor: '#39524b', contrast: '#0d2b22' },
    engineering: { floor: '#4b4632', contrast: '#2b230a' },
    medbay: { floor: '#33505c', contrast: '#0b2531' },
    command: { floor: '#3b4258', contrast: '#12182e' },
    corridor: { floor: '#3f3f45', contrast: '#1a1a20' },
    dorm: { floor: '#453a4e', contrast: '#201327' },
    airlock: { floor: '#4a3b3b', contrast: '#2a1414' }
  };

  var DEFAULT_COLORS = { floor: '#3d3d44', contrast: '#1b1b20' };
  var WALL_TOP = '#59606e';
  var WALL_LEFT = '#3a4050';
  var WALL_RIGHT = '#2b303d';
  var WALL_TOP_CONTRAST = '#dfe7f5';
  var WALL_SIDE_CONTRAST = '#8f9ab0';
  var DOOR_COLOR = '#c9a45c';
  var OBJECT_COLOR = '#e8d9a8';
  var BACKGROUND = '#0a0b10';

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

  /** Caché de geometría del mapa: listas de índices de casilla por sala. */
  function prepare(map) {
    if (!map) return { rooms: [], doors: [], walls: [] };
    var cached = CACHE ? CACHE.get(map) : map.renderCache;
    if (cached) return cached;
    var cache = { rooms: [], doors: [], walls: [] };
    (map.rooms || []).forEach(function (room) {
      cache.rooms.push({ room: room, tiles: [] });
    });
    var tiles = map.tiles || map.grid || [];
    var roomIndex = map.roomIndex || [];
    for (var i = 0; i < tiles.length; i += 1) {
      var value = tiles[i];
      if (value === TILES.wall) {
        cache.walls.push(i);
      } else if (value === TILES.floor || value === TILES.door) {
        var index = roomIndex[i];
        if (index !== undefined && index >= 0 && cache.rooms[index]) cache.rooms[index].tiles.push(i);
        else cache.doors.push(i);
      }
    }
    if (CACHE) CACHE.set(map, cache);
    else map.renderCache = cache;
    return cache;
  }

  /** Posición isométrica de una casilla, en píxeles sin cámara. */
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
   * Cámara de tercera persona: sigue al jugador cuando está solo y encuadra a
   * todo el grupo cuando hay varios (V-1).
   */
  function computeCamera(map, world, viewport) {
    var view = viewport || { width: 960, height: 540 };
    var list = world && world.players && world.players.list ? world.players.list : [];
    var focus;
    if (list.length === 0) {
      focus = { x: (map.width - 1) / 2, y: (map.height - 1) / 2 };
    } else if (list.length === 1) {
      focus = { x: list[0].x, y: list[0].y };
      return { x: focus.x, y: focus.y, zoom: 1.15, follow: 'player' };
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
    var zoom = clamp(Math.min(view.width / spanX, view.height / spanY), 0.45, 1.35);
    return { x: focus.x, y: focus.y, zoom: zoom, follow: 'group' };
  }

  function roomColor(room, contrast) {
    var entry = ROOM_COLORS[room && room.id] || DEFAULT_COLORS;
    return contrast ? entry.contrast : entry.floor;
  }

  function diamondPath(ctx, x, y, width, height) {
    ctx.moveTo(x, y - height / 2);
    ctx.lineTo(x + width / 2, y);
    ctx.lineTo(x, y + height / 2);
    ctx.lineTo(x - width / 2, y);
    ctx.closePath();
  }

  /** Color del sistema asociado a una sala y su salud 0–100. */
  function roomHealth(game, room) {
    if (!game || !game.systems || !room || !room.system) return { health: 100, color: null };
    var system = game.systems[room.system];
    if (!system) return { health: 100, color: null };
    return { health: clamp(system.health, 0, 100), color: SYSTEM_COLORS[room.system] || null };
  }

  function drawIcon(ctx, x, y, size, icon, color) {
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, size * 0.18);
    switch (icon) {
      case 'circle':
        ctx.beginPath();
        ctx.arc(x, y, size * 0.5, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'cross':
        ctx.beginPath();
        ctx.rect(x - size * 0.18, y - size * 0.6, size * 0.36, size * 1.2);
        ctx.rect(x - size * 0.6, y - size * 0.18, size * 1.2, size * 0.36);
        ctx.fill();
        break;
      case 'wrench':
        ctx.beginPath();
        ctx.moveTo(x - size * 0.5, y + size * 0.5);
        ctx.lineTo(x + size * 0.35, y - size * 0.4);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x + size * 0.45, y - size * 0.45, size * 0.22, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'star':
        ctx.beginPath();
        for (var i = 0; i < 10; i += 1) {
          var radius = i % 2 === 0 ? size * 0.6 : size * 0.25;
          var angle = (Math.PI / 5) * i - Math.PI / 2;
          var px = x + Math.cos(angle) * radius;
          var py = y + Math.sin(angle) * radius;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        break;
      case 'bolt':
        ctx.beginPath();
        ctx.moveTo(x + size * 0.15, y - size * 0.6);
        ctx.lineTo(x - size * 0.35, y + size * 0.1);
        ctx.lineTo(x + size * 0.05, y + size * 0.1);
        ctx.lineTo(x - size * 0.1, y + size * 0.6);
        ctx.lineTo(x + size * 0.4, y - size * 0.05);
        ctx.lineTo(x, y - size * 0.05);
        ctx.closePath();
        ctx.fill();
        break;
      case 'flask':
        ctx.beginPath();
        ctx.moveTo(x - size * 0.35, y - size * 0.55);
        ctx.lineTo(x + size * 0.35, y - size * 0.55);
        ctx.lineTo(x + size * 0.5, y + size * 0.55);
        ctx.lineTo(x - size * 0.5, y + size * 0.55);
        ctx.closePath();
        ctx.fill();
        break;
      case 'screen':
        ctx.beginPath();
        ctx.rect(x - size * 0.6, y - size * 0.45, size * 1.2, size * 0.9);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x - size * 0.3, y + size * 0.7);
        ctx.lineTo(x + size * 0.3, y + size * 0.7);
        ctx.stroke();
        break;
      case 'radio':
        ctx.beginPath();
        ctx.rect(x - size * 0.55, y - size * 0.3, size * 1.1, size * 0.7);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y - size * 0.3, size * 0.3, Math.PI, 0);
        ctx.stroke();
        break;
      case 'bed':
        ctx.beginPath();
        ctx.rect(x - size * 0.6, y - size * 0.25, size * 1.2, size * 0.55);
        ctx.fill();
        ctx.beginPath();
        ctx.rect(x - size * 0.65, y - size * 0.45, size * 0.25, size * 0.9);
        ctx.fill();
        break;
      case 'door':
        ctx.beginPath();
        ctx.arc(x, y, size * 0.55, Math.PI, 0);
        ctx.lineTo(x + size * 0.55, y + size * 0.55);
        ctx.lineTo(x - size * 0.55, y + size * 0.55);
        ctx.closePath();
        ctx.stroke();
        break;
      case 'tank':
        ctx.beginPath();
        ctx.rect(x - size * 0.45, y - size * 0.6, size * 0.9, size * 1.2);
        ctx.fill();
        break;
      default:
        ctx.beginPath();
        ctx.rect(x - size * 0.5, y - size * 0.5, size, size);
        ctx.fill();
        break;
    }
  }

  function nearestObject(map, world, players) {
    if (!map || !map.objects || players.length === 0) return null;
    var items = world && world.objects ? world.objects.items : {};
    var best = null;
    var bestDistance = 2.6;
    map.objects.forEach(function (def) {
      var instance = items[def.id];
      if (instance && instance.carriedBy) return;
      players.forEach(function (player) {
        var distance = Math.sqrt(
          Math.pow(player.x - def.x, 2) + Math.pow(player.y - def.y, 2)
        );
        if (distance < bestDistance) {
          bestDistance = distance;
          best = def;
        }
      });
    });
    return best;
  }

  function drawStatusShape(ctx, x, y, size, health) {
    // Forma además de color (S29, S66): cuadrado 0–33, triángulo 34–66,
    // círculo 67–100. Se usa un contorno blanco para que no dependa del tono.
    ctx.strokeStyle = '#f5f7ff';
    ctx.lineWidth = Math.max(1, size * 0.14);
    ctx.beginPath();
    if (health <= 33) {
      ctx.rect(x - size, y - size, size * 2, size * 2);
    } else if (health <= 66) {
      ctx.moveTo(x, y - size);
      ctx.lineTo(x + size, y + size);
      ctx.lineTo(x - size, y + size);
      ctx.closePath();
    } else {
      ctx.arc(x, y, size, 0, Math.PI * 2);
    }
    ctx.stroke();
  }

  /**
   * Dibuja un cuadro completo.
   * @param {CanvasRenderingContext2D} ctx2d
   * @param {{map:Object, game:Object, world:Object, camera:Object,
   *   a11y:Object, t:Function, viewport:Object, time:number}} options
   * @returns {{rooms:number, objects:number, players:number, zoom:number}}
   */
  function render(ctx2d, options) {
    var opts = options || {};
    var map = opts.map || (opts.world && opts.world.map);
    if (!ctx2d || !map) return { rooms: 0, objects: 0, players: 0, zoom: 1 };
    // C-9 llama `state` al estado de partida; se aceptan ambos nombres.
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
    camera.zoom = clamp(camera.zoom || 1, 0.3, 2.4);
    var zoom = camera.zoom;

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

    function screenX(x, y) {
      return origin.x + ((x - y) * (TILE_W / 2) - ((camera.x - camera.y) * (TILE_W / 2))) * zoom;
    }
    function screenY(x, y) {
      return origin.y + ((x + y) * (TILE_H / 2) - ((camera.x + camera.y) * (TILE_H / 2))) * zoom;
    }

    // Casillas: se recorre el índice plano y se calcula x/y con aritmética
    // entera, sin crear objetos por celda.
    var width = map.width;
    var tileCount = 0;
    var tileX = 0;
    var tileY = 0;
    function cellX(index) {
      return index % width;
    }
    function cellY(index) {
      return (index - (index % width)) / width;
    }

    ctx2d.save();
    ctx2d.fillStyle = BACKGROUND;
    ctx2d.fillRect(0, 0, viewport.width, viewport.height);

    // 1. Suelo por sala: una ruta por sala, no por casilla.
    cache.rooms.forEach(function (group) {
      if (group.tiles.length === 0) return;
      ctx2d.beginPath();
      for (var i = 0; i < group.tiles.length; i += 1) {
        tileCount += 1;
        tileX = cellX(group.tiles[i]);
        tileY = cellY(group.tiles[i]);
        diamondPath(ctx2d, screenX(tileX, tileY), screenY(tileX, tileY), tileWidth, tileHeight);
      }
      ctx2d.fillStyle = roomColor(group.room, !!a11y.highContrast);
      ctx2d.fill();
      if (a11y.highContrast) {
        ctx2d.strokeStyle = '#e8eefc';
        ctx2d.lineWidth = 1;
        ctx2d.stroke();
      }
    });

    // 2. Puertas: suelo destacado entre salas.
    if (cache.doors.length > 0) {
      ctx2d.beginPath();
      for (var d = 0; d < cache.doors.length; d += 1) {
        tileX = cellX(cache.doors[d]);
        tileY = cellY(cache.doors[d]);
        diamondPath(ctx2d, screenX(tileX, tileY), screenY(tileX, tileY), tileWidth, tileHeight);
      }
      ctx2d.fillStyle = DOOR_COLOR;
      ctx2d.fill();
    }

    // 3. Paredes: cara izquierda, cara derecha y tapa, cada una en su ruta.
    if (cache.walls.length > 0) {
      ctx2d.beginPath();
      for (var w = 0; w < cache.walls.length; w += 1) {
        tileX = cellX(cache.walls[w]);
        tileY = cellY(cache.walls[w]);
        var wx = screenX(tileX, tileY);
        var wy = screenY(tileX, tileY);
        ctx2d.moveTo(wx - tileWidth / 2, wy);
        ctx2d.lineTo(wx, wy + tileHeight / 2);
        ctx2d.lineTo(wx, wy + tileHeight / 2 + wallHeight);
        ctx2d.lineTo(wx - tileWidth / 2, wy + wallHeight);
        ctx2d.closePath();
      }
      ctx2d.fillStyle = a11y.highContrast ? WALL_SIDE_CONTRAST : WALL_LEFT;
      ctx2d.fill();

      ctx2d.beginPath();
      for (var r = 0; r < cache.walls.length; r += 1) {
        tileX = cellX(cache.walls[r]);
        tileY = cellY(cache.walls[r]);
        var rx = screenX(tileX, tileY);
        var ry = screenY(tileX, tileY);
        ctx2d.moveTo(rx + tileWidth / 2, ry);
        ctx2d.lineTo(rx, ry + tileHeight / 2);
        ctx2d.lineTo(rx, ry + tileHeight / 2 + wallHeight);
        ctx2d.lineTo(rx + tileWidth / 2, ry + wallHeight);
        ctx2d.closePath();
      }
      ctx2d.fillStyle = a11y.highContrast ? WALL_SIDE_CONTRAST : WALL_RIGHT;
      ctx2d.fill();

      ctx2d.beginPath();
      for (var t = 0; t < cache.walls.length; t += 1) {
        tileX = cellX(cache.walls[t]);
        tileY = cellY(cache.walls[t]);
        diamondPath(ctx2d, screenX(tileX, tileY), screenY(tileX, tileY), tileWidth, tileHeight);
      }
      ctx2d.fillStyle = a11y.highContrast ? WALL_TOP_CONTRAST : WALL_TOP;
      ctx2d.fill();
    }

    // 4. Degradación visible por sala (V-7): tinte y forma de estado.
    cache.rooms.forEach(function (group) {
      if (group.tiles.length === 0) return;
      var state = roomHealth(game, group.room);
      if (state.health >= 99 || !state.color) return;
      var alpha = ((100 - state.health) / 100) * 0.4;
      if (!a11y.reduceMotion) alpha *= 0.8 + Math.abs(Math.sin(motion * 0.6)) * 0.2;
      ctx2d.globalAlpha = clamp(alpha, 0, 0.5);
      ctx2d.beginPath();
      for (var i = 0; i < group.tiles.length; i += 1) {
        tileX = cellX(group.tiles[i]);
        tileY = cellY(group.tiles[i]);
        diamondPath(ctx2d, screenX(tileX, tileY), screenY(tileX, tileY), tileWidth, tileHeight);
      }
      ctx2d.fillStyle = state.color;
      ctx2d.fill();
      ctx2d.globalAlpha = 1;
      var center = group.room.center || group.room.rect;
      drawStatusShape(ctx2d, screenX(center.x, center.y), screenY(center.x, center.y) - tileHeight, 5 * zoom, state.health);
    });

    // 5. Objetos interactuables con iconos procedurales.
    var items = world && world.objects ? world.objects.items : {};
    var objectCount = 0;
    (map.objects || []).forEach(function (object) {
      var instance = items[object.id];
      if (instance && instance.carriedBy) return;
      objectCount += 1;
      var ox = screenX(object.x, object.y);
      var oy = screenY(object.x, object.y) - tileHeight * 0.35;
      drawIcon(ctx2d, ox, oy, 7 * zoom, object.icon, a11y.highContrast ? '#ffffff' : OBJECT_COLOR);
    });

    // 6. Jugadores: círculo con marca de dirección, sin colisión entre ellos.
    var players = world && world.players && world.players.list ? world.players.list : [];
    players.forEach(function (player) {
      var px = screenX(player.x, player.y);
      var py = screenY(player.x, player.y) - tileHeight * 0.2;
      var radius = 7 * zoom;
      ctx2d.beginPath();
      ctx2d.arc(px, py, radius, 0, Math.PI * 2);
      ctx2d.fillStyle = (ROLE_COLORS[player.role] || '#e8eefc');
      ctx2d.fill();
      if (a11y.highContrast) {
        ctx2d.strokeStyle = '#0a0b10';
        ctx2d.lineWidth = 2;
        ctx2d.stroke();
      }
      var facing = player.facing || 'down';
      var fx = px + (facing === 'left' ? -radius : facing === 'right' ? radius : 0);
      var fy = py + (facing === 'up' ? -radius : facing === 'down' ? radius : 0);
      ctx2d.beginPath();
      ctx2d.moveTo(px, py);
      ctx2d.lineTo(fx, fy);
      ctx2d.strokeStyle = '#0a0b10';
      ctx2d.lineWidth = 1.5;
      ctx2d.stroke();
    });

    // 7. Etiquetas traducidas (solo si la UI pasa `t`).
    if (translate && !a11y.hideLabels) {
      ctx2d.textAlign = 'center';
      ctx2d.textBaseline = 'middle';
      ctx2d.font = Math.round(11 * zoom) + 'px system-ui, sans-serif';
      ctx2d.fillStyle = a11y.highContrast ? '#ffffff' : 'rgba(235,240,255,0.82)';
      cache.rooms.forEach(function (group) {
        if (group.room.rect.w * group.room.rect.h < 12) return;
        var center = group.room.center;
        ctx2d.fillText(translate(group.room.nameKey), screenX(center.x, center.y), screenY(center.x, center.y) + tileHeight * 0.2);
      });
      var near = nearestObject(map, world, players);
      if (near) {
        ctx2d.fillStyle = '#ffe9a8';
        ctx2d.fillText(translate(near.nameKey), screenX(near.x, near.y), screenY(near.x, near.y) - tileHeight * 1.1);
      }
    }

    // 8. Oscurecimiento global según la potencia y el soporte vital (V-7).
    var darkness = clamp(1 - (isFinite(look.lighting) ? look.lighting : 1), 0, 1) * 0.55;
    if (darkness > 0.01) {
      ctx2d.fillStyle = 'rgba(2,4,10,' + darkness.toFixed(3) + ')';
      ctx2d.fillRect(0, 0, viewport.width, viewport.height);
    }

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
    project: project,
    toScreen: toScreen,
    computeCamera: computeCamera,
    prepare: prepare,
    render: render
  };
});
