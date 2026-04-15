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
    }

    var sorted = topoSort(taskIds, sched.predByTaskId);

    // ── Forward pass: longest distance from any start node ──
    // dist[id] = longest path length (ms) from project start to end of this task
    var dist = {};
    var lpPred = {}; // tracks which predecessor gave the longest distance

    for (var fi = 0; fi < sorted.length; fi++) {
      var fid = sorted[fi];
      var ft = sched.taskById[fid];
      if (!ft) continue;

      var fpreds = sched.predByTaskId[fid] || [];
      var bestDist = 0;
      var bestPred = null;

      for (var fpi = 0; fpi < fpreds.length; fpi++) {
        var predId = fpreds[fpi].pred_task_id;
        var fpt = sched.taskById[predId];
        if (!fpt) continue;

        // Implied lag from ALICE's actual dates
        var lagMs = 0;
        if (fpt.early_end && ft.early_start) {
          lagMs = Math.max(ft.early_start - fpt.early_end, 0);
        }

        var predDist = (dist[predId] || 0) + lagMs;
        if (predDist > bestDist) {
          bestDist = predDist;
          bestPred = predId;
        }
      }

      dist[fid] = bestDist + ft.calDurationMs;
      lpPred[fid] = bestPred;

      // Also compute cpmES/cpmEF for backward pass
      ft.cpmES = ft.early_start || sched.projectStart;
      ft.cpmEF = ft.cpmES
        ? new Date(ft.cpmES.getTime() + ft.calDurationMs)
        : null;
    }

    // Find the project-end task (longest distance from start)
    var cpmProjectEnd = null;
    var lpEndId = null;
    var maxDist = 0;
    for (var ei = 0; ei < taskIds.length; ei++) {
      var eid = taskIds[ei];
      if ((dist[eid] || 0) > maxDist) {
        maxDist = dist[eid];
        lpEndId = eid;
      }
      var et = sched.taskById[eid];
      if (et && et.cpmEF && (!cpmProjectEnd || et.cpmEF > cpmProjectEnd)) {
        cpmProjectEnd = et.cpmEF;
      }
    }
    sched.cpmProjectEnd = cpmProjectEnd;

    // Prefer MC milestone as end point if it exists
    if (sched.mcTask && dist[sched.mcTask.task_id]) {
      lpEndId = sched.mcTask.task_id;
    }

    // ── Backward pass (using ALICE's actual dates for late start/finish) ──
    for (var bi = sorted.length - 1; bi >= 0; bi--) {
      var bid = sorted[bi];
      var bt = sched.taskById[bid];
      if (!bt) continue;

      var bsuccs = sched.succByTaskId[bid] || [];
      var minSuccStart = null;

      for (var bsi = 0; bsi < bsuccs.length; bsi++) {
        var bst = sched.taskById[bsuccs[bsi].task_id];
        if (!bst || !bst.cpmLS) continue;
        var lag2 = 0;
        if (bt.early_end && bst.early_start) {
          lag2 = Math.max(bst.early_start - bt.early_end, 0);
        }
        var departure = new Date(bst.cpmLS.getTime() - lag2);
        if (!minSuccStart || departure < minSuccStart) minSuccStart = departure;
      }

      bt.cpmLF = minSuccStart || cpmProjectEnd;
      bt.cpmLS = bt.cpmLF
        ? new Date(bt.cpmLF.getTime() - bt.calDurationMs)
        : null;

      // CPM-computed float
      if (bt.cpmEF && bt.cpmLF) {
        bt.cpmFloatDays = (bt.cpmLF - bt.cpmEF) / MS_PER_DAY;
      } else {
        bt.cpmFloatDays = null;
      }

      // ALICE's own float from its dates or reported slack
      if (bt.late_end && bt.early_end) {
        bt.aliceFloatDays = (bt.late_end - bt.early_end) / MS_PER_DAY;
      } else {
        bt.aliceFloatDays = bt.total_float_hr / 8;
      }

      bt.cpmCritical = bt.cpmFloatDays !== null && bt.cpmFloatDays <= 1;
    }

    // ── Method 1: Longest Path via distance-tracked predecessor chain ──
    sched.drivingPath = buildLongestPath(sched, lpPred, lpEndId, dist);

    // ── Method 2: Zero Float (pre-computed at default tolerance 0) ──
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

  // ── Longest Path: trace backward through the longest-distance predecessor chain ──
  function buildLongestPath(sched, lpPred, endId, dist) {
    if (!endId) return [];
    var path = [];
    var visited = {};
    var current = endId;
    var maxSteps = Object.keys(sched.taskById).length;

    while (current && !visited[current] && maxSteps-- > 0) {
      visited[current] = true;
      var task = sched.taskById[current];
      if (task) {
        task.onDrivingPath = true;
        path.unshift(task);
      }
      current = lpPred[current] || null;
    }

    return path.filter(function (t) { return !SKIP_RE.test(t.task_name); });
  }

  // ── Zero Float: use ALICE's own float data, group into connected paths ──
  function findZeroFloatPaths(sched, toleranceDays) {
    var tasks = Object.values(sched.taskById);
    var zfTasks = {};
    var toleranceHrs = toleranceDays * 8;

    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      if (!t.early_start || !t.early_end) continue;
      if (SKIP_RE.test(t.task_name)) continue;

      // Primary: use ALICE's reported total float
      var aliceFloatHrs = Math.abs(t.total_float_hr);
      var isAliceCrit = (t.isCritical === true);

      // Secondary: use ALICE's late dates if available
      var dateFloatDays = null;
      if (t.late_end && t.early_end) {
        dateFloatDays = (t.late_end - t.early_end) / MS_PER_DAY;
      }

      var isZeroFloat = false;

      // Task qualifies if any of these are true:
      if (isAliceCrit) isZeroFloat = true;
      if (aliceFloatHrs <= toleranceHrs) isZeroFloat = true;
      if (dateFloatDays !== null && Math.abs(dateFloatDays) <= toleranceDays) isZeroFloat = true;

      // Also include CPM-computed zero-float as a fallback
      if (t.cpmFloatDays !== null && Math.abs(t.cpmFloatDays) <= toleranceDays) {
        isZeroFloat = true;
      }

      if (isZeroFloat) {
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
    if (zf.totalTasks > 0) {
      if (zf.fragmented) {
        notes.push('Zero Float found ' + zf.pathCount + ' disconnected path fragments totaling ' + zf.totalTasks + ' activities. Multiple parallel critical paths exist.');
      } else {
        notes.push('Zero Float found a single continuous path of ' + zf.totalTasks + ' activities.');
      }
    } else {
      notes.push('No activities found with float within ' + toleranceDays + 'd tolerance. Try increasing the tolerance slider.');
    }

    notes.push('Longest Path traced ' + lp.length + ' driving activities from project end backward through driving predecessors.');

    if (both > 0) {
      notes.push(both + ' activities appear in both methods (' + Math.round(both / Math.max(lp.length, 1) * 100) + '% of longest path).');
    }
    if (lpOnly > 0) {
      notes.push(lpOnly + ' activities are on the Longest Path but have non-zero float. These are on the driving chain but have scheduling flexibility because multiple paths converge at their successors.');
    }
    if (zfOnly > 0) {
      notes.push(zfOnly + ' activities have zero float but are NOT on the Longest Path. These sit on parallel critical paths that are equally time-constrained but do not drive the selected finish milestone.');
    }

    if (lp.length > 0 && zf.totalTasks > 0 && both === 0) {
      notes.push('WARNING: Zero overlap between methods. This typically means the network logic is sparse or ALICE used resource constraints that shifted the critical path away from the pure-logic longest path.');
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
