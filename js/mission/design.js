/*
 * Fase 1: diseño de misión (DM-1 … DM-14).
 *
 * Mantiene las elecciones del equipo (componentes, instrumentos, lanzador y
 * órbita), calcula los totales al instante (DM-5), arma la lista verificable de
 * requisitos (DM-2, DM-11) y decide si el lanzamiento se puede habilitar.
 */
(function (global, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./catalog.js'), require('../core/events.js'), require('../core/resources.js'), require('../core/rng.js'));
  } else {
    var GS = (global.GS = global.GS || {});
    GS.mission = GS.mission || {};
    GS.mission.design = factory(GS.mission.catalog, GS.core.events, GS.core.resources, GS.core.rng);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (catalog, events, resources, rngModule) {
  'use strict';

  var BASE_DATA_CAPACITY = 20;
  var SANDBOX_BUDGET = 9999;

  function round1(value) {
    return Math.round(Number(value) * 10) / 10;
  }

  function clamp(value, min, max) {
    var n = Number(value);
    if (!isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  function sum(list, field) {
    return list.reduce(function (total, item) {
      var value = item && item[field];
      return total + (isFinite(value) ? value : 0);
    }, 0);
  }

  /**
   * Crea un diseño vacío con la versión simple de cada grupo seleccionada.
   * @param {Object} options `{scenarioId, difficultyId, mode, seed}`
   */
  function createDesign(options) {
    var opts = options || {};
    var scenarioId = opts.scenarioId || (catalog.scenarios()[0] || {}).id || 'scn.ceres_survey';
    var difficultyId = opts.difficultyId || 'basic';
    var mode = opts.mode || 'campaign';
    var profile = events.profileFor(difficultyId);
    var groups = {};

    catalog.partGroups().forEach(function (group) {
      var options2 = group.options || [];
      var simple = options2.find(function (part) {
        return part.version === 'simple';
      }) || options2[0];
      if (simple) groups[group.id] = simple.id;
    });

    var design = {
      scenarioId: scenarioId,
      difficultyId: difficultyId,
      mode: mode,
      groups: groups,
      instruments: [],
      launcherId: null,
      orbitId: null,
      budget: mode === 'sandbox' ? SANDBOX_BUDGET : profile.budget,
      seed: opts.seed || 'design',
      totals: {}
    };
    design.totals = totals(design);
    return design;
  }

  function profileOf(design) {
    return events.profileFor(design.difficultyId);
  }

  function scenarioOf(design) {
    return catalog.findScenario(design.scenarioId);
  }

  function objectiveOf(design) {
    var scenario = scenarioOf(design);
    if (!scenario) return null;
    return catalog.findObjective(scenario.objectiveId);
  }

  /** Piezas resueltas del diseño (con su grupo y sistema). */
  function designParts(design) {
    return Object.keys(design.groups || {})
      .map(function (groupId) {
        return catalog.findPart(design.groups[groupId]);
      })
      .filter(Boolean);
  }

  /** Instrumentos resueltos con masa, potencia, coste y valor científico. */
  function designInstruments(design) {
    return (design.instruments || [])
      .map(function (entry) {
        return catalog.findInstrument(entry.id, entry.version);
      })
      .filter(Boolean);
  }

  /**
   * Recalcula los totales del diseño (masa, potencia, coste, datos, ciencia).
   * Es la fuente única de verdad que consumen el panel, la validación y la partida.
   */
  function totals(design) {
    var parts = designParts(design);
    var instruments = designInstruments(design);
    var science = {};
    instruments.forEach(function (instrument) {
      Object.keys(instrument.science || {}).forEach(function (tag) {
        science[tag] = round1((science[tag] || 0) + instrument.science[tag]);
      });
    });
    var launcher = design.launcherId ? catalog.findLauncher(design.launcherId) : null;
    var launcherCost = launcher && isFinite(launcher.cost) ? launcher.cost : 0;
    var reliabilityBySystem = {};
    parts.forEach(function (part) {
      var system = part.system || part.groupId;
      var current = reliabilityBySystem[system];
      var value = isFinite(part.reliability) ? part.reliability : 90;
      reliabilityBySystem[system] = current === undefined ? value : (current + value) / 2;
    });

    return {
      mass: round1(sum(parts, 'mass') + sum(instruments, 'mass')),
      // DM-9: el lanzador también cuesta; se paga del mismo presupuesto (S-11).
      partsCost: round1(sum(parts, 'cost') + sum(instruments, 'cost')),
      launcherCost: launcherCost,
      cost: round1(sum(parts, 'cost') + sum(instruments, 'cost') + launcherCost),
      powerGen: round1(sum(parts, 'powerGen')),
      powerDrawBase: round1(sum(parts, 'powerDraw')),
      powerDrawInstruments: round1(sum(instruments, 'powerDraw')),
      powerDraw: round1(sum(parts, 'powerDraw') + sum(instruments, 'powerDraw')),
      dataRate: round1(sum(instruments, 'dataRate') + sum(parts, 'dataRate')),
      dataCapacity: round1(BASE_DATA_CAPACITY + sum(parts, 'dataStorage')),
      science: science,
      reliabilityBySystem: reliabilityBySystem,
      partCount: parts.length,
      instrumentCount: instruments.length
    };
  }

  /** Recalcula y guarda los totales en el diseño. */
  function refresh(design) {
    design.totals = totals(design);
    return design.totals;
  }

  /** Cambia la versión de un grupo: `simple` o `advanced` (DM-4, DM-8). */
  function setPartVersion(design, groupId, version) {
    var options = catalog.partsForGroup(groupId);
    var chosen = options.find(function (part) {
      return part.version === version;
    });
    if (!chosen) return design;
    design.groups[groupId] = chosen.id;
    return refresh(design);
  }

  /** Alterna la versión de un grupo (simple ⇄ avanzada). */
  function togglePartVersion(design, groupId) {
    var options = catalog.partsForGroup(groupId);
    var currentId = design.groups[groupId];
    var current = options.find(function (part) {
      return part.id === currentId;
    });
    var next = options.find(function (part) {
      return !current || part.version !== current.version;
    });
    if (!next) return design;
    design.groups[groupId] = next.id;
    return refresh(design);
  }

  function setLauncher(design, launcherId) {
    design.launcherId = launcherId;
    return refresh(design);
  }

  function setOrbit(design, orbitId) {
    design.orbitId = orbitId;
    return refresh(design);
  }

  /** Añade, cambia de versión o quita un instrumento (DM-7, DM-8). */
  function setInstrument(design, instrumentId, version) {
    var list = design.instruments || (design.instruments = []);
    var index = list.findIndex(function (entry) {
      return entry.id === instrumentId;
    });
    if (!version) {
      if (index !== -1) list.splice(index, 1);
      return refresh(design);
    }
    if (index === -1) list.push({ id: instrumentId, version: version });
    else list[index].version = version;
    return refresh(design);
  }

  function toggleInstrument(design, instrumentId) {
    var list = design.instruments || [];
    var existing = list.find(function (entry) {
      return entry.id === instrumentId;
    });
    if (!existing) return setInstrument(design, instrumentId, 'simple');
    if (existing.version === 'simple') return setInstrument(design, instrumentId, 'advanced');
    return setInstrument(design, instrumentId, null);
  }

  function instrumentVersion(design, instrumentId) {
    var found = (design.instruments || []).find(function (entry) {
      return entry.id === instrumentId;
    });
    return found ? found.version : null;
  }

  /**
   * Lista verificable de requisitos del objetivo (DM-2) más las comprobaciones
   * técnicas del lanzamiento (DM-11). Cada ítem trae `ok`, su clave y parámetros.
   */
  function getRequirements(design) {
    var scenario = scenarioOf(design);
    var objective = objectiveOf(design);
    var profile = profileOf(design);
    var launcher = design.launcherId ? catalog.findLauncher(design.launcherId) : null;
    var orbit = design.orbitId ? catalog.findOrbit(design.orbitId) : null;
    var data = design.totals && design.totals.mass !== undefined ? design.totals : refresh(design);
    var checks = [];

    if (!objective) {
      return [{ id: 'objective', ok: false, labelKey: 'req.no_objective', params: {} }];
    }

    // 1. Valor científico por área: el instrumento tiene que servir al objetivo.
    (objective.requires || []).forEach(function (requirement, index) {
      if (requirement.type === 'science') {
        var have = data.science[requirement.tag] || 0;
        checks.push({
          id: 'science:' + requirement.tag + ':' + index,
          ok: have >= requirement.value,
          labelKey: 'req.science',
          params: {
            tag: 'science.tag.' + requirement.tag,
            have: round1(have),
            need: requirement.value
          }
        });
      }
      if (requirement.type === 'coverage') {
        var coverage = orbit ? orbit.coverage || 0 : 0;
        checks.push({
          id: 'coverage',
          ok: !!orbit && coverage >= requirement.value,
          labelKey: 'req.coverage',
          params: { have: Math.round(coverage * 100), need: Math.round(requirement.value * 100) }
        });
      }
      if (requirement.type === 'duration') {
        var days = profile.missionDays;
        checks.push({
          id: 'duration',
          ok: days >= requirement.value,
          labelKey: 'req.duration',
          params: { have: days, need: requirement.value }
        });
      }
      if (requirement.type === 'data') {
        checks.push({
          id: 'data_capacity',
          ok: data.dataCapacity >= requirement.value,
          labelKey: 'req.data_capacity',
          params: { have: round1(data.dataCapacity), need: requirement.value }
        });
      }
    });

    // 2. Compatibilidad de masa con el lanzador (DM-11).
    var capacity = launcher ? launcher.payloadCapacity : 0;
    checks.push({
      id: 'mass',
      ok: !!launcher && data.mass <= capacity,
      labelKey: 'req.mass',
      params: { have: round1(data.mass), need: capacity },
      blockerKey: 'block.mass_over_capacity',
      fixKey: 'fix.mass_over_capacity'
    });

    // 3. La órbita pedida debe estar al alcance del lanzador (DM-11).
    checks.push({
      id: 'orbit',
      ok: !!orbit && !!launcher && (launcher.maxOrbitRank || 0) >= (orbit.rank || 0),
      labelKey: 'req.orbit',
      params: {
        orbit: orbit ? 'orbit.' + orbit.id + '.name' : 'req.none',
        launcher: launcher ? 'launcher.' + launcher.id + '.name' : 'req.none'
      },
      blockerKey: 'block.orbit_not_supported',
      fixKey: 'fix.orbit_not_supported'
    });

    // 4. Presupuesto (RN-1, S-11).
    checks.push({
      id: 'budget',
      ok: data.cost <= design.budget,
      labelKey: 'req.budget',
      params: { have: round1(data.cost), need: round1(design.budget) },
      blockerKey: 'block.budget',
      fixKey: 'fix.budget'
    });

    // 5. Balance de potencia: generación menos consumo no puede ser negativo.
    checks.push({
      id: 'power',
      ok: data.powerGen - data.powerDraw >= 0,
      labelKey: 'req.power',
      params: { have: round1(data.powerGen), need: round1(data.powerDraw) },
      blockerKey: 'block.power_deficit',
      fixKey: 'fix.power_deficit'
    });

    // 6. La duración del objetivo debe caber en la vida útil del escenario.
    if (scenario && isFinite(scenario.minDays) && profile.missionDays < scenario.minDays) {
      checks.push({
        id: 'lifetime',
        ok: false,
        labelKey: 'req.lifetime',
        params: { have: profile.missionDays, need: scenario.minDays },
        blockerKey: 'block.lifetime',
        fixKey: 'fix.lifetime'
      });
    }

    return checks;
  }

  /**
   * Validación de lanzamiento (DM-11). Si algo falta, el botón se bloquea y se
   * explica el motivo con las opciones de corrección.
   */
  function validateLaunch(design) {
    var checks = getRequirements(design);
    var failed = checks.filter(function (check) {
      return !check.ok;
    });
    var blockers = failed.map(function (check) {
      return {
        id: check.id,
        code: check.blockerKey || 'block.requirement',
        labelKey: check.labelKey,
        params: check.params,
        fixKey: check.fixKey || null
      };
    });

    // Los avisos no bloquean: sirven para mostrar riesgos antes de lanzar.
    var warnings = [];
    var data = design.totals || totals(design);
    if (isFinite(data.powerGen) && data.powerGen > 0 && (data.powerGen - data.powerDraw) / data.powerGen < 0.1) {
      warnings.push({ code: 'warn.power_tight', params: { margin: round1(data.powerGen - data.powerDraw) } });
    }
    if (design.mode !== 'sandbox' && data.cost > design.budget * 0.9) {
      warnings.push({ code: 'warn.budget_tight', params: { left: round1(design.budget - data.cost) } });
    }
    var instruments = designInstruments(design);
    if (instruments.length === 0) warnings.push({ code: 'warn.no_instruments' });

    return {
      ok: blockers.length === 0 && !!design.launcherId && !!design.orbitId,
      blockers: blockers,
      warnings: warnings,
      checks: checks
    };
  }

  /**
   * Impacto inmediato de cada cambio en los recursos (DM-5).
   * Devuelve el panel ya evaluado más el estado del lanzamiento.
   */
  function liveImpact(design) {
    var data = design.totals && design.totals.mass !== undefined ? design.totals : refresh(design);
    var orbit = design.orbitId ? catalog.findOrbit(design.orbitId) : null;
    var launcher = design.launcherId ? catalog.findLauncher(design.launcherId) : null;
    var profile = profileOf(design);
    var resourcesState = resources.createResources({
      mass: data.mass,
      massMax: launcher ? launcher.payloadCapacity : 0,
      powerGen: data.powerGen,
      powerDraw: data.powerDraw,
      budget: design.budget - data.cost,
      budgetTotal: design.budget,
      dataStored: 0,
      dataCap: data.dataCapacity,
      bandwidth: 0,
      daysLeft: profile.missionDays,
      missionDays: profile.missionDays,
      critical: (scenarioOf(design) || {}).critical || 'power'
    });

    return {
      totals: data,
      panel: resources.evaluate(resourcesState),
      resources: resourcesState,
      launch: validateLaunch(design),
      orbit: orbit,
      launcher: launcher,
      profile: profile,
      instruments: designInstruments(design),
      parts: designParts(design)
    };
  }

  /**
   * Objeto de diseño listo para `core/game.createGame()`.
   * Incluye piezas con su sistema (origen), instrumentos e infraestructura.
   */
  function toGameDesign(design) {
    var parts = designParts(design);
    var instruments = designInstruments(design);
    var data = design.totals && design.totals.mass !== undefined ? design.totals : refresh(design);
    var orbit = design.orbitId ? catalog.findOrbit(design.orbitId) : null;
    var launcher = design.launcherId ? catalog.findLauncher(design.launcherId) : null;

    return {
      parts: parts.map(function (part) {
        return {
          id: part.id,
          system: part.system,
          reliability: part.reliability,
          mass: part.mass,
          powerDraw: part.powerDraw,
          powerGen: part.powerGen || 0
        };
      }),
      instruments: instruments.map(function (instrument) {
        return {
          id: instrument.id,
          version: instrument.version,
          powerDraw: instrument.powerDraw,
          dataRate: instrument.dataRate,
          science: instrument.science || {}
        };
      }),
      totals: Object.assign({}, data, {
        budgetTotal: design.budget,
        budgetRemaining: round1(design.budget - data.cost),
        massMax: launcher ? launcher.payloadCapacity : 0
      }),
      orbit: orbit
        ? {
            id: orbit.id,
            rank: orbit.rank,
            coverage: orbit.coverage,
            radiation: orbit.radiation,
            eclipseFraction: orbit.eclipseFraction,
            comms: orbit.comms
          }
        : null,
      launcher: launcher ? { id: launcher.id, payloadCapacity: launcher.payloadCapacity, maxOrbitRank: launcher.maxOrbitRank } : null,
      dataCapacity: data.dataCapacity,
      scenarioId: design.scenarioId,
      difficultyId: design.difficultyId
    };
  }

  /**
   * Semilla reproducible de una partida derivada del diseño.
   * Componentes e instrumentos se ordenan antes de hashear: el mismo diseño
   * elegido en otro orden tiene que dar la misma semilla (R3-002).
   */
  function seedFor(design, salt) {
    var groups = Object.keys(design.groups || {})
      .sort()
      .map(function (groupId) {
        return groupId + '=' + design.groups[groupId];
      })
      .join(',');
    var instruments = (design.instruments || [])
      .map(function (entry) {
        return entry.id + ':' + entry.version;
      })
      .sort()
      .join(',');
    return rngModule.hashSeed(
      [design.scenarioId, design.difficultyId, design.launcherId, design.orbitId, salt || ''].join('|') + '|' + groups + '|' + instruments
    );
  }

  /** Resume el diseño para guardarlo o compararlo (solo claves y valores). */
  function serialize(design) {
    return {
      scenarioId: design.scenarioId,
      difficultyId: design.difficultyId,
      mode: design.mode,
      groups: Object.assign({}, design.groups),
      instruments: (design.instruments || []).map(function (entry) {
        return { id: entry.id, version: entry.version };
      }),
      launcherId: design.launcherId,
      orbitId: design.orbitId,
      budget: design.budget,
      totals: Object.assign({}, design.totals),
      seed: design.seed
    };
  }

  function deserialize(saved) {
    var design = createDesign({
      scenarioId: saved.scenarioId,
      difficultyId: saved.difficultyId,
      mode: saved.mode,
      seed: saved.seed
    });
    design.groups = Object.assign({}, saved.groups);
    design.instruments = (saved.instruments || []).map(function (entry) {
      return { id: entry.id, version: entry.version };
    });
    design.launcherId = saved.launcherId || null;
    design.orbitId = saved.orbitId || null;
    if (isFinite(saved.budget)) design.budget = saved.budget;
    refresh(design);
    return design;
  }

  return {
    BASE_DATA_CAPACITY: BASE_DATA_CAPACITY,
    createDesign: createDesign,
    refresh: refresh,
    totals: totals,
    designParts: designParts,
    designInstruments: designInstruments,
    setPartVersion: setPartVersion,
    togglePartVersion: togglePartVersion,
    setLauncher: setLauncher,
    setOrbit: setOrbit,
    setInstrument: setInstrument,
    toggleInstrument: toggleInstrument,
    instrumentVersion: instrumentVersion,
    getRequirements: getRequirements,
    validateLaunch: validateLaunch,
    liveImpact: liveImpact,
    toGameDesign: toGameDesign,
    seedFor: seedFor,
    serialize: serialize,
    deserialize: deserialize,
    profileOf: profileOf,
    scenarioOf: scenarioOf,
    objectiveOf: objectiveOf,
    clamp: clamp
  };
});
