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

  // ── EPC Actions (crew-based buckets) ──
  function renderEPCActions(R) {
    var buckets = R.epcActions, totalGainDays = R.totalGainDays, usingMC = R.usingMC;
    if (!buckets || !buckets.length) return;
    var sub = document.getElementById('epc-actions-sub');
    if (sub) sub.textContent = 'Crew-by-crew breakdown of schedule levers \u2014 ' + totalGainDays + '-day ' + (usingMC ? 'MC ' : '') + 'acceleration';
    var list = document.getElementById('epc-actions-list');
    if (!list) return;

    list.innerHTML = buckets.map(function (b, idx) {
      var shiftDir = b.peakShiftDays > 0 ? 'earlier' : (b.peakShiftDays < 0 ? 'later' : 'unchanged');
      var shiftCls = b.peakShiftDays > 0 ? 'epc-shift-pos' : (b.peakShiftDays < 0 ? 'epc-shift-neg' : '');
      var shiftText = b.peakShiftDays !== 0
        ? '<span class="' + shiftCls + '">' + Math.abs(b.peakShiftDays) + 'd ' + shiftDir + '</span>'
        : '<span style="color:var(--text-muted)">no shift</span>';

      var peakLine = '';
      if (b.bPeakDate && b.oPeakDate) {
        peakLine = '<div class="crew-peak-line">' +
          '<span>Peak: <strong>' + b.bPeakCount + '</strong> workers on ' + fmtDate(b.bPeakDate) + ' \u2192 <strong>' + b.oPeakCount + '</strong> workers on ' + fmtDate(b.oPeakDate) + '</span>' +
          '<span class="crew-peak-shift">' + shiftText + '</span>' +
        '</div>';
      }

      var leverCount = b.levers.length;
      var leverSummary = leverCount > 0
        ? '<div class="crew-lever-summary">' + leverCount + ' lever' + (leverCount !== 1 ? 's' : '') + ' identified: ' +
          b.levers.map(function (lv) { return lv.label; }).join(', ') + '</div>'
        : '<div class="crew-lever-summary" style="color:var(--text-dim)">No schedule levers detected for this crew</div>';

      var leversHtml = b.levers.map(function (lv, li) {
        var uid = 'lever-' + idx + '-' + li;
        var detailHtml = renderLeverDetail(lv);
        return '<div class="epc-lever">' +
          '<div class="epc-lever-header" onclick="ATT.toggleLever(\'' + uid + '\')">' +
            '<span class="epc-lever-arrow" id="arrow-' + uid + '">\u25B6</span>' +
            '<span class="epc-lever-name">' + lv.label + '</span>' +
            '<span class="epc-lever-count">' + lv.count + '</span>' +
            '<span class="epc-lever-summary-text">' + lv.summary + '</span>' +
          '</div>' +
          '<div class="epc-lever-detail" id="' + uid + '" style="display:none">' + detailHtml + '</div>' +
        '</div>';
      }).join('');

      return '<div class="epc-action-card crew-bucket">' +
        '<div class="epc-card-header">' +
          '<div class="epc-num">' + (idx + 1) + '</div>' +
          '<div class="epc-title">' + b.crewName + '</div>' +
          '<span class="crew-task-count">' + b.taskCount + ' tasks</span>' +
        '</div>' +
        '<div class="epc-body">' +
          peakLine +
          leverSummary +
          (leversHtml ? '<div class="epc-levers-wrap">' + leversHtml + '</div>' : '') +
        '</div>' +
      '</div>';
    }).join('');
  }

  function renderLeverDetail(lever) {
    if (lever.type === 'resequencing') {
      return '<div class="lever-path-compare">' +
        '<div class="lever-path-row"><span class="lever-path-label">Baseline:</span> <span>' + (lever.baselinePath || '\u2014') + '</span></div>' +
        '<div class="lever-path-row"><span class="lever-path-label">Optimized:</span> <span>' + (lever.optimizedPath || '\u2014') + '</span></div>' +
        (lever.changed ? '<div class="lever-reseq-flag">\u26A0 Installation order changed between scenarios</div>' : '<div style="color:var(--text-dim);font-size:11px;margin-top:6px">Same progression order in both scenarios</div>') +
      '</div>';
    }

    if (lever.type === 'execution_path' && lever.details) {
      return lever.details.map(function (d) {
        var predHtml = d.predComparison.map(function (p) {
          var cls = 'pred-' + p.status;
          var label = p.status === 'same' ? '' : (p.status === 'deleted' ? ' (removed)' : ' (new)');
          return '<span class="' + cls + '">' + p.name + label + '</span>';
        }).join('');
        return '<div class="lever-ep-task">' +
          '<div class="lever-ep-task-name">' + d.taskName + (d.block ? ' <span class="lever-ep-block">(' + d.block + ')</span>' : '') +
            ' <span class="lever-ep-shift">' + (d.finishShift < 0 ? '\u25B2' : '\u25BC') + ' ' + Math.abs(d.finishShift).toFixed(0) + 'd</span></div>' +
          '<div class="lever-ep-preds">Predecessors: ' + (predHtml || '<span style="color:var(--text-dim)">none</span>') + '</div>' +
        '</div>';
      }).join('');
    }

    if (lever.type === 'parallel' && lever.details) {
      return '<div class="lever-detail-list">' +
        lever.details.map(function (d) {
          return '<div class="lever-detail-row">' +
            '<span class="lever-task-label">' + d.taskName + (d.block ? ' (' + d.block + ')' : '') + '</span>' +
            ' \u2014 run parallel with <em>' + d.predName + '</em>, finish ' + d.finishShift + 'd earlier' +
            ' <span style="color:var(--text-dim)">(' + d.bEnd + ' \u2192 ' + d.oEnd + ')</span>' +
          '</div>';
        }).join('') +
      '</div>';
    }

    if (lever.type === 'duration' && lever.details) {
      return '<div class="epc-crew-table"><table>' +
        '<thead><tr><th>Activity</th><th>Block</th><th>Base Crew</th><th>Opt Crew</th><th>Base Dur</th><th>Opt Dur</th><th>Saved</th></tr></thead><tbody>' +
        lever.details.map(function (d) {
          return '<tr><td>' + d.taskName + '</td><td>' + (d.block || '\u2014') + '</td>' +
            '<td>' + d.bCrew + '</td><td>' + d.oCrew + '</td>' +
            '<td>' + d.bDur + 'd</td><td>' + d.oDur + 'd</td>' +
            '<td class="epc-shift-pos">\u2212' + d.saved + 'd</td></tr>';
        }).join('') +
      '</tbody></table></div>';
    }

    if (lever.type === 'handoff' && lever.details) {
      return '<div class="epc-crew-table"><table>' +
        '<thead><tr><th>Activity</th><th>Block</th><th>Predecessor</th><th>Base Gap</th><th>Opt Gap</th><th>Saved</th></tr></thead><tbody>' +
        lever.details.map(function (d) {
          return '<tr><td>' + d.taskName + '</td><td>' + (d.block || '\u2014') + '</td>' +
            '<td>' + d.predName + '</td>' +
            '<td>' + (d.bGap !== null ? d.bGap + 'd' : '\u2014') + '</td>' +
            '<td>' + (d.oGap !== null ? d.oGap + 'd' : '\u2014') + '</td>' +
            '<td class="epc-shift-pos">\u2212' + d.saved + 'd</td></tr>';
        }).join('') +
      '</tbody></table></div>';
    }

    return '<div style="color:var(--text-dim);font-size:12px;padding:6px 0">No additional detail available</div>';
  }

  ATT.toggleLever = function (uid) {
    var el = document.getElementById(uid);
    var arrow = document.getElementById('arrow-' + uid);
    if (!el) return;
    var open = el.style.display !== 'none';
    el.style.display = open ? 'none' : '';
    if (arrow) arrow.textContent = open ? '\u25B6' : '\u25BC';
  };

  // ── Workfront Sequences ──
  var _wfCache = null;

  function renderWorkfrontSequences(R) {
    var baseline = R.baseline, optimized = R.optimized;

    var rawTasks = [];

    function collectTasks(sched, tag) {
      var tasks = Object.values(sched.taskById);
      for (var i = 0; i < tasks.length; i++) {
        var t = tasks[i];
        if (!t.early_start || !t.early_end) continue;
        var comm = t.commodity;
        if (comm === 'Other' || comm === 'Milestones') continue;
        rawTasks.push({
          commodity: comm,
          taskName: t.task_name,
          blockNum: t.blockNum || '',
          area: t.area || '',
          subArea: t.subArea || '',
          blockNotation: t.blockNotation || '',
          start: t.early_start,
          end: t.early_end,
          tag: tag,
        });
      }
    }

    collectTasks(baseline, 'baseline');
    collectTasks(optimized, 'optimized');

    var commodityNames = {};
    rawTasks.forEach(function (t) { commodityNames[t.commodity] = true; });
    var commList = Object.keys(commodityNames).sort();

    _wfSelectedTrades = {};
    commList.forEach(function (c) { _wfSelectedTrades[c] = true; });

    var dd = document.getElementById('wf-multi-dropdown');
    if (dd) {
      var html = '<label class="wf-multi-item" data-val="__all__">' +
        '<input type="checkbox" checked onchange="ATT.toggleAllTrades(this.checked)"> <span>Select All</span></label>' +
        '<div class="wf-multi-divider"></div>';
      commList.forEach(function (c) {
        html += '<label class="wf-multi-item" data-val="' + c + '">' +
          '<input type="checkbox" checked onchange="ATT.toggleTrade(\'' + c.replace(/'/g, "\\'") + '\', this.checked)"> <span>' + c + '</span></label>';
      });
      dd.innerHTML = html;
    }
    _wfUpdateBtnLabel();

    _wfCache = { rawTasks: rawTasks, commodityNames: commList };
    ATT.updateWorkfrontChart();
  }

  var _wfSelectedTrades = {};

  function _wfUpdateBtnLabel() {
    var btn = document.getElementById('wf-multi-btn');
    if (!btn || !_wfCache) return;
    var all = _wfCache.commodityNames;
    var selected = all.filter(function (c) { return _wfSelectedTrades[c]; });
    if (selected.length === 0) {
      btn.textContent = 'None selected \u25BE';
    } else if (selected.length === all.length) {
      btn.textContent = 'All Trades (' + all.length + ') \u25BE';
    } else if (selected.length <= 2) {
      btn.textContent = selected.join(', ') + ' \u25BE';
    } else {
      btn.textContent = selected.length + ' trades selected \u25BE';
    }
  }

  ATT.toggleTradeDropdown = function () {
    var dd = document.getElementById('wf-multi-dropdown');
    if (dd) dd.classList.toggle('open');
  };

  document.addEventListener('click', function (e) {
    var wrap = document.getElementById('wf-commodity-multi');
    var dd = document.getElementById('wf-multi-dropdown');
    if (dd && wrap && !wrap.contains(e.target)) dd.classList.remove('open');
  });

  ATT.toggleAllTrades = function (checked) {
    if (!_wfCache) return;
    _wfCache.commodityNames.forEach(function (c) { _wfSelectedTrades[c] = checked; });
    var dd = document.getElementById('wf-multi-dropdown');
    if (dd) {
      dd.querySelectorAll('input[type="checkbox"]').forEach(function (cb) { cb.checked = checked; });
    }
    _wfUpdateBtnLabel();
    ATT.updateWorkfrontChart();
  };

  ATT.toggleTrade = function (trade, checked) {
    _wfSelectedTrades[trade] = checked;
    var dd = document.getElementById('wf-multi-dropdown');
    if (dd && _wfCache) {
      var allCb = dd.querySelector('[data-val="__all__"] input');
      if (allCb) {
        var allChecked = _wfCache.commodityNames.every(function (c) { return _wfSelectedTrades[c]; });
        allCb.checked = allChecked;
      }
    }
    _wfUpdateBtnLabel();
    ATT.updateWorkfrontChart();
  };

  function wfGroupKey(t, level) {
    if (level === 'block') return t.blockNum || '(none)';
    if (level === 'area') {
      if (t.blockNum && t.area) return t.blockNum + '.' + t.area;
      return t.blockNum || '(none)';
    }
    if (level === 'task') return t.taskName || '(unnamed)';
    return t.blockNotation || (t.blockNum ? t.blockNum + (t.area ? '.' + t.area : '') + (t.subArea ? '.' + t.subArea : '') : '(none)');
  }

  ATT.updateWorkfrontChart = function () {
    if (!_wfCache) return;
    var selScen = document.getElementById('wf-scenario-filter');
    var selLevel = document.getElementById('wf-level-filter');
    var chosenScen = selScen ? selScen.value : 'both';
    var chosenLevel = selLevel ? selLevel.value : 'subarea';
    var MS_PER_DAY = 86400000;

    var allComms = _wfCache.commodityNames;
    var selectedComms = allComms.filter(function (c) { return _wfSelectedTrades[c]; });
    var isAllSelected = selectedComms.length === allComms.length;
    var isSingleTrade = selectedComms.length === 1;

    var filtered = _wfCache.rawTasks.filter(function (t) { return _wfSelectedTrades[t.commodity]; });
    if (chosenLevel !== 'task') {
      filtered = filtered.filter(function (t) { return t.blockNum || t.blockNotation; });
    }

    var grouped = {};
    for (var i = 0; i < filtered.length; i++) {
      var t = filtered[i];
      var comm = t.commodity;
      var key = wfGroupKey(t, chosenLevel);
      var gk = (!isSingleTrade ? comm + ' \u2014 ' : '') + key;

      if (!grouped[gk]) grouped[gk] = { commodity: comm, key: key, baseline: null, optimized: null };
      var cur = grouped[gk][t.tag];
      if (!cur || t.start < cur.start) {
        grouped[gk][t.tag] = {
          start: t.start,
          end: cur ? (t.end > cur.end ? t.end : cur.end) : t.end,
          taskCount: cur ? cur.taskCount + 1 : 1,
        };
      } else {
        if (t.end > cur.end) cur.end = t.end;
        cur.taskCount++;
      }
    }

    var rows = Object.keys(grouped).map(function (gk) {
      var g = grouped[gk];
      var earliest = g.baseline ? g.baseline.start : (g.optimized ? g.optimized.start : new Date());
      if (g.optimized && g.optimized.start < earliest) earliest = g.optimized.start;
      return {
        label: gk,
        commodity: g.commodity,
        block: g.key,
        baseline: g.baseline,
        optimized: g.optimized,
        earliest: earliest,
      };
    });
    rows.sort(function (a, b) { return a.earliest - b.earliest; });
    for (var ri = 0; ri < rows.length; ri++) rows[ri].seq = ri + 1;

    var showB = chosenScen === 'both' || chosenScen === 'baseline';
    var showO = chosenScen === 'both' || chosenScen === 'optimized';
    rows = rows.filter(function (r) {
      return (showB && r.baseline) || (showO && r.optimized);
    });

    var levelLabels = { block: 'Block', area: 'Area', subarea: 'Sub-area', task: 'Task' };
    var titleEl = document.getElementById('wf-chart-title');
    var subEl = document.getElementById('wf-chart-sub');
    var lvlName = levelLabels[chosenLevel] || 'Sub-area';
    var tradeLabel = isSingleTrade ? selectedComms[0] : (selectedComms.length + ' Trades');
    if (titleEl) titleEl.textContent = tradeLabel + ' \u2014 ' + lvlName + ' Progression';
    if (subEl) subEl.textContent = 'Rows ordered by earliest activity start \u2014 bars show work windows (' + lvlName + ' level)';

    var totalRows = rows.length;
    var MAX_ROWS = chosenLevel === 'task' ? 500 : 200;
    var truncated = false;
    if (rows.length > MAX_ROWS) {
      truncated = true;
      rows = rows.slice(0, MAX_ROWS);
    }

    var LABEL_MAX = chosenLevel === 'task' ? 50 : 80;
    var yLabels = rows.map(function (r) {
      var lbl = r.label;
      return lbl.length > LABEL_MAX ? lbl.substring(0, LABEL_MAX) + '\u2026' : lbl;
    });
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
    var leftMargin = Math.min(420, Math.max(100, maxLabelLen * 6.5 + 20));
    var ROW_H = chosenLevel === 'task' ? 26 : 40;
    var fontSize = chosenLevel === 'task' ? 9 : 11;
    var lineW_b = chosenLevel === 'task' ? (bothScenarios ? 12 : 16) : bLineW;
    var lineW_o = chosenLevel === 'task' ? (bothScenarios ? 6 : 16) : oLineW;
    var chartH = Math.max(300, rows.length * ROW_H + 80);

    if (traces.length > 0 && traces[0].name === 'Baseline') traces[0].line.width = lineW_b;
    if (traces.length > 1 && traces[1].name === 'Optimized') traces[1].line.width = lineW_o;
    if (traces.length === 1 && traces[0].name === 'Optimized') traces[0].line.width = lineW_o;

    var wrapEl = document.getElementById('chart-workfront-wrap');
    if (wrapEl) wrapEl.style.maxHeight = Math.min(chartH, 700) + 'px';

    plotDark('chart-workfront', traces, {
      xaxis: { type: 'date', color: '#8899bb', gridcolor: '#2a3050', automargin: true },
      yaxis: {
        categoryorder: 'array', categoryarray: yLabels.slice().reverse(),
        color: '#e2e8f0', tickfont: { size: fontSize }, automargin: true,
      },
      margin: { l: leftMargin, r: 30, t: 10, b: 50 },
      height: chartH,
      hovermode: 'closest',
      legend: { font: { color: '#8899bb' }, orientation: 'h', y: 1.05 },
    });

    var footerEl = document.getElementById('wf-chart-sub');
    if (truncated && footerEl) {
      footerEl.textContent += ' (showing first ' + MAX_ROWS + ' of ' + totalRows + ' rows)';
    }

    renderWorkfrontSummary(rows, isSingleTrade ? selectedComms[0] : null, chosenScen, chosenLevel, MS_PER_DAY);
  };

  function renderWorkfrontSummary(rows, singleComm, scenario, level, MS_PER_DAY) {
    var el = document.getElementById('wf-sequence-summary');
    if (!el) return;

    if (!singleComm || rows.length === 0 || level === 'task') {
      el.style.display = 'none';
      return;
    }

    var unitName = level === 'block' ? 'blocks' : level === 'area' ? 'areas' : 'sub-areas';

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

    var html = '<div style="font-size:13px;font-weight:700;margin-bottom:8px">' + singleComm + ' Progression Order</div>';
    if (scenario === 'both' || scenario === 'baseline') {
      html += '<div class="cp-summary-row"><span class="cp-summary-label">Baseline:</span> <span>' + (bSeqStr || '\u2014') + '</span> <span style="color:var(--text-dim);margin-left:8px">(' + seqB.length + ' ' + unitName + ')</span></div>';
    }
    if (scenario === 'both' || scenario === 'optimized') {
      html += '<div class="cp-summary-row"><span class="cp-summary-label">Optimized:</span> <span>' + (oSeqStr || '\u2014') + '</span> <span style="color:var(--text-dim);margin-left:8px">(' + seqO.length + ' ' + unitName + ')</span></div>';
    }
    if (scenario === 'both' && resequenced) {
      html += '<div style="margin-top:8px;padding:8px 12px;background:rgba(245,158,11,.07);border-radius:6px;border:1px solid rgba(245,158,11,.2);font-size:12px;color:#f59e0b">' +
        '\u26A0 Progression order changed between scenarios \u2014 workfront resequencing detected</div>';
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

    var summaryEl = document.getElementById('crew-ramp-summary');
    if (!summaryEl) return;

    var buckets = R.epcActions || [];
    var shifted = buckets.filter(function (b) { return b.peakShiftDays !== 0 && b.bPeakDate && b.oPeakDate; });
    if (shifted.length === 0) { summaryEl.style.display = 'none'; return; }

    summaryEl.style.display = '';
    var tableHtml = '<div class="epc-crew-table"><table>' +
      '<thead><tr><th>Crew</th><th>Baseline Crew #</th><th>Baseline Peak</th><th>Optimized Crew #</th><th>Optimized Peak</th><th>Shift</th></tr></thead><tbody>' +
      shifted.sort(function (a, b) { return Math.abs(b.peakShiftDays) - Math.abs(a.peakShiftDays); }).map(function (b) {
        var dir = b.peakShiftDays > 0 ? 'earlier' : 'later';
        var cls = b.peakShiftDays > 0 ? 'epc-shift-pos' : 'epc-shift-neg';
        return '<tr><td>' + b.crewName + '</td>' +
          '<td>' + b.bPeakCount + '</td>' +
          '<td>' + fmtDate(b.bPeakDate) + '</td>' +
          '<td>' + b.oPeakCount + '</td>' +
          '<td>' + fmtDate(b.oPeakDate) + '</td>' +
          '<td class="' + cls + '">' + Math.abs(b.peakShiftDays) + 'd ' + dir + '</td></tr>';
      }).join('') +
      '</tbody></table></div>';

    summaryEl.innerHTML =
      '<div class="epc-action-card crew-bucket" style="margin-top:16px">' +
        '<div class="epc-card-header">' +
          '<div class="epc-num">\u{1F477}</div>' +
          '<div class="epc-title">Crew Peak Shifts Summary</div>' +
          '<span class="crew-task-count">' + shifted.length + ' crews</span>' +
        '</div>' +
        '<div class="epc-body">' + tableHtml + '</div>' +
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
