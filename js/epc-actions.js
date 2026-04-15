(function (ATT) {
  'use strict';

  var TACTICS = ATT.TACTICS;
  var fmtDate = ATT.fmtDate;
  var monthLabel = ATT.monthLabel;

  function shortName(name) { return (name || '').split(' - ')[0].replace(/_/g, ' ').trim(); }
  function nameWithBlock(name) {
    var short = shortName(name);
    var m = (name || '').match(/(\d+\.[A-Za-z]+\.\d+)/);
    return m ? short + ' (' + m[1] + ')' : short;
  }
  function blockTag(d) { return d.blockNotation || (d.blockNum ? 'Block ' + d.blockNum : ''); }

  var POST_MC_RE = /\beor\b|energiz|hot.commiss|substantial.complet|final.punch|closeout|demob|as.built|warranty|turnover|handover/i;

  function isPreMC(d, mcCutoff) {
    if (POST_MC_RE.test(d.task_name || '')) return false;
    if (mcCutoff && d.oStart && d.oStart >= mcCutoff) return false;
    return true;
  }

  function dominantTactic(diffs) {
    var counts = {};
    diffs.forEach(function (d) {
      (d.tactics || []).forEach(function (t) {
        if (t.tactic !== 'No Change') counts[t.tactic] = (counts[t.tactic] || 0) + 1;
      });
    });
    var top = Object.entries(counts).sort(function (a, b) { return b[1] - a[1]; })[0];
    return top ? top[0] : '';
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

  ATT.generateEPCActions = function (aggregations, diffs, R) {
    var mcCutoff = R.oMCDate || R.bMCDate || null;
    var actions = [];
    var preMC = diffs.filter(function (d) { return isPreMC(d, mcCutoff) && d.oStart && d.bStart; });
    var usedTasks = {};

    // ── 1. Crew Peak Timing Shifts ──
    var hasAliceCrewData = !!(R.bCrewData && R.oCrewData);

    if (hasAliceCrewData) {
      var bCD = R.bCrewData, oCD = R.oCrewData;
      var bOverall = { peak: bCD.peakCount, date: bCD.peakDate };
      var oOverall = { peak: oCD.peakCount, date: oCD.peakDate };

      if (bOverall.date && oOverall.date && ATT.differentMonth(bOverall.date, oOverall.date)) {
        var shiftDays = Math.round(Math.abs(bOverall.date - oOverall.date) / 86400000);
        actions.push({
          title: 'Site crew peak moves from ' + fmtDate(bOverall.date) + ' to ' + fmtDate(oOverall.date),
          baselineState: 'Peak: ' + bOverall.peak + ' workers on ' + fmtDate(bOverall.date),
          optimizedState: 'Peak: ' + oOverall.peak + ' workers on ' + fmtDate(oOverall.date),
          whatChanged: 'Peak crew date shifts ' + shiftDays + 'd. Headcount: ' + bOverall.peak + ' \u2192 ' + oOverall.peak + ' workers.',
          rootCause: 'Activity resequencing changes when the most trades overlap on-site, moving the peak manning date',
          fieldAction: 'Plan site infrastructure (parking, laydown, porta-johns, break areas) for ' + oOverall.peak + ' workers by ' + fmtDate(oOverall.date) + '. Confirm all subs can staff simultaneously.',
          priority: 'High',
          impact: shiftDays,
          weakLogic: false,
          weakLogicNote: '',
        });
      }

      var allCrewNames = {};
      bCD.crewNames.forEach(function (n) { allCrewNames[n] = true; });
      oCD.crewNames.forEach(function (n) { allCrewNames[n] = true; });

      Object.keys(allCrewNames).forEach(function (crew) {
        var bP = bCD.crewPeaks[crew] || { peak: 0, date: null };
        var oP = oCD.crewPeaks[crew] || { peak: 0, date: null };
        if (!bP.date || !oP.date || !ATT.differentMonth(bP.date, oP.date)) return;
        if (bP.peak < 5 && oP.peak < 5) return;
        var shiftD = Math.round(Math.abs(bP.date - oP.date) / 86400000);
        if (shiftD < 14) return;

        actions.push({
          title: 'Move \u201C' + crew + '\u201D peak from ' + fmtDate(bP.date) + ' to ' + fmtDate(oP.date),
          baselineState: crew + ' peak: ' + bP.peak + ' workers on ' + fmtDate(bP.date),
          optimizedState: crew + ' peak: ' + oP.peak + ' workers on ' + fmtDate(oP.date),
          whatChanged: crew + ' peak manning date shifts ' + shiftD + 'd. Headcount: ' + bP.peak + ' \u2192 ' + oP.peak + ' workers.',
          rootCause: 'Activity resequencing changes when this crew is most utilized, moving its peak date',
          fieldAction: 'Confirm ' + crew + ' can staff ' + oP.peak + ' workers by ' + fmtDate(oP.date) + '. Adjust mobilization date and material deliveries.',
          priority: 'High',
          impact: shiftD,
          weakLogic: false,
          weakLogicNote: '',
        });
      });
    } else {
      var crewDiffs = preMC.filter(function (d) {
        return d.commodity !== 'Other' && d.commodity !== 'Milestones' && d.commodity !== 'Procurement';
      });

      var bOverall = sweepCrewPeak(crewDiffs, 'bStart', 'bEnd', 'bCrewSize');
      var oOverall = sweepCrewPeak(crewDiffs, 'oStart', 'oEnd', 'oCrewSize');

      if (bOverall.date && oOverall.date && ATT.differentMonth(bOverall.date, oOverall.date)) {
        var shiftDays = Math.round(Math.abs(bOverall.date - oOverall.date) / 86400000);
        actions.push({
          title: 'Site crew peak moves from ' + fmtDate(bOverall.date) + ' to ' + fmtDate(oOverall.date),
          baselineState: 'Peak: ' + bOverall.peak + ' workers on ' + fmtDate(bOverall.date),
          optimizedState: 'Peak: ' + oOverall.peak + ' workers on ' + fmtDate(oOverall.date),
          whatChanged: 'Peak crew date shifts ' + shiftDays + 'd. Headcount: ' + bOverall.peak + ' \u2192 ' + oOverall.peak + ' workers.',
          rootCause: 'Activity resequencing changes when the most trades overlap on-site, moving the peak manning date',
          fieldAction: 'Plan site infrastructure (parking, laydown, porta-johns, break areas) for ' + oOverall.peak + ' workers by ' + fmtDate(oOverall.date) + '. Confirm all subs can staff simultaneously.',
          priority: 'High',
          impact: shiftDays,
          weakLogic: false,
          weakLogicNote: '',
        });
      }

      var tradeNames = {};
      crewDiffs.forEach(function (d) { tradeNames[d.commodity] = true; });

      Object.keys(tradeNames).forEach(function (trade) {
        var tradeDiffs = crewDiffs.filter(function (d) { return d.commodity === trade; });
        var bPeak = sweepCrewPeak(tradeDiffs, 'bStart', 'bEnd', 'bCrewSize');
        var oPeak = sweepCrewPeak(tradeDiffs, 'oStart', 'oEnd', 'oCrewSize');
        if (!bPeak.date || !oPeak.date || !ATT.differentMonth(bPeak.date, oPeak.date)) return;
        if (bPeak.peak < 5 && oPeak.peak < 5) return;
        var shiftD = Math.round(Math.abs(bPeak.date - oPeak.date) / 86400000);
        if (shiftD < 14) return;

        actions.push({
          title: 'Move ' + trade + ' crew peak from ' + fmtDate(bPeak.date) + ' to ' + fmtDate(oPeak.date),
          baselineState: trade + ' peak: ' + bPeak.peak + ' workers on ' + fmtDate(bPeak.date),
          optimizedState: trade + ' peak: ' + oPeak.peak + ' workers on ' + fmtDate(oPeak.date),
          whatChanged: trade + ' peak manning date shifts ' + shiftD + 'd. Headcount: ' + bPeak.peak + ' \u2192 ' + oPeak.peak + ' workers.',
          rootCause: 'Activity resequencing changes when the most ' + trade + ' activities overlap, moving the trade peak',
          fieldAction: 'Confirm ' + trade + ' sub can staff ' + oPeak.peak + ' workers by ' + fmtDate(oPeak.date) + '. Adjust mobilization date and material deliveries.',
          priority: 'High',
          impact: shiftD,
          weakLogic: false,
          weakLogicNote: '',
        });
      });
    }

    // ── 2. Parallel Execution (Logic FS → SS) ──
    var overlapDiffs = preMC.filter(function (d) {
      return d.logic && d.logic.newSS > 0 && Math.abs(d.finishVar) > 1 && !usedTasks[d.task_code];
    }).sort(function (a, b) { return a.finishVar - b.finishVar; });

    overlapDiffs.slice(0, 2).forEach(function (d) {
      usedTasks[d.task_code] = true;
      var loc = blockTag(d);
      var predLabel = d.logic.drivingPredName ? '\u201C' + shortName(d.logic.drivingPredName) + '\u201D' : 'predecessor';
      var weak = !d.logic.sameDriving;
      var weakNote = '';
      if (weak) {
        weakNote = 'Driving predecessor differs between schedules' +
          (d.logic.bPredCount !== d.logic.oPredCount ? ' (predecessor count: ' + d.logic.bPredCount + ' \u2192 ' + d.logic.oPredCount + ')' : '') +
          '. Execution path was restructured \u2014 not a direct like-for-like comparison.';
      }

      actions.push({
        title: 'Run \u201C' + shortName(d.task_name) + '\u201D parallel with ' + predLabel + (loc ? ' in ' + loc : ''),
        baselineState: 'Sequential (FS). ' + d.logic.bPredCount + ' predecessors. Start: ' + fmtDate(d.bStart) + ', Finish: ' + fmtDate(d.bEnd),
        optimizedState: 'Parallel (SS). ' + d.logic.oPredCount + ' predecessors (' + d.logic.newSS + ' new SS). Start: ' + fmtDate(d.oStart) + ', Finish: ' + fmtDate(d.oEnd),
        whatChanged: 'Logic changed from finish-to-start to start-to-start on ' + d.logic.newSS + ' relationship(s). Activity now overlaps its predecessor.',
        rootCause: 'Parallel work fronts \u2014 two trades in the same area concurrently instead of sequentially',
        fieldAction: 'Coordinate zone boundaries between ' + shortName(d.task_name) + ' and ' + predLabel + ' crews. Foremen agree on work zones and sequence within the shared area before either trade starts.',
        priority: d.oCritical ? 'Critical' : 'High',
        impact: Math.abs(d.finishVar),
        weakLogic: weak,
        weakLogicNote: weakNote,
      });
    });

    // ── 3. Duration Compression via Crew Increase ──
    var crewCompByTrade = {};
    preMC.filter(function (d) {
      return d.durVar < -1 && d.laborVar > 0.5 && Math.abs(d.startVar) < 5 && !usedTasks[d.task_code];
    }).forEach(function (d) {
      var k = d.commodity;
      if (!crewCompByTrade[k] || Math.abs(d.durVar) > Math.abs(crewCompByTrade[k].durVar)) {
        crewCompByTrade[k] = d;
      }
    });

    Object.values(crewCompByTrade)
      .sort(function (a, b) { return a.durVar - b.durVar; })
      .slice(0, 2)
      .forEach(function (d) {
        usedTasks[d.task_code] = true;
        var loc = blockTag(d);
        actions.push({
          title: 'Add ' + d.laborVar.toFixed(0) + ' workers to \u201C' + shortName(d.task_name) + '\u201D' + (loc ? ' in ' + loc : '') + ' \u2014 compress ' + d.bDurDays.toFixed(0) + 'd to ' + d.oDurDays.toFixed(0) + 'd',
          baselineState: d.bCrewSize.toFixed(0) + ' crew, ' + d.bDurDays.toFixed(0) + 'd duration. Start: ' + fmtDate(d.bStart) + ', Finish: ' + fmtDate(d.bEnd),
          optimizedState: d.oCrewSize.toFixed(0) + ' crew, ' + d.oDurDays.toFixed(0) + 'd duration. Start: ' + fmtDate(d.oStart) + ', Finish: ' + fmtDate(d.oEnd),
          whatChanged: 'Crew increased from ' + d.bCrewSize.toFixed(0) + ' to ' + d.oCrewSize.toFixed(0) + ' (+' + d.laborVar.toFixed(0) + '). Duration shortened by ' + Math.abs(d.durVar).toFixed(0) + 'd.',
          rootCause: 'Higher crew loading \u2014 same work scope completed faster with more workers on the activity',
          fieldAction: 'Get sub to commit ' + d.oCrewSize.toFixed(0) + ' crew in writing (up from ' + d.bCrewSize.toFixed(0) + '). Ensure tools and equipment for the larger gang are staged at the workfront before start.',
          priority: d.oCritical ? 'Critical' : 'High',
          impact: Math.abs(d.durVar),
          weakLogic: false,
          weakLogicNote: '',
        });
      });

    // ── 4. Block Resequencing / Area Release ──
    var reseqDiffs = preMC.filter(function (d) {
      return d.startVar < -5 && Math.abs(d.durVar) < 1 && Math.abs(d.laborVar) < 0.5 && d.blockNum;
    });

    var reseqByBlock = {};
    reseqDiffs.forEach(function (d) {
      var k = d.blockNum;
      if (!reseqByBlock[k]) reseqByBlock[k] = { diffs: [], totalShift: 0 };
      reseqByBlock[k].diffs.push(d);
      reseqByBlock[k].totalShift += d.startVar;
    });

    Object.entries(reseqByBlock)
      .filter(function (e) { return e[1].diffs.length >= 3; })
      .sort(function (a, b) { return a[1].totalShift - b[1].totalShift; })
      .slice(0, 2)
      .forEach(function (e) {
        var block = e[0], info = e[1];
        var avgShift = Math.round(info.totalShift / info.diffs.length);
        var earliest = info.diffs.sort(function (a, b) { return a.oStart - b.oStart; })[0];
        var loc = 'Block ' + block;

        var constraintCount = info.diffs.filter(function (d) {
          return d.tactics.some(function (t) { return t.tactic === TACTICS.CONSTRAINT; });
        }).length;
        var isConstraint = constraintCount > info.diffs.length * 0.5;
        var cause = isConstraint
          ? 'Area constraint released earlier \u2014 ' + loc + ' available sooner than baseline'
          : 'Block execution resequenced \u2014 ' + loc + ' moves ahead in the construction sequence';

        info.diffs.forEach(function (d) { usedTasks[d.task_code] = true; });

        actions.push({
          title: (isConstraint ? 'Release ' : 'Resequence ') + loc + ' \u2014 ' + info.diffs.length + ' activities start ~' + Math.abs(avgShift) + 'd earlier',
          baselineState: info.diffs.length + ' activities in ' + loc + '. First start: ' + fmtDate(earliest.bStart),
          optimizedState: info.diffs.length + ' activities in ' + loc + '. First start: ' + fmtDate(earliest.oStart),
          whatChanged: info.diffs.length + ' activities in ' + loc + ' shift ~' + Math.abs(avgShift) + 'd earlier. Same scope, same crew, same durations.',
          rootCause: cause,
          fieldAction: isConstraint
            ? 'Secure area access for ' + loc + ' by ' + fmtDate(earliest.oStart) + '. Permit/release must be in hand before crew mobilizes.'
            : 'Execute ' + loc + ' starting ' + fmtDate(earliest.oStart) + '. Coordinate with adjacent blocks to avoid resource conflicts.',
          priority: info.diffs.some(function (d) { return d.oCritical; }) ? 'Critical' : 'High',
          impact: Math.abs(avgShift) * info.diffs.length,
          weakLogic: false,
          weakLogicNote: '',
        });
      });

    // ── 5. Handoff Compression (same driving predecessor) ──
    var handoffDiffs = preMC.filter(function (d) {
      return d.logic && d.logic.lagDelta < -24 && d.logic.sameDriving && !usedTasks[d.task_code];
    }).sort(function (a, b) { return a.logic.lagDelta - b.logic.lagDelta; });

    handoffDiffs.slice(0, 2).forEach(function (d) {
      usedTasks[d.task_code] = true;
      var loc = blockTag(d);
      var bGap = d.logic.bDrivingLagDays !== null ? Math.round(d.logic.bDrivingLagDays) : null;
      var oGap = d.logic.oDrivingLagDays !== null ? Math.round(d.logic.oDrivingLagDays) : null;
      var predName = d.logic.drivingPredName ? nameWithBlock(d.logic.drivingPredName) : 'predecessor';
      var taskName = nameWithBlock(d.task_name);
      var gapDelta = (bGap !== null && oGap !== null) ? Math.abs(bGap - oGap) : Math.abs(Math.round(d.logic.lagDelta / 24));

      actions.push({
        title: 'Close ' + gapDelta + 'd gap between \u201C' + shortName(d.logic.drivingPredName || '') + '\u201D and \u201C' + shortName(d.task_name) + '\u201D' + (loc ? ' in ' + loc : ''),
        baselineState: predName + ' \u2192 ' + taskName + '. Gap: ' + (bGap !== null ? bGap + 'd' : 'unknown') + '. Successor start: ' + fmtDate(d.bStart),
        optimizedState: predName + ' \u2192 ' + taskName + '. Gap: ' + (oGap !== null ? oGap + 'd' : 'unknown') + '. Successor start: ' + fmtDate(d.oStart),
        whatChanged: 'Handoff gap reduced from ' + (bGap !== null ? bGap + 'd' : '?') + ' to ' + (oGap !== null ? oGap + 'd' : '?') + '. Same predecessor drives in both schedules.',
        rootCause: 'Tighter trade handoff \u2014 predecessor completes and successor crew starts with less idle time between',
        fieldAction: 'Predecessor crew must finish clean with no punch items blocking the next trade. Successor crew staged and ready to start within ' + (oGap !== null ? oGap + 'd' : 'reduced gap') + ' of predecessor completion.',
        priority: d.oCritical ? 'Critical' : 'High',
        impact: gapDelta,
        weakLogic: false,
        weakLogicNote: '',
      });
    });

    // ── 6. Changed Execution Path (weak logic flag) ──
    var changedPaths = preMC.filter(function (d) {
      return Math.abs(d.finishVar) > 5 && d.logic && !usedTasks[d.task_code] &&
        (d.logic.added > 2 || d.logic.removed > 2 ||
         (!d.logic.sameDriving && d.logic.bPredCount !== d.logic.oPredCount));
    }).sort(function (a, b) { return a.finishVar - b.finishVar; });

    changedPaths.slice(0, 1).forEach(function (d) {
      usedTasks[d.task_code] = true;
      var loc = blockTag(d);
      actions.push({
        title: '\u201C' + shortName(d.task_name) + '\u201D' + (loc ? ' in ' + loc : '') + ' \u2014 execution path restructured',
        baselineState: d.logic.bPredCount + ' predecessors. Start: ' + fmtDate(d.bStart) + ', Finish: ' + fmtDate(d.bEnd),
        optimizedState: d.logic.oPredCount + ' predecessors. Start: ' + fmtDate(d.oStart) + ', Finish: ' + fmtDate(d.oEnd),
        whatChanged: 'Predecessor count: ' + d.logic.bPredCount + ' \u2192 ' + d.logic.oPredCount + '.' + (d.logic.added > 0 ? ' ' + d.logic.added + ' added.' : '') + (d.logic.removed > 0 ? ' ' + d.logic.removed + ' removed.' : '') + ' Finish shifted ' + Math.abs(d.finishVar).toFixed(0) + 'd.',
        rootCause: 'Execution path restructured \u2014 the optimized schedule uses a different predecessor/successor chain than baseline',
        fieldAction: 'Review the optimized predecessor logic for this activity. Verify the new construction sequence is executable in the field before committing crew.',
        priority: 'Medium',
        impact: Math.abs(d.finishVar),
        weakLogic: true,
        weakLogicNote: 'Logic path differs between baseline and optimized. ' + (d.logic.added || 0) + ' predecessor(s) added, ' + (d.logic.removed || 0) + ' removed. This is not a like-for-like comparison \u2014 the construction sequence was restructured.',
      });
    });

    // Sort: Critical first, then by impact
    var prioOrder = { Critical: 0, High: 1, Medium: 2 };
    actions.sort(function (a, b) {
      var pa = prioOrder[a.priority] || 2, pb = prioOrder[b.priority] || 2;
      if (pa !== pb) return pa - pb;
      return (b.impact || 0) - (a.impact || 0);
    });

    return actions.slice(0, 8);
  };

})(window.ATT = window.ATT || {});
