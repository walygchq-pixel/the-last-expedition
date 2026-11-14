/*
 * Acceso al catálogo de datos (`data/*.json`).
 *
 * Los módulos de simulación no leen archivos: reciben el registro de datos ya
 * cargado. En el navegador ese registro es `GS.data` (generado por
 * `tools/build-data.js`); en Node lo inyectan las pruebas con `init()`.
 */
(function (global, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    var GS = (global.GS = global.GS || {});
    GS.mission = GS.mission || {};
    GS.mission.catalog = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var installed = null;

  function init(registry) {
    installed = registry || null;
    return api;
  }

  function source() {
    if (installed) return installed;
    if (typeof globalThis !== 'undefined' && globalThis.GS && globalThis.GS.data) return globalThis.GS.data;
    return {};
  }

  function file(key) {
    var data = source()[key];
    return data || null;
  }

  function itemsOf(key) {
    var data = file(key);
    if (!data) return [];
    return data.items || data.groups || data.terms || data.steps || data.rooms || [];
  }

  /** Piezas aplanadas: cada opción de cada grupo, con su `groupId` y versión. */
  function parts() {
    var groups = file('parts');
    if (!groups || !groups.groups) return [];
    var flat = [];
    groups.groups.forEach(function (group) {
      (group.options || []).forEach(function (option) {
        flat.push(Object.assign({}, option, {
          groupId: group.id,
          groupNameKey: group.nameKey,
          groupDescKey: group.descKey,
          system: option.system || group.system || group.id
        }));
      });
    });
    return flat;
  }

  function findPart(partId) {
    return parts().find(function (part) {
      return part.id === partId;
    }) || null;
  }

  function partGroups() {
    var data = file('parts');
    return (data && data.groups) || [];
  }

  function partsForGroup(groupId) {
    return parts().filter(function (part) {
      return part.groupId === groupId;
    });
  }

  /** Instrumentos aplanados por versión: `{id, version, …}`. */
  function instruments() {
    var data = file('instruments');
    if (!data || !data.items) return [];
    var flat = [];
    data.items.forEach(function (item) {
      Object.keys(item.versions || {}).forEach(function (version) {
        flat.push(Object.assign({}, item.versions[version], {
          id: item.id,
          version: version,
          system: item.system || 'instruments',
          entryKey: item.id + ':' + version,
          nameKey: item.versions[version].nameKey || item.nameKey,
          descKey: item.versions[version].descKey || item.descKey
        }));
      });
    });
    return flat;
  }

  function instrumentEntries() {
    var data = file('instruments');
    return (data && data.items) || [];
  }

  function findInstrument(id, version) {
    return instruments().find(function (instrument) {
      return instrument.id === id && instrument.version === (version || 'simple');
    }) || null;
  }

  function launchers() {
    return itemsOf('launchers');
  }

  function findLauncher(id) {
    return launchers().find(function (launcher) {
      return launcher.id === id;
    }) || null;
  }

  function orbits() {
    return itemsOf('orbits');
  }

  function findOrbit(id) {
    return orbits().find(function (orbit) {
      return orbit.id === id;
    }) || null;
  }

  function objectives() {
    return itemsOf('objectives');
  }

  function findObjective(id) {
    return objectives().find(function (objective) {
      return objective.id === id;
    }) || null;
  }

  function scenarios() {
    return itemsOf('scenarios');
  }

  function findScenario(id) {
    return scenarios().find(function (scenario) {
      return scenario.id === id;
    }) || null;
  }

  function events() {
    return itemsOf('events');
  }

  function foodItems() {
    return itemsOf('food');
  }

  function shipLayout() {
    return file('shipLayout');
  }

  function objects() {
    return itemsOf('objects');
  }

  function glossary() {
    return itemsOf('glossary');
  }

  function tutorial() {
    return itemsOf('tutorial');
  }

  /** Localiza cualquier elemento por `id` en un archivo con `items`. */
  function findIn(key, id) {
    return itemsOf(key).find(function (item) {
      return item.id === id;
    }) || null;
  }

  var api = {
    init: init,
    source: source,
    file: file,
    parts: parts,
    partGroups: partGroups,
    partsForGroup: partsForGroup,
    findPart: findPart,
    instruments: instruments,
    instrumentEntries: instrumentEntries,
    findInstrument: findInstrument,
    launchers: launchers,
    findLauncher: findLauncher,
    orbits: orbits,
    findOrbit: findOrbit,
    objectives: objectives,
    findObjective: findObjective,
    scenarios: scenarios,
    findScenario: findScenario,
    events: events,
    foodItems: foodItems,
    shipLayout: shipLayout,
    objects: objects,
    glossary: glossary,
    tutorial: tutorial,
    findIn: findIn
  };

  return api;
});
