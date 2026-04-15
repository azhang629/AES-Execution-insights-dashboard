(function (ATT) {
  'use strict';

  window.APP = {
    baselineFile: null, optimizedFile: null,
    baselineText: null, optimizedText: null,
    crewBaselineFile: null, crewOptimizedFile: null,
    crewBaselineText: null, crewOptimizedText: null,
    results: null,
  };

  window.onerror = function (msg, src, line) {
    var el = document.getElementById('upload-error');
    if (el) { el.style.display = 'block'; el.innerHTML += '<div>JS Error (line ' + line + '): ' + msg + '</div>'; }
    return false;
  };

  // ── File reading ──
  function readFile(file, which) {
    var statusEl = document.getElementById('fn-' + which);
    var card = document.getElementById('card-' + which);
    statusEl.textContent = 'Reading ' + file.name;
    statusEl.className = 'ub-status';
    var reader = new FileReader();
    reader.onload = function (e) {
      APP[which + 'File'] = file;
      APP[which + 'Text'] = e.target.result;
      statusEl.textContent = '\u2713 ' + file.name;
      statusEl.className = 'ub-status ok';
      card.classList.add('loaded');
      document.getElementById('btn-analyze').disabled = !(APP.baselineText && APP.optimizedText);
    };
    reader.onerror = function () {
      statusEl.textContent = 'Error reading file';
      statusEl.className = 'ub-status err';
    };
    reader.readAsText(file);
  }

  // ── Wire upload buttons ──
  document.getElementById('btn-pick-baseline').addEventListener('click', function () {
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.csv';
    inp.onchange = function () { if (inp.files && inp.files[0]) readFile(inp.files[0], 'baseline'); };
    inp.click();
  });
  document.getElementById('btn-pick-optimized').addEventListener('click', function () {
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.csv';
    inp.onchange = function () { if (inp.files && inp.files[0]) readFile(inp.files[0], 'optimized'); };
    inp.click();
  });
  document.getElementById('btn-pick-crewBaseline').addEventListener('click', function () {
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.csv';
    inp.onchange = function () { if (inp.files && inp.files[0]) readFile(inp.files[0], 'crewBaseline'); };
    inp.click();
  });
  document.getElementById('btn-pick-crewOptimized').addEventListener('click', function () {
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.csv';
    inp.onchange = function () { if (inp.files && inp.files[0]) readFile(inp.files[0], 'crewOptimized'); };
    inp.click();
  });

  // ── Drop zone ──
  (function () {
    var dz = document.getElementById('dropzone');
    document.addEventListener('dragover', function (e) { e.preventDefault(); });
    document.addEventListener('drop', function (e) { e.preventDefault(); });
    dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('drag-active'); });
    dz.addEventListener('dragleave', function (e) { if (!dz.contains(e.relatedTarget)) dz.classList.remove('drag-active'); });
    dz.addEventListener('drop', function (e) {
      e.preventDefault(); dz.classList.remove('drag-active');
      var files = e.dataTransfer.files;
      if (!files || files.length === 0) return;
      if (files.length >= 2) { readFile(files[0], 'baseline'); readFile(files[1], 'optimized'); }
      else { readFile(files[0], APP.baselineText ? 'optimized' : 'baseline'); }
    });
  })();

  // ── Loading helpers ──
  function setLoadingStage(text, pct) {
    document.getElementById('loading-stage').textContent = text;
    document.getElementById('loading-bar').style.width = pct + '%';
  }

  // ── Analysis runner ──
  ATT.runAnalysis = async function () {
    document.getElementById('upload-screen').style.display = 'none';
    document.getElementById('loading-screen').style.display = 'flex';

    await ATT.sleep(50);
    setLoadingStage('Parsing baseline CSV\u2026', 10);
    await ATT.sleep(30);

    var baselineRows = ATT.parseCSVText(APP.baselineText);
    setLoadingStage('Parsing optimized CSV\u2026', 25);
    await ATT.sleep(30);

    var optimizedRows = ATT.parseCSVText(APP.optimizedText);

    // Parse crew CSVs if provided
    var bCrewData = null, oCrewData = null;
    if (APP.crewBaselineText) {
      setLoadingStage('Parsing baseline crew data\u2026', 32);
      await ATT.sleep(20);
      bCrewData = ATT.parseCrewCSV(APP.crewBaselineText);
    }
    if (APP.crewOptimizedText) {
      setLoadingStage('Parsing optimized crew data\u2026', 36);
      await ATT.sleep(20);
      oCrewData = ATT.parseCrewCSV(APP.crewOptimizedText);
    }

    setLoadingStage('Building schedule models\u2026', 40);
    await ATT.sleep(30);

    var baseline  = ATT.buildScheduleFromCSV(baselineRows,  APP.baselineFile ? APP.baselineFile.name : 'Baseline');
    var optimized = ATT.buildScheduleFromCSV(optimizedRows, APP.optimizedFile ? APP.optimizedFile.name : 'Optimized');

    setLoadingStage('Matching activities\u2026', 55);
    await ATT.sleep(30);

    var matchResult = ATT.matchSchedules(baseline, optimized);

    setLoadingStage('Computing differences\u2026', 65);
    await ATT.sleep(30);

    var diffs = matchResult.matched.map(function (m) { return ATT.computeDiff(m, baseline, optimized); });

    setLoadingStage('Detecting area-level patterns\u2026', 72);
    await ATT.sleep(20);

    var constraintBlocks = ATT.detectAreaConstraints(diffs);

    setLoadingStage('Classifying tactics\u2026', 78);
    await ATT.sleep(30);

    var classifiedDiffs = diffs.map(function (d) {
      return Object.assign({}, d, { tactics: ATT.classifyTactics(d, constraintBlocks) });
    });

    setLoadingStage('Aggregating impacts\u2026', 88);
    await ATT.sleep(30);

    var bMCDate    = baseline.mcDate    || null;
    var oMCDate    = optimized.mcDate   || null;
    var bCODDate   = baseline.codDate   || null;
    var oCODDate   = optimized.codDate  || null;
    var bSubstDate = baseline.substDate || baseline.projectEnd;
    var oSubstDate = optimized.substDate || optimized.projectEnd;
    var bEndDate   = bSubstDate;
    var oEndDate   = oSubstDate;

    var mcWarning = null;
    if (!bMCDate && !oMCDate) {
      mcWarning = 'Mechanical Completion milestone not found in either file. Looked for task names containing "Mechanical Completion". Falling back to latest project end dates.';
    } else if (!bMCDate) {
      mcWarning = 'Mechanical Completion milestone not found in the baseline CSV. Ensure the baseline export includes the MC milestone task.';
    } else if (!oMCDate) {
      mcWarning = 'Mechanical Completion milestone not found in the optimized CSV. Ensure the optimized export includes the MC milestone task.';
    }

    var usingMC = !!(bMCDate && oMCDate);
    var bCompDate, oCompDate;
    if (usingMC) {
      bCompDate = bMCDate;
      oCompDate = oMCDate;
    } else {
      bCompDate = bMCDate || bEndDate;
      oCompDate = oMCDate || oEndDate;
    }
    var totalGainDays = bCompDate && oCompDate ? Math.round(ATT.dateDiffDays(oCompDate, bCompDate)) : 0;

    var aggregations = ATT.aggregate(classifiedDiffs, Math.max(totalGainDays, 1));
    var insights     = ATT.generateInsights(aggregations, classifiedDiffs, totalGainDays);
    var requirements = ATT.generateRequirements(aggregations, classifiedDiffs, totalGainDays);

    var partialR = {
      totalGainDays: totalGainDays, usingMC: usingMC,
      bMCDate: bMCDate, oMCDate: oMCDate, bCODDate: bCODDate, oCODDate: oCODDate,
      bSubstDate: bSubstDate, oSubstDate: oSubstDate, mcWarning: mcWarning,
      bCrewData: bCrewData, oCrewData: oCrewData,
    };
    var epcActions = ATT.generateEPCActions(aggregations, classifiedDiffs, partialR);

    setLoadingStage('Building dashboard\u2026', 95);
    await ATT.sleep(50);

    APP.results = {
      baseline: baseline, optimized: optimized,
      matched: matchResult.matched, onlyB: matchResult.onlyB, onlyO: matchResult.onlyO,
      diffs: classifiedDiffs,
      aggregations: aggregations, insights: insights, requirements: requirements, epcActions: epcActions,
      totalGainDays: totalGainDays, usingMC: usingMC, mcWarning: mcWarning,
      bMCDate: bMCDate, oMCDate: oMCDate, bCODDate: bCODDate, oCODDate: oCODDate,
      bSubstDate: bSubstDate, oSubstDate: oSubstDate, bEndDate: bEndDate, oEndDate: oEndDate,
      matchCount: matchResult.matched.length,
      changedCount: classifiedDiffs.filter(function (d) { return Math.abs(d.finishVar) > 0.5; }).length,
      bCrewData: bCrewData, oCrewData: oCrewData,
    };

    ATT.renderDashboard(APP.results);

    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    document.getElementById('header-project').innerHTML = '<b>' + baseline.projectName + '</b>';
    if (usingMC) {
      document.getElementById('gain-badge').textContent = totalGainDays + 'd MC acceleration';
    } else if (bMCDate || oMCDate) {
      document.getElementById('gain-badge').textContent = totalGainDays + 'd (MC partial)';
    } else {
      document.getElementById('gain-badge').textContent = totalGainDays + ' days saved';
    }
    document.getElementById('ti-tactics').textContent = Object.keys(aggregations.byTactic).length;

    if (mcWarning) {
      var warnEl = document.getElementById('mc-warning');
      if (warnEl) { warnEl.style.display = 'block'; warnEl.textContent = mcWarning; }
    }
  };

  // ── Tab navigation ──
  ATT.switchTab = function (name) {
    document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('active'); });
    document.querySelectorAll('.tab-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === name);
    });
    var panel = document.getElementById('tab-' + name);
    if (panel) panel.classList.add('active');
    setTimeout(function () {
      if (panel) panel.querySelectorAll('[id^="chart-"]').forEach(function (el) {
        try { Plotly.Plots.resize(el); } catch (e) { }
      });
    }, 60);
  };

  document.querySelectorAll('.tab-btn[data-tab]').forEach(function (btn) {
    btn.addEventListener('click', function () { ATT.switchTab(btn.dataset.tab); });
  });

  // ── Reset ──
  ATT.resetApp = function () {
    APP.baselineFile = APP.optimizedFile = APP.baselineText = APP.optimizedText = APP.results = null;
    APP.crewBaselineFile = APP.crewOptimizedFile = APP.crewBaselineText = APP.crewOptimizedText = null;
    document.getElementById('app').style.display = 'none';
    ['baseline', 'optimized', 'crewBaseline', 'crewOptimized'].forEach(function (k) {
      var fn = document.getElementById('fn-' + k);
      if (fn) { fn.textContent = ''; fn.className = 'ub-status'; }
      var card = document.getElementById('card-' + k);
      if (card) card.classList.remove('loaded');
    });
    document.getElementById('btn-analyze').disabled = true;
    document.getElementById('upload-screen').style.display = 'flex';
    var mcWarnEl = document.getElementById('mc-warning');
    if (mcWarnEl) { mcWarnEl.style.display = 'none'; mcWarnEl.textContent = ''; }
    document.getElementById('agent-messages').innerHTML = '<div class="msg-welcome"><strong>Schedule Analyst ready</strong>Ask me anything about the schedule changes.</div>';
  };

})(window.ATT = window.ATT || {});
