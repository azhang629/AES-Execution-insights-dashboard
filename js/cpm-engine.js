(function (ATT) {
  'use strict';

  var MS_PER_DAY = 86400000;
  var SKIP_RE = /mobiliz/i;

  function topoSort(taskIds, predByTaskId) {
    var inDegree = {};
    var adjList = {};

    for (var i = 0; i < taskIds.length; i++) {
      inDegree[taskIds[i]] = 0;
      adjList[taskIds[i]] = [];
    }

    for (var j = 0; j < taskIds.length; j++) {
      var id = taskIds[j];
      var preds = predByTaskId[id] || [];
      for (var k = 0; k < preds.length; k++) {
        var pid = preds[k].pred_task_id;
        if (adjList[pid] !== undefined) {
          inDegree[id]++;
          adjList[pid].push(id);
        }
      }
    }

    var queue = [];
    for (var q = 0; q < taskIds.length; q++) {
      if (inDegree[taskIds[q]] === 0) queue.push(taskIds[q]);
    }

    var sorted = [];
    while (queue.length > 0) {
      var node = queue.shift();
      sorted.push(node);
      var succs = adjList[node];
      for (var s = 0; s < succs.length; s++) {
        inDegree[succs[s]]--;
        if (inDegree[succs[s]] === 0) queue.push(succs[s]);
      }
    }
    return sorted;
  }

  // ── Main CPM pass ──
  ATT.runCPM = function (sched) {
    var tasks = Object.values(sched.taskById);
    var taskIds = tasks.map(function (t) { return t.task_id; });

    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      t.calDurationMs = (t.early_end && t.early_start)
        ? Math.max(t.early_end - t.early_start, 0)
        : Math.max((t.cal_duration_hr || t.duration_hr || 0) * 3600000, 0);

      // Implied lag from ALICE dates for each predecessor
      var preds = sched.predByTaskId[t.task_id] || [];
      for (var pi = 0; pi < preds.length; pi++) {
        var pt = sched.taskById[preds[pi].pred_task_id];
        if (pt && pt.early_end && t.early_start) {
          preds[pi]._impliedLagMs = Math.max(t.early_start - pt.early_end, 0);
        } else {
          preds[pi]._impliedLagMs = 0;
        }
      }
    }

    var sorted = topoSort(taskIds, sched.predByTaskId);

    // ── Forward pass (uses implied lags) ──
    for (var fi = 0; fi < sorted.length; fi++) {
      var fid = sorted[fi];
      var ft = sched.taskById[fid];
      if (!ft) continue;

      var fpreds = sched.predByTaskId[fid] || [];
      var maxPredEnd = null;

      for (var fpi = 0; fpi < fpreds.length; fpi++) {
        var fpt = sched.taskById[fpreds[fpi].pred_task_id];
        if (fpt && fpt.cpmEF) {
          var arrival = new Date(fpt.cpmEF.getTime() + (fpreds[fpi]._impliedLagMs || 0));
          if (!maxPredEnd || arrival > maxPredEnd) maxPredEnd = arrival;
        }
      }

      ft.cpmES = maxPredEnd || ft.early_start || sched.projectStart;
      ft.cpmEF = ft.cpmES
        ? new Date(ft.cpmES.getTime() + ft.calDurationMs)
        : null;
    }

    var cpmProjectEnd = null;
    for (var ei = 0; ei < tasks.length; ei++) {
      if (tasks[ei].cpmEF && (!cpmProjectEnd || tasks[ei].cpmEF > cpmProjectEnd)) {
        cpmProjectEnd = tasks[ei].cpmEF;
      }
    }
    sched.cpmProjectEnd = cpmProjectEnd;

    // ── Backward pass (uses implied lags) ──
    for (var bi = sorted.length - 1; bi >= 0; bi--) {
      var bid = sorted[bi];
      var bt = sched.taskById[bid];
      if (!bt) continue;

      var bsuccs = sched.succByTaskId[bid] || [];
      var minSuccStart = null;

      for (var bsi = 0; bsi < bsuccs.length; bsi++) {
        var bst = sched.taskById[bsuccs[bsi].task_id];
        if (!bst || !bst.cpmLS) continue;
        var sPreds = sched.predByTaskId[bsuccs[bsi].task_id] || [];
        var lag = 0;
        for (var lk = 0; lk < sPreds.length; lk++) {
          if (sPreds[lk].pred_task_id === bid) { lag = sPreds[lk]._impliedLagMs || 0; break; }
        }
        var departure = new Date(bst.cpmLS.getTime() - lag);
        if (!minSuccStart || departure < minSuccStart) minSuccStart = departure;
      }

      bt.cpmLF = minSuccStart || cpmProjectEnd;
      bt.cpmLS = bt.cpmLF
        ? new Date(bt.cpmLF.getTime() - bt.calDurationMs)
        : null;

      if (bt.cpmEF && bt.cpmLF) {
        bt.cpmFloatDays = (bt.cpmLF - bt.cpmEF) / MS_PER_DAY;
      } else {
        bt.cpmFloatDays = null;
      }

      if (bt.late_end && bt.early_end) {
        bt.aliceFloatDays = (bt.late_end - bt.early_end) / MS_PER_DAY;
      } else {
        bt.aliceFloatDays = bt.total_float_hr / 8;
      }

      bt.cpmCritical = bt.cpmFloatDays !== null && bt.cpmFloatDays <= 1;
    }

    // ── Method 1: Longest Path (driving predecessor trace) ──
    sched.drivingPath = traceDrivingPath(sched);

    // ── Method 2: Zero Float paths (pre-computed at default tolerance 0) ──
    sched.zeroFloatResult = findZeroFloatPaths(sched, 0);

    // ── Validation stats ──
    var agree = 0, aliceOnly = 0, cpmOnly = 0, bothNon = 0, total = 0;
    for (var vi = 0; vi < tasks.length; vi++) {
      var vt = tasks[vi];
      if (!vt.early_start || !vt.early_end) continue;
      total++;
      var ac = vt.isCritical || (vt.aliceFloatDays !== null && vt.aliceFloatDays <= 0);
      var cc = vt.cpmCritical;
      if (ac && cc) agree++;
      else if (ac && !cc) aliceOnly++;
      else if (!ac && cc) cpmOnly++;
      else bothNon++;
    }

    sched.cpmValidation = {
      totalTasks: total,
      agreedCritical: agree,
      aliceOnlyCritical: aliceOnly,
      cpmOnlyCritical: cpmOnly,
      agreementPct: total > 0 ? Math.round(((agree + bothNon) / total) * 100) : 100,
      drivingPathLength: sched.drivingPath.length,
    };

    return sched;
  };

  // ── Longest Path: trace driving predecessors backward from project end ──
  function traceDrivingPath(sched) {
    var tasks = Object.values(sched.taskById);
    var endTask = null;
    for (var i = 0; i < tasks.length; i++) {
      if (!tasks[i].early_end) continue;
      if (!endTask || tasks[i].early_end > endTask.early_end) endTask = tasks[i];
    }
    if (!endTask) return [];

    var visited = {};
    var path = [];
    var current = endTask;
    var maxSteps = tasks.length;

    while (current && !visited[current.task_id] && maxSteps-- > 0) {
      visited[current.task_id] = true;
      current.onDrivingPath = true;
      path.unshift(current);

      var preds = sched.predByTaskId[current.task_id] || [];
      if (!preds.length) break;

      var driver = null;
      var driverArrival = null;
      for (var p = 0; p < preds.length; p++) {
        var pt = sched.taskById[preds[p].pred_task_id];
        if (pt && pt.early_end) {
          var arrival = pt.early_end.getTime() + (preds[p]._impliedLagMs || 0);
          if (!driver || arrival > driverArrival) {
            driver = pt;
            driverArrival = arrival;
          }
        }
      }
      current = driver;
    }

    return path.filter(function (t) { return !SKIP_RE.test(t.task_name); });
  }

  // ── Zero Float: find all activities within tolerance, group into connected paths ──
  function findZeroFloatPaths(sched, toleranceDays) {
    var tasks = Object.values(sched.taskById);
    var zfTasks = {};

    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      if (!t.early_start || !t.early_end) continue;
      if (SKIP_RE.test(t.task_name)) continue;

      var floatVal = t.cpmFloatDays;
      if (floatVal === null) continue;
      if (Math.abs(floatVal) <= toleranceDays) {
        zfTasks[t.task_id] = t;
      }
    }

    // Build adjacency within zero-float subset
    var zfIds = Object.keys(zfTasks);
    var visited = {};
    var components = [];

    function dfs(id, comp) {
      if (visited[id]) return;
      visited[id] = true;
      comp.push(zfTasks[id]);

      var preds = sched.predByTaskId[id] || [];
      for (var j = 0; j < preds.length; j++) {
        if (zfTasks[preds[j].pred_task_id]) dfs(preds[j].pred_task_id, comp);
      }
      var succs = sched.succByTaskId[id] || [];
      for (var k = 0; k < succs.length; k++) {
        if (zfTasks[succs[k].task_id]) dfs(succs[k].task_id, comp);
      }
    }

    for (var c = 0; c < zfIds.length; c++) {
      if (!visited[zfIds[c]]) {
        var comp = [];
        dfs(zfIds[c], comp);
        comp.sort(function (a, b) { return a.early_start - b.early_start; });
        components.push(comp);
      }
    }

    components.sort(function (a, b) { return b.length - a.length; });

    var allTasks = [];
    for (var ci = 0; ci < components.length; ci++) {
      for (var ti = 0; ti < components[ci].length; ti++) {
        allTasks.push(components[ci][ti]);
      }
    }

    return {
      paths: components,
      pathCount: components.length,
      totalTasks: allTasks.length,
      mainPath: components[0] || [],
      allTasks: allTasks,
      fragmented: components.length > 1,
    };
  }

  // ── Public: recompute zero-float paths with custom tolerance ──
  ATT.getZeroFloatPaths = function (sched, toleranceDays) {
    return findZeroFloatPaths(sched, toleranceDays);
  };

  // ── Public: diagnose difference between the two methods ──
  ATT.diagnoseCPMethods = function (sched, toleranceDays) {
    toleranceDays = toleranceDays || 0;
    var zf = findZeroFloatPaths(sched, toleranceDays);
    var lp = sched.drivingPath || [];

    var zfSet = {};
    for (var i = 0; i < zf.allTasks.length; i++) zfSet[zf.allTasks[i].task_id] = true;
    var lpSet = {};
    for (var j = 0; j < lp.length; j++) lpSet[lp[j].task_id] = true;

    var both = 0, zfOnly = 0, lpOnly = 0;
    var lpOnlyTasks = [], zfOnlyTasks = [];

    for (var k in zfSet) {
      if (lpSet[k]) both++;
      else { zfOnly++; zfOnlyTasks.push(sched.taskById[k]); }
    }
    for (var m in lpSet) {
      if (!zfSet[m]) { lpOnly++; lpOnlyTasks.push(sched.taskById[m]); }
    }

    var notes = [];
    if (zf.fragmented) {
      notes.push('Zero Float found ' + zf.pathCount + ' disconnected path fragments (' + zf.totalTasks + ' total activities). This indicates parallel near-critical paths.');
    } else if (zf.pathCount === 1) {
      notes.push('Zero Float found a single continuous path of ' + zf.totalTasks + ' activities.');
    } else {
      notes.push('No activities with float within tolerance.');
    }

    notes.push('Longest Path traced ' + lp.length + ' driving activities from project end.');

    if (both > 0) {
      notes.push(both + ' activities appear in both methods.');
    }
    if (lpOnly > 0) {
      notes.push(lpOnly + ' activities are on the Longest Path but have non-zero float (' + toleranceDays + 'd tolerance). These likely have float because multiple paths converge, giving them scheduling flexibility despite being on the driving chain.');
    }
    if (zfOnly > 0) {
      notes.push(zfOnly + ' activities have zero float but are NOT on the Longest Path. These sit on parallel critical paths that are equally constrained but not driving the project finish milestone.');
    }

    return {
      overlap: both,
      zfOnlyCount: zfOnly,
      lpOnlyCount: lpOnly,
      zfOnlyTasks: zfOnlyTasks,
      lpOnlyTasks: lpOnlyTasks,
      notes: notes,
    };
  };

})(window.ATT = window.ATT || {});
