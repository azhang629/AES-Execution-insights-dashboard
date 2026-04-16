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

    // ── 2. Parallel Execution (Logic FS -> SS) ── consolidated
    var overlapDiffs = preMC.filter(function (d) {
      return d.logic && d.logic.newSS > 0 && Math.abs(d.finishVar) > 1 && !usedTasks[d.task_code];
    }).sort(function (a, b) { return a.finishVar - b.finishVar; });

    if (overlapDiffs.length > 0) {
      var olItems = overlapDiffs.slice(0, 8).map(function (d) {
        usedTasks[d.task_code] = true;
        var loc = blockTag(d);
        var predLabel = d.logic.drivingPredName ? shortName(d.logic.drivingPredName) : 'predecessor';
        return {
          text: shortName(d.task_name) + (loc ? ' (' + loc + ')' : '') + ' \u2014 run parallel with ' + predLabel + ', finish ' + Math.abs(d.finishVar).toFixed(0) + 'd earlier (' + fmtDate(d.bEnd) + ' \u2192 ' + fmtDate(d.oEnd) + ')',
          weak: !d.logic.sameDriving,
        };
      });
      var totalOlGain = overlapDiffs.slice(0, 8).reduce(function (s, d) { return s + Math.abs(d.finishVar); }, 0);
      var anyOlCrit = overlapDiffs.slice(0, 8).some(function (d) { return d.oCritical; });

      actions.push({
        title: 'Parallel Execution \u2014 ' + olItems.length + ' activit' + (olItems.length === 1 ? 'y' : 'ies') + ' overlap predecessors',
        bullets: [
          'Logic changed from finish-to-start to start-to-start \u2014 activities now overlap predecessors instead of waiting',
          'Coordinate zone boundaries so two trades can work the same area concurrently',
        ],
        subItems: olItems,
        priority: anyOlCrit ? 'Critical' : 'High',
        impact: totalOlGain,
        weakLogic: olItems.some(function (it) { return it.weak; }),
        weakLogicNote: olItems.some(function (it) { return it.weak; }) ? 'Some items have differing driving predecessors between schedules \u2014 not a direct like-for-like comparison.' : '',
      });
    }

    // ── 3. Duration Compression via Crew Increase ── consolidated
    var crewCompDiffs = preMC.filter(function (d) {
      return d.durVar < -1 && d.laborVar > 0.5 && Math.abs(d.startVar) < 5 && !usedTasks[d.task_code];
    }).sort(function (a, b) { return a.durVar - b.durVar; });

    if (crewCompDiffs.length > 0) {
      var ccItems = crewCompDiffs.slice(0, 8).map(function (d) {
        usedTasks[d.task_code] = true;
        var loc = blockTag(d);
        return {
          text: shortName(d.task_name) + (loc ? ' (' + loc + ')' : '') + ' \u2014 crew ' + d.bCrewSize.toFixed(0) + ' \u2192 ' + d.oCrewSize.toFixed(0) + ', duration ' + d.bDurDays.toFixed(0) + 'd \u2192 ' + d.oDurDays.toFixed(0) + 'd (\u2212' + Math.abs(d.durVar).toFixed(0) + 'd)',
        };
      });
      var totalCcGain = crewCompDiffs.slice(0, 8).reduce(function (s, d) { return s + Math.abs(d.durVar); }, 0);
      var anyCcCrit = crewCompDiffs.slice(0, 8).some(function (d) { return d.oCritical; });

      actions.push({
        title: 'Duration Compression \u2014 ' + ccItems.length + ' activit' + (ccItems.length === 1 ? 'y' : 'ies') + ' shortened via crew increase',
        bullets: [
          'Higher crew loading \u2014 same work scope completed faster with more workers on each activity',
          'Confirm subs can commit to the higher crew counts in writing before start',
        ],
        subItems: ccItems,
        priority: anyCcCrit ? 'Critical' : 'High',
        impact: totalCcGain,
        weakLogic: false,
        weakLogicNote: '',
      });
    }

    // ── 4. Block Resequencing / Area Release ── consolidated
    var reseqDiffs = preMC.filter(function (d) {
      return d.startVar < -5 && Math.abs(d.durVar) < 1 && Math.abs(d.laborVar) < 0.5 && d.blockNum && !usedTasks[d.task_code];
    });

    var reseqByBlock = {};
    reseqDiffs.forEach(function (d) {
      var k = d.blockNum;
      if (!reseqByBlock[k]) reseqByBlock[k] = { diffs: [], totalShift: 0 };
      reseqByBlock[k].diffs.push(d);
      reseqByBlock[k].totalShift += d.startVar;
    });

    var reseqBlocks = Object.entries(reseqByBlock)
      .filter(function (e) { return e[1].diffs.length >= 3; })
      .sort(function (a, b) { return a[1].totalShift - b[1].totalShift; });

    if (reseqBlocks.length > 0) {
      var rsItems = [];
      var totalRsImpact = 0;
      var anyRsCrit = false;

      reseqBlocks.forEach(function (e) {
        var block = e[0], info = e[1];
        var avgShift = Math.round(info.totalShift / info.diffs.length);
        var earliest = info.diffs.sort(function (a, b) { return a.oStart - b.oStart; })[0];
        var loc = 'Block ' + block;

        var constraintCount = info.diffs.filter(function (d) {
          return d.tactics.some(function (t) { return t.tactic === TACTICS.CONSTRAINT; });
        }).length;
        var isConstraint = constraintCount > info.diffs.length * 0.5;

        info.diffs.forEach(function (d) { usedTasks[d.task_code] = true; });
        if (info.diffs.some(function (d) { return d.oCritical; })) anyRsCrit = true;
        totalRsImpact += Math.abs(avgShift) * info.diffs.length;

        rsItems.push({
          text: loc + ' \u2014 ' + info.diffs.length + ' activities start ~' + Math.abs(avgShift) + 'd earlier' +
            (isConstraint ? ' (area constraint released)' : ' (block resequenced)') +
            '. Start by ' + fmtDate(earliest.oStart),
        });
      });

      actions.push({
        title: 'Block Resequencing \u2014 ' + reseqBlocks.length + ' block' + (reseqBlocks.length === 1 ? '' : 's') + ' move ahead in construction sequence',
        bullets: [
          'Blocks execute in a different order \u2014 same scope, same crew, same durations but earlier start dates',
          'Coordinate with adjacent blocks to avoid resource conflicts at the new start dates',
        ],
        subItems: rsItems,
        priority: anyRsCrit ? 'Critical' : 'High',
        impact: totalRsImpact,
        weakLogic: false,
        weakLogicNote: '',
      });
    }

    // ── 5. Handoff Compression (same driving predecessor) ── consolidated
    var handoffDiffs = preMC.filter(function (d) {
      return d.logic && d.logic.lagDelta < -24 && d.logic.sameDriving && !usedTasks[d.task_code];
    }).sort(function (a, b) { return a.logic.lagDelta - b.logic.lagDelta; });

    if (handoffDiffs.length > 0) {
      var hoItems = handoffDiffs.slice(0, 8).map(function (d) {
        usedTasks[d.task_code] = true;
        var loc = blockTag(d);
        var bGap = d.logic.bDrivingLagDays !== null ? Math.round(d.logic.bDrivingLagDays) : null;
        var oGap = d.logic.oDrivingLagDays !== null ? Math.round(d.logic.oDrivingLagDays) : null;
        var predName = d.logic.drivingPredName ? shortName(d.logic.drivingPredName) : 'predecessor';
        var gapDelta = (bGap !== null && oGap !== null) ? Math.abs(bGap - oGap) : Math.abs(Math.round(d.logic.lagDelta / 24));
        return {
          text: shortName(d.task_name) + (loc ? ' (' + loc + ')' : '') + ' \u2014 gap after ' + predName + ' reduced ' + (bGap !== null ? bGap + 'd' : '?') + ' \u2192 ' + (oGap !== null ? oGap + 'd' : '?') + ' (\u2212' + gapDelta + 'd)',
        };
      });
      var totalHoGain = hoItems.length;
      var anyHoCrit = handoffDiffs.slice(0, 8).some(function (d) { return d.oCritical; });

      actions.push({
        title: 'Handoff Compression \u2014 ' + hoItems.length + ' trade handoff' + (hoItems.length === 1 ? '' : 's') + ' tightened',
        bullets: [
          'Idle time between predecessor and successor trades reduced \u2014 crews start sooner after the previous trade finishes',
          'Predecessor crew must finish clean with no punch items blocking the next trade',
        ],
        subItems: hoItems,
        priority: anyHoCrit ? 'Critical' : 'High',
        impact: totalHoGain * 10,
        weakLogic: false,
        weakLogicNote: '',
      });
    }

    // ── 6. Changed Execution Path (weak logic flag) ── consolidated
    var changedPaths = preMC.filter(function (d) {
      return Math.abs(d.finishVar) > 5 && d.logic && !usedTasks[d.task_code] &&
        (d.logic.added > 2 || d.logic.removed > 2 ||
         (!d.logic.sameDriving && d.logic.bPredCount !== d.logic.oPredCount));
    }).sort(function (a, b) { return a.finishVar - b.finishVar; });

    if (changedPaths.length > 0) {
      var cpItems = changedPaths.slice(0, 6).map(function (d) {
        usedTasks[d.task_code] = true;
        var loc = blockTag(d);
        return {
          text: shortName(d.task_name) + (loc ? ' (' + loc + ')' : '') + ' \u2014 preds ' + d.logic.bPredCount + ' \u2192 ' + d.logic.oPredCount + ', finish shifted ' + Math.abs(d.finishVar).toFixed(0) + 'd',
        };
      });

      actions.push({
        title: 'Execution Path Restructured \u2014 ' + cpItems.length + ' activit' + (cpItems.length === 1 ? 'y' : 'ies') + ' with changed predecessor logic',
        bullets: [
          'Optimized schedule uses different predecessor/successor chains than baseline',
          'Review optimized logic for each activity \u2014 verify the new construction sequence is executable in the field',
        ],
        subItems: cpItems,
        priority: 'Medium',
        impact: changedPaths.slice(0, 6).reduce(function (s, d) { return s + Math.abs(d.finishVar); }, 0),
        weakLogic: true,
        weakLogicNote: 'Logic paths differ between baseline and optimized \u2014 these are not like-for-like comparisons. The construction sequence was restructured.',
      });
    }

    var prioOrder = { Critical: 0, High: 1, Medium: 2 };
    actions.sort(function (a, b) {
      var pa = prioOrder[a.priority] || 2, pb = prioOrder[b.priority] || 2;
      if (pa !== pb) return pa - pb;
      return (b.impact || 0) - (a.impact || 0);
    });

    return actions.slice(0, 8);
  };

})(window.ATT = window.ATT || {});
