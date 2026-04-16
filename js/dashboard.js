(function (ATT) {
  'use strict';

  var TACTICS = ATT.TACTICS;
  var TACTIC_COLORS = ATT.TACTIC_COLORS;
  var TACTIC_RULES = ATT.TACTIC_RULES;
  var fmtDate = ATT.fmtDate;
  var fmtDays = ATT.fmtDays;
  var dateDiffDays = ATT.dateDiffDays;
  var plotDark = ATT.plotDark;


  // ── Master render ──
  ATT.renderDashboard = function (R) {
    renderExecutiveSummary(R);
    renderEPCActions(R);
    renderTacticBuckets(R);
    renderWorkfrontSequences(R);
    renderCrewTimeline(R);
    renderCriticalPath(R);
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

  // ── Workfront Sequences ──
  var _wfCache = null;

  function renderWorkfrontSequences(R) {
    var baseline = R.baseline, optimized = R.optimized;

    var byCommodity = {};

    function collectTasks(sched, tag) {
      var tasks = Object.values(sched.taskById);
      for (var i = 0; i < tasks.length; i++) {
        var t = tasks[i];
        if (!t.early_start || !t.early_end) continue;
        if (!t.blockNotation && !t.blockNum) continue;
        var comm = t.commodity;
        if (comm === 'Other' || comm === 'Milestones') continue;
        if (!byCommodity[comm]) byCommodity[comm] = {};
        var blk = t.blockNotation || ('Block ' + t.blockNum);
        if (!byCommodity[comm][blk]) byCommodity[comm][blk] = { baseline: null, optimized: null };
        var cur = byCommodity[comm][blk][tag];
        if (!cur || t.early_start < cur.start) {
          byCommodity[comm][blk][tag] = {
            start: t.early_start,
            end: cur ? (t.early_end > cur.end ? t.early_end : cur.end) : t.early_end,
            taskCount: cur ? cur.taskCount + 1 : 1,
          };
        } else {
          if (t.early_end > cur.end) cur.end = t.early_end;
          cur.taskCount++;
        }
      }
    }

    collectTasks(baseline, 'baseline');
    collectTasks(optimized, 'optimized');

    var commodityNames = Object.keys(byCommodity).sort();

    var sel = document.getElementById('wf-commodity-filter');
    if (sel) {
      sel.innerHTML = '<option value="__all__">All Trades</option>' +
        commodityNames.map(function (c) { return '<option value="' + c + '">' + c + '</option>'; }).join('');
    }

    _wfCache = { byCommodity: byCommodity, commodityNames: commodityNames };
    ATT.updateWorkfrontChart();
  }

  ATT.updateWorkfrontChart = function () {
    if (!_wfCache) return;
    var selComm = document.getElementById('wf-commodity-filter');
    var selScen = document.getElementById('wf-scenario-filter');
    var chosenComm = selComm ? selComm.value : '__all__';
    var chosenScen = selScen ? selScen.value : 'both';
    var data = _wfCache.byCommodity;
    var MS_PER_DAY = 86400000;

    var rows = [];

    if (chosenComm === '__all__') {
      var comms = _wfCache.commodityNames;
      for (var ci = 0; ci < comms.length; ci++) {
        var comm = comms[ci];
        var blocks = Object.keys(data[comm]);
        var sortable = blocks.map(function (blk) {
          var b = data[comm][blk].baseline;
          var o = data[comm][blk].optimized;
          var earliest = b ? b.start : (o ? o.start : new Date());
          if (o && o.start < earliest) earliest = o.start;
          return { block: blk, earliest: earliest, data: data[comm][blk], commodity: comm };
        });
        sortable.sort(function (a, b) { return a.earliest - b.earliest; });
        for (var si = 0; si < sortable.length; si++) {
          rows.push({
            label: comm + ' \u2014 ' + sortable[si].block,
            commodity: comm,
            block: sortable[si].block,
            seq: si + 1,
            baseline: sortable[si].data.baseline,
            optimized: sortable[si].data.optimized,
          });
        }
      }
    } else {
      var blocks = Object.keys(data[chosenComm] || {});
      var sortable = blocks.map(function (blk) {
        var b = data[chosenComm][blk].baseline;
        var o = data[chosenComm][blk].optimized;
        var earliest = b ? b.start : (o ? o.start : new Date());
        if (o && o.start < earliest) earliest = o.start;
        return { block: blk, earliest: earliest, data: data[chosenComm][blk] };
      });
      sortable.sort(function (a, b) { return a.earliest - b.earliest; });
      for (var si = 0; si < sortable.length; si++) {
        rows.push({
          label: sortable[si].block,
          commodity: chosenComm,
          block: sortable[si].block,
          seq: si + 1,
          baseline: sortable[si].data.baseline,
          optimized: sortable[si].data.optimized,
        });
      }
    }

    var showB = chosenScen === 'both' || chosenScen === 'baseline';
    var showO = chosenScen === 'both' || chosenScen === 'optimized';
    rows = rows.filter(function (r) {
      return (showB && r.baseline) || (showO && r.optimized);
    });

    var titleEl = document.getElementById('wf-chart-title');
    var subEl = document.getElementById('wf-chart-sub');
    if (titleEl) titleEl.textContent = chosenComm === '__all__' ? 'All Trades \u2014 Block Progression' : chosenComm + ' \u2014 Block Progression';
    if (subEl) subEl.textContent = 'Blocks ordered by earliest activity start \u2014 bars show work windows';

    var yLabels = rows.map(function (r) { return r.label; });
    var traces = [];

    var bothScenarios = showB && showO;
    var bLineW = bothScenarios ? 18 : 22;
    var oLineW = bothScenarios ? 10 : 22;

    if (showB) {
      traces.push({
        type: 'scatter', mode: 'lines', name: 'Baseline',
        x: [], y: [], line: { color: 'rgba(79,142,247,0.9)', width: bLineW },
        hoverinfo: 'text', text: [],
      });
      for (var i = 0; i < rows.length; i++) {
        var b = rows[i].baseline;
        if (!b) continue;
        var dur = Math.round((b.end - b.start) / MS_PER_DAY);
        traces[traces.length - 1].x.push(b.start, b.end, null);
        traces[traces.length - 1].y.push(yLabels[i], yLabels[i], null);
        traces[traces.length - 1].text.push(
          rows[i].label + '<br>Baseline: ' + fmtDate(b.start) + ' \u2013 ' + fmtDate(b.end) + ' (' + dur + 'd, ' + b.taskCount + ' tasks)',
          rows[i].label + '<br>Baseline: ' + fmtDate(b.start) + ' \u2013 ' + fmtDate(b.end) + ' (' + dur + 'd, ' + b.taskCount + ' tasks)',
          null
        );
      }
    }

    if (showO) {
      traces.push({
        type: 'scatter', mode: 'lines', name: 'Optimized',
        x: [], y: [], line: { color: 'rgba(34,211,168,0.9)', width: oLineW },
        hoverinfo: 'text', text: [],
      });
      for (var i = 0; i < rows.length; i++) {
        var o = rows[i].optimized;
        if (!o) continue;
        var dur = Math.round((o.end - o.start) / MS_PER_DAY);
        traces[traces.length - 1].x.push(o.start, o.end, null);
        traces[traces.length - 1].y.push(yLabels[i], yLabels[i], null);
        traces[traces.length - 1].text.push(
          rows[i].label + '<br>Optimized: ' + fmtDate(o.start) + ' \u2013 ' + fmtDate(o.end) + ' (' + dur + 'd, ' + o.taskCount + ' tasks)',
          rows[i].label + '<br>Optimized: ' + fmtDate(o.start) + ' \u2013 ' + fmtDate(o.end) + ' (' + dur + 'd, ' + o.taskCount + ' tasks)',
          null
        );
      }
    }

    var maxLabelLen = 0;
    for (var li = 0; li < yLabels.length; li++) {
      if (yLabels[li].length > maxLabelLen) maxLabelLen = yLabels[li].length;
    }
    var leftMargin = Math.min(400, Math.max(100, maxLabelLen * 7 + 20));
    var ROW_H = 40;
    var chartH = Math.max(300, rows.length * ROW_H + 80);

    plotDark('chart-workfront', traces, {
      xaxis: { type: 'date', color: '#8899bb', gridcolor: '#2a3050', automargin: true },
      yaxis: {
        categoryorder: 'array', categoryarray: yLabels.slice().reverse(),
        color: '#e2e8f0', tickfont: { size: 11 }, automargin: true,
      },
      margin: { l: leftMargin, r: 30, t: 10, b: 50 },
      height: chartH,
      hovermode: 'closest',
      legend: { font: { color: '#8899bb' }, orientation: 'h', y: 1.05 },
    });

    renderWorkfrontSummary(rows, chosenComm, chosenScen, MS_PER_DAY);
  };

  function renderWorkfrontSummary(rows, comm, scenario, MS_PER_DAY) {
    var el = document.getElementById('wf-sequence-summary');
    if (!el) return;

    if (comm === '__all__' || rows.length === 0) {
      el.style.display = 'none';
      return;
    }

    var seqB = [], seqO = [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].baseline) seqB.push({ block: rows[i].block, start: rows[i].baseline.start });
      if (rows[i].optimized) seqO.push({ block: rows[i].block, start: rows[i].optimized.start });
    }
    seqB.sort(function (a, b) { return a.start - b.start; });
    seqO.sort(function (a, b) { return a.start - b.start; });

    var bSeqStr = seqB.map(function (s) { return s.block; }).join(' \u2192 ');
    var oSeqStr = seqO.map(function (s) { return s.block; }).join(' \u2192 ');

    var resequenced = bSeqStr !== oSeqStr;

    var html = '<div style="font-size:13px;font-weight:700;margin-bottom:8px">' + comm + ' Progression Order</div>';
    if (scenario === 'both' || scenario === 'baseline') {
      html += '<div class="cp-summary-row"><span class="cp-summary-label">Baseline:</span> <span>' + (bSeqStr || '\u2014') + '</span> <span style="color:var(--text-dim);margin-left:8px">(' + seqB.length + ' blocks)</span></div>';
    }
    if (scenario === 'both' || scenario === 'optimized') {
      html += '<div class="cp-summary-row"><span class="cp-summary-label">Optimized:</span> <span>' + (oSeqStr || '\u2014') + '</span> <span style="color:var(--text-dim);margin-left:8px">(' + seqO.length + ' blocks)</span></div>';
    }
    if (scenario === 'both' && resequenced) {
      html += '<div style="margin-top:8px;padding:8px 12px;background:rgba(245,158,11,.07);border-radius:6px;border:1px solid rgba(245,158,11,.2);font-size:12px;color:#f59e0b">' +
        '\u26A0 Block progression order changed between scenarios \u2014 workfront resequencing detected</div>';
    }

    el.style.display = '';
    el.innerHTML = html;
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
  var MS_PER_DAY = 86400000;
  var _cpCache = null;
  var _cpMethod = 'longest-path';
  var _cpNCThreshold = 10;

  function renderCriticalPath(R) {
    var baseline = R.baseline, optimized = R.optimized;
    _cpCache = { baseline: baseline, optimized: optimized };
    _cpMethod = 'longest-path';
    _cpNCThreshold = 10;

    var toggle = document.getElementById('cp-method-toggle');
    if (toggle) {
      toggle.querySelectorAll('.cp-method-btn').forEach(function (btn) {
        btn.classList.toggle('active', btn.dataset.method === 'longest-path');
      });
    }
    var ncWrap = document.getElementById('cp-tolerance-wrap');
    if (ncWrap) ncWrap.style.display = 'none';

    updateCPStats();
    ATT.updateCPGantt();
    renderDiagnostics(R);
  }

  ATT.setCPMethod = function (method) {
    _cpMethod = method;
    var toggle = document.getElementById('cp-method-toggle');
    if (toggle) {
      toggle.querySelectorAll('.cp-method-btn').forEach(function (btn) {
        btn.classList.toggle('active', btn.dataset.method === method);
      });
    }
    var desc = document.getElementById('cp-method-desc');
    if (desc) {
      desc.textContent = method === 'longest-path'
        ? 'Traces the single continuous chain of driving logic from project start to the selected milestone.'
        : 'All activities where Total Float \u2264 0. May produce multiple disconnected segments.';
    }
    var ncWrap = document.getElementById('cp-tolerance-wrap');
    if (ncWrap) ncWrap.style.display = method === 'zero-float' ? '' : 'none';
    var chartTitle = document.getElementById('cp-chart-title');
    var chartSub = document.getElementById('cp-chart-sub');
    if (method === 'longest-path') {
      if (chartTitle) chartTitle.textContent = 'Longest Path \u2014 Driving Chain';
      if (chartSub) chartSub.textContent = 'Activities on the driving logic chain from start to finish milestone';
    } else {
      if (chartTitle) chartTitle.textContent = 'Zero Total Float \u2014 Critical Activities';
      if (chartSub) chartSub.textContent = 'All activities with total float \u2264 0 (may include multiple disconnected segments)';
    }
    updateCPStats();
    ATT.updateCPGantt();
  };

  ATT.updateNCThreshold = function (val) {
    _cpNCThreshold = parseInt(val) || 10;
    var label = document.getElementById('cp-nc-value');
    if (label) label.textContent = _cpNCThreshold + 'd';
    updateCPStats();
  };

  function updateCPStats() {
    if (!_cpCache) return;
    var b = _cpCache.baseline, o = _cpCache.optimized;
    var html = '';
    if (_cpMethod === 'longest-path') {
      var bLP = (b.drivingPath || []).length;
      var oLP = (o.drivingPath || []).length;
      var bZF = (b.zeroFloatPath || []).length;
      var oZF = (o.zeroFloatPath || []).length;
      html =
        '<div class="stat-card accent"><div class="stat-label">Baseline LP Tasks</div><div class="stat-value">' + bLP + '</div><div class="stat-detail">Driving chain activities</div></div>' +
        '<div class="stat-card accent"><div class="stat-label">Optimized LP Tasks</div><div class="stat-value">' + oLP + '</div><div class="stat-detail">Driving chain activities</div></div>' +
        '<div class="stat-card warn"><div class="stat-label">Baseline TF\u22640</div><div class="stat-value">' + bZF + '</div><div class="stat-detail">Zero-float activities</div></div>' +
        '<div class="stat-card warn"><div class="stat-label">Optimized TF\u22640</div><div class="stat-value">' + oZF + '</div><div class="stat-detail">Zero-float activities</div></div>';
    } else {
      var bZF2 = (b.zeroFloatPath || []).length;
      var oZF2 = (o.zeroFloatPath || []).length;
      var bSegs = b.cpmResult ? b.cpmResult.zeroFloat.segmentCount : 0;
      var oSegs = o.cpmResult ? o.cpmResult.zeroFloat.segmentCount : 0;
      var bNC = ATT.recomputeNearCritical(b, _cpNCThreshold).length;
      var oNC = ATT.recomputeNearCritical(o, _cpNCThreshold).length;
      html =
        '<div class="stat-card warn"><div class="stat-label">Baseline TF\u22640</div><div class="stat-value">' + bZF2 + '</div><div class="stat-detail">' + bSegs + ' segment' + (bSegs !== 1 ? 's' : '') + '</div></div>' +
        '<div class="stat-card warn"><div class="stat-label">Optimized TF\u22640</div><div class="stat-value">' + oZF2 + '</div><div class="stat-detail">' + oSegs + ' segment' + (oSegs !== 1 ? 's' : '') + '</div></div>' +
        '<div class="stat-card accent"><div class="stat-label">Baseline Near-Crit</div><div class="stat-value">' + bNC + '</div><div class="stat-detail">0 < TF \u2264 ' + _cpNCThreshold + 'd</div></div>' +
        '<div class="stat-card accent"><div class="stat-label">Optimized Near-Crit</div><div class="stat-value">' + oNC + '</div><div class="stat-detail">0 < TF \u2264 ' + _cpNCThreshold + 'd</div></div>';
    }
    document.getElementById('cp-top-stats').innerHTML = html;
  }

  ATT.updateCPGantt = function () {
    if (!_cpCache) return;
    var b = _cpCache.baseline, o = _cpCache.optimized;
    var scenarioSel = document.getElementById('cp-gantt-filter');
    var scenario = scenarioSel ? scenarioSel.value : 'both';

    var bPath, oPath;
    if (_cpMethod === 'longest-path') {
      bPath = (b.drivingPath || []).filter(function (t) { return t.early_start && t.early_end; });
      oPath = (o.drivingPath || []).filter(function (t) { return t.early_start && t.early_end; });
    } else {
      bPath = (b.zeroFloatPath || []).filter(function (t) { return t.early_start && t.early_end; });
      oPath = (o.zeroFloatPath || []).filter(function (t) { return t.early_start && t.early_end; });
    }

    bPath.sort(function (a, b) { return a.early_start - b.early_start; });
    oPath.sort(function (a, b) { return a.early_start - b.early_start; });

    drawCPGantt(bPath, oPath, scenario);
    renderPathSummary(bPath, oPath, scenario);
    renderCPTable(bPath, oPath, scenario);
  };

  function drawCPGantt(bPath, oPath, scenario) {
    var traces = [];
    var yLabels = [];
    var maxShow = 40;

    if (scenario === 'both') {
      // Merge by task_name, show both bars per activity
      var nameMap = {};
      var order = [];
      function addToMap(path, key) {
        for (var i = 0; i < path.length; i++) {
          var name = path[i].task_name;
          if (!nameMap[name]) { nameMap[name] = {}; order.push(name); }
          nameMap[name][key] = path[i];
        }
      }
      addToMap(bPath, 'b');
      addToMap(oPath, 'o');

      // Sort by earliest start across either
      order.sort(function (a, b) {
        var aStart = (nameMap[a].o || nameMap[a].b).early_start;
        var bStart = (nameMap[b].o || nameMap[b].b).early_start;
        return aStart - bStart;
      });

      var displayed = order.slice(0, maxShow);

      for (var ri = 0; ri < displayed.length; ri++) {
        var name = displayed[ri];
        var entry = nameMap[name];
        var shortName = name.length > 42 ? name.substring(0, 42) + '\u2026' : name;
        var block = (entry.b || entry.o).blockNotation || (entry.b || entry.o).blockNum || '';
        yLabels.push(block ? shortName + ' [' + block + ']' : shortName);

        if (entry.b) {
          var bStart = entry.b._displayStart || entry.b.early_start;
          var bf = entry.b.cpmFloatDays != null ? entry.b.cpmFloatDays.toFixed(1) + 'd' : '\u2014';
          traces.push({
            type: 'scatter', mode: 'lines',
            x: [bStart, entry.b.early_end],
            y: [ri - 0.18, ri - 0.18],
            line: { color: 'rgba(79,142,247,0.75)', width: 12 },
            name: 'Baseline', legendgroup: 'baseline', showlegend: ri === 0 && !!entry.b,
            hovertemplate: '<b>Baseline</b><br>' + name.substring(0, 50) + '<br>' + fmtDate(entry.b.early_start) + ' \u2192 ' + fmtDate(entry.b.early_end) + '<br>Float: ' + bf + '<extra></extra>',
          });
        }
        if (entry.o) {
          var oStart = entry.o._displayStart || entry.o.early_start;
          var of_ = entry.o.cpmFloatDays != null ? entry.o.cpmFloatDays.toFixed(1) + 'd' : '\u2014';
          traces.push({
            type: 'scatter', mode: 'lines',
            x: [oStart, entry.o.early_end],
            y: [ri + 0.18, ri + 0.18],
            line: { color: 'rgba(34,211,168,0.85)', width: 12 },
            name: 'Optimized', legendgroup: 'optimized', showlegend: ri === 0 && !!entry.o,
            hovertemplate: '<b>Optimized</b><br>' + name.substring(0, 50) + '<br>' + fmtDate(entry.o.early_start) + ' \u2192 ' + fmtDate(entry.o.early_end) + '<br>Float: ' + of_ + '<extra></extra>',
          });
        }
      }

      plotDark('chart-gantt', traces, {
        xaxis: { type: 'date', color: '#8899bb', gridcolor: '#2a3050' },
        yaxis: {
          tickvals: displayed.map(function (d, idx) { return idx; }),
          ticktext: yLabels,
          autorange: 'reversed', color: '#e2e8f0', tickfont: { size: 10 },
        },
        margin: { l: 350, r: 30, t: 10, b: 50 },
        height: Math.max(300, displayed.length * 32 + 60),
        legend: { font: { color: '#8899bb' }, orientation: 'h', y: 1.02 },
        hovermode: 'closest',
      });

    } else {
      // Single scenario stair-step
      var path = scenario === 'baseline' ? bPath : oPath;
      var displayed2 = path.slice(0, maxShow);
      if (!displayed2.length) {
        plotDark('chart-gantt', [], { height: 100, annotations: [{ text: 'No critical path activities found', xref: 'paper', yref: 'paper', x: 0.5, y: 0.5, showarrow: false, font: { color: '#8899bb', size: 14 } }] });
        return;
      }

      var barColor = scenario === 'baseline' ? 'rgba(79,142,247,0.85)' : 'rgba(34,211,168,0.85)';
      var connColor = scenario === 'baseline' ? 'rgba(79,142,247,0.25)' : 'rgba(34,211,168,0.25)';

      for (var si = 0; si < displayed2.length; si++) {
        var st = displayed2[si];
        var sLabel = st.task_name.length > 42 ? st.task_name.substring(0, 42) + '\u2026' : st.task_name;
        var sBlock = st.blockNotation || st.blockNum || '';
        yLabels.push(sBlock ? sLabel + ' [' + sBlock + ']' : sLabel);

        var stStart = st._displayStart || st.early_start;
        var sfloat = st.cpmFloatDays != null ? st.cpmFloatDays.toFixed(1) + 'd' : '\u2014';
        traces.push({
          type: 'scatter', mode: 'lines',
          x: [stStart, st.early_end], y: [si, si],
          line: { color: barColor, width: 16 },
          showlegend: false,
          hovertemplate: '<b>' + st.task_name.substring(0, 50) + '</b><br>' + fmtDate(st.early_start) + ' \u2192 ' + fmtDate(st.early_end) + '<br>Float: ' + sfloat + '<extra></extra>',
        });

        if (si < displayed2.length - 1) {
          var nxt = displayed2[si + 1];
          var nxtStart = nxt._displayStart || nxt.early_start;
          traces.push({
            type: 'scatter', mode: 'lines',
            x: [st.early_end, nxtStart, nxtStart],
            y: [si, si, si + 1],
            line: { color: connColor, width: 1, dash: 'dot' },
            showlegend: false, hoverinfo: 'skip',
          });
        }
      }

      plotDark('chart-gantt', traces, {
        xaxis: { type: 'date', color: '#8899bb', gridcolor: '#2a3050' },
        yaxis: {
          tickvals: displayed2.map(function (d, idx) { return idx; }),
          ticktext: yLabels,
          autorange: 'reversed', color: '#e2e8f0', tickfont: { size: 10 },
        },
        margin: { l: 350, r: 30, t: 10, b: 50 },
        height: Math.max(300, displayed2.length * 30 + 60),
        hovermode: 'closest',
      });
    }
  }

  function renderPathSummary(bPath, oPath, scenario) {
    var el = document.getElementById('cp-path-summary');
    if (!el) return;

    function summarize(path, label) {
      if (!path.length) return '<div style="color:var(--text-muted);font-size:12px">' + label + ': no critical activities found</div>';
      var first = path[0], last = path[path.length - 1];
      var durDays = last.early_end && first.early_start
        ? Math.round((last.early_end - first.early_start) / MS_PER_DAY)
        : '\u2014';
      return '<div class="cp-summary-row">' +
        '<span class="cp-summary-label">' + label + ':</span> ' +
        '<span>' + path.length + ' tasks</span>' +
        '<span class="cp-summary-sep">\u00B7</span>' +
        '<span>' + durDays + ' calendar days</span>' +
        '<span class="cp-summary-sep">\u00B7</span>' +
        '<span>Start: ' + fmtDate(first.early_start) + '</span>' +
        '<span class="cp-summary-sep">\u00B7</span>' +
        '<span>End: ' + fmtDate(last.early_end) + '</span>' +
      '</div>';
    }

    var html = '';
    if (scenario === 'both' || scenario === 'baseline') html += summarize(bPath, 'Baseline');
    if (scenario === 'both' || scenario === 'optimized') html += summarize(oPath, 'Optimized');

    el.style.display = html ? '' : 'none';
    el.innerHTML = html;
  }

  function renderDiagnostics(R) {
    var el = document.getElementById('cp-diag-content');
    var wrap = document.getElementById('cp-diagnostics');
    if (!el || !wrap) return;

    var bDiag = R.baseline.cpmResult ? R.baseline.cpmResult.diagnostics : null;
    var oDiag = R.optimized.cpmResult ? R.optimized.cpmResult.diagnostics : null;

    var html = '';
    if (bDiag && bDiag.notes.length > 0) {
      html += '<div class="cp-diag-section"><strong>Baseline:</strong><ul>';
      for (var i = 0; i < bDiag.notes.length; i++) html += '<li>' + bDiag.notes[i] + '</li>';
      html += '</ul></div>';
    }
    if (oDiag && oDiag.notes.length > 0) {
      html += '<div class="cp-diag-section"><strong>Optimized:</strong><ul>';
      for (var j = 0; j < oDiag.notes.length; j++) html += '<li>' + oDiag.notes[j] + '</li>';
      html += '</ul></div>';
    }

    if (!html) {
      html = '<div style="color:var(--text-muted);font-size:12px">Both methods computed \u2014 no divergence notes available.</div>';
    }

    el.innerHTML = html;
  }

  function renderCPTable(bPath, oPath, scenario) {
    var body = document.getElementById('cp-table-body');
    var footer = document.getElementById('cp-table-footer');
    if (!body) return;

    var path;
    if (scenario === 'optimized') path = oPath;
    else if (scenario === 'baseline') path = bPath;
    else path = oPath.length ? oPath : bPath;

    var label = scenario === 'baseline' ? 'Baseline' : scenario === 'optimized' ? 'Optimized' : (oPath.length ? 'Optimized' : 'Baseline');
    var subEl = document.getElementById('cp-table-sub');
    if (subEl) subEl.textContent = label + ' \u2014 ' + (_cpMethod === 'longest-path' ? 'driving chain' : 'zero-float') + ' activities';

    var maxShow = 100;
    var shown = path.slice(0, maxShow);

    body.innerHTML = shown.map(function (t) {
      var tf = t.cpmTotalFloat != null ? t.cpmTotalFloat.toFixed(1) + 'd' : (t.cpmFloatDays != null ? t.cpmFloatDays.toFixed(1) + 'd' : '\u2014');
      var ff = t.cpmFreeFloat != null ? t.cpmFreeFloat.toFixed(1) + 'd' : '\u2014';
      var durDays = t.calDurationMs ? (t.calDurationMs / 86400000).toFixed(1) + 'd' : '\u2014';
      var driverName = '\u2014';
      if (t.drivingPredId && _cpCache) {
        var sched = scenario === 'baseline' ? _cpCache.baseline : _cpCache.optimized;
        var driverTask = sched.taskById[t.drivingPredId];
        if (driverTask) driverName = driverTask.task_name.length > 35 ? driverTask.task_name.substring(0, 35) + '\u2026' : driverTask.task_name;
      }
      var tfClass = '';
      if (t.cpmTotalFloat != null) {
        if (t.cpmTotalFloat <= 0) tfClass = ' class="badge badge-crit"';
        else if (t.cpmTotalFloat <= 10) tfClass = ' class="badge badge-pos"';
      }
      return '<tr>' +
        '<td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + t.task_name + '">' + t.task_name + '</td>' +
        '<td>' + (t.blockNotation || t.blockNum || '\u2014') + '</td>' +
        '<td style="white-space:nowrap">' + fmtDate(t.early_start) + '</td>' +
        '<td style="white-space:nowrap">' + fmtDate(t.early_end) + '</td>' +
        '<td>' + durDays + '</td>' +
        '<td><span' + tfClass + '>' + tf + '</span></td>' +
        '<td>' + ff + '</td>' +
        '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--text-muted)" title="' + (driverName !== '\u2014' ? driverName : '') + '">' + driverName + '</td>' +
      '</tr>';
    }).join('');

    if (footer) {
      footer.textContent = 'Showing ' + shown.length + ' of ' + path.length + ' ' + label.toLowerCase() + ' activities';
    }
  }

  var MS_PER_DAY = 86400000;

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

  ATT.filterByTactic = function (tacticName) {
    ATT.switchTab('workfronts');
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
