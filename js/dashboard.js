(function (ATT) {
  'use strict';

  var TACTICS = ATT.TACTICS;
  var TACTIC_COLORS = ATT.TACTIC_COLORS;
  var TACTIC_RULES = ATT.TACTIC_RULES;
  var fmtDate = ATT.fmtDate;
  var fmtDays = ATT.fmtDays;
  var dateDiffDays = ATT.dateDiffDays;
  var plotDark = ATT.plotDark;

  var tableSort = { col: 'finishVar', dir: 1 };

  // ── Master render ──
  ATT.renderDashboard = function (R) {
    renderExecutiveSummary(R);
    renderEPCActions(R);
    renderTacticBuckets(R);
    renderAreaCommodity(R);
    renderCrewTimeline(R);
    renderCriticalPath(R);
    populateFilters(R);
    ATT.renderActivityTable();
  };

  // ── Executive Summary ──
  function renderExecutiveSummary(R) {
    var totalGainDays = R.totalGainDays, usingMC = R.usingMC, matchCount = R.matchCount, changedCount = R.changedCount;
    var aggregations = R.aggregations, diffs = R.diffs, insights = R.insights;
    var bMCDate = R.bMCDate, oMCDate = R.oMCDate;
    var bEndDate = R.bEndDate, oEndDate = R.oEndDate;
    var critChanges = diffs.filter(function (d) { return d.bCritical !== d.oCritical; }).length;

    var accelLabel, accelDetail;
    if (usingMC) {
      accelLabel = 'MC Acceleration';
      accelDetail = 'Mechanical Completion: ' + fmtDate(bMCDate) + ' \u2192 ' + fmtDate(oMCDate);
    } else if (bMCDate && !oMCDate) {
      accelLabel = 'MC Acceleration (partial)';
      accelDetail = 'Baseline MC: ' + fmtDate(bMCDate) + ' \u2014 Optimized MC: not found';
    } else if (!bMCDate && oMCDate) {
      accelLabel = 'MC Acceleration (partial)';
      accelDetail = 'Baseline MC: not found \u2014 Optimized MC: ' + fmtDate(oMCDate);
    } else {
      accelLabel = 'Schedule Acceleration';
      accelDetail = fmtDate(bEndDate) + ' \u2192 ' + fmtDate(oEndDate);
    }

    var warningHtml = '';
    if (R.mcWarning) {
      warningHtml = '<div class="stat-card" style="grid-column:1/-1;padding:14px 18px;border-color:rgba(245,158,11,.4);background:rgba(245,158,11,.06)"><div style="display:flex;align-items:center;gap:10px"><span style="font-size:20px">\u26A0\uFE0F</span><div><div style="font-size:13px;font-weight:600;color:#f59e0b;margin-bottom:2px">Mechanical Completion Warning</div><div style="font-size:12px;color:var(--text-muted);line-height:1.5">' + R.mcWarning + '</div></div></div></div>';
    }

    document.getElementById('stats-grid').innerHTML =
      warningHtml +
      '<div class="stat-card success"><div class="stat-label">' + accelLabel + '</div><div class="stat-value">' + totalGainDays + 'd</div><div class="stat-detail">' + accelDetail + '</div></div>' +
      '<div class="stat-card accent"><div class="stat-label">Activities Compared</div><div class="stat-value">' + matchCount.toLocaleString() + '</div><div class="stat-detail">' + changedCount + ' with meaningful changes</div></div>' +
      '<div class="stat-card warn"><div class="stat-label">Critical Path Changes</div><div class="stat-value">' + critChanges + '</div><div class="stat-detail">Activities moving on/off driving path</div></div>' +
      '<div class="stat-card accent"><div class="stat-label">Tactic Buckets</div><div class="stat-value">' + Object.keys(aggregations.byTactic).length + '</div><div class="stat-detail">Distinct optimization strategies used</div></div>';

    // Waterfall chart
    var sortedTactics = Object.entries(aggregations.byTactic)
      .map(function (e) { return { name: e[0], days: e[1].scaledDays || 0, count: e[1].count }; })
      .sort(function (a, b) { return b.days - a.days; });

    plotDark('chart-waterfall', [{
      type: 'bar', orientation: 'h',
      x: sortedTactics.map(function (t) { return t.days; }),
      y: sortedTactics.map(function (t) { return t.name; }),
      marker: { color: sortedTactics.map(function (t) { return TACTIC_COLORS[t.name] || '#4f8ef7'; }) },
      text: sortedTactics.map(function (t) { return t.days + 'd \u00B7 ' + t.count + ' activities'; }),
      textposition: 'outside',
      hovertemplate: '<b>%{y}</b><br>~%{x} days<extra></extra>',
    }], {
      xaxis: { title: 'Schedule Days Recovered', color: '#8899bb', gridcolor: '#2a3050' },
      yaxis: { autorange: 'reversed', color: '#e2e8f0', tickfont: { size: 11 }, automargin: true },
      margin: { l: 10, r: 100, t: 10, b: 40 },
      height: Math.max(400, sortedTactics.length * 40 + 60),
    });

    // Commodity donut
    var commData = Object.entries(aggregations.byCommodity)
      .map(function (e) { return { name: e[0], val: Math.abs(e[1].totalFinishVar) }; })
      .sort(function (a, b) { return b.val - a.val; }).slice(0, 8);
    var commTotal = commData.reduce(function (s, c) { return s + c.val; }, 0) || 1;
    plotDark('chart-commodity', [{
      type: 'bar', orientation: 'h',
      y: commData.map(function (c) { return c.name; }),
      x: commData.map(function (c) { return +(c.val / commTotal * 100).toFixed(1); }),
      marker: { color: ['#4f8ef7', '#22d3a8', '#f59e0b', '#a78bfa', '#f472b6', '#60a5fa', '#34d399', '#fb7185'] },
      text: commData.map(function (c) { return (c.val / commTotal * 100).toFixed(1) + '%'; }),
      textposition: 'outside',
      hovertemplate: '<b>%{y}</b><br>%{text}<extra></extra>',
    }], {
      xaxis: { title: '% of total schedule improvement', color: '#8899bb', gridcolor: '#2a3050', ticksuffix: '%' },
      yaxis: { autorange: 'reversed', color: '#e2e8f0', tickfont: { size: 11 }, automargin: true },
      margin: { l: 10, r: 80, t: 10, b: 40 },
      height: 400,
    });

    // Insights
    document.getElementById('insights-grid').innerHTML = insights.map(function (ins) {
      return '<div class="insight-card" style="border-left-color:' + (TACTIC_COLORS[ins.tactic] || '#4f8ef7') + '"><div class="insight-tactic">' + ins.tactic + '</div><div class="insight-text">' + ins.text + '<br><br><em style="color:var(--text-muted)">' + ins.exec + '</em></div>' + (ins.days ? '<div class="insight-impact">~' + ins.days + ' days</div>' : '') + '</div>';
    }).join('');
  }

  // ── EPC Actions ──
  function renderEPCActions(R) {
    var epcActions = R.epcActions, totalGainDays = R.totalGainDays, usingMC = R.usingMC;
    if (!epcActions || !epcActions.length) return;
    var sub = document.getElementById('epc-actions-sub');
    if (sub) sub.textContent = 'What the EPC must execute differently to realize the ' + totalGainDays + '-day ' + (usingMC ? 'Mechanical Completion ' : '') + 'acceleration';
    var list = document.getElementById('epc-actions-list');
    if (!list) return;
    list.innerHTML = epcActions.map(function (a, i) {
      var pCls = a.priority.toLowerCase();
      var weakHtml = '';
      if (a.weakLogic && a.weakLogicNote) {
        weakHtml = '<div class="epc-weak-logic">\u26A0 ' + a.weakLogicNote + '</div>';
      }

      var bulletsHtml = '';
      if (a.bullets && a.bullets.length) {
        bulletsHtml = '<ul class="epc-bullets">' +
          a.bullets.map(function (b) { return '<li>' + b + '</li>'; }).join('') +
        '</ul>';
      }

      var crewHtml = '';
      if (a.crewShifts && a.crewShifts.length) {
        crewHtml = '<div class="epc-crew-table"><table>' +
          '<thead><tr><th>Crew</th><th>Baseline Crew #</th><th>Baseline Peak Date</th><th>Optimized Crew #</th><th>Optimized Peak Date</th><th>Shift</th></tr></thead><tbody>' +
          a.crewShifts.map(function (c) {
            var dir = c.shiftDays > 0 ? 'earlier' : 'later';
            var cls = c.shiftDays > 0 ? 'epc-shift-pos' : 'epc-shift-neg';
            return '<tr><td>' + c.name + '</td>' +
              '<td>' + c.bPeak + '</td>' +
              '<td>' + fmtDate(c.bDate) + '</td>' +
              '<td>' + c.oPeak + '</td>' +
              '<td>' + fmtDate(c.oDate) + '</td>' +
              '<td class="' + cls + '">' + Math.abs(c.shiftDays) + 'd ' + dir + '</td></tr>';
          }).join('') +
          '</tbody></table></div>';
      }

      return '<div class="epc-action-card priority-' + pCls + '">' +
        '<div class="epc-card-header">' +
          '<div class="epc-num">' + (i + 1) + '</div>' +
          '<div class="epc-title">' + a.title + '</div>' +
          '<span class="priority-pill ' + pCls + '">' + a.priority + '</span>' +
        '</div>' +
        '<div class="epc-body">' +
          bulletsHtml +
          crewHtml +
        '</div>' +
        weakHtml +
      '</div>';
    }).join('');
  }

  // ── Tactic Buckets ──
  function renderTacticBuckets(R) {
    var aggregations = R.aggregations, diffs = R.diffs;
    var sortedTactics = Object.entries(aggregations.byTactic)
      .map(function (e) { return { name: e[0], count: e[1].count, scaledDays: e[1].scaledDays, diffs: e[1].diffs }; })
      .sort(function (a, b) { return b.scaledDays - a.scaledDays; });

    var maxDays = sortedTactics[0] ? sortedTactics[0].scaledDays : 1;

    document.getElementById('tactic-grid').innerHTML = sortedTactics.map(function (t) {
      var color = TACTIC_COLORS[t.name] || '#4f8ef7';
      var topActs = t.diffs.sort(function (a, b) { return a.finishVar - b.finishVar; }).slice(0, 4);
      return '<div class="tactic-card" onclick="ATT.filterByTactic(\'' + t.name + '\')"><div class="tactic-header"><div class="tactic-dot" style="background:' + color + '"></div><div class="tactic-name">' + t.name + '</div><div class="tactic-count">' + t.count + ' activities</div></div><div class="tactic-bar-wrap"><div class="tactic-bar" style="background:' + color + ';width:' + Math.min(100, (t.scaledDays / maxDays) * 100).toFixed(0) + '%"></div></div><span class="tactic-days">' + (t.scaledDays || 0) + '</span><span class="tactic-days-label"> estimated days</span><div class="tactic-activities">' +
        topActs.map(function (d) {
          return '<div class="tactic-act-item"><span>' + (d.task_name.length > 50 ? d.task_name.substring(0, 50) + '\u2026' : d.task_name) + '</span><span class="tactic-act-badge">' + (d.finishVar < 0 ? '\u25B2' : '\u25BC') + ' ' + Math.abs(d.finishVar).toFixed(0) + 'd</span></div>';
        }).join('') + '</div></div>';
    }).join('');

    // Top 20 chart
    var top20 = diffs.filter(function (d) { return d.finishVar !== 0; })
      .sort(function (a, b) { return a.finishVar - b.finishVar; }).slice(0, 20);

    plotDark('chart-top20', [{
      type: 'bar', orientation: 'h',
      x: top20.map(function (d) { return -d.finishVar; }),
      y: top20.map(function (d) { return d.task_name.substring(0, 45) + ' [' + (d.blockNotation || d.blockNum) + ']'; }),
      marker: { color: top20.map(function (d) { return d.finishVar < 0 ? '#22d3a8' : '#ef4444'; }) },
      text: top20.map(function (d) { return (d.finishVar < 0 ? '\u25B2 ' : '\u25BC ') + Math.abs(d.finishVar).toFixed(1) + 'd'; }),
      textposition: 'outside',
      hovertemplate: '<b>%{y}</b><br>%{x:.1f} days<extra></extra>',
    }], {
      xaxis: { title: 'Days Improvement (earlier finish = positive)', color: '#8899bb', gridcolor: '#2a3050' },
      yaxis: { autorange: 'reversed', color: '#e2e8f0', tickfont: { size: 10 } },
      margin: { l: 380, r: 80, t: 10, b: 50 },
      height: 420,
    });

    // Rules table
    document.getElementById('rules-table').innerHTML = TACTIC_RULES.map(function (r) {
      return '<tr><td><span class="badge badge-tactic" style="background:' + (TACTIC_COLORS[r.name] || '#4f8ef7') + '20;color:' + (TACTIC_COLORS[r.name] || '#4f8ef7') + '">' + r.name + '</span></td><td style="color:var(--text-muted);font-size:12px">' + r.signals + '</td><td style="color:var(--text-dim);font-style:italic;font-size:12px">' + r.example + '</td></tr>';
    }).join('');
  }

  // ── Area & Commodity ──
  function renderAreaCommodity(R) {
    var aggregations = R.aggregations;

    var blocks = Object.entries(aggregations.byBlock)
      .filter(function (e) { return e[0] && e[0] !== 'General'; })
      .map(function (e) { return { block: e[0], avgShift: e[1].totalFinishVar / e[1].count }; })
      .sort(function (a, b) { return a.avgShift - b.avgShift; });

    plotDark('chart-block', [{
      type: 'bar',
      x: blocks.map(function (b) { return 'Block ' + b.block; }),
      y: blocks.map(function (b) { return -b.avgShift; }),
      marker: { color: blocks.map(function (b) { return b.avgShift < 0 ? '#22d3a8' : '#ef4444'; }) },
      hovertemplate: '<b>%{x}</b><br>Avg: %{y:.1f} days earlier<extra></extra>',
    }], {
      xaxis: { color: '#e2e8f0' },
      yaxis: { title: 'Avg days earlier (positive = improvement)', color: '#8899bb', gridcolor: '#2a3050' },
      margin: { l: 60, r: 20, t: 10, b: 40 },
      height: 300,
    });

    // Tactic mix by trade
    var commodities = Object.keys(aggregations.byCommodity)
      .filter(function (c) { return c !== 'Other' && c !== 'Milestones'; })
      .sort(function (a, b) { return aggregations.byCommodity[b].count - aggregations.byCommodity[a].count; })
      .slice(0, 9);

    var stackedTraces = Object.values(TACTICS).map(function (tname) {
      var vals = commodities.map(function (c) {
        var cdiffs = aggregations.byCommodity[c] ? aggregations.byCommodity[c].diffs : [];
        return cdiffs.filter(function (d) { return d.tactics.some(function (t) { return t.tactic === tname; }); }).length;
      });
      if (vals.every(function (v) { return v === 0; })) return null;
      return { type: 'bar', name: tname, x: commodities, y: vals, marker: { color: TACTIC_COLORS[tname] || '#4f8ef7' } };
    }).filter(Boolean);

    plotDark('chart-trade-mix', stackedTraces, {
      barmode: 'stack',
      xaxis: { color: '#e2e8f0', tickangle: -30, tickfont: { size: 10 } },
      yaxis: { title: 'Activity count', color: '#8899bb', gridcolor: '#2a3050' },
      margin: { l: 50, r: 10, t: 10, b: 100 },
      height: 300,
      legend: { font: { size: 10, color: '#8899bb' } },
    });
  }

  // ── Crew Timeline ──
  function renderCrewTimeline(R) {
    var aggregations = R.aggregations, diffs = R.diffs;

    if (R.bCrewData && R.oCrewData) {
      renderAliceCrewCurves(R.bCrewData, R.oCrewData);
    }

    var crewAction = (R.epcActions || []).filter(function (a) {
      return a.crewShifts && a.crewShifts.length > 0;
    })[0];

    var summaryEl = document.getElementById('crew-ramp-summary');
    if (!summaryEl) return;
    if (!crewAction) { summaryEl.style.display = 'none'; return; }

    summaryEl.style.display = '';
    var bulletsHtml = '';
    if (crewAction.bullets && crewAction.bullets.length) {
      bulletsHtml = '<ul class="epc-bullets">' +
        crewAction.bullets.map(function (b) { return '<li>' + b + '</li>'; }).join('') +
      '</ul>';
    }

    var tableHtml = '<div class="epc-crew-table"><table>' +
      '<thead><tr><th>Crew</th><th>Baseline Crew #</th><th>Baseline Peak Date</th><th>Optimized Crew #</th><th>Optimized Peak Date</th><th>Shift</th></tr></thead><tbody>' +
      crewAction.crewShifts.map(function (c) {
        var dir = c.shiftDays > 0 ? 'earlier' : 'later';
        var cls = c.shiftDays > 0 ? 'epc-shift-pos' : 'epc-shift-neg';
        return '<tr><td>' + c.name + '</td>' +
          '<td>' + c.bPeak + '</td>' +
          '<td>' + fmtDate(c.bDate) + '</td>' +
          '<td>' + c.oPeak + '</td>' +
          '<td>' + fmtDate(c.oDate) + '</td>' +
          '<td class="' + cls + '">' + Math.abs(c.shiftDays) + 'd ' + dir + '</td></tr>';
      }).join('') +
      '</tbody></table></div>';

    summaryEl.innerHTML =
      '<div class="epc-action-card priority-high" style="margin-top:16px">' +
        '<div class="epc-card-header">' +
          '<div class="epc-num">\u{1F477}</div>' +
          '<div class="epc-title">' + crewAction.title + '</div>' +
          '<span class="priority-pill high">' + crewAction.priority + '</span>' +
        '</div>' +
        '<div class="epc-body">' + bulletsHtml + tableHtml + '</div>' +
      '</div>';
  }

  // ── Critical Path ──
  function renderCriticalPath(R) {
    var diffs = R.diffs;
    var baseline = R.baseline, optimized = R.optimized;

    // ── CPM Validation Summary ──
    renderCPMValidation(baseline, optimized, diffs);

    // ── Discrepancies Table ──
    renderCPMDiscrepancies(baseline, optimized);

    // ── Critical Path Shifts (using CPM-validated flags) ──
    var gainedFloat   = diffs.filter(function (d) { return d.bCpmCritical && !d.oCpmCritical; }).sort(function (a, b) { return a.finishVar - b.finishVar; });
    var stillCritical = diffs.filter(function (d) { return d.bCpmCritical && d.oCpmCritical; }).sort(function (a, b) { return a.finishVar - b.finishVar; });
    var becameCritical = diffs.filter(function (d) { return !d.bCpmCritical && d.oCpmCritical; });

    if (!gainedFloat.length && !stillCritical.length && !becameCritical.length) {
      gainedFloat   = diffs.filter(function (d) { return d.bCritical && !d.oCritical; }).sort(function (a, b) { return a.finishVar - b.finishVar; });
      stillCritical = diffs.filter(function (d) { return d.bCritical && d.oCritical; }).sort(function (a, b) { return a.finishVar - b.finishVar; });
      becameCritical = diffs.filter(function (d) { return !d.bCritical && d.oCritical; });
    }

    document.getElementById('cp-stats-grid').innerHTML =
      '<div class="stat-card success"><div class="stat-label">Moved Off Critical Path</div><div class="stat-value">' + gainedFloat.length + '</div><div class="stat-detail">Now have schedule buffer</div></div>' +
      '<div class="stat-card warn"><div class="stat-label">Moved Onto Critical Path</div><div class="stat-value">' + becameCritical.length + '</div><div class="stat-detail">Now driving project end</div></div>' +
      '<div class="stat-card accent"><div class="stat-label">Near-Critical in Both</div><div class="stat-value">' + stillCritical.length + '</div><div class="stat-detail">Remain on or near driving path</div></div>';

    function renderCPList(el, items, limit) {
      limit = limit || 15;
      if (!items.length) { el.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:13px">None identified.</div>'; return; }
      el.innerHTML = items.slice(0, limit).map(function (d) {
        var delta = -d.finishVar;
        return '<div class="cp-row"><div class="cp-code">' + (d.task_code || '') + '</div><div class="cp-name" title="' + d.task_name + '">' + (d.task_name.length > 45 ? d.task_name.substring(0, 45) + '\u2026' : d.task_name) + '</div><div class="cp-block">' + (d.blockNotation || d.blockNum) + '</div><div class="cp-delta ' + (delta > 0 ? 'better' : delta < 0 ? 'worse' : '') + '">' + (delta > 0 ? '\u25B2 ' : delta < 0 ? '\u25BC ' : '') + Math.abs(delta).toFixed(1) + 'd</div><div class="cp-status ' + (delta > 0 ? 'gained' : delta < 0 ? 'lost' : 'same') + '">' + (delta > 0 ? 'Better' : delta < 0 ? 'Slipped' : 'Same') + '</div></div>';
      }).join('');
    }

    renderCPList(document.getElementById('cp-gained-float'), gainedFloat.concat(becameCritical));
    renderCPList(document.getElementById('cp-near-critical'), stillCritical);

    // ── Gantt Chart: Critical Path Comparison (using CPM driving-path tasks) ──
    var cpDiffs = diffs.filter(function (d) {
        return d.bCpmCritical || d.oCpmCritical || d.bOnDrivingPath || d.oOnDrivingPath;
      })
      .filter(function (d) { return d.bStart && d.bEnd && d.oStart && d.oEnd; })
      .sort(function (a, b) { return a.oStart - b.oStart; })
      .slice(0, 30);

    if (!cpDiffs.length) {
      cpDiffs = diffs.filter(function (d) { return d.bCritical || d.oCritical; })
        .filter(function (d) { return d.bStart && d.bEnd && d.oStart && d.oEnd; })
        .sort(function (a, b) { return a.oStart - b.oStart; })
        .slice(0, 25);
    }

    if (cpDiffs.length > 0) {
      var ganttTraces = [];
      var yLabels = cpDiffs.map(function (d) { return d.task_name.substring(0, 40); });

      for (var gi = 0; gi < cpDiffs.length; gi++) {
        var gd = cpDiffs[gi];
        ganttTraces.push({
          type: 'scatter', mode: 'lines',
          x: [gd.bStart, gd.bEnd], y: [gi - 0.15, gi - 0.15],
          line: { color: 'rgba(79,142,247,0.4)', width: 14 },
          name: 'Baseline', legendgroup: 'baseline', showlegend: gi === 0,
          hovertemplate: '<b>Baseline</b><br>' + gd.task_name.substring(0, 40) + '<br>' + fmtDate(gd.bStart) + ' \u2192 ' + fmtDate(gd.bEnd) + '<extra></extra>',
        });
        ganttTraces.push({
          type: 'scatter', mode: 'lines',
          x: [gd.oStart, gd.oEnd], y: [gi + 0.15, gi + 0.15],
          line: { color: 'rgba(34,211,168,0.8)', width: 14 },
          name: 'Optimized', legendgroup: 'optimized', showlegend: gi === 0,
          hovertemplate: '<b>Optimized</b><br>' + gd.task_name.substring(0, 40) + '<br>' + fmtDate(gd.oStart) + ' \u2192 ' + fmtDate(gd.oEnd) + '<extra></extra>',
        });
      }

      plotDark('chart-gantt', ganttTraces, {
        xaxis: { type: 'date', color: '#8899bb', gridcolor: '#2a3050' },
        yaxis: {
          tickvals: cpDiffs.map(function (d, i) { return i; }),
          ticktext: yLabels,
          autorange: 'reversed', color: '#e2e8f0', tickfont: { size: 10 },
        },
        margin: { l: 320, r: 30, t: 10, b: 50 },
        height: Math.max(300, cpDiffs.length * 32 + 60),
        legend: { font: { color: '#8899bb' }, orientation: 'h', y: 1.02 },
        hovermode: 'closest',
      });
    }
  }

  // ── CPM Validation Summary ──
  function renderCPMValidation(baseline, optimized, diffs) {
    var bv = baseline.cpmValidation || {};
    var ov = optimized.cpmValidation || {};
    var bDP = (baseline.drivingPath || []).length;
    var oDP = (optimized.drivingPath || []).length;

    var bCritCount = 0, oCritCount = 0;
    var tasks = Object.values(baseline.taskById);
    for (var i = 0; i < tasks.length; i++) { if (tasks[i].cpmCritical) bCritCount++; }
    var oTasks = Object.values(optimized.taskById);
    for (var j = 0; j < oTasks.length; j++) { if (oTasks[j].cpmCritical) oCritCount++; }

    var totalDisc = (bv.aliceOnlyCritical || 0) + (bv.cpmOnlyCritical || 0)
                  + (ov.aliceOnlyCritical || 0) + (ov.cpmOnlyCritical || 0);

    var discClass = totalDisc === 0 ? 'success' : totalDisc <= 10 ? 'accent' : 'warn';

    document.getElementById('cpm-validation-grid').innerHTML =
      '<div class="stat-card accent"><div class="stat-label">Baseline CPM-Critical</div><div class="stat-value">' + bCritCount + '</div><div class="stat-detail">Driving path: ' + bDP + ' activities</div></div>' +
      '<div class="stat-card accent"><div class="stat-label">Optimized CPM-Critical</div><div class="stat-value">' + oCritCount + '</div><div class="stat-detail">Driving path: ' + oDP + ' activities</div></div>' +
      '<div class="stat-card ' + discClass + '"><div class="stat-label">Validation Agreement</div><div class="stat-value">' + (bv.agreementPct || 100) + '%</div><div class="stat-detail">' + totalDisc + ' discrepancies found</div></div>';
  }

  // ── Discrepancies Table ──
  function renderCPMDiscrepancies(baseline, optimized) {
    var wrap = document.getElementById('cpm-discrepancies-wrap');
    var body = document.getElementById('cpm-discrepancy-body');
    if (!wrap || !body) return;

    var rows = [];

    function collectDiscrepancies(sched, label) {
      var tasks = Object.values(sched.taskById);
      for (var i = 0; i < tasks.length; i++) {
        var t = tasks[i];
        if (!t.early_start || !t.early_end) continue;
        var aliceCrit = t.isCritical || (t.aliceFloatDays != null && t.aliceFloatDays <= 0);
        var cpmCrit = !!t.cpmCritical;
        if (aliceCrit === cpmCrit) continue;

        rows.push({
          name: t.task_name,
          block: t.blockNotation || t.blockNum || '\u2014',
          aliceFlag: t.isCritical ? 'Critical' : 'Non-critical',
          aliceFloat: t.aliceFloatDays != null ? t.aliceFloatDays.toFixed(1) + 'd' : '\u2014',
          cpmFloat: t.cpmFloatDays != null ? t.cpmFloatDays.toFixed(1) + 'd' : '\u2014',
          status: aliceCrit && !cpmCrit
            ? '<span style="color:#f59e0b">ALICE-only critical</span>'
            : '<span style="color:#a78bfa">CPM-only critical</span>',
          schedule: label,
          absFloat: Math.abs(t.cpmFloatDays || 0),
        });
      }
    }

    collectDiscrepancies(baseline, 'Baseline');
    collectDiscrepancies(optimized, 'Optimized');

    rows.sort(function (a, b) { return a.absFloat - b.absFloat; });

    if (!rows.length) {
      wrap.style.display = 'none';
      return;
    }

    wrap.style.display = '';
    var maxRows = 30;
    body.innerHTML = rows.slice(0, maxRows).map(function (r) {
      var shortName = r.name.length > 50 ? r.name.substring(0, 50) + '\u2026' : r.name;
      return '<tr><td title="' + r.name + ' (' + r.schedule + ')">' + shortName + ' <span style="font-size:10px;color:var(--text-dim)">(' + r.schedule + ')</span></td>' +
        '<td>' + r.block + '</td>' +
        '<td>' + r.aliceFlag + '</td>' +
        '<td>' + r.aliceFloat + '</td>' +
        '<td>' + r.cpmFloat + '</td>' +
        '<td>' + r.status + '</td></tr>';
    }).join('');

    if (rows.length > maxRows) {
      body.innerHTML += '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);font-size:12px">\u2026 and ' + (rows.length - maxRows) + ' more</td></tr>';
    }
  }

  // ── Requirements ──
  function renderRequirements(R) {
    var reqs = R.requirements;
    var catColors = {
      'Mobilization': '#22d3a8', 'Permitting': '#fb7185',
      'Field Discipline': '#f59e0b', 'Resources': '#a78bfa',
      'Area Management': '#60a5fa', 'Scheduling': '#4f8ef7',
      'Project Controls': '#34d399',
    };
    var byCategory = {};
    for (var i = 0; i < reqs.length; i++) {
      if (!byCategory[reqs[i].category]) byCategory[reqs[i].category] = [];
      byCategory[reqs[i].category].push(reqs[i]);
    }
    document.getElementById('requirements-content').innerHTML = Object.entries(byCategory).map(function (e) {
      var cat = e[0], items = e[1];
      return '<div class="requirement-section"><div class="req-section-title" style="color:' + (catColors[cat] || '#8899bb') + '">' + cat + '</div>' +
        items.map(function (r) {
          return '<div class="requirement-item"><div class="req-icon">' + r.icon + '</div><div style="flex:1"><div class="req-title">' + r.title + '</div><div class="req-detail">' + r.detail + '</div></div>' + (r.date ? '<div class="req-date">' + r.date + '</div>' : '') + '</div>';
        }).join('') + '</div>';
    }).join('');
  }

  // ── Activity Table ──
  function populateFilters(R) {
    var diffs = R.diffs;
    var comms = Array.from(new Set(diffs.map(function (d) { return d.commodity; }))).sort();
    var blocks = Array.from(new Set(diffs.map(function (d) { return d.blockNum; }).filter(Boolean))).sort(function (a, b) { return a - b; });
    var tactics = Array.from(new Set(diffs.flatMap(function (d) { return d.tactics.map(function (t) { return t.tactic; }); }))).filter(function (t) { return t !== 'No Change'; }).sort();

    document.getElementById('filter-commodity').innerHTML = '<option value="">All Trades</option>' + comms.map(function (c) { return '<option value="' + c + '">' + c + '</option>'; }).join('');
    document.getElementById('filter-block').innerHTML = '<option value="">All Blocks</option>' + blocks.map(function (b) { return '<option value="' + b + '">Block ' + b + '</option>'; }).join('');
    document.getElementById('filter-tactic').innerHTML = '<option value="">All Tactics</option>' + tactics.map(function (t) { return '<option value="' + t + '">' + t + '</option>'; }).join('');
  }

  ATT.filterByTactic = function (tacticName) {
    ATT.switchTab('areas');
    setTimeout(function () {
      document.getElementById('filter-tactic').value = tacticName;
      ATT.renderActivityTable();
    }, 80);
  };

  ATT.sortTable = function (col) {
    tableSort = { col: col, dir: tableSort.col === col ? -tableSort.dir : 1 };
    ATT.renderActivityTable();
  };

  ATT.renderActivityTable = function () {
    if (!window.APP || !window.APP.results) return;
    var diffs = window.APP.results.diffs;
    var fComm = document.getElementById('filter-commodity').value;
    var fBlock = document.getElementById('filter-block').value;
    var fTactic = document.getElementById('filter-tactic').value;
    var fImpact = document.getElementById('filter-impact').value;

    var filtered = diffs.filter(function (d) {
      if (fComm && d.commodity !== fComm) return false;
      if (fBlock && d.blockNum !== fBlock) return false;
      if (fTactic && !d.tactics.some(function (t) { return t.tactic === fTactic; })) return false;
      if (fImpact === 'improved' && d.finishVar >= -0.5) return false;
      if (fImpact === 'worsened' && d.finishVar <= 0.5) return false;
      if (fImpact === 'major' && Math.abs(d.finishVar) <= 7) return false;
      return true;
    });

    filtered.sort(function (a, b) {
      var va = a[tableSort.col], vb = b[tableSort.col];
      if (typeof va === 'string') return tableSort.dir * va.localeCompare(vb);
      return tableSort.dir * ((va || 0) - (vb || 0));
    });

    var shown = filtered.slice(0, 200);
    document.getElementById('activity-table-body').innerHTML = shown.map(function (d) {
      var ptac = d.tactics[0] || { tactic: 'No Change' };
      var color = TACTIC_COLORS[ptac.tactic] || '#4f8ef7';
      return '<tr><td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + d.task_name + '">' + d.task_name + '</td><td><span style="font-size:11px">' + d.commodity + '</span></td><td>' + (d.blockNotation || d.blockNum || '\u2014') + '</td><td>' + (d.startVar ? '<span class="badge ' + (d.startVar < -0.5 ? 'badge-neg' : d.startVar > 0.5 ? 'badge-pos' : '') + '">' + fmtDays(d.startVar, true) + '</span>' : '\u2014') + '</td><td>' + (d.finishVar ? '<span class="badge ' + (d.finishVar < -0.5 ? 'badge-neg' : d.finishVar > 0.5 ? 'badge-pos' : '') + '">' + fmtDays(d.finishVar, true) + '</span>' : '\u2014') + '</td><td>' + (d.durVar ? fmtDays(d.durVar, true) : '\u2014') + '</td><td>' + (d.floatVar ? (d.floatVar > 0 ? '+' : '') + d.floatVar.toFixed(1) + 'd' : '\u2014') + '</td><td>' + (d.laborVar !== 0 ? (d.laborVar > 0 ? '+' : '') + d.laborVar.toFixed(1) : '\u2014') + '</td><td><span class="badge badge-tactic" style="background:' + color + '20;color:' + color + '">' + ptac.tactic + '</span></td></tr>';
    }).join('');

    document.getElementById('activity-table-footer').textContent =
      'Showing ' + shown.length + ' of ' + filtered.length + ' activities' +
      (filtered.length < diffs.length ? ' (' + diffs.length + ' total)' : '');
  };

  // ── ALICE Crew Curves (single chart with filter) ──
  var _crewCache = null;

  function renderAliceCrewCurves(bCrew, oCrew) {
    var wrap = document.getElementById('crew-curve-wrap');
    if (wrap) wrap.style.display = '';

    var allDates = {};
    bCrew.dates.forEach(function (d) { allDates[d] = true; });
    oCrew.dates.forEach(function (d) { allDates[d] = true; });
    var sortedDates = Object.keys(allDates).sort();

    var allCrewNames = {};
    bCrew.crewNames.forEach(function (n) { allCrewNames[n] = true; });
    oCrew.crewNames.forEach(function (n) { allCrewNames[n] = true; });
    var crewList = Object.keys(allCrewNames).sort().filter(function (name) {
      var bD = bCrew.crews[name] || {}, oD = oCrew.crews[name] || {};
      var bMax = 0, oMax = 0;
      sortedDates.forEach(function (d) {
        if ((bD[d] || 0) > bMax) bMax = bD[d];
        if ((oD[d] || 0) > oMax) oMax = oD[d];
      });
      return bMax >= 1 || oMax >= 1;
    });

    _crewCache = { bCrew: bCrew, oCrew: oCrew, sortedDates: sortedDates, crewList: crewList };

    var sel = document.getElementById('crew-curve-filter');
    if (sel) {
      sel.innerHTML = '<option value="__total__">All Crews (Total Site)</option>' +
        crewList.map(function (n) {
          var label = (n || '').split(' - ')[0].replace(/_/g, ' ').trim();
          return '<option value="' + n + '">' + label + '</option>';
        }).join('');
    }

    ATT.updateCrewCurve();
  }

  ATT.updateCrewCurve = function () {
    if (!_crewCache) return;
    var sel = document.getElementById('crew-curve-filter');
    var chosen = sel ? sel.value : '__total__';
    var bc = _crewCache.bCrew, oc = _crewCache.oCrew, dates = _crewCache.sortedDates;

    var bVals, oVals, yTitle, bPeak = 0, bPeakDate = '', oPeak = 0, oPeakDate = '';

    if (chosen === '__total__') {
      bVals = dates.map(function (d) { return bc.dailyTotal[d] || 0; });
      oVals = dates.map(function (d) { return oc.dailyTotal[d] || 0; });
      yTitle = 'Total daily headcount';
      bPeak = bc.peakCount; bPeakDate = bc.peakDate ? bc.peakDate.toISOString().slice(0, 10) : '';
      oPeak = oc.peakCount; oPeakDate = oc.peakDate ? oc.peakDate.toISOString().slice(0, 10) : '';
    } else {
      var bD = bc.crews[chosen] || {}, oD = oc.crews[chosen] || {};
      bVals = dates.map(function (d) { return bD[d] || 0; });
      oVals = dates.map(function (d) { return oD[d] || 0; });
      yTitle = 'Daily headcount';
      for (var i = 0; i < dates.length; i++) {
        if (bVals[i] > bPeak) { bPeak = bVals[i]; bPeakDate = dates[i]; }
        if (oVals[i] > oPeak) { oPeak = oVals[i]; oPeakDate = dates[i]; }
      }
    }

    var annotations = [];
    if (bPeak > 0 && bPeakDate) {
      annotations.push({ x: bPeakDate, y: bPeak, text: 'Baseline peak: ' + Math.round(bPeak), showarrow: true, arrowhead: 2, ax: -50, ay: -30, font: { color: '#4f8ef7', size: 11 }, arrowcolor: '#4f8ef7' });
    }
    if (oPeak > 0 && oPeakDate) {
      annotations.push({ x: oPeakDate, y: oPeak, text: 'Optimized peak: ' + Math.round(oPeak), showarrow: true, arrowhead: 2, ax: 50, ay: -30, font: { color: '#22d3a8', size: 11 }, arrowcolor: '#22d3a8' });
    }

    plotDark('chart-crew-curve', [
      { type: 'scatter', mode: 'lines', name: 'Baseline', x: dates, y: bVals, line: { color: 'rgba(79,142,247,0.8)', width: 2 }, fill: 'tozeroy', fillcolor: 'rgba(79,142,247,0.1)' },
      { type: 'scatter', mode: 'lines', name: 'Optimized', x: dates, y: oVals, line: { color: 'rgba(34,211,168,0.9)', width: 2 }, fill: 'tozeroy', fillcolor: 'rgba(34,211,168,0.1)' },
    ], {
      xaxis: { type: 'date', color: '#8899bb', gridcolor: '#2a3050' },
      yaxis: { title: yTitle, color: '#8899bb', gridcolor: '#2a3050' },
      margin: { l: 60, r: 20, t: 10, b: 50 },
      height: 420,
      legend: { font: { color: '#8899bb' }, orientation: 'h', y: 1.05 },
      annotations: annotations,
    });
  };

})(window.ATT = window.ATT || {});
