(function (ATT) {
  'use strict';

  var TACTICS = ATT.TACTICS;
  var fmtDate = ATT.fmtDate;

  function shortName(name) { return (name || '').split(' - ')[0].replace(/_/g, ' ').trim(); }
  function blockTag(d) { return d.blockNotation || (d.blockNum ? 'Block ' + d.blockNum : ''); }

  var POST_MC_RE = /\beor\b|energiz|hot.commiss|substantial.complet|final.punch|closeout|demob|as.built|warranty|turnover|handover/i;

  function isPreMC(d, mcCutoff) {
    if (POST_MC_RE.test(d.task_name || '')) return false;
    if (mcCutoff && d.oStart && d.oStart >= mcCutoff) return false;
    return true;
  }

  function sweepCrewPeak(activities, startKey, endKey, crewKey) {
    var events = [];
    activities.forEach(function (d) {
      var s = d[startKey], e = d[endKey], c = d[crewKey];
      if (!s || !e || !c || c <= 0) return;
      events.push({ date: s.getTime(), delta: +c });
      events.push({ date: e.getTime() + 86400000, delta: -c });
    });
    events.sort(function (a, b) { return a.date - b.date || b.delta - a.delta; });
    var current = 0, peak = 0, peakDate = null;
    for (var i = 0; i < events.length; i++) {
      current += events[i].delta;
      if (current > peak) { peak = current; peakDate = new Date(events[i].date); }
    }
    return { peak: Math.round(peak), date: peakDate };
  }

  function matchCrewToDiffs(crewName, diffs) {
    var cn = shortName(crewName).toLowerCase().replace(/\s+crew\s*$/i, '').trim();
    var exact = diffs.filter(function (d) {
      return d.commodity && d.commodity.toLowerCase() === cn;
    });
    if (exact.length > 0) return exact;
    return diffs.filter(function (d) {
      if (!d.commodity) return false;
      var comm = d.commodity.toLowerCase();
      return cn.indexOf(comm) >= 0 || comm.indexOf(cn) >= 0;
    });
  }

  function comparePredecessors(diff, baseline, optimized) {
    var bTask = diff.b, oTask = diff.o;
    var bPreds = baseline.predByTaskId[bTask.task_id] || [];
    var oPreds = optimized.predByTaskId[oTask.task_id] || [];

    var bNames = {};
    for (var i = 0; i < bPreds.length; i++) {
      var p = bPreds[i];
      var pt = baseline.taskById[p.pred_task_id] || baseline.taskByCode[p.pred_task_id];
      var name = pt ? pt.task_name : p.pred_task_id;
      if (name && !bNames[name]) bNames[name] = pt;
    }

    var oNames = {};
    for (var j = 0; j < oPreds.length; j++) {
      var op = oPreds[j];
      var opt = optimized.taskById[op.pred_task_id] || optimized.taskByCode[op.pred_task_id];
      var oname = opt ? opt.task_name : op.pred_task_id;
      if (oname && !oNames[oname]) oNames[oname] = opt;
    }

    var items = [];
    var bKeys = Object.keys(bNames);
    for (var bi = 0; bi < bKeys.length; bi++) {
      var k = bKeys[bi];
      if (oNames[k]) {
        items.push({ name: shortName(k), status: 'same' });
      } else {
        items.push({ name: shortName(k), status: 'deleted' });
      }
    }
    var oKeys = Object.keys(oNames);
    for (var oi = 0; oi < oKeys.length; oi++) {
      if (!bNames[oKeys[oi]]) {
        items.push({ name: shortName(oKeys[oi]), status: 'new' });
      }
    }
    return items;
  }

  function getBlockProgression(crewDiffs, startKey) {
    var blockStarts = {};
    for (var i = 0; i < crewDiffs.length; i++) {
      var d = crewDiffs[i];
      var bn = d.blockNotation || d.blockNum;
      if (!bn) continue;
      var start = d[startKey];
      if (!start) continue;
      if (!blockStarts[bn] || start < blockStarts[bn]) {
        blockStarts[bn] = start;
      }
    }
    return Object.keys(blockStarts)
      .sort(function (a, b) { return blockStarts[a] - blockStarts[b]; })
      .map(function (bn) { return { block: bn, start: blockStarts[bn] }; });
  }

  function generateCrewLevers(crewDiffs, R) {
    var mcCutoff = R.oMCDate || R.bMCDate || null;
    var levers = [];
    var preMC = crewDiffs.filter(function (d) { return isPreMC(d, mcCutoff) && d.oStart && d.bStart; });
    if (preMC.length === 0) return levers;

    // 1. Workfront Resequencing
    var reseqDiffs = preMC.filter(function (d) {
      return d.startVar < -5 && Math.abs(d.durVar) < 1 && Math.abs(d.laborVar) < 0.5 && d.blockNum;
    });
    if (reseqDiffs.length >= 2) {
      var basePath = getBlockProgression(reseqDiffs, 'bStart');
      var optPath = getBlockProgression(reseqDiffs, 'oStart');
      var bStr = basePath.map(function (p) { return p.block; }).join(' \u2192 ');
      var oStr = optPath.map(function (p) { return p.block; }).join(' \u2192 ');
      levers.push({
        type: 'resequencing',
        label: 'Workfront Resequencing',
        summary: reseqDiffs.length + ' activities resequenced \u2014 installation order changed',
        baselinePath: bStr,
        optimizedPath: oStr,
        changed: bStr !== oStr,
        count: reseqDiffs.length,
      });
    }

    // 2. Execution Path Changes
    var pathDiffs = preMC.filter(function (d) {
      return Math.abs(d.finishVar) > 3 && d.logic &&
        (d.logic.added > 0 || d.logic.removed > 0 || !d.logic.sameDriving);
    }).sort(function (a, b) { return a.finishVar - b.finishVar; });
    if (pathDiffs.length > 0) {
      var epDetails = pathDiffs.slice(0, 10).map(function (d) {
        return {
          taskName: shortName(d.task_name),
          block: blockTag(d),
          finishShift: d.finishVar,
          predComparison: comparePredecessors(d, R.baseline, R.optimized),
        };
      });
      levers.push({
        type: 'execution_path',
        label: 'Execution Path',
        summary: pathDiffs.length + ' activit' + (pathDiffs.length === 1 ? 'y' : 'ies') + ' with changed predecessor logic',
        details: epDetails,
        count: pathDiffs.length,
      });
    }

    // 3. Parallel Execution
    var overlapDiffs = preMC.filter(function (d) {
      return d.logic && d.logic.newSS > 0 && Math.abs(d.finishVar) > 1;
    }).sort(function (a, b) { return a.finishVar - b.finishVar; });
    if (overlapDiffs.length > 0) {
      var parDetails = overlapDiffs.slice(0, 8).map(function (d) {
        return {
          taskName: shortName(d.task_name),
          block: blockTag(d),
          predName: d.logic.drivingPredName ? shortName(d.logic.drivingPredName) : 'predecessor',
          finishShift: Math.abs(d.finishVar).toFixed(0),
          bEnd: fmtDate(d.bEnd),
          oEnd: fmtDate(d.oEnd),
        };
      });
      levers.push({
        type: 'parallel',
        label: 'Parallel Execution',
        summary: overlapDiffs.length + ' activit' + (overlapDiffs.length === 1 ? 'y' : 'ies') + ' now overlap predecessors (FS \u2192 SS)',
        details: parDetails,
        count: overlapDiffs.length,
      });
    }

    // 4. Duration Compression
    var durDiffs = preMC.filter(function (d) {
      return d.durVar < -1 && d.laborVar > 0.5 && Math.abs(d.startVar) < 5;
    }).sort(function (a, b) { return a.durVar - b.durVar; });
    if (durDiffs.length > 0) {
      var dcDetails = durDiffs.slice(0, 8).map(function (d) {
        return {
          taskName: shortName(d.task_name),
          block: blockTag(d),
          bCrew: d.bCrewSize.toFixed(0),
          oCrew: d.oCrewSize.toFixed(0),
          bDur: d.bDurDays.toFixed(0),
          oDur: d.oDurDays.toFixed(0),
          saved: Math.abs(d.durVar).toFixed(0),
        };
      });
      levers.push({
        type: 'duration',
        label: 'Duration Compression',
        summary: durDiffs.length + ' activit' + (durDiffs.length === 1 ? 'y' : 'ies') + ' shortened via crew increase',
        details: dcDetails,
        count: durDiffs.length,
      });
    }

    // 5. Handoff Compression
    var handoffDiffs = preMC.filter(function (d) {
      return d.logic && d.logic.lagDelta < -24 && d.logic.sameDriving;
    }).sort(function (a, b) { return a.logic.lagDelta - b.logic.lagDelta; });
    if (handoffDiffs.length > 0) {
      var hoDetails = handoffDiffs.slice(0, 8).map(function (d) {
        var bGap = d.logic.bDrivingLagDays !== null ? Math.round(d.logic.bDrivingLagDays) : null;
        var oGap = d.logic.oDrivingLagDays !== null ? Math.round(d.logic.oDrivingLagDays) : null;
        return {
          taskName: shortName(d.task_name),
          block: blockTag(d),
          predName: d.logic.drivingPredName ? shortName(d.logic.drivingPredName) : 'predecessor',
          bGap: bGap,
          oGap: oGap,
          saved: (bGap !== null && oGap !== null) ? Math.abs(bGap - oGap) : Math.abs(Math.round(d.logic.lagDelta / 24)),
        };
      });
      levers.push({
        type: 'handoff',
        label: 'Handoff Compression',
        summary: handoffDiffs.length + ' handoff' + (handoffDiffs.length === 1 ? '' : 's') + ' tightened between predecessor trades',
        details: hoDetails,
        count: handoffDiffs.length,
      });
    }

    return levers;
  }

  ATT.generateEPCActions = function (aggregations, diffs, R) {
    var crewBuckets = [];
    var hasAliceCrewData = !!(R.bCrewData && R.oCrewData);

    if (hasAliceCrewData) {
      var bCD = R.bCrewData, oCD = R.oCrewData;
      var allCrewNames = {};
      bCD.crewNames.forEach(function (n) { allCrewNames[n] = true; });
      oCD.crewNames.forEach(function (n) { allCrewNames[n] = true; });

      Object.keys(allCrewNames).sort().forEach(function (crew) {
        var bP = bCD.crewPeaks[crew] || { peak: 0, date: null };
        var oP = oCD.crewPeaks[crew] || { peak: 0, date: null };
        if (bP.peak < 3 && oP.peak < 3) return;

        var shiftD = (bP.date && oP.date) ? Math.round((bP.date - oP.date) / 86400000) : 0;
        var crewDiffs = matchCrewToDiffs(crew, diffs);
        var levers = generateCrewLevers(crewDiffs, R);

        crewBuckets.push({
          crewName: shortName(crew),
          bPeakDate: bP.date,
          oPeakDate: oP.date,
          bPeakCount: Math.round(bP.peak),
          oPeakCount: Math.round(oP.peak),
          peakShiftDays: shiftD,
          levers: levers,
          taskCount: crewDiffs.length,
        });
      });
    } else {
      var commodities = {};
      diffs.forEach(function (d) {
        if (d.commodity && d.commodity !== 'Other' && d.commodity !== 'Milestones' && d.commodity !== 'Procurement') {
          if (!commodities[d.commodity]) commodities[d.commodity] = [];
          commodities[d.commodity].push(d);
        }
      });

      Object.keys(commodities).sort().forEach(function (comm) {
        var commDiffs = commodities[comm];
        var bPeak = sweepCrewPeak(commDiffs, 'bStart', 'bEnd', 'bCrewSize');
        var oPeak = sweepCrewPeak(commDiffs, 'oStart', 'oEnd', 'oCrewSize');
        var shiftD = (bPeak.date && oPeak.date) ? Math.round((bPeak.date - oPeak.date) / 86400000) : 0;
        var levers = generateCrewLevers(commDiffs, R);

        crewBuckets.push({
          crewName: comm,
          bPeakDate: bPeak.date,
          oPeakDate: oPeak.date,
          bPeakCount: bPeak.peak,
          oPeakCount: oPeak.peak,
          peakShiftDays: shiftD,
          levers: levers,
          taskCount: commDiffs.length,
        });
      });
    }

    crewBuckets.sort(function (a, b) { return Math.abs(b.peakShiftDays) - Math.abs(a.peakShiftDays); });
    return crewBuckets;
  };

})(window.ATT = window.ATT || {});
