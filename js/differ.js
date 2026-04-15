(function (ATT) {
  'use strict';

  var dateDiffDays = ATT.dateDiffDays;

  function computeLagHr(pred, predTask, succTask) {
    if (pred.lag_hr !== null && pred.lag_hr !== undefined) return pred.lag_hr;
    if (!predTask || !succTask) return 0;
    if (predTask.early_end && succTask.early_start) {
      return (succTask.early_start - predTask.early_end) / 3600000;
    }
    return 0;
  }

  function predKey(predTask) {
    return predTask ? predTask.task_name : null;
  }

  function diffRelationships(bTask, oTask, baseline, optimized) {
    var bPreds = baseline.predByTaskId[bTask.task_id] || [];
    var oPreds = optimized.predByTaskId[oTask.task_id] || [];

    var bPredMap = {};
    for (var i = 0; i < bPreds.length; i++) {
      var p = bPreds[i];
      var pt = baseline.taskById[p.pred_task_id] || baseline.taskByCode[p.pred_task_id];
      var key = predKey(pt) || p.pred_task_id;
      if (key && !bPredMap[key]) bPredMap[key] = { pred: p, predTask: pt };
    }
    var oPredMap = {};
    for (var j = 0; j < oPreds.length; j++) {
      var op = oPreds[j];
      var opt = optimized.taskById[op.pred_task_id] || optimized.taskByCode[op.pred_task_id];
      var okey = predKey(opt) || op.pred_task_id;
      if (okey && !oPredMap[okey]) oPredMap[okey] = { pred: op, predTask: opt };
    }

    var newSS = 0, hasNegLag = false, removed = 0, added = 0;
    var matchedCount = 0;
    var matchedPairs = [];

    var bKeys = Object.keys(bPredMap);
    for (var bi = 0; bi < bKeys.length; bi++) {
      var code = bKeys[bi];
      var bEntry = bPredMap[code];
      var oEntry = oPredMap[code];
      if (oEntry) {
        matchedCount++;
        var bLag = computeLagHr(bEntry.pred, bEntry.predTask, bTask);
        var oLag = computeLagHr(oEntry.pred, oEntry.predTask, oTask);
        matchedPairs.push({ name: code, bLag: bLag, oLag: oLag });
        if (bEntry.pred.pred_type !== 'PR_SS' && (oEntry.pred.pred_type === 'PR_SS' || (oLag < 0 && bLag >= 0))) newSS++;
        if (oLag < 0) hasNegLag = true;
      } else {
        removed++;
      }
    }
    var oKeys = Object.keys(oPredMap);
    for (var oi = 0; oi < oKeys.length; oi++) {
      if (!bPredMap[oKeys[oi]]) {
        added++;
        var addedPred = oPredMap[oKeys[oi]];
        var addedLag = computeLagHr(addedPred.pred, addedPred.predTask, oTask);
        if (addedPred.pred.pred_type === 'PR_SS' || addedLag < 0) newSS++;
        if (addedLag < 0) hasNegLag = true;
      }
    }

    var sameDriving = false;
    var lagDelta = 0;
    var drivingPredName = null;
    var bDrivingLagDays = null, oDrivingLagDays = null;

    if (matchedPairs.length > 0) {
      var bDriver = matchedPairs.slice().sort(function (a, b) { return a.bLag - b.bLag; })[0];
      var oDriver = matchedPairs.slice().sort(function (a, b) { return a.oLag - b.oLag; })[0];

      if (bDriver.name === oDriver.name && bDriver.bLag < 720) {
        sameDriving = true;
        drivingPredName = bDriver.name;
        lagDelta = bDriver.oLag - bDriver.bLag;
        bDrivingLagDays = bDriver.bLag / 24;
        oDrivingLagDays = bDriver.oLag / 24;
      } else {
        drivingPredName = bDriver.name;
        lagDelta = bDriver.oLag - bDriver.bLag;
        bDrivingLagDays = bDriver.bLag / 24;
        oDrivingLagDays = bDriver.oLag / 24;
      }
    }

    return {
      lagDelta: lagDelta, newSS: newSS, hasNegLag: hasNegLag,
      removed: removed, added: added,
      bPredCount: bPreds.length, oPredCount: oPreds.length,
      bDrivingLagDays: bDrivingLagDays,
      oDrivingLagDays: oDrivingLagDays,
      drivingPredName: drivingPredName,
      sameDriving: sameDriving
    };
  }

  ATT.computeDiff = function (match, baseline, optimized) {
    var b = match.b, o = match.o;
    var startVar  = dateDiffDays(b.early_start, o.early_start);
    var finishVar = dateDiffDays(b.early_end, o.early_end);
    var durVar    = (o.duration_hr - b.duration_hr) / 8;
    var laborVar  = o.laborCrewSize - b.laborCrewSize;
    var floatVar  = (o.total_float_hr - b.total_float_hr) / 8;
    var calChange = (b.clndr_id != null || o.clndr_id != null) && (b.clndr_id !== o.clndr_id);
    var logic     = diffRelationships(b, o, baseline, optimized);

    return {
      task_code:     b.task_code,
      task_name:     b.task_name,
      commodity:     b.commodity,
      blockNotation: b.blockNotation,
      blockNum:      b.blockNum,
      area:          b.area,
      startVar: startVar, finishVar: finishVar, durVar: durVar,
      laborVar: laborVar, floatVar: floatVar, calChange: calChange, logic: logic,
      bCritical: b.nearCritical,
      oCritical: o.nearCritical,
      bFloat:    b.total_float_hr / 8,
      oFloat:    o.total_float_hr / 8,
      bDurDays:  b.duration_hr / 8,
      oDurDays:  o.duration_hr / 8,
      bCrewSize: b.laborCrewSize,
      oCrewSize: o.laborCrewSize,
      bStart: b.early_start,
      oStart: o.early_start,
      bEnd:   b.early_end,
      oEnd:   o.early_end,
      b: b, o: o,
    };
  };

})(window.ATT = window.ATT || {});
