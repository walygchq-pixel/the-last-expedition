/*
 * Informe de misión, análisis posterior y comparador (P-2, P-3, P-4, G-3, M-3).
 *
 * El informe llega ya construido por `core/game` (`game.report`) y el análisis
 * por `core/scoring.analyze`; esta pantalla sólo traduce códigos, claves y
 * números. El comparador reutiliza `core/scoring.compare` a través de
 * `storage/transfer.compare`, y acepta dos informes o dos diseños.
 */
(function (global, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(
      require('../core/scoring.js'),
      require('../mission/catalog.js'),
      require('../mission/design.js'),
      require('../storage/saves.js'),
      require('../storage/transfer.js'),
      require('../storage/leaderboard.js')
    );
  } else {
    var GS = (global.GS = global.GS || {});
    GS.ui = GS.ui || {};
    GS.ui.reportScreen = factory(
      GS.core.scoring,
      GS.mission.catalog,
      GS.mission.design,
      GS.storage.saves,
      GS.storage.transfer,
      GS.storage.leaderboard
    );
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (scoring, catalog, designModule, saves, transfer, leaderboard) {
  'use strict';

  /** Pantalla de informe o de comparador. */
  function create(ctx) {
    var t = ctx.t;
    var tr = ctx.tr;
    var state = ctx.state;
    var report = state.report;
    var analysis = state.analysis || (report ? scoring.analyze(report) : null);
    var root = ctx.el('section', {
      id: 'report-screen',
      class: 'stack',
      'aria-label': t(state.screen === 'compare' ? 'compare.title' : 'report.title')
    });

    if (state.screen !== 'compare') {
      if (!report) {
        root.appendChild(
          ctx.el('div', { class: 'card stack' }, [
            ctx.el('h1', { text: t('report.title') }),
            ctx.el('p', { class: 'muted', text: t('report.none') }),
            ctx.el('div', { class: 'row' }, [
              ctx.el('button', { type: 'button', text: t('menu.new_game'), onclick: function () { ctx.go('setup'); } }),
              ctx.el('button', { type: 'button', text: t('menu.back_to_title'), onclick: function () { ctx.go('title'); } })
            ])
          ])
        );
      } else {
        root.appendChild(reportHeader(ctx));
        root.appendChild(scoreSection(ctx));
        root.appendChild(analysisSection(ctx));
        root.appendChild(resourcesSection(ctx));
        root.appendChild(crewSection(ctx));
        root.appendChild(decisionsSection(ctx));
        root.appendChild(leaderboardSection(ctx));
      }
    }

    root.appendChild(comparatorSection(ctx));
    root.appendChild(actionsBar(ctx));
    return { id: state.screen === 'compare' ? 'compare' : 'report', node: root };
  }

  function reportHeader(ctx) {
    var t = ctx.t;
    var tr = ctx.tr;
    var report = ctx.state.report;
    var line = ctx.el('div', { class: 'design-header' });
    line.appendChild(
      ctx.el('div', { class: 'stack' }, [
        ctx.el('h1', { text: t('report.title') }),
        ctx.el('div', { class: 'row tight' }, [
          ctx.el('span', { class: 'badge', text: t('scenario.' + report.scenarioId + '.name') }),
          ctx.el('span', { class: 'badge', text: t('diff.' + report.difficultyId + '.name') }),
          ctx.el('span', { class: 'badge', text: t('mode.' + report.mode + '.name') }),
          ctx.el('span', { class: 'badge', text: t('report.end_day', { day: tr.formatNumber(report.endDay) }) })
        ])
      ])
    );
    line.appendChild(
      ctx.el('div', { class: 'stack' }, [
        ctx.el('span', { class: 'badge', text: t('report.outcome.' + report.outcome) }),
        ctx.el('span', { class: 'faint', text: t('report.seed', { seed: report.seed }) }),
        report.createdAt
          ? ctx.el('span', { class: 'faint', text: t('report.created_at', { date: tr.formatDate(report.createdAt) }) })
          : null
      ])
    );
    return line;
  }

  function scoreSection(ctx) {
    var t = ctx.t;
    var tr = ctx.tr;
    var report = ctx.state.report;
    var card = ctx.el('section', { class: 'card stack' }, [ctx.el('h2', { text: t('report.score_title') })]);
    var head = ctx.el('div', { class: 'report-score' }, [
      ctx.el('span', { class: 'total', text: tr.formatNumber(report.score) }),
      ctx.el('span', { class: 'muted', text: t('report.score_of', { max: tr.formatNumber(report.maxScore) }) })
    ]);
    card.appendChild(head);
    var bar = ctx.el('div', { class: 'bar' + (report.score < report.maxScore * 0.4 ? ' is-warn' : '') }, [
      ctx.el('span', { style: 'width:' + Math.max(0, Math.min(100, (report.score / Math.max(1, report.maxScore)) * 100)) + '%' })
    ]);
    card.appendChild(bar);

    var breakdown = ctx.el('div', { class: 'breakdown' });
    (report.breakdown || []).forEach(function (item) {
      var row = ctx.el('div', { class: 'breakdown-row' }, [
        ctx.el('span', { text: t(item.labelKey) }),
        ctx.el('div', { class: 'bar' + (item.points < item.max * 0.5 ? ' is-warn' : '') }, [
          ctx.el('span', { style: 'width:' + Math.max(0, Math.min(100, (item.points / Math.max(1, item.max)) * 100)) + '%' })
        ]),
        ctx.el('span', {
          text: t('report.points', { points: tr.formatNumber(item.points), max: tr.formatNumber(item.max) })
        })
      ]);
      row.appendChild(ctx.el('span', { class: 'why', text: t(item.whyKey, item.params) }));
      breakdown.appendChild(row);
    });
    card.appendChild(breakdown);
    return card;
  }

  function analysisSection(ctx) {
    var t = ctx.t;
    var tr = ctx.tr;
    var report = ctx.state.report;
    var analysis = ctx.state.analysis || scoring.analyze(report);
    var card = ctx.el('section', { class: 'card stack' }, [
      ctx.el('h2', { text: t('report.analysis_title') }),
      ctx.el('p', { text: t(analysis.headline) })
    ]);
    if (analysis.findings.length === 0) {
      card.appendChild(ctx.el('p', { class: 'muted', text: t('report.analysis_none') }));
    } else {
      var list = ctx.el('ul', { class: 'analysis-list' });
      analysis.findings.forEach(function (finding) {
        list.appendChild(
          ctx.el('li', null, [
            ctx.el('strong', { text: t(finding.code, finding.params) }),
            ctx.el('span', { class: 'faint', text: t('report.lost_points', { points: tr.formatNumber(finding.lost) }) }),
            ctx.el('p', { class: 'why muted', text: t(finding.whyKey, finding.params) })
          ])
        );
      });
      card.appendChild(list);
    }
    if (analysis.tradeoffs.length > 0) {
      card.appendChild(ctx.el('h3', { text: t('report.tradeoffs_title') }));
      var tradeoffs = ctx.el('ul', { class: 'analysis-list' });
      analysis.tradeoffs.forEach(function (tradeoff) {
        tradeoffs.appendChild(ctx.el('li', { text: t(tradeoff.code) }));
      });
      card.appendChild(tradeoffs);
    }
    return card;
  }

  function resourcesSection(ctx) {
    var t = ctx.t;
    var tr = ctx.tr;
    var res = ctx.state.report.resources || {};
    var grid = ctx.el('div', { class: 'design-totals' });
    [
      { key: 'report.res_budget_spent', value: tr.formatUnit(res.budgetSpent || 0, 'unit.meur') },
      { key: 'report.res_data_transmitted', value: tr.formatUnit(res.dataTransmitted || 0, 'unit.kb') },
      { key: 'report.res_data_lost', value: tr.formatUnit(res.dataLost || 0, 'unit.kb') },
      { key: 'res.mass.name', value: tr.formatUnit(res.mass || 0, 'unit.kg') },
      { key: 'res.power.name', value: tr.formatUnit(res.powerDraw || 0, 'unit.w') }
    ].forEach(function (row) {
      grid.appendChild(ctx.el('div', null, [ctx.el('div', { class: 'faint', text: t(row.key) }), ctx.el('div', { text: row.value })]));
    });
    return ctx.el('section', { class: 'card stack' }, [ctx.el('h2', { text: t('report.resources_title') }), grid]);
  }

  function crewSection(ctx) {
    var t = ctx.t;
    var tr = ctx.tr;
    var report = ctx.state.report;
    var table = ctx.el('table', { class: 'table' });
    table.appendChild(
      ctx.el('thead', null, [
        ctx.el('tr', null, [
          ctx.el('th', { text: t('report.col_member') }),
          ctx.el('th', { text: t('report.col_role') }),
          ctx.el('th', { text: t('report.col_status') }),
          ctx.el('th', { text: t('crew.need.health') }),
          ctx.el('th', { text: t('crew.need.morale') }),
          ctx.el('th', { text: t('crew.need.stress') })
        ])
      ])
    );
    var body = ctx.el('tbody');
    (report.crew || []).forEach(function (member) {
      body.appendChild(
        ctx.el('tr', null, [
          ctx.el('td', { text: member.id }),
          ctx.el('td', { text: t('role.' + member.role + '.name') }),
          ctx.el('td', { text: t(member.alive ? 'report.alive' : 'report.dead') }),
          ctx.el('td', { text: tr.formatNumber(member.health) }),
          ctx.el('td', { text: tr.formatNumber(member.morale) }),
          ctx.el('td', { text: tr.formatNumber(member.stress) })
        ])
      );
    });
    table.appendChild(body);
    return ctx.el('section', { class: 'card stack' }, [ctx.el('h2', { text: t('report.crew_title') }), table]);
  }

  function decisionsSection(ctx) {
    var t = ctx.t;
    var tr = ctx.tr;
    var report = ctx.state.report;
    var card = ctx.el('section', { class: 'card stack' }, [ctx.el('h2', { text: t('report.decisions_title') })]);
    var decisions = report.keyDecisions || [];
    if (decisions.length === 0) {
      card.appendChild(ctx.el('p', { class: 'muted', text: t('report.decisions_none') }));
      return card;
    }
    var list = ctx.el('ul', { class: 'analysis-list' });
    decisions.forEach(function (decision) {
      var item = ctx.el('li', null, [
        ctx.el('strong', { text: t(decision.code, decision.params) }),
        ctx.el('span', { class: 'faint', text: t('report.decision_day', { day: tr.formatNumber(decision.createdDay) }) }),
        decision.resolved ? ctx.el('span', { class: 'faint', text: t('report.decision_resolved') }) : null,
        decision.whyKey ? ctx.el('p', { class: 'muted', text: t(decision.whyKey) }) : null
      ]);
      list.appendChild(item);
    });
    card.appendChild(list);
    return card;
  }

  function leaderboardSection(ctx) {
    var t = ctx.t;
    var tr = ctx.tr;
    var report = ctx.state.report;
    var card = ctx.el('section', { class: 'card stack' }, [ctx.el('h2', { text: t('lb.title') })]);
    if (ctx.state.lbRank) {
      card.appendChild(ctx.el('p', { text: t('lb.your_rank', { rank: tr.formatNumber(ctx.state.lbRank) }) }));
    }
    var entries = leaderboard.list(report.scenarioId, report.difficultyId);
    if (entries.length === 0) {
      card.appendChild(ctx.el('p', { class: 'muted', text: t('lb.empty') }));
      return card;
    }
    var table = ctx.el('table', { class: 'table' });
    table.appendChild(
      ctx.el('thead', null, [
        ctx.el('tr', null, [
          ctx.el('th', { text: t('lb.rank') }),
          ctx.el('th', { text: t('lb.score') }),
          ctx.el('th', { text: t('lb.end_day') }),
          ctx.el('th', { text: t('lb.crew_alive') }),
          ctx.el('th', { text: t('lb.created_at') })
        ])
      ])
    );
    var body = ctx.el('tbody');
    entries.slice(0, 10).forEach(function (entry, index) {
      body.appendChild(
        ctx.el('tr', null, [
          ctx.el('td', { text: tr.formatNumber(index + 1) }),
          ctx.el('td', { text: tr.formatNumber(entry.score) }),
          ctx.el('td', { text: tr.formatNumber(entry.endDay) }),
          ctx.el('td', {
            text: t('report.crew_alive_count', { alive: tr.formatNumber(entry.crewAlive), total: tr.formatNumber(entry.crewTotal) })
          }),
          ctx.el('td', { text: tr.formatDate(entry.createdAt) })
        ])
      );
    });
    table.appendChild(body);
    card.appendChild(table);
    return card;
  }

  /* --- Comparador (G-3, M-3) ---------------------------------------- */

  function compareState(ctx) {
    if (!ctx.state.compare) ctx.state.compare = { a: null, b: null };
    return ctx.state.compare;
  }

  function slot(ctx, key) {
    var t = ctx.t;
    var compare = compareState(ctx);
    var slotData = compare[key];
    var wrap = ctx.el('div', { class: 'stack' });

    // Claves explícitas: el escáner de cobertura i18n lee literales, no
    // concatenaciones (C-8).
    var slotLabelKey = key === 'a' ? 'compare.slot_a' : 'compare.slot_b';
    var select = ctx.el('select', {
      'aria-label': t(slotLabelKey)
    });
    select.appendChild(ctx.el('option', { value: '', text: t('common.none') }));
    if (ctx.state.report) {
      select.appendChild(ctx.el('option', { value: 'current', text: t('compare.current_report') }));
    }
    saves.listDesigns().forEach(function (entry) {
      select.appendChild(
        ctx.el('option', {
          value: 'design:' + entry.id,
          text: t('compare.design_option', {
            scenario: t('scenario.' + entry.scenarioId + '.name'),
            difficulty: t('diff.' + entry.difficultyId + '.name'),
            date: ctx.tr.formatDate(entry.savedAt)
          })
        })
      );
    });
    select.value = compare[key] ? compare[key].ref || '' : '';
    select.addEventListener('change', function () {
      var value = select.value;
      if (!value) {
        compare[key] = null;
      } else if (value === 'current') {
        compare[key] = { kind: 'report', ref: value, data: ctx.state.report };
      } else if (value.indexOf('design:') === 0) {
        var payload = saves.loadDesign(value.slice(7));
        compare[key] = payload ? { kind: 'design', ref: value, data: designModule.deserialize(payload.design) } : null;
      }
      ctx.rerender();
    });
    wrap.appendChild(ctx.el('label', { text: t(slotLabelKey) }));
    wrap.appendChild(select);
    wrap.appendChild(
      ctx.el('button', {
        type: 'button',
        text: t('common.import'),
        onclick: function () {
          importInto(ctx, key);
        }
      })
    );
    wrap.appendChild(
      ctx.el('p', {
        class: 'faint',
        text: slotData
          ? t(slotData.kind === 'report' ? 'compare.loaded_report' : 'compare.loaded_design')
          : t('compare.empty_slot')
      })
    );
    return wrap;
  }

  function importInto(ctx, key) {
    var input = ctx.el('input', { type: 'file', accept: '.json,application/json', hidden: true });
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      transfer.readFile(file).then(function (text) {
        var parsed = transfer.importJson(text);
        if (!parsed.ok) {
          ctx.toast({ code: parsed.code, params: parsed.params, severity: 'warn' });
          return;
        }
        var compare = compareState(ctx);
        if (parsed.kind === transfer.KIND.DESIGN) {
          compare[key] = { kind: 'design', ref: '', data: designModule.deserialize(parsed.data) };
        } else if (parsed.kind === transfer.KIND.REPORT) {
          compare[key] = { kind: 'report', ref: '', data: parsed.data };
        } else {
          ctx.toast({ code: 'import.wrong_kind', severity: 'warn' });
          return;
        }
        ctx.rerender();
      });
    });
    ctx.doc.body.appendChild(input);
    input.click();
    ctx.doc.body.removeChild(input);
  }

  function comparatorSection(ctx) {
    var t = ctx.t;
    var tr = ctx.tr;
    var compare = compareState(ctx);
    var card = ctx.el('section', { class: 'card stack' }, [
      ctx.el('h2', { text: t('compare.title') }),
      ctx.el('p', { class: 'faint', text: t('compare.hint') })
    ]);
    var grid = ctx.el('div', { class: 'compare-grid' }, [slot(ctx, 'a'), slot(ctx, 'b')]);
    card.appendChild(grid);

    if (!compare.a || !compare.b) {
      card.appendChild(ctx.el('p', { class: 'muted', text: t('compare.need_two') }));
      return card;
    }

    var result = transfer.compare(compare.a.data, compare.b.data);
    card.appendChild(
      ctx.el('p', {
        class: 'badge',
        text: t(result.kind === 'report' ? 'compare.kind_report' : 'compare.kind_design')
      })
    );
    var table = ctx.el('table', { class: 'table' });
    table.appendChild(
      ctx.el('thead', null, [
        ctx.el('tr', null, [
          ctx.el('th', { text: t('compare.metric') }),
          ctx.el('th', { text: t('compare.a') }),
          ctx.el('th', { text: t('compare.b') }),
          ctx.el('th', { text: t('compare.delta') }),
          ctx.el('th', { text: t('compare.better') })
        ])
      ])
    );
    var body = ctx.el('tbody');
    result.rows.forEach(function (row) {
      body.appendChild(
        ctx.el('tr', null, [
          ctx.el('td', { text: t(row.id) }),
          ctx.el('td', { text: tr.formatNumber(row.a) }),
          ctx.el('td', { text: tr.formatNumber(row.b) }),
          ctx.el('td', {
            class: row.better === 'a' ? 'delta-better' : row.better === 'b' ? 'delta-worse' : 'delta-tie',
            text: tr.formatSigned(row.delta)
          }),
          ctx.el('td', {
            text: t(
              row.better === 'a' ? 'compare.better_a' : row.better === 'b' ? 'compare.better_b' : 'compare.better_tie'
            )
          })
        ])
      );
    });
    table.appendChild(body);
    card.appendChild(table);
    return card;
  }

  function actionsBar(ctx) {
    var t = ctx.t;
    var row = ctx.el('div', { class: 'row' });
    if (ctx.state.screen !== 'compare') {
      row.appendChild(
        ctx.el('button', {
          type: 'button',
          text: t('common.export'),
          onclick: function () {
            if (!ctx.state.report) return;
            var text = transfer.exportJson(transfer.KIND.REPORT, ctx.state.report);
            if (transfer.download(transfer.filenameFor('report', ctx.state.report.missionId), text)) {
              ctx.toast({ code: 'save.exported' });
            }
          }
        })
      );
      row.appendChild(
        ctx.el('button', {
          type: 'button',
          text: t('compare.title'),
          onclick: function () {
            ctx.go('compare');
          }
        })
      );
    }
    row.appendChild(
      ctx.el('button', {
        type: 'button',
        text: t('menu.new_game'),
        onclick: function () {
          ctx.go('setup');
        }
      })
    );
    row.appendChild(
      ctx.el('button', {
        type: 'button',
        class: 'ghost',
        text: t('menu.back_to_title'),
        onclick: function () {
          ctx.go('title');
        }
      })
    );
    return row;
  }

  return { create: create };
});
