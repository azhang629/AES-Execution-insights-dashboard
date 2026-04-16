(function (ATT) {
  'use strict';

  var MS_PER_DAY = 86400000;
  // ── Step 1: Scope subgraph by BFS backward from milestone ──
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

  // ── Step 2: Topological sort (Kahn's algorithm) ──
  function topoSort(taskIds, predByTaskId) {
    var idSet = {};
    for (var i = 0; i < taskIds.length; i++) idSet[taskIds[i]] = true;

    var inDegree = {};
    var adjList = {};
    for (var j = 0; j < taskIds.length; j++) {
      inDegree[taskIds[j]] = 0;
      adjList[taskIds[j]] = [];
    }

    for (var k = 0; k < taskIds.length; k++) {
      var id = taskIds[k];
      var preds = predByTaskId[id] || [];
      for (var p = 0; p < preds.length; p++) {
        var pid = preds[p].pred_task_id;
        if (idSet[pid]) {
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
      var succs = adjList[node] || [];
      for (var s = 0; s < succs.length; s++) {
        inDegree[succs[s]]--;
        if (inDegree[succs[s]] === 0) queue.push(succs[s]);
      }
    }

    if (sorted.length < taskIds.length) {
      var inSorted = {};
      for (var si = 0; si < sorted.length; si++) inSorted[sorted[si]] = true;
      for (var r = 0; r < taskIds.length; r++) {
        if (!inSorted[taskIds[r]]) sorted.push(taskIds[r]);
      }
    }

    return sorted;
  }

  // ── Normalize constraint type string ──
  function normalizeConstraint(raw) {
    if (!raw) return '';
    var s = raw.toLowerCase().replace(/[\s_-]+/g, ' ').trim();
    if (/mandatory.*start/.test(s)) return 'MANDATORY_START';
    if (/mandatory.*finish/.test(s)) return 'MANDATORY_FINISH';
    if (/start.*on.*or.*after/.test(s)) return 'START_ON_OR_AFTER';
    if (/finish.*on.*or.*before/.test(s)) return 'FINISH_ON_OR_BEFORE';
    if (/start.*on/.test(s)) return 'START_ON';
    if (/finish.*on/.test(s)) return 'FINISH_ON';
    return '';
  }

  // ── Step 3: Forward pass — compute ES and EF ──
  function forwardPass(sched, sorted, subgraphSet) {
    var ES = {}, EF = {};
    var drivingPred = {};

    for (var i = 0; i < sorted.length; i++) {
      var id = sorted[i];
      var task = sched.taskById[id];
      if (!task) continue;

      var duration = task.calDurationMs || 0;
      var preds = (sched.predByTaskId[id] || []).filter(function (p) {
        return subgraphSet[p.pred_task_id];
      });

      if (preds.length === 0) {
        var startDate = task.early_start || sched.projectStart;
        ES[id] = startDate ? startDate.getTime() : 0;
        EF[id] = ES[id] + duration;
        drivingPred[id] = null;
      } else {
        var maxStartConstraint = -Infinity;
        var maxFinishConstraint = -Infinity;
        var bestStartPred = null;
        var bestFinishPred = null;

        for (var p = 0; p < preds.length; p++) {
          var rel = preds[p];
          var pid = rel.pred_task_id;
          if (ES[pid] === undefined) continue;

          var lagMs = (rel.lag_days || 0) * MS_PER_DAY;
          var relType = (rel.rel_type || 'FS').toUpperCase();

          if (relType === 'SS') {
            var ssES = ES[pid] + lagMs;
            if (ssES > maxStartConstraint) { maxStartConstraint = ssES; bestStartPred = pid; }
          } else if (relType === 'FF') {
            var ffEF = EF[pid] + lagMs;
            if (ffEF > maxFinishConstraint) { maxFinishConstraint = ffEF; bestFinishPred = pid; }
          } else if (relType === 'SF') {
            var sfEF = ES[pid] + lagMs;
            if (sfEF > maxFinishConstraint) { maxFinishConstraint = sfEF; bestFinishPred = pid; }
          } else {
            var fsES = EF[pid] + lagMs;
            if (fsES > maxStartConstraint) { maxStartConstraint = fsES; bestStartPred = pid; }
          }
        }

        var esFromStart = maxStartConstraint > -Infinity ? maxStartConstraint : 0;
        var esFromFinish = maxFinishConstraint > -Infinity ? maxFinishConstraint - duration : -Infinity;

        if (esFromFinish > esFromStart) {
          ES[id] = esFromFinish;
          EF[id] = maxFinishConstraint;
          drivingPred[id] = bestFinishPred;
        } else {
          ES[id] = esFromStart;
          EF[id] = ES[id] + duration;
          drivingPred[id] = bestStartPred;
        }
        if (maxFinishConstraint > EF[id]) {
          EF[id] = maxFinishConstraint;
          ES[id] = EF[id] - duration;
          drivingPred[id] = bestFinishPred;
        }
      }

      // Apply hard constraints after computing from logic
      var cType = normalizeConstraint(task.cstr_type);
      if (cType && task.cstr_date) {
        var cDate = task.cstr_date.getTime();
        if (cType === 'MANDATORY_START' || cType === 'START_ON') {
          ES[id] = cDate;
          EF[id] = ES[id] + duration;
        } else if (cType === 'START_ON_OR_AFTER') {
          if (ES[id] < cDate) { ES[id] = cDate; EF[id] = ES[id] + duration; }
        } else if (cType === 'MANDATORY_FINISH' || cType === 'FINISH_ON') {
          EF[id] = cDate;
          ES[id] = EF[id] - duration;
        } else if (cType === 'FINISH_ON_OR_BEFORE') {
          if (EF[id] > cDate) { EF[id] = cDate; ES[id] = EF[id] - duration; }
        }
      }
    }

    return { ES: ES, EF: EF, drivingPred: drivingPred };
  }

  // ── Step 4: Backward pass — compute LS and LF ──
  function backwardPass(sched, sorted, subgraphSet, milestoneId, fwdResult) {
    var LS = {}, LF = {};
    var milestoneEF = fwdResult.EF[milestoneId];
    var milestoneDur = (sched.taskById[milestoneId] || {}).calDurationMs || 0;

    LF[milestoneId] = milestoneEF;
    LS[milestoneId] = LF[milestoneId] - milestoneDur;

    // Build successor map within subgraph
    var succMap = {};
    for (var i = 0; i < sorted.length; i++) succMap[sorted[i]] = [];

    for (var j = 0; j < sorted.length; j++) {
      var sid = sorted[j];
      var preds = (sched.predByTaskId[sid] || []).filter(function (p) {
        return subgraphSet[p.pred_task_id];
      });
      for (var k = 0; k < preds.length; k++) {
        var predRel = preds[k];
        if (succMap[predRel.pred_task_id]) {
          succMap[predRel.pred_task_id].push({
            succ_id: sid,
            rel_type: predRel.rel_type || 'FS',
            lag_days: predRel.lag_days || 0
          });
        }
      }
    }

    // Process in reverse topological order
    for (var ri = sorted.length - 1; ri >= 0; ri--) {
      var rid = sorted[ri];
      if (rid === milestoneId) continue;

      var task = sched.taskById[rid];
      if (!task) continue;
      var duration = task.calDurationMs || 0;

      var succs = succMap[rid] || [];
      var minLF = Infinity;

      for (var si = 0; si < succs.length; si++) {
        var succRel = succs[si];
        var succId = succRel.succ_id;
        if (LS[succId] === undefined && LF[succId] === undefined) continue;

        var lagMs = (succRel.lag_days || 0) * MS_PER_DAY;
        var sRelType = (succRel.rel_type || 'FS').toUpperCase();
        var lfCand;

        if (sRelType === 'SS') {
          lfCand = (LS[succId] !== undefined ? LS[succId] : LF[succId]) - lagMs + duration;
        } else if (sRelType === 'FF') {
          lfCand = (LF[succId] !== undefined ? LF[succId] : 0) - lagMs;
        } else if (sRelType === 'SF') {
          lfCand = (LF[succId] !== undefined ? LF[succId] : 0) - lagMs + duration;
        } else {
          lfCand = (LS[succId] !== undefined ? LS[succId] : LF[succId]) - lagMs;
        }

        if (lfCand < minLF) minLF = lfCand;
      }

      // Dead-end activities: LF = milestone.LF (NOT their own EF)
      LF[rid] = (minLF === Infinity) ? milestoneEF : minLF;
      LS[rid] = LF[rid] - duration;
    }

    return { LS: LS, LF: LF };
  }

  // ── Step 5: Compute float ──
  function computeFloat(sched, sorted, subgraphSet, fwdResult, bwdResult) {
    var totalFloat = {};
    var freeFloat = {};

    var fsSuccMap = {};
    for (var i = 0; i < sorted.length; i++) fsSuccMap[sorted[i]] = [];

    for (var j = 0; j < sorted.length; j++) {
      var sid = sorted[j];
      var preds = (sched.predByTaskId[sid] || []).filter(function (p) {
        return subgraphSet[p.pred_task_id];
      });
      for (var k = 0; k < preds.length; k++) {
        var rel = preds[k];
        if ((rel.rel_type || 'FS').toUpperCase() === 'FS') {
          fsSuccMap[rel.pred_task_id].push(sid);
        }
      }
    }

    for (var fi = 0; fi < sorted.length; fi++) {
      var id = sorted[fi];
      var es = fwdResult.ES[id];
      var ls = bwdResult.LS[id];

      // Total Float = LS - ES (do NOT clamp to zero; negative float is meaningful)
      if (es !== undefined && ls !== undefined) {
        totalFloat[id] = (ls - es) / MS_PER_DAY;
      } else {
        totalFloat[id] = null;
      }

      // Free Float = min(succ.ES for FS successors) - EF, clamped to max(0, value)
      var fSuccs = fsSuccMap[id] || [];
      if (fSuccs.length > 0) {
        var minSuccES = Infinity;
        for (var si = 0; si < fSuccs.length; si++) {
          var succES = fwdResult.ES[fSuccs[si]];
          if (succES !== undefined && succES < minSuccES) minSuccES = succES;
        }
        var ef = fwdResult.EF[id];
        if (minSuccES !== Infinity && ef !== undefined) {
          freeFloat[id] = Math.max(0, (minSuccES - ef) / MS_PER_DAY);
        } else {
          freeFloat[id] = Math.max(0, totalFloat[id] || 0);
        }
      } else {
        freeFloat[id] = Math.max(0, totalFloat[id] || 0);
      }
    }

    return { totalFloat: totalFloat, freeFloat: freeFloat };
  }

  // ── Step 6a: Zero Total Float method ──
  function zeroTFMethod(sched, sorted, subgraphSet, floatResult) {
    var criticalIds = [];
    for (var i = 0; i < sorted.length; i++) {
      var id = sorted[i];
      if (floatResult.totalFloat[id] !== null && floatResult.totalFloat[id] <= 0) {
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
        var topoMap = {};
        for (var ti = 0; ti < sorted.length; ti++) topoMap[sorted[ti]] = ti;
        comp.sort(function (a, b) { return (topoMap[a] || 0) - (topoMap[b] || 0); });
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

  // ── Step 6b: Longest Path (Driving Logic) ──
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

  // ── Step 7: Near-critical activities ──
  function findNearCritical(sorted, criticalSet, floatResult, thresholdDays) {
    var result = [];
    for (var i = 0; i < sorted.length; i++) {
      var id = sorted[i];
      if (criticalSet[id]) continue;
      var tf = floatResult.totalFloat[id];
      if (tf !== null && tf > 0 && tf <= thresholdDays) result.push(id);
    }
    return result;
  }

  // ── Step 8: Divergence diagnostics ──
  function diagnoseDivergence(sched, lpIds, tfResult) {
    var lpSet = {};
    for (var i = 0; i < lpIds.length; i++) lpSet[lpIds[i]] = true;
    var tfSet = {};
    for (var j = 0; j < tfResult.ids.length; j++) tfSet[tfResult.ids[j]] = true;

    var overlap = [], lpOnly = [], tfOnly = [];
    for (var k in lpSet) {
      if (tfSet[k]) overlap.push(k);
      else lpOnly.push(k);
    }
    for (var m in tfSet) {
      if (!lpSet[m]) tfOnly.push(m);
    }

    var notes = [];
    if (lpIds.length > 0 && tfResult.ids.length > 0 &&
        overlap.length === lpIds.length && overlap.length === tfResult.ids.length) {
      notes.push('The two methods agree \u2014 the schedule has a single, clean driving chain.');
    } else {
      if (lpOnly.length > 0) {
        notes.push(lpOnly.length + ' Longest Path activities have positive float. A hard constraint on a parallel path may have pushed the milestone date later than pure logic would.');
      }
      if (tfOnly.length > 0) {
        var constrained = tfOnly.filter(function (tid) {
          var t = sched.taskById[tid];
          return t && t.cstr_type;
        });
        if (constrained.length > 0) {
          notes.push(constrained.length + ' zero-float-only activities have hard constraints compressing their float. They would not be critical if constraints were removed.');
        }
        notes.push(tfOnly.length + ' activities have zero float but are NOT on the Longest Path. These sit on parallel critical paths that are equally time-constrained but do not drive the selected finish milestone.');
      }
      if (tfResult.segmentCount > 1) {
        notes.push('The zero-float path is fragmented into ' + tfResult.segmentCount + ' disconnected segments, suggesting broken logic or constraint artifacts.');
      }
    }

    if (lpIds.length > 0 && tfResult.ids.length > 0 && overlap.length === 0) {
      notes.push('WARNING: Zero overlap between methods. This typically means the network logic is sparse or resource constraints shifted the critical path away from the pure-logic longest path.');
    }

    return { overlap: overlap, lpOnly: lpOnly, tfOnly: tfOnly, notes: notes };
  }

  // ── Display helper: remove overlapping tasks for Gantt stair-step ──
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
  // optMilestoneId: if provided, use this task ID as the milestone endpoint
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
      // Default priority: SC > MC > latest task
      if (sched.scTask) {
        milestoneId = sched.scTask.task_id;
      } else if (sched.mcTask) {
        milestoneId = sched.mcTask.task_id;
      } else {
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

    var subgraphIds = scopeSubgraph(sched, milestoneId);
    var subgraphSet = {};
    for (var si = 0; si < subgraphIds.length; si++) subgraphSet[subgraphIds[si]] = true;

    var sorted = topoSort(subgraphIds, sched.predByTaskId);
    var fwdResult = forwardPass(sched, sorted, subgraphSet);
    var bwdResult = backwardPass(sched, sorted, subgraphSet, milestoneId, fwdResult);
    var floatResult = computeFloat(sched, sorted, subgraphSet, fwdResult, bwdResult);
    var zfResult = zeroTFMethod(sched, sorted, subgraphSet, floatResult);
    var lpIds = longestPathMethod(milestoneId, fwdResult.drivingPred);

    var critSet = {};
    for (var ci = 0; ci < zfResult.ids.length; ci++) critSet[zfResult.ids[ci]] = true;
    var nearCritIds = findNearCritical(sorted, critSet, floatResult, 10);
    var diagnostics = diagnoseDivergence(sched, lpIds, zfResult);

    // Write computed fields back to each task
    for (var wi = 0; wi < sorted.length; wi++) {
      var wid = sorted[wi];
      var wt = sched.taskById[wid];
      if (!wt) continue;

      wt.cpmES = fwdResult.ES[wid] !== undefined ? new Date(fwdResult.ES[wid]) : null;
      wt.cpmEF = fwdResult.EF[wid] !== undefined ? new Date(fwdResult.EF[wid]) : null;
      wt.cpmLS = bwdResult.LS[wid] !== undefined ? new Date(bwdResult.LS[wid]) : null;
      wt.cpmLF = bwdResult.LF[wid] !== undefined ? new Date(bwdResult.LF[wid]) : null;
      wt.cpmTotalFloat = floatResult.totalFloat[wid];
      wt.cpmFreeFloat = floatResult.freeFloat[wid];
      wt.cpmFloatDays = floatResult.totalFloat[wid];
      wt.cpmCritical = floatResult.totalFloat[wid] !== null && floatResult.totalFloat[wid] <= 0;
      wt.onLongestPath = false;
      wt.onDrivingPath = false;
      wt.isNearCritical = false;
      wt.drivingPredId = fwdResult.drivingPred[wid] || null;
    }

    for (var lpi = 0; lpi < lpIds.length; lpi++) {
      var lt = sched.taskById[lpIds[lpi]];
      if (lt) { lt.onLongestPath = true; lt.onDrivingPath = true; }
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
      sorted: sorted,
      fwd: fwdResult,
      bwd: bwdResult,
      float: floatResult,
      zeroFloat: zfResult,
      longestPath: lpIds,
      nearCritical: nearCritIds,
      diagnostics: diagnostics,
      lpTasks: lpTasks,
      zfTasks: zfTasks,
      ncTasks: ncTasks,
    };

    // ALICE float for backward compat
    for (var ai = 0; ai < tasks.length; ai++) {
      var at = tasks[ai];
      if (at.late_end && at.early_end) {
        at.aliceFloatDays = (at.late_end - at.early_end) / MS_PER_DAY;
      } else {
        at.aliceFloatDays = at.total_float_hr / 8;
      }
    }

    // Validation stats
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
      drivingPathLength: lpTasks.length,
    };

    return sched;
  };

  // ── Public: recompute near-critical with custom threshold ──
  ATT.recomputeNearCritical = function (sched, thresholdDays) {
    if (!sched.cpmResult) return [];
    var sorted = sched.cpmResult.sorted;
    var floatResult = sched.cpmResult.float;
    var criticalSet = {};
    for (var i = 0; i < sched.cpmResult.zeroFloat.ids.length; i++) {
      criticalSet[sched.cpmResult.zeroFloat.ids[i]] = true;
    }
    return filterForDisplay(
      findNearCritical(sorted, criticalSet, floatResult, thresholdDays)
        .map(function (id) { return sched.taskById[id]; })
    );
  };

  // ── Public: backward-compat getZeroFloatPaths with tolerance ──
  ATT.getZeroFloatPaths = function (sched, toleranceDays) {
    if (!sched.cpmResult) {
      return { paths: [], pathCount: 0, totalTasks: 0, mainPath: [], allTasks: [], fragmented: false };
    }

    var floatResult = sched.cpmResult.float;
    var sorted = sched.cpmResult.sorted;
    var subgraphSet = {};
    for (var i = 0; i < sorted.length; i++) subgraphSet[sorted[i]] = true;

    var zfIds = [];
    for (var j = 0; j < sorted.length; j++) {
      var id = sorted[j];
      var tf = floatResult.totalFloat[id];
      if (tf !== null && tf <= toleranceDays) {
        var task = sched.taskById[id];
        if (task && task.early_start && task.early_end) {
          zfIds.push(id);
        }
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

  // ── Public: backward-compat diagnoseCPMethods ──
  ATT.diagnoseCPMethods = function (sched, toleranceDays) {
    if (!sched.cpmResult) {
      return { overlap: 0, zfOnlyCount: 0, lpOnlyCount: 0, notes: [] };
    }

    var diag = sched.cpmResult.diagnostics;
    var zf = ATT.getZeroFloatPaths(sched, toleranceDays || 0);
    var lp = sched.cpmResult.lpTasks;

    var notes = [];
    if (zf.totalTasks > 0) {
      if (zf.fragmented) {
        notes.push('Zero Float found ' + zf.pathCount + ' disconnected path fragments totaling ' + zf.totalTasks + ' activities.');
      } else {
        notes.push('Zero Float found a single continuous path of ' + zf.totalTasks + ' activities.');
      }
    } else {
      notes.push('No activities found with float within ' + (toleranceDays || 0) + 'd tolerance.');
    }

    notes.push('Longest Path traced ' + lp.length + ' driving activities from milestone backward through driving predecessors.');

    for (var n = 0; n < diag.notes.length; n++) notes.push(diag.notes[n]);

    return {
      overlap: diag.overlap.length,
      zfOnlyCount: diag.tfOnly.length,
      lpOnlyCount: diag.lpOnly.length,
      zfOnlyTasks: diag.tfOnly.map(function (id) { return sched.taskById[id]; }).filter(Boolean),
      lpOnlyTasks: diag.lpOnly.map(function (id) { return sched.taskById[id]; }).filter(Boolean),
      notes: notes,
    };
  };

})(window.ATT = window.ATT || {});
