'use strict';

/*
 * Pruebas de la capa de mundo (T6: S7–S12, S30–S34, S86; contratos C-1…C-9).
 *
 * Se ejecutan en Node sin navegador: el mapa y los objetos salen de los JSON
 * canónicos, la simulación se prueba con `core/game` real y el render con un
 * contexto 2D falso, para comprobar que los módulos no tocan el DOM.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { registry, ROOT } = require('./helpers/data.js');
const catalog = require('../js/mission/catalog.js');
const gameModule = require('../js/core/game.js');
const shipMap = require('../js/world/shipMap.js');
const pathfinding = require('../js/world/pathfinding.js');
const objects = require('../js/world/objects.js');
const players = require('../js/world/players.js');
const input = require('../js/world/input.js');
const renderer = require('../js/world/renderer.js');
const worldModule = require('../js/world/world.js');

const DATA = registry();
catalog.init(DATA);

const LAYOUT_FILE = path.join(ROOT, 'data', 'shipLayout.json');
const OBJECTS_FILE = path.join(ROOT, 'data', 'objects.json');
const KEYS_FILE = path.join(ROOT, 'odd', 'tasks', 'keys-world.json');
const WORLD_DIR = path.join(ROOT, 'js', 'world');

const ROLES = [
  { id: 'p1', role: 'engineer' },
  { id: 'p2', role: 'medic_cook' },
  { id: 'p3', role: 'scientist' },
  { id: 'p4', role: 'communications' }
];

const ROOM_IDS = ['galley', 'engineering', 'medbay', 'command', 'corridor', 'dorm', 'airlock'];

function makeGame(overrides) {
  return gameModule.createGame(Object.assign({
    design: { parts: [], totals: {}, orbit: {} },
    players: ROLES,
    seed: 'world-test'
  }, overrides || {}));
}

function makeWorld(game, options) {
  return worldModule.create(Object.assign({ game: game }, options || {}));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function place(player, cell) {
  player.x = cell.x;
  player.y = cell.y;
}

function roomOf(map, id) {
  return map.rooms.find((room) => room.id === id);
}

test('S85: el mapa mide 40 × 30 y declara las siete salas navegables de V-2', () => {
  const map = shipMap.build({});
  assert.equal(map.width, 40);
  assert.equal(map.height, 30);
  assert.equal(map.tiles.length, 40 * 30);
  assert.equal(map.grid, map.tiles, 'C-9 expone el alias `grid`');
  assert.ok(map.rooms.length >= 7);
  const ids = map.rooms.map((room) => room.id).sort();
  assert.deepEqual(ids, ROOM_IDS.slice().sort());
  map.rooms.forEach((room) => {
    assert.match(room.nameKey, /^room\.[a-z]+\.name$/);
    assert.ok(room.rect.w > 0 && room.rect.h > 0, room.id + ' sin rectángulo');
  });
  assert.equal(map.doors.length, 6);
  // Inyección explícita del registro de datos (segundo argumento de `build`).
  const injected = shipMap.build({}, DATA);
  assert.equal(injected.width, map.width);
  assert.equal(injected.objects.length, map.objects.length);
});

test('S85: el layout y los objetos son JSON válidos con 1–4 puntos de aparición por sala', () => {
  const layout = readJson(LAYOUT_FILE);
  const objectData = readJson(OBJECTS_FILE);
  assert.equal(layout.width, 40);
  assert.equal(layout.height, 30);
  assert.ok(Array.isArray(layout.spawns) && layout.spawns.length >= 1 && layout.spawns.length <= 4);
  layout.rooms.forEach((room) => {
    assert.ok(room.spawns.length >= 1 && room.spawns.length <= 4, room.id);
    room.spawns.forEach((cell) => {
      assert.ok(cell.x >= room.rect.x && cell.x < room.rect.x + room.rect.w, room.id);
      assert.ok(cell.y >= room.rect.y && cell.y < room.rect.y + room.rect.h, room.id);
    });
  });
  assert.ok(Array.isArray(objectData.items));
  assert.equal(objectData.items.length, 59);
  assert.equal(new Set(objectData.items.map((item) => item.id)).size, 59, 'ids de objeto únicos');
});

test('S32: cada sala tiene al menos 6 objetos y como mucho 12 (12 solo en cocina y mecánica)', () => {
  const map = shipMap.build({});
  const allowed = ['system', 'crew', 'crewCondition', 'resource', 'food', 'consequence', 'flag', 'data', 'chance', 'stat'];
  const counts = {};
  map.objects.forEach((object) => {
    counts[object.roomId] = (counts[object.roomId] || 0) + 1;
    assert.match(object.nameKey, /^object\.[a-z_]+\.name$/);
    assert.match(object.descKey, /^object\.[a-z_]+\.desc$/);
    assert.ok(object.actions.length >= 1, object.id + ' sin acciones');
    const hasEffects = object.actions.some((action) => {
      assert.match(action.labelKey, /^action\.[a-z_]+\.[a-z_]+\.label$/);
      assert.match(action.estimateKey, /^action\.[a-z_]+\.[a-z_]+\.estimate$/);
      return action.effects.some((effect) => allowed.includes(effect.type));
    });
    assert.ok(hasEffects, object.id + ' es decorativo (S32)');
  });
  map.rooms.forEach((room) => {
    const total = counts[room.id] || 0;
    assert.ok(total >= 6, room.id + ' tiene ' + total + ' objetos');
    if (room.id === 'galley' || room.id === 'engineering') assert.ok(total <= 12, room.id);
    else assert.ok(total <= 10, room.id);
  });
});

test('S85: las puertas perforan el casco y unen dos salas transitables', () => {
  const map = shipMap.build({});
  map.doors.forEach((door) => {
    assert.equal(shipMap.tileAt(map, door.x, door.y), shipMap.TILES.door);
    assert.equal(shipMap.roomAt(map, door.x, door.y), null, 'la puerta queda entre salas');
    const sides = door.rooms.map((id) => roomOf(map, id));
    assert.equal(sides.length, 2, door.id);
    const neighbors = [
      { x: door.x + 1, y: door.y },
      { x: door.x - 1, y: door.y },
      { x: door.x, y: door.y + 1 },
      { x: door.x, y: door.y - 1 }
    ].filter((cell) => shipMap.isWalkable(map, cell.x, cell.y));
    assert.ok(neighbors.length >= 2, door.id + ' no conecta suelo');
    sides.forEach((room) => {
      const touches = neighbors.some((cell) => {
        const found = shipMap.roomAt(map, cell.x, cell.y);
        return found && found.id === room.id;
      });
      assert.ok(touches, door.id + ' no toca ' + room.id);
    });
  });
  assert.equal(shipMap.isWalkable(map, 0, 0), false, 'fuera del casco no se camina');
  assert.equal(shipMap.tileAt(map, 0, 0), shipMap.TILES.void);
  assert.equal(shipMap.tileAt(map, -1, 0), -1);
});

test('S86: findPath conecta el spawn con cada sala usando solo casillas transitables', () => {
  const map = shipMap.build({});
  const start = shipMap.spawnFor(map, 0);
  assert.ok(shipMap.isWalkable(map, start.x, start.y));
  map.rooms.forEach((room) => {
    const path = pathfinding.findPath(map, start, room.center);
    assert.ok(Array.isArray(path), 'sin camino a ' + room.id);
    assert.ok(path.length > 0);
    assert.deepEqual(path[0], start);
    assert.deepEqual(path[path.length - 1], room.center);
    path.forEach((cell, index) => {
      assert.ok(shipMap.isWalkable(map, cell.x, cell.y), 'casilla no transitable en ' + room.id);
      if (index > 0) {
        const step = Math.abs(cell.x - path[index - 1].x) + Math.abs(cell.y - path[index - 1].y);
        assert.equal(step, 1, 'findPath no usa diagonales (S86)');
      }
    });
    const found = shipMap.roomAt(map, room.center.x, room.center.y);
    assert.equal(found.id, room.id);
  });
});

test('S86: findPath es determinista y devuelve null cuando no hay camino', () => {
  const map = shipMap.build({});
  const start = shipMap.spawnFor(map, 0);
  const goal = roomOf(map, 'medbay').center;
  const first = pathfinding.findPath(map, start, goal);
  const second = pathfinding.findPath(map, start, goal);
  assert.deepEqual(first, second);
  assert.deepEqual(pathfinding.neighbors(map, { x: 0, y: 0 }), []);
  assert.equal(pathfinding.findPath(map, start, { x: -3, y: 0 }), null);
  assert.equal(pathfinding.findPath(map, start, { x: 0, y: 0 }), null, 'el vacío no es transitable');
  assert.deepEqual(pathfinding.findPath(map, start, start), [start]);
});

test('S7/S19: cuatro jugadores aparecen en casillas transitables y pueden compartir casilla', () => {
  const game = makeGame();
  const world = makeWorld(game);
  assert.equal(world.players.list.length, 4);
  world.players.list.forEach((player, index) => {
    assert.ok(shipMap.isWalkable(world.map, player.x, player.y), 'spawn ' + player.id);
    assert.equal(player.id, ROLES[index].id);
    assert.equal(player.role, ROLES[index].role);
    assert.deepEqual(player.inventory, []);
  });
  assert.deepEqual(shipMap.spawnFor(world.map, 5), shipMap.spawnFor(world.map, 1), 'reparte en ciclo');
  // Dos jugadores en la misma casilla: no hay colisión entre jugadores.
  place(world.players.list[1], { x: world.players.list[0].x, y: world.players.list[0].y });
  const moved = players.move(world, { p1: { right: true }, p2: { right: true } }, 0.1);
  assert.ok(moved.moved > 0);
  assert.equal(world.players.list[0].x, world.players.list[1].x);
});

test('S19: move choca contra las paredes y avanza con dt fraccionario', () => {
  const game = makeGame();
  const world = makeWorld(game);
  const spawn = world.players.list[0];
  assert.deepEqual({ x: spawn.x, y: spawn.y }, { x: 18, y: 15 });
  players.move(world, { p1: { up: true } }, 0.5);
  assert.ok(spawn.y >= 14 && spawn.y < 15, 'la pared del pasillo frena el movimiento');
  assert.equal(spawn.facing, 'up');
  players.move(world, { p1: { left: true } }, 0.5);
  assert.ok(spawn.x < 18, 'se mueve a lo largo del pasillo');
  assert.ok(shipMap.isWalkable(world.map, spawn.x, spawn.y));
});

test('S34: el inventario acepta 2 objetos y 3 con la mochila mejorada', () => {
  const game = makeGame();
  const world = makeWorld(game);
  const player = world.players.list[0];
  place(player, { x: 8, y: 18 });
  assert.equal(players.pickup(world, player.id, 'toolbox').ok, true);
  place(player, { x: 9, y: 18 });
  assert.equal(players.pickup(world, player.id, 'spare_parts').ok, true);
  place(player, { x: 8, y: 4 });
  const full = players.pickup(world, player.id, 'knives');
  assert.equal(full.ok, false);
  assert.equal(full.codes[0].code, 'err.world_inventory_full');
  assert.equal(full.codes[0].params.max, 2);
  assert.deepEqual(player.inventory, ['toolbox', 'spare_parts']);

  game.flags.backpackUpgraded = true;
  const upgraded = players.pickup(world, player.id, 'knives');
  assert.equal(upgraded.ok, true);
  assert.deepEqual(player.inventory, ['toolbox', 'spare_parts', 'knives']);
});

test('S34: pickup rechaza objetos no portables, ya llevados y fuera de alcance', () => {
  const game = makeGame();
  const world = makeWorld(game);
  const player = world.players.list[0];
  place(player, { x: 6, y: 4 });
  assert.equal(players.pickup(world, player.id, 'fridge').codes[0].code, 'err.world_not_portable');
  assert.equal(players.pickup(world, player.id, 'no-existe').codes[0].code, 'err.world_unknown_object');
  assert.equal(players.pickup(world, 'p9', 'toolbox').codes[0].code, 'err.world_unknown_player');
  assert.equal(players.pickup(world, player.id, 'toolbox').codes[0].code, 'err.world_too_far');
  place(player, { x: 8, y: 18 });
  assert.equal(players.pickup(world, player.id, 'toolbox').ok, true);
  place(world.players.list[1], { x: 8, y: 18 });
  assert.equal(players.pickup(world, 'p2', 'toolbox').codes[0].code, 'err.world_already_carried');
});

test('S34: give intercambia objetos y respeta la capacidad del receptor', () => {
  const game = makeGame();
  const world = makeWorld(game);
  const [first, second, third] = world.players.list;
  first.inventory.push('medkit');
  objects.setCarrier(world, 'medkit', first.id);
  const result = players.give(world, first.id, second.id, 'medkit');
  assert.equal(result.ok, true);
  assert.deepEqual(first.inventory, []);
  assert.deepEqual(second.inventory, ['medkit']);
  assert.equal(objects.carrierOf(world, 'medkit'), second.id);
  assert.equal(players.give(world, first.id, second.id, 'medkit').codes[0].code, 'err.world_item_not_held');
  assert.equal(players.give(world, second.id, second.id, 'medkit').codes[0].code, 'err.world_give_self');
  assert.equal(players.give(world, second.id, 'p9', 'medkit').codes[0].code, 'err.world_unknown_player');
  third.inventory.push('knives', 'ration_crates');
  assert.equal(players.give(world, second.id, third.id, 'medkit').codes[0].code, 'err.world_inventory_full');
});

test('S32/S33: interact aplica efectos reales y devuelve estimate sin texto', () => {
  const game = makeGame();
  const world = makeWorld(game);
  const actor = world.players.list[1]; // medic_cook
  place(actor, { x: 6, y: 4 });
  const beforeFreshness = game.pantry.items[0].freshness;
  const beforeHunger = game.crew.members[0].hunger;
  const result = objects.interact(world, 'fridge', 'open', actor.id);
  assert.equal(result.ok, true);
  assert.equal(result.codes[0].code, 'msg.world_object_used');
  assert.equal(result.codes[0].params.object, 'object.fridge.name');
  assert.equal(result.estimate, 'action.fridge.open.estimate');
  assert.ok(game.pantry.items[0].freshness < beforeFreshness, 'la frescura bajó');
  assert.ok(game.crew.members[0].hunger < beforeHunger, 'el hambre bajó');
  assert.ok(result.applied.some((entry) => entry.type === 'food' && entry.op === 'freshness'));
  assert.equal(objects.find(world, 'fridge').uses.open, 1);

  // Repetir no rompe los rangos del estado (efectos acumulativos acotados).
  for (let i = 0; i < 200; i += 1) objects.interact(world, 'fridge', 'open', actor.id);
  game.pantry.items.forEach((item) => assert.ok(item.freshness >= 0 && item.freshness <= 100));
  game.crew.members.forEach((member) => {
    assert.ok(member.hunger >= 0 && member.hunger <= 100);
    assert.ok(member.health >= 0 && member.health <= 100);
  });
  assert.doesNotThrow(() => JSON.stringify(gameModule.getState(game)));
});

test('S39/S40: interact puede agendar consecuencias con disparador temporal o de evento', () => {
  const game = makeGame();
  const world = makeWorld(game);
  const actor = world.players.list[1];
  place(actor, { x: 13, y: 8 });
  const before = game.log.entries.length;
  const result = objects.interact(world, 'waste_bins', 'empty', actor.id);
  assert.equal(result.ok, true);
  assert.equal(game.log.entries.length, before + 1);
  const entry = game.log.entries[game.log.entries.length - 1];
  assert.equal(entry.code, 'cons.object.waste_vent');
  assert.equal(entry.whyKey, 'cons.why.waste_vent');
  assert.equal(entry.dueDay, 2);
  assert.equal(entry.dueEvents, 3);
  assert.equal(entry.cause, 'object');
  assert.ok(game.pantry.waste >= 0);
});

test('S32: interact valida objeto, acción, rol, objeto requerido y acciones de un solo uso', () => {
  const game = makeGame();
  const world = makeWorld(game);
  const engineer = world.players.list[0];
  const cook = world.players.list[1];

  assert.equal(objects.interact(world, 'no-existe', 'open', engineer.id).codes[0].code, 'err.world_unknown_object');
  assert.equal(objects.interact(world, 'fridge', 'no-existe', engineer.id).codes[0].code, 'err.world_unknown_action');
  assert.equal(objects.interact(world, 'fridge', 'open', 'p9').codes[0].code, 'err.world_unknown_player');
  assert.equal(objects.interact({}, 'fridge', 'open', engineer.id).codes[0].code, 'err.world_no_world');

  place(cook, { x: 6, y: 4 });
  const wrongRole = objects.interact(world, 'fridge', 'service', cook.id);
  assert.equal(wrongRole.ok, false);
  assert.equal(wrongRole.codes[0].code, 'err.world_role_required');
  assert.equal(wrongRole.codes[0].params.role, 'role.engineer.name');

  place(engineer, { x: 8, y: 4 });
  assert.equal(objects.interact(world, 'fridge', 'service', engineer.id).ok, true);

  place(engineer, { x: 15, y: 21 });
  const missingItem = objects.interact(world, 'conduits', 'patch', engineer.id);
  assert.equal(missingItem.codes[0].code, 'err.world_item_required');
  assert.equal(missingItem.codes[0].params.item, 'object.toolbox.name');
  engineer.inventory.push('toolbox');
  assert.equal(objects.interact(world, 'conduits', 'patch', engineer.id).ok, true);

  place(engineer, { x: 12, y: 14 });
  assert.equal(objects.interact(world, 'fire_extinguisher', 'discharge', engineer.id).ok, true);
  const again = objects.interact(world, 'fire_extinguisher', 'discharge', engineer.id);
  assert.equal(again.ok, false);
  assert.equal(again.codes[0].code, 'err.world_action_used');
  assert.deepEqual(objects.actions(objects.find(world, 'fire_extinguisher')).map((action) => action.id), []);
  assert.equal(
    objects.interact(world, 'pressure_seal', 'replace', engineer.id).codes[0].code,
    'err.world_too_far'
  );
});

test('S32: todas las acciones del catálogo se aplican sin romper el estado de la partida', () => {
  const game = makeGame();
  const world = makeWorld(game);
  const allowed = ['system', 'crew', 'crewCondition', 'resource', 'food', 'consequence', 'flag', 'data', 'chance', 'stat'];
  let applied = 0;
  world.map.objects.forEach((definition) => {
    const instance = objects.find(world, definition.id);
    objects.actions(instance).forEach((action) => {
      let actor = world.players.list.find((player) => player.role === action.requiresRole) || world.players.list[0];
      const originalRole = actor.role;
      if (action.requiresRole) actor.role = action.requiresRole;
      if (action.requiresItem && actor.inventory.indexOf(action.requiresItem) === -1) {
        actor.inventory.push(action.requiresItem);
      }
      place(actor, { x: definition.x, y: definition.y });
      const result = objects.interact(world, definition.id, action.id, actor.id);
      assert.equal(result.ok, true, definition.id + '.' + action.id + ': ' + JSON.stringify(result.codes));
      action.effects.forEach((effect) => assert.ok(allowed.includes(effect.type), effect.type));
      actor.role = originalRole;
      applied += 1;
    });
  });
  assert.ok(applied >= 60, 'se probaron ' + applied + ' acciones');
  Object.keys(game.systems).forEach((id) => {
    const system = game.systems[id];
    assert.ok(system.health >= 0 && system.health <= 100, id);
    assert.ok(system.reliability >= 0 && system.reliability <= 100, id);
  });
  game.crew.members.forEach((member) => {
    ['health', 'hunger', 'thirst', 'sleep', 'stress', 'morale', 'hygiene'].forEach((field) => {
      assert.ok(member[field] >= 0 && member[field] <= 100, field);
    });
  });
  game.pantry.items.forEach((item) => assert.ok(item.freshness >= 0 && item.freshness <= 100));
  assert.ok(game.pantry.waste >= 0 && game.pantry.waste <= 100);
  assert.ok(game.log.entries.length >= 3, 'las acciones con consecuencia quedan agendadas');
  assert.doesNotThrow(() => JSON.stringify(gameModule.getState(game)));
});

test('S8: controles por defecto para cuatro jugadores y reasignación de teclas', () => {
  const defaults = input.defaults();
  assert.deepEqual(defaults.p1, { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', interact: 'KeyE' });
  assert.deepEqual(defaults.p2, { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', interact: 'Enter' });
  assert.equal(defaults.p3.up, 'KeyI');
  assert.equal(defaults.p3.down, 'KeyK');
  assert.equal(defaults.p3.left, 'KeyJ');
  assert.equal(defaults.p3.right, 'KeyL');
  assert.equal(defaults.p3.interact, 'Semicolon', 'la Ñ es Semicolon en el DOM');
  assert.equal(defaults.p4.up, 'Numpad8');
  assert.equal(defaults.p4.interact, 'Numpad0');
  assert.deepEqual(input.ACTIONS, ['up', 'down', 'left', 'right', 'interact']);

  const controller = input.createInput();
  assert.equal(input.bind(controller, 'p1', 'interact', 'KeyQ'), true);
  assert.equal(input.bind(controller, 'p1', 'saltar', 'KeyQ'), false);
  input.press(controller, 'KeyQ');
  const state = input.poll(controller);
  assert.equal(state.p1.interact, true);
  assert.equal(input.poll(controller).p1.interact, false, 'interact es de flanco');
});

test('S14: gamepad es opcional y no rompe cuando no hay Gamepad API', () => {
  assert.equal(typeof globalThis.document, 'undefined');
  assert.deepEqual(input.gamepad(), []);
  const controller = input.createInput();
  assert.deepEqual(input.poll(controller), {
    p1: { up: false, down: false, left: false, right: false, interact: false },
    p2: { up: false, down: false, left: false, right: false, interact: false },
    p3: { up: false, down: false, left: false, right: false, interact: false },
    p4: { up: false, down: false, left: false, right: false, interact: false }
  });
  assert.equal(input.attach(controller), false, 'sin DOM no se registran listeners');
});

test('C-1: los módulos de js/world se cargan sin DOM y no usan Math.random (C-4)', () => {
  const files = fs.readdirSync(WORLD_DIR).filter((name) => name.endsWith('.js'));
  assert.ok(files.length >= 7, 'faltan módulos de mundo');
  files.forEach((name) => {
    const source = fs.readFileSync(path.join(WORLD_DIR, name), 'utf8');
    assert.equal(/Math\.random/.test(source), false, name + ' usa Math.random');
    assert.match(source, /typeof module === 'object'/, name + ' no usa el envoltorio dual C-1');
    assert.match(source, /'use strict'/, name);
  });
  const samples = files.map((name) => require(path.join(WORLD_DIR, name)));
  samples.forEach((module) => assert.equal(typeof module, 'object'));
});

test('V-1/V-7: el render isométrico dibuja con cámara de grupo y respeta accesibilidad', () => {
  const game = makeGame();
  const world = makeWorld(game);
  const calls = [];
  const base = { canvas: { width: 800, height: 450 } };
  const ctx = new Proxy(base, {
    get(target, property) {
      if (property in target) return target[property];
      return (...args) => {
        calls.push(String(property));
        void args;
        return undefined;
      };
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    }
  });

  const labels = [];
  const translate = (key) => {
    labels.push(key);
    return key;
  };
  const stats = renderer.render(ctx, { map: world.map, game: game, world: world, a11y: {}, t: translate });
  assert.ok(stats.tiles > 200, 'se dibujaron casillas');
  assert.equal(stats.rooms, world.map.rooms.length);
  assert.equal(stats.objects, world.map.objects.length);
  assert.equal(stats.players, 4);
  assert.equal(stats.camera.follow, 'group', 'encuadre compartido con 4 jugadores');
  assert.ok(calls.includes('fill'));
  assert.ok(labels.includes('room.galley.name'), 'las etiquetas pasan por t()');
  assert.ok(labels.includes('room.medbay.name'));

  game.systems.power.health = 12;
  game.systems.thermal.health = 40;
  const dimmed = renderer.render(ctx, {
    map: world.map, game: game, world: world,
    a11y: { highContrast: true, reduceMotion: true }, t: translate
  });
  assert.ok(dimmed.tiles > 200);
  assert.ok(calls.includes('stroke'), 'alto contraste dibuja contornos');

  const solo = makeWorld(makeGame({ players: [{ id: 'p1', role: 'engineer' }] }));
  const camera = renderer.computeCamera(solo.map, solo, { width: 800, height: 450 });
  assert.equal(camera.follow, 'player');
  assert.ok(camera.zoom > 0);
  assert.deepEqual(renderer.render(null, { map: solo.map }).rooms, 0);
});

test('C-8: las claves de la capa de mundo existen en inglés y español, con paridad exacta', () => {
  const keys = readJson(KEYS_FILE);
  assert.deepEqual(Object.keys(keys).sort(), ['en', 'es']);
  const en = Object.keys(keys.en).sort();
  const es = Object.keys(keys.es).sort();
  assert.deepEqual(en, es, 'paridad de claves EN/ES');
  assert.ok(en.length > 200, 'se esperaban varias claves, hay ' + en.length);

  const markers = (text) => (String(text).match(/\{[a-zA-Z0-9_]+\}/g) || []).sort().join(',');
  en.forEach((key) => {
    assert.equal(typeof keys.en[key], 'string', key);
    assert.equal(typeof keys.es[key], 'string', key);
    assert.ok(keys.en[key].trim().length > 0, 'texto vacío en ' + key);
    assert.ok(keys.es[key].trim().length > 0, 'texto vacío en ' + key);
    assert.equal(markers(keys.en[key]), markers(keys.es[key]), 'marcadores distintos en ' + key);
  });

  // El padre fusionará este archivo en data/locales/*.json: cuando ya esté
  // fusionado, las claves también deben estar en el diccionario cargado.
  const merged = DATA['locales/en'];
  en.forEach((key) => {
    if (key in merged) assert.equal(typeof merged[key], 'string', key);
  });

  // Toda clave referenciada por los datos de mundo está declarada.
  const objectData = readJson(OBJECTS_FILE);
  objectData.items.forEach((item) => {
    [item.nameKey, item.descKey].forEach((key) => {
      assert.ok(key in keys.en, 'falta ' + key);
    });
    item.actions.forEach((action) => {
      assert.ok(action.labelKey in keys.en, 'falta ' + action.labelKey);
      assert.ok(action.estimateKey in keys.en, 'falta ' + action.estimateKey);
      const pending = action.effects.filter((effect) => effect.type === 'consequence');
      pending.forEach((effect) => {
        assert.ok(effect.code in keys.en, 'falta ' + effect.code);
        assert.ok(effect.whyKey in keys.en, 'falta ' + effect.whyKey);
      });
      if (action.requiresRole) {
        const roleKey = 'role.' + action.requiresRole + '.name';
        assert.ok(roleKey in DATA['locales/en'], 'rol sin traducir: ' + roleKey);
        assert.ok(roleKey in DATA['locales/es'], 'rol sin traducir: ' + roleKey);
      }
      if (action.requiresItem) {
        assert.ok('object.' + action.requiresItem + '.name' in keys.en);
      }
    });
  });

  // Toda clave emitida desde el código de `js/world` está declarada.
  const emitted = new Set();
  fs.readdirSync(WORLD_DIR).filter((name) => name.endsWith('.js')).forEach((name) => {
    const source = fs.readFileSync(path.join(WORLD_DIR, name), 'utf8');
    const matches = source.match(/(?:err|msg)\.[a-z_]+/g) || [];
    matches.forEach((key) => emitted.add(key));
  });
  emitted.forEach((key) => {
    assert.ok(key in keys.en, 'clave emitida sin traducir: ' + key);
    assert.ok(key in keys.es, 'clave emitida sin traducir: ' + key);
  });
  ['room.galley.name', 'room.engineering.name', 'object.fridge.name', 'action.fridge.open.estimate'].forEach((key) => {
    assert.ok(key in keys.en, 'falta ' + key);
  });
});
