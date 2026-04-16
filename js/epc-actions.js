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

    // ── 1. Consolidated Crew Peak Action ──
    var hasAliceCrewData = !!(R.bCrewData && R.oCrewData);
    var crewShifts = [];
    var siteShift = null;

    if (hasAliceCrewData) {
      var bCD = R.bCrewData, oCD = R.oCrewData;
      var bOverall = { peak: bCD.peakCount, date: bCD.peakDate };
      var oOverall = { peak: oCD.peakCount, date: oCD.peakDate };

      if (bOverall.date && oOverall.date) {
        var siteDays = Math.round((bOverall.date - oOverall.date) / 86400000);
        siteShift = { bPeak: bOverall.peak, oPeak: oOverall.peak, bDate: bOverall.date, oDate: oOverall.date, days: siteDays };
      }

      var allCrewNames = {};
      bCD.crewNames.forEach(function (n) { allCrewNames[n] = true; });
      oCD.crewNames.forEach(function (n) { allCrewNames[n] = true; });

      Object.keys(allCrewNames).sort().forEach(function (crew) {
        var bP = bCD.crewPeaks[crew] || { peak: 0, date: null };
        var oP = oCD.crewPeaks[crew] || { peak: 0, date: null };
        if (!bP.date || !oP.date) return;
        if (bP.peak < 3 && oP.peak < 3) return;
        var shiftD = Math.round((bP.date - oP.date) / 86400000);
        if (Math.abs(shiftD) < 7) return;

        crewShifts.push({
          name: shortName(crew),
          shiftDays: shiftD,
          bDate: bP.date,
          oDate: oP.date,
          bPeak: bP.peak,
          oPeak: oP.peak,
        });
      });
    } else {
      var crewDiffs = preMC.filter(function (d) {
        return d.commodity !== 'Other' && d.commodity !== 'Milestones' && d.commodity !== 'Procurement';
      });

      var bOverall = sweepCrewPeak(crewDiffs, 'bStart', 'bEnd', 'bCrewSize');
      var oOverall = sweepCrewPeak(crewDiffs, 'oStart', 'oEnd', 'oCrewSize');

      if (bOverall.date && oOverall.date) {
        var siteDays = Math.round((bOverall.date - oOverall.date) / 86400000);
        siteShift = { bPeak: bOverall.peak, oPeak: oOverall.peak, bDate: bOverall.date, oDate: oOverall.date, days: siteDays };
      }

      var tradeNames = {};
      crewDiffs.forEach(function (d) { tradeNames[d.commodity] = true; });

      Object.keys(tradeNames).sort().forEach(function (trade) {
        var tradeDiffs = crewDiffs.filter(function (d) { return d.commodity === trade; });
        var bPeak = sweepCrewPeak(tradeDiffs, 'bStart', 'bEnd', 'bCrewSize');
        var oPeak = sweepCrewPeak(tradeDiffs, 'oStart', 'oEnd', 'oCrewSize');
        if (!bPeak.date || !oPeak.date) return;
        if (bPeak.peak < 5 && oPeak.peak < 5) return;
        var shiftD = Math.round((bPeak.date - oPeak.date) / 86400000);
        if (Math.abs(shiftD) < 14) return;

        crewShifts.push({
          name: trade,
          shiftDays: shiftD,
          bDate: bPeak.date,
          oDate: oPeak.date,
          bPeak: bPeak.peak,
          oPeak: oPeak.peak,
        });
      });
    }

    var pulledForward = crewShifts.filter(function (c) { return c.shiftDays > 0; });
    var pushedBack = crewShifts.filter(function (c) { return c.shiftDays < 0; });

    // Always include a crew ramp-up action
    (function () {
      var bullets = [];
      var title, maxShift = 0, earliestODate = null;

      crewShifts.forEach(function (c) {
        if (Math.abs(c.shiftDays) > maxShift) maxShift = Math.abs(c.shiftDays);
        if (!earliestODate || c.oDate < earliestODate) earliestODate = c.oDate;
      });

      if (siteShift) {
        var siteDelta = siteShift.days;
        if (siteDelta > 0) {
          title = 'Crew ramp-up accelerated \u2014 site peak pulled forward ' + siteDelta + ' days';
        } else if (siteDelta < 0) {
          title = 'Crew ramp-up shifted \u2014 site peak moves ' + Math.abs(siteDelta) + ' days later';
        } else {
          title = 'Crew ramp-up timing unchanged \u2014 peak crew count adjusted';
        }
        bullets.push('Site peak moves from ' + fmtDate(siteShift.bDate) + ' to ' + fmtDate(siteShift.oDate) + ' (' + siteShift.oPeak + ' workers vs ' + siteShift.bPeak + ' baseline)');
      } else {
        title = 'Crew ramp-up accelerated';
        bullets.push('Optimized schedule adjusts crew mobilization timing across trades');
      }

      bullets.push('Activity resequencing compresses the ramp-up curve \u2014 trades reach peak manning earlier, shortening the critical path');

      if (pulledForward.length > 0 || pushedBack.length > 0) {
        bullets.push(pulledForward.length + ' crew(s) peak earlier, ' + pushedBack.length + ' shift later');
        if (maxShift > 0) title = title.replace(/accelerated/, 'accelerated \u2014 peaks shifted up to ' + maxShift + ' days');
      }

      var peakCount = siteShift ? siteShift.oPeak : '';
      var fieldNote = peakCount
        ? 'Confirm all subs can mobilize to peak manning by their new dates. Plan site infrastructure (laydown, parking, break areas) for ' + peakCount + ' workers' + (earliestODate ? ' by ' + fmtDate(earliestODate) : '') + '.'
        : 'Confirm all subs can mobilize to peak manning by their new dates.';

      actions.push({
        title: title,
        bullets: bullets,
        crewShifts: crewShifts.length > 0 ? crewShifts.sort(function (a, b) { return b.shiftDays - a.shiftDays; }) : [],
        fieldAction: fieldNote,
        priority: 'High',
        impact: maxShift || 10,
        weakLogic: false,
        weakLogicNote: '',
      });
    })();

    // ── 2. Parallel Execution (Logic FS -> SS) ──
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
        bullets: [
          'Logic changed from finish-to-start to start-to-start on ' + d.logic.newSS + ' relationship(s) \u2014 activity now overlaps its predecessor',
          'Parallel work fronts: two trades in the same area concurrently instead of sequentially',
          'Finish pulled forward ' + Math.abs(d.finishVar).toFixed(0) + 'd (' + fmtDate(d.bEnd) + ' \u2192 ' + fmtDate(d.oEnd) + ')',
        ],
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
          bullets: [
            'Crew increased from ' + d.bCrewSize.toFixed(0) + ' to ' + d.oCrewSize.toFixed(0) + ' (+' + d.laborVar.toFixed(0) + ' workers). Duration shortened by ' + Math.abs(d.durVar).toFixed(0) + 'd',
            'Higher crew loading \u2014 same work scope completed faster with more workers on the activity',
          ],
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

        info.diffs.forEach(function (d) { usedTasks[d.task_code] = true; });

        actions.push({
          title: (isConstraint ? 'Release ' : 'Resequence ') + loc + ' \u2014 ' + info.diffs.length + ' activities start ~' + Math.abs(avgShift) + 'd earlier',
          bullets: [
            info.diffs.length + ' activities in ' + loc + ' shift ~' + Math.abs(avgShift) + 'd earlier. Same scope, same crew, same durations',
            isConstraint
              ? 'Area constraint released earlier \u2014 ' + loc + ' available sooner than baseline'
              : 'Block execution resequenced \u2014 ' + loc + ' moves ahead in the construction sequence',
          ],
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
      var gapDelta = (bGap !== null && oGap !== null) ? Math.abs(bGap - oGap) : Math.abs(Math.round(d.logic.lagDelta / 24));

      actions.push({
        title: 'Close ' + gapDelta + 'd gap between \u201C' + shortName(d.logic.drivingPredName || '') + '\u201D and \u201C' + shortName(d.task_name) + '\u201D' + (loc ? ' in ' + loc : ''),
        bullets: [
          'Handoff gap reduced from ' + (bGap !== null ? bGap + 'd' : '?') + ' to ' + (oGap !== null ? oGap + 'd' : '?') + '. Same predecessor drives in both schedules',
          'Tighter trade handoff \u2014 predecessor completes and successor crew starts with less idle time between',
        ],
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
        bullets: [
          'Predecessor count: ' + d.logic.bPredCount + ' \u2192 ' + d.logic.oPredCount + '.' + (d.logic.added > 0 ? ' ' + d.logic.added + ' added.' : '') + (d.logic.removed > 0 ? ' ' + d.logic.removed + ' removed.' : '') + ' Finish shifted ' + Math.abs(d.finishVar).toFixed(0) + 'd',
          'Execution path restructured \u2014 the optimized schedule uses a different predecessor/successor chain than baseline',
        ],
        fieldAction: 'Review the optimized predecessor logic for this activity. Verify the new construction sequence is executable in the field before committing crew.',
        priority: 'Medium',
        impact: Math.abs(d.finishVar),
        weakLogic: true,
        weakLogicNote: 'Logic path differs between baseline and optimized. ' + (d.logic.added || 0) + ' predecessor(s) added, ' + (d.logic.removed || 0) + ' removed. This is not a like-for-like comparison \u2014 the construction sequence was restructured.',
      });
    });

    var prioOrder = { Critical: 0, High: 1, Medium: 2 };
    actions.sort(function (a, b) {
      var pa = prioOrder[a.priority] || 2, pb = prioOrder[b.priority] || 2;
      if (pa !== pb) return pa - pb;
      return (b.impact || 0) - (a.impact || 0);
    });

    return actions.slice(0, 8);
  };

})(window.ATT = window.ATT || {});
