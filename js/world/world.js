/*
 * Pegamento de la capa de mundo (`js/world`).
 *
 * Junta mapa, objetos, jugadores y entrada en un único estado serializable que
 * consumen el render y la UI. No tiene lógica propia: solo compone los módulos
 * de la capa y expone `create`, `step` y `nearest`.
 */
(function (global, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(
      require('./shipMap.js'),
      require('./objects.js'),
      require('./players.js'),
      require('./input.js')
    );
  } else {
    var GS = (global.GS = global.GS || {});
    GS.world = GS.world || {};
    GS.world.world = factory(GS.world.shipMap, GS.world.objects, GS.world.players, GS.world.input);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (shipMap, objects, players, input) {
  'use strict';

  function rolesFromGame(game) {
    if (game && game.crew && game.crew.members && game.crew.members.length > 0) {
      return game.crew.members.map(function (member) {
        return { id: member.id, role: member.role };
      });
    }
    return ['engineer'];
  }

  /**
   * Crea el estado de mundo.
   * @param {Object} opts `{design, catalog, map, game, roles, speed, capacity}`
   */
  function create(opts) {
    var options = opts || {};
    var map = options.map || shipMap.build(options.design, options.catalog);
    var game = options.game || null;
    return {
      version: 1,
      map: map,
      game: game,
      objects: objects.create(map),
      players: players.create(map, options.roles || rolesFromGame(game), options),
      input: options.input || null
    };
  }

  /** Avanza el mundo con el estado de entrada del cuadro (delega en `players`). */
  function step(world, control, dt) {
    if (!world) return { moved: 0, active: 0 };
    return players.move(world, control, dt);
  }

  /** Objeto más cercano a un jugador dentro de `maxDistance` casillas. */
  function nearest(world, playerId, maxDistance) {
    if (!world || !world.map || !world.objects) return null;
    var player = players.byId(world, playerId);
    if (!player) return null;
    var limit = isFinite(maxDistance) ? maxDistance : objects.REACH;
    var best = null;
    var bestDistance = Infinity;
    objects.list(world).forEach(function (object) {
      var dx = player.x - object.x;
      var dy = player.y - object.y;
      var distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= limit && distance < bestDistance) {
        bestDistance = distance;
        best = object;
      }
    });
    return best ? { object: best, distance: Math.round(bestDistance * 100) / 100 } : null;
  }

  return {
    create: create,
    step: step,
    nearest: nearest
  };
});
