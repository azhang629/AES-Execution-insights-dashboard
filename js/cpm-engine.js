(function (ATT) {
  'use strict';

  var MS_PER_DAY = 86400000;

  function topoSort(taskIds, predByTaskId, taskById) {
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

  ATT.runCPM = function (sched) {
    var tasks = Object.values(sched.taskById);
    var taskIds = tasks.map(function (t) { return t.task_id; });

    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      t.calDurationMs = (t.early_end && t.early_start)
        ? Math.max(t.early_end - t.early_start, 0)
        : Math.max((t.cal_duration_hr || t.duration_hr || 0) * 3600000, 0);
    }

    var sorted = topoSort(taskIds, sched.predByTaskId, sched.taskById);

    // ── Forward pass ──
    for (var fi = 0; fi < sorted.length; fi++) {
      var fid = sorted[fi];
      var ft = sched.taskById[fid];
      if (!ft) continue;

      var preds = sched.predByTaskId[fid] || [];
      var maxPredEnd = null;

      for (var pi = 0; pi < preds.length; pi++) {
        var pt = sched.taskById[preds[pi].pred_task_id];
        if (pt && pt.cpmEF) {
          if (!maxPredEnd || pt.cpmEF > maxPredEnd) maxPredEnd = pt.cpmEF;
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

    // ── Backward pass ──
    for (var bi = sorted.length - 1; bi >= 0; bi--) {
      var bid = sorted[bi];
      var bt = sched.taskById[bid];
      if (!bt) continue;

      var succs = sched.succByTaskId[bid] || [];
      var minSuccStart = null;

      for (var si = 0; si < succs.length; si++) {
        var st = sched.taskById[succs[si].task_id];
        if (st && st.cpmLS) {
          if (!minSuccStart || st.cpmLS < minSuccStart) minSuccStart = st.cpmLS;
        }
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

    // ── Driving path trace ──
    sched.drivingPath = traceDrivingPath(sched);

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
      agreementPct: total > 0
        ? Math.round(((agree + bothNon) / total) * 100)
        : 100,
      drivingPathLength: sched.drivingPath.length,
    };

    return sched;
  };

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
      for (var p = 0; p < preds.length; p++) {
        var pt = sched.taskById[preds[p].pred_task_id];
        if (pt && pt.early_end) {
          if (!driver || pt.early_end > driver.early_end) driver = pt;
        }
      }
      current = driver;
    }

    return path;
  }

})(window.ATT = window.ATT || {});
