(function (ATT) {
  'use strict';

  var MS_PER_DAY = 86400000;

  // ── Scope subgraph by BFS backward from milestone ──
  function scopeSubgraph(sched, milestoneId) {
    var ancestors = {};
    ancestors[milestoneId] = true;
    var queue = [milestoneId];
    while (queue.length > 0) {
      var current = queue.shift();
      var preds = sched.predByTaskId[current] || [];
      for (var i = 0; i < preds.length; i++) {
        var pid = preds[i].pred_task_id;
        if (!ancestors[pid] && sched.taskById[pid]) {
          ancestors[pid] = true;
          queue.push(pid);
        }
      }
    }
    return Object.keys(ancestors);
  }

  // ── Compute actual float using ALICE's late dates ──
  function computeActualFloat(task) {
    if (task.late_start && task.early_start) {
      return (task.late_start - task.early_start) / MS_PER_DAY;
    }
    if (task.late_end && task.early_end) {
      return (task.late_end - task.early_end) / MS_PER_DAY;
    }
    if (task.total_float_hr !== undefined && task.total_float_hr !== null) {
      return task.total_float_hr / 24;
    }
    return null;
  }

  // ── Find driving predecessor using ALICE's actual dates ──
  // For each task, the driving predecessor is the one that leaves
  // the least slack between its constraint and the task's actual start.
  function findDrivingPredecessors(sched, subgraphIds, subgraphSet) {
    var drivingPred = {};

    for (var i = 0; i < subgraphIds.length; i++) {
      var id = subgraphIds[i];
      var task = sched.taskById[id];
      if (!task || !task.early_start) { drivingPred[id] = null; continue; }

      var preds = (sched.predByTaskId[id] || []).filter(function (p) {
        return subgraphSet[p.pred_task_id] && sched.taskById[p.pred_task_id];
      });

      if (preds.length === 0) { drivingPred[id] = null; continue; }

      var taskES = task.early_start.getTime();
      var taskEF = task.early_end ? task.early_end.getTime() : taskES;
      var bestPred = null;
      var leastSlack = Infinity;

      for (var p = 0; p < preds.length; p++) {
        var rel = preds[p];
        var predTask = sched.taskById[rel.pred_task_id];
        if (!predTask) continue;

        var predES = predTask.early_start ? predTask.early_start.getTime() : null;
        var predEF = predTask.early_end ? predTask.early_end.getTime() : null;
        if (predES === null && predEF === null) continue;

        var lagMs = (rel.lag_days || 0) * MS_PER_DAY;
        var relType = (rel.rel_type || 'FS').toUpperCase();
        var constraintDate;

        if (relType === 'SS') {
          constraintDate = (predES || 0) + lagMs;
        } else if (relType === 'FF') {
          constraintDate = (predEF || 0) + lagMs;
        } else if (relType === 'SF') {
          constraintDate = (predES || 0) + lagMs;
        } else {
          constraintDate = (predEF || 0) + lagMs;
        }

        // Slack = how much gap between this predecessor's constraint and the task's actual start
        // For FF/SF relationships, compare against finish
        var slack;
        if (relType === 'FF' || relType === 'SF') {
          slack = taskEF - constraintDate;
        } else {
          slack = taskES - constraintDate;
        }

        if (slack < leastSlack) {
          leastSlack = slack;
          bestPred = rel.pred_task_id;
        }
      }

      drivingPred[id] = bestPred;
    }

    return drivingPred;
  }

  // ── Longest Path: trace back from milestone through driving predecessors ──
  function longestPathMethod(milestoneId, drivingPred) {
    var path = [];
    var current = milestoneId;
    var visited = {};
    while (current != null && !visited[current]) {
      visited[current] = true;
      path.push(current);
      current = drivingPred[current];
    }
    path.reverse();
    return path;
  }

  // ── Zero Total Float: collect all tasks with float ≤ tolerance ──
  function zeroFloatMethod(sched, subgraphIds, subgraphSet, floatMap, tolerance) {
    var criticalIds = [];
    for (var i = 0; i < subgraphIds.length; i++) {
      var id = subgraphIds[i];
      var tf = floatMap[id];
      if (tf !== null && tf !== undefined && tf <= tolerance) {
        criticalIds.push(id);
      }
    }

    // Group into connected components
    var critSet = {};
    for (var j = 0; j < criticalIds.length; j++) critSet[criticalIds[j]] = true;

    var visited = {};
    var components = [];

    function dfs(nid, comp) {
      if (visited[nid]) return;
      visited[nid] = true;
      comp.push(nid);
      var preds = (sched.predByTaskId[nid] || []).filter(function (p) {
        return critSet[p.pred_task_id] && subgraphSet[p.pred_task_id];
      });
      for (var pi = 0; pi < preds.length; pi++) dfs(preds[pi].pred_task_id, comp);
      var succs = (sched.succByTaskId[nid] || []).filter(function (s) {
        return critSet[s.task_id] && subgraphSet[s.task_id];
      });
      for (var si = 0; si < succs.length; si++) dfs(succs[si].task_id, comp);
    }

    for (var ci = 0; ci < criticalIds.length; ci++) {
      if (!visited[criticalIds[ci]]) {
        var comp = [];
        dfs(criticalIds[ci], comp);
        comp.sort(function (a, b) {
          var at = sched.taskById[a], bt = sched.taskById[b];
          var as = at && at.early_start ? at.early_start.getTime() : 0;
          var bs = bt && bt.early_start ? bt.early_start.getTime() : 0;
          return as - bs;
        });
        components.push(comp);
      }
    }

    components.sort(function (a, b) { return b.length - a.length; });
    var allCritical = [];
    for (var ai = 0; ai < components.length; ai++) {
      for (var bi = 0; bi < components[ai].length; bi++) {
        allCritical.push(components[ai][bi]);
      }
    }

    return { ids: allCritical, segments: components, segmentCount: components.length };
  }

  // ── Near-critical activities ──
  function findNearCritical(subgraphIds, criticalSet, floatMap, thresholdDays) {
    var result = [];
    for (var i = 0; i < subgraphIds.length; i++) {
      var id = subgraphIds[i];
      if (criticalSet[id]) continue;
      var tf = floatMap[id];
      if (tf !== null && tf !== undefined && tf > 0 && tf <= thresholdDays) result.push(id);
    }
    return result;
  }

  // ── Display helper: collapse parallel tasks into stair-step ──
  function enforceSequential(tasks) {
    if (tasks.length <= 1) return tasks;
    tasks.sort(function (a, b) { return a.early_start - b.early_start; });
    var result = [];
    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      if (!result.length) { result.push(t); continue; }
      var prev = result[result.length - 1];
      if (t.early_end <= prev.early_end) continue;
      if (t.early_start < prev.early_end) t._displayStart = prev.early_end;
      result.push(t);
    }
    return result;
  }

  function filterForDisplay(tasks) {
    return tasks.filter(function (t) {
      return t && t.early_start && t.early_end;
    });
  }

  // ── Main CPM entry point ──
  ATT.runCPM = function (sched, optMilestoneId) {
    var tasks = Object.values(sched.taskById);

    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      t.calDurationMs = (t.early_end && t.early_start)
        ? Math.max(t.early_end - t.early_start, 0)
        : Math.max((t.cal_duration_hr || t.duration_hr || 0) * 3600000, 0);
    }

    var milestoneId = optMilestoneId || null;
    if (!milestoneId) {
      if (sched.scTask) milestoneId = sched.scTask.task_id;
      else if (sched.mcTask) milestoneId = sched.mcTask.task_id;
      else {
        var latestTask = null;
        for (var li = 0; li < tasks.length; li++) {
          if (tasks[li].early_end && (!latestTask || tasks[li].early_end > latestTask.early_end)) {
            latestTask = tasks[li];
          }
        }
        if (latestTask) milestoneId = latestTask.task_id;
      }
    }

    if (!milestoneId) {
      sched.cpmResult = null;
      sched.drivingPath = [];
      sched.zeroFloatPath = [];
      sched.nearCriticalTasks = [];
      return sched;
    }

    // Scope to tasks that are ancestors of the milestone
    var subgraphIds = scopeSubgraph(sched, milestoneId);
    var subgraphSet = {};
    for (var si = 0; si < subgraphIds.length; si++) subgraphSet[subgraphIds[si]] = true;

    // Compute float using ALICE's actual late dates
    var floatMap = {};
    for (var fi = 0; fi < subgraphIds.length; fi++) {
      var fid = subgraphIds[fi];
      var ft = sched.taskById[fid];
      floatMap[fid] = ft ? computeActualFloat(ft) : null;
    }

    // Find driving predecessors using actual dates
    var drivingPred = findDrivingPredecessors(sched, subgraphIds, subgraphSet);

    // Longest Path: trace back from milestone
    var lpIds = longestPathMethod(milestoneId, drivingPred);

    // Zero Total Float: all tasks with float ≤ 0
    var zfResult = zeroFloatMethod(sched, subgraphIds, subgraphSet, floatMap, 0);

    // Near-critical
    var critSet = {};
    for (var ci = 0; ci < zfResult.ids.length; ci++) critSet[zfResult.ids[ci]] = true;
    var nearCritIds = findNearCritical(subgraphIds, critSet, floatMap, 10);

    // Diagnostics
    var lpSet = {};
    for (var di = 0; di < lpIds.length; di++) lpSet[lpIds[di]] = true;
    var tfSet = {};
    for (var dj = 0; dj < zfResult.ids.length; dj++) tfSet[zfResult.ids[dj]] = true;
    var overlap = [], lpOnly = [], tfOnly = [];
    for (var dk in lpSet) { if (tfSet[dk]) overlap.push(dk); else lpOnly.push(dk); }
    for (var dl in tfSet) { if (!lpSet[dl]) tfOnly.push(dl); }

    // Write computed fields to each task
    for (var wi = 0; wi < subgraphIds.length; wi++) {
      var wid = subgraphIds[wi];
      var wt = sched.taskById[wid];
      if (!wt) continue;
      wt.cpmFloatDays = floatMap[wid];
      wt.cpmTotalFloat = floatMap[wid];
      wt.cpmCritical = floatMap[wid] !== null && floatMap[wid] <= 0;
      wt.onLongestPath = !!lpSet[wid];
      wt.onDrivingPath = !!lpSet[wid];
      wt.isNearCritical = false;
      wt.drivingPredId = drivingPred[wid] || null;
    }

    for (var nci = 0; nci < nearCritIds.length; nci++) {
      var nt = sched.taskById[nearCritIds[nci]];
      if (nt) nt.isNearCritical = true;
    }

    var lpTasks = filterForDisplay(lpIds.map(function (id) { return sched.taskById[id]; }));
    var zfTasks = filterForDisplay(zfResult.ids.map(function (id) { return sched.taskById[id]; }));
    var ncTasks = filterForDisplay(nearCritIds.map(function (id) { return sched.taskById[id]; }));

    sched.drivingPath = enforceSequential(lpTasks.slice());
    sched.zeroFloatPath = enforceSequential(zfTasks.slice());
    sched.nearCriticalTasks = ncTasks;
    sched.cpmMilestoneId = milestoneId;

    sched.cpmResult = {
      milestoneId: milestoneId,
      subgraphSize: subgraphIds.length,
      floatMap: floatMap,
      zeroFloat: zfResult,
      longestPath: lpIds,
      nearCritical: nearCritIds,
      diagnostics: { overlap: overlap, lpOnly: lpOnly, tfOnly: tfOnly, notes: [] },
      lpTasks: lpTasks,
      zfTasks: zfTasks,
      ncTasks: ncTasks,
    };

    // Validation stats
    var agree = 0, aliceOnly = 0, cpmOnly = 0, bothNon = 0, total = 0;
    for (var vi = 0; vi < tasks.length; vi++) {
      var vt = tasks[vi];
      if (!vt.early_start || !vt.early_end) continue;
      total++;
      var aliceFloat = computeActualFloat(vt);
      var ac = vt.isCritical || (aliceFloat !== null && aliceFloat <= 0);
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
      drivingPathLength: lpTasks.length,
    };

    return sched;
  };

  // ── Public: recompute near-critical with custom threshold ──
  ATT.recomputeNearCritical = function (sched, thresholdDays) {
    if (!sched.cpmResult) return [];
    var floatMap = sched.cpmResult.floatMap || {};
    var subgraphIds = Object.keys(floatMap);
    var criticalSet = {};
    for (var i = 0; i < sched.cpmResult.zeroFloat.ids.length; i++) {
      criticalSet[sched.cpmResult.zeroFloat.ids[i]] = true;
    }
    return filterForDisplay(
      findNearCritical(subgraphIds, criticalSet, floatMap, thresholdDays)
        .map(function (id) { return sched.taskById[id]; })
    );
  };

  // ── Public: getZeroFloatPaths with tolerance ──
  ATT.getZeroFloatPaths = function (sched, toleranceDays) {
    if (!sched.cpmResult) {
      return { paths: [], pathCount: 0, totalTasks: 0, mainPath: [], allTasks: [], fragmented: false };
    }

    var floatMap = sched.cpmResult.floatMap || {};
    var subgraphIds = Object.keys(floatMap);
    var subgraphSet = {};
    for (var i = 0; i < subgraphIds.length; i++) subgraphSet[subgraphIds[i]] = true;

    var zfIds = [];
    for (var j = 0; j < subgraphIds.length; j++) {
      var id = subgraphIds[j];
      var tf = floatMap[id];
      if (tf !== null && tf !== undefined && tf <= toleranceDays) {
        var task = sched.taskById[id];
        if (task && task.early_start && task.early_end) zfIds.push(id);
      }
    }

    var zfSet = {};
    for (var zi = 0; zi < zfIds.length; zi++) zfSet[zfIds[zi]] = true;

    var visited = {};
    var components = [];

    function dfs(nid, comp) {
      if (visited[nid]) return;
      visited[nid] = true;
      comp.push(sched.taskById[nid]);
      var preds = (sched.predByTaskId[nid] || []).filter(function (p) { return zfSet[p.pred_task_id]; });
      for (var pi = 0; pi < preds.length; pi++) dfs(preds[pi].pred_task_id, comp);
      var succs = (sched.succByTaskId[nid] || []).filter(function (s) { return zfSet[s.task_id]; });
      for (var si = 0; si < succs.length; si++) dfs(succs[si].task_id, comp);
    }

    for (var ci = 0; ci < zfIds.length; ci++) {
      if (!visited[zfIds[ci]]) {
        var comp = [];
        dfs(zfIds[ci], comp);
        comp.sort(function (a, b) { return a.early_start - b.early_start; });
        components.push(comp);
      }
    }

    components.sort(function (a, b) { return b.length - a.length; });
    var allTasks = [];
    for (var ai = 0; ai < components.length; ai++) {
      for (var bi = 0; bi < components[ai].length; bi++) {
        allTasks.push(components[ai][bi]);
      }
    }

    return {
      paths: components,
      pathCount: components.length,
      totalTasks: allTasks.length,
      mainPath: components[0] || [],
      allTasks: enforceSequential(allTasks),
      fragmented: components.length > 1,
    };
  };

  // ── Public: diagnoseCPMethods ──
  ATT.diagnoseCPMethods = function (sched, toleranceDays) {
    if (!sched.cpmResult) {
      return { overlap: 0, zfOnlyCount: 0, lpOnlyCount: 0, notes: [] };
    }

    var diag = sched.cpmResult.diagnostics;
    var zf = ATT.getZeroFloatPaths(sched, toleranceDays || 0);
    var lp = sched.cpmResult.lpTasks;

    var notes = [];
    if (zf.totalTasks > 0) {
      notes.push(zf.fragmented
        ? 'Zero Float: ' + zf.pathCount + ' segments, ' + zf.totalTasks + ' activities.'
        : 'Zero Float: single path, ' + zf.totalTasks + ' activities.');
    } else {
      notes.push('No activities with float within ' + (toleranceDays || 0) + 'd tolerance.');
    }
    notes.push('Longest Path: ' + lp.length + ' driving activities traced from milestone.');

    return {
      overlap: diag.overlap.length,
      zfOnlyCount: diag.tfOnly.length,
      lpOnlyCount: diag.lpOnly.length,
      notes: notes,
    };
  };

})(window.ATT = window.ATT || {});
