(function (ATT) {
  'use strict';

  var TACTICS = ATT.TACTICS;
  var fmtDate = ATT.fmtDate;
  var dateDiffDays = ATT.dateDiffDays;
  var monthLabel = ATT.monthLabel;

  function shortName(name) { return (name || '').split(' - ')[0].replace(/_/g, ' ').trim(); }
  function nameWithBlock(name) {
    var short = shortName(name);
    var m = (name || '').match(/(\d+\.[A-Za-z]+\.\d+)/);
    return m ? short + ' (' + m[1] + ')' : short;
  }
  function blk(d) { return d.blockNotation || (d.blockNum ? 'Block ' + d.blockNum : ''); }

  var POST_MC_RE = /\beor\b|energiz|hot.commiss|substantial.complet|final.punch|closeout|demob|as.built|warranty|turnover|handover/i;

  function isPreMC(d, mcCutoff) {
    if (POST_MC_RE.test(d.task_name || '')) return false;
    if (mcCutoff && d.oStart && d.oStart >= mcCutoff) return false;
    return true;
  }

  ATT.generateEPCActions = function (aggregations, diffs, R) {
    var byTactic = aggregations.byTactic;
    var totalGainDays = R.totalGainDays, usingMC = R.usingMC;
    var bMCDate = R.bMCDate, oMCDate = R.oMCDate;
    var mcCutoff = oMCDate || bMCDate || null;
    var actions = [];

    var preMCDiffs = diffs.filter(function (d) { return isPreMC(d, mcCutoff); });

    function preMCTacticDiffs(tacticKey) {
      var bucket = byTactic[tacticKey];
      if (!bucket || !bucket.diffs) return [];
      return bucket.diffs.filter(function (d) { return isPreMC(d, mcCutoff); });
    }

    // ── 1. Earlier mobilizations ──
    var earlyMovers = preMCDiffs
      .filter(function (d) { return d.oStart && d.startVar < -3; })
      .sort(function (a, b) { return a.startVar - b.startVar; });

    var criticalMovers = earlyMovers.filter(function (d) { return d.oCritical; });
    var seenCommodities = {};

    criticalMovers.slice(0, 4).forEach(function (d) {
      if (seenCommodities[d.commodity]) return;
      seenCommodities[d.commodity] = true;
      var loc = blk(d);
      actions.push({
        priority: 'Critical',
        title: 'Mobilize ' + d.commodity + ' ' + Math.abs(d.startVar).toFixed(0) + 'd earlier' + (loc ? ' in ' + loc : '') + ' \u2014 starts ' + fmtDate(d.oStart),
        detail: '\u201C' + shortName(d.task_name) + '\u201D is on the critical path and must begin ' + Math.abs(d.startVar).toFixed(0) + ' days earlier than baseline. Get the sub on-site, trailers set, tools laid out, and crew badged in before ' + fmtDate(d.oStart) + '. Confirm material is on the laydown and rigging is available.',
        by: fmtDate(d.oStart)
      });
    });

    // ── 2. Crew increases per trade ──
    var crewDiffs = preMCDiffs.filter(function (d) { return d.laborVar > 0.5 && d.oStart; })
      .sort(function (a, b) { return b.laborVar - a.laborVar; });

    var crewByTrade = {};
    crewDiffs.forEach(function (d) {
      var k = d.commodity;
      if (!crewByTrade[k]) crewByTrade[k] = { total: 0, peak: 0, count: 0, earliest: d.oStart, latest: d.oEnd || d.oStart, diffs: [] };
      crewByTrade[k].total += d.laborVar;
      if (d.laborVar > crewByTrade[k].peak) crewByTrade[k].peak = d.laborVar;
      crewByTrade[k].count++;
      crewByTrade[k].diffs.push(d);
      if (d.oStart < crewByTrade[k].earliest) crewByTrade[k].earliest = d.oStart;
      if ((d.oEnd || d.oStart) > crewByTrade[k].latest) crewByTrade[k].latest = d.oEnd || d.oStart;
    });

    Object.entries(crewByTrade)
      .sort(function (a, b) { return b[1].peak - a[1].peak; })
      .slice(0, 2)
      .forEach(function (e) {
        var trade = e[0], info = e[1];
        var topTask = info.diffs[0];
        actions.push({
          priority: 'High',
          title: 'Add ' + info.peak.toFixed(0) + ' ' + trade + ' workers for \u201C' + shortName(topTask.task_name) + '\u201D' + (info.count > 1 ? ' (+' + (info.count - 1) + ' more activities)' : ''),
          detail: 'Need +' + info.peak.toFixed(0) + ' heads on the ground from ' + fmtDate(info.earliest) + ' through ' + fmtDate(info.latest) + '. Get the sub to commit crew counts in writing. Make sure there are enough harnesses, radios, and hand tools for the bigger gang. Verify parking, porta-johns, and break area can handle the extra headcount.',
          by: fmtDate(info.earliest)
        });
      });

    // ── 3. Reduce gaps between trades ──
    var handoffDiffs = preMCTacticDiffs(TACTICS.HANDOFF)
      .filter(function (d) { return d.logic && d.logic.lagDelta && d.logic.sameDriving; })
      .sort(function (a, b) { return a.logic.lagDelta - b.logic.lagDelta; });

    handoffDiffs.slice(0, 2).forEach(function (d) {
      var loc = blk(d);
      var bGap = d.logic.bDrivingLagDays !== null ? Math.round(d.logic.bDrivingLagDays) : null;
      var oGap = d.logic.oDrivingLagDays !== null ? Math.round(d.logic.oDrivingLagDays) : null;
      var predName = d.logic.drivingPredName ? nameWithBlock(d.logic.drivingPredName) : 'predecessor';
      var taskName = nameWithBlock(d.task_name);
      var gapStr = (bGap !== null && oGap !== null) ? bGap + 'd \u2192 ' + oGap + 'd' : '';
      actions.push({
        priority: 'High',
        title: 'Reduce gap before \u201C' + shortName(d.task_name) + '\u201D' + (loc ? ' in ' + loc : ''),
        detail: 'Predecessor: \u201C' + predName + '\u201D \u2192 Successor: \u201C' + taskName + '\u201D. Gap: ' + gapStr + '.',
        by: d.oStart ? fmtDate(d.oStart) : null
      });
    });

    // ── 4. Overlapping trades in the same area ──
    var overlapDiffs = preMCTacticDiffs(TACTICS.OVERLAP);
    if (overlapDiffs.length > 0) {
      var overlapPairs = {};
      overlapDiffs.forEach(function (d) {
        var loc = blk(d) || 'Site';
        var key = loc + '|' + d.commodity;
        if (!overlapPairs[key]) overlapPairs[key] = { loc: loc, commodity: d.commodity, count: 0, earliest: d.oStart };
        overlapPairs[key].count++;
        if (d.oStart && d.oStart < overlapPairs[key].earliest) overlapPairs[key].earliest = d.oStart;
      });

      Object.values(overlapPairs)
        .sort(function (a, b) { return b.count - a.count; })
        .slice(0, 2)
        .forEach(function (p) {
          actions.push({
            priority: 'High',
            title: 'Run concurrent ' + p.commodity + ' work in ' + p.loc + ' \u2014 ' + p.count + ' activities overlap predecessors',
            detail: 'Two trades will be working the same area at the same time. Rope off zones, stagger lifts, and make sure each foreman knows exactly which rows or tables are theirs. Run a joint tailboard every morning so both crews know where the other one is. First overlap starts ' + fmtDate(p.earliest) + '.',
            by: fmtDate(p.earliest)
          });
        });
    }

    // ── 5. Duration compressions ──
    var durationCuts = preMCDiffs
      .filter(function (d) { return d.durationVar < -0.5 && d.oStart; })
      .sort(function (a, b) { return a.durationVar - b.durationVar; });

    var durationByTrade = {};
    durationCuts.forEach(function (d) {
      var k = d.commodity;
      if (!durationByTrade[k]) durationByTrade[k] = { maxCut: 0, count: 0, topTask: null };
      durationByTrade[k].count++;
      if (Math.abs(d.durationVar) > durationByTrade[k].maxCut) {
        durationByTrade[k].maxCut = Math.abs(d.durationVar);
        durationByTrade[k].topTask = d;
      }
    });

    Object.entries(durationByTrade)
      .sort(function (a, b) { return b[1].maxCut - a[1].maxCut; })
      .slice(0, 2)
      .forEach(function (e) {
        var trade = e[0], info = e[1];
        var d = info.topTask;
        var loc = blk(d);
        actions.push({
          priority: 'High',
          title: 'Complete \u201C' + shortName(d.task_name) + '\u201D ' + info.maxCut.toFixed(0) + 'd faster' + (loc ? ' in ' + loc : '') + ' \u2014 pre-stage materials by ' + fmtDate(d.oStart),
          detail: 'Have all material kitted and delivered to the workfront before the crew shows up \u2014 no waiting on forklifts or running back to the laydown. Pre-assemble what you can off the install area. Make sure the right equipment is there day one: torque wrenches, crimpers, cable carts, whatever the crew needs so they don\u2019t lose a single shift.',
          by: fmtDate(d.oStart)
        });
      });

    // ── 6. Peak-timing shifts ──
    var peakDiffs = preMCTacticDiffs(TACTICS.PEAK_TIMING);
    if (peakDiffs.length > 0) {
      var shiftByTrade = {};
      peakDiffs.forEach(function (d) {
        if (!d.bStart || !d.oStart) return;
        var k = d.commodity;
        if (!shiftByTrade[k]) shiftByTrade[k] = { count: 0, shifts: {} };
        var shift = monthLabel(d.bStart) + ' \u2192 ' + monthLabel(d.oStart);
        shiftByTrade[k].shifts[shift] = (shiftByTrade[k].shifts[shift] || 0) + 1;
        shiftByTrade[k].count++;
      });

      Object.entries(shiftByTrade)
        .sort(function (a, b) { return b[1].count - a[1].count; })
        .slice(0, 2)
        .forEach(function (e) {
          var trade = e[0], info = e[1];
          var topShift = Object.entries(info.shifts).sort(function (a, b) { return b[1] - a[1]; })[0];
          actions.push({
            priority: 'Medium',
            title: 'Move ' + trade + ' peak from ' + topShift[0] + ' \u2014 ' + info.count + ' activities shift',
            detail: 'The ' + trade + ' crew hits peak manning in a different month now. Call the sub and lock in the new dates. Rebook any rented equipment, trailers, and laydown reservations to match. Make sure material deliveries land before the new start \u2014 not on the old schedule.',
            by: null
          });
        });
    }

    // ── 7. Constraint-gated activities ──
    var constraintDiffs = preMCTacticDiffs(TACTICS.CONSTRAINT);
    if (constraintDiffs.length > 0) {
      var sorted = constraintDiffs.filter(function (d) { return d.oStart; }).sort(function (a, b) { return a.oStart - b.oStart; });
      sorted.slice(0, 2).forEach(function (d) {
        var loc = blk(d);
        actions.push({
          priority: 'Critical',
          title: 'Secure area access' + (loc ? ' for ' + loc : '') + ' by ' + fmtDate(d.oStart) + ' \u2014 \u201C' + shortName(d.task_name) + '\u201D is constraint-gated',
          detail: 'Crews can\u2019t touch this area until the permit or release comes through. Get the application submitted now, chase the approval weekly, and have a plan B if it\u2019s late. Once access is granted, be ready to roll \u2014 equipment, material, and crew should already be staged nearby.',
          by: fmtDate(d.oStart)
        });
      });
    }

    // ── 8. Material procurement pull-ins ──
    var bigPullIns = preMCDiffs
      .filter(function (d) { return d.startVar < -5 && d.oStart && d.durationVar >= -0.5; })
      .sort(function (a, b) { return a.startVar - b.startVar; });

    var procByTrade = {};
    bigPullIns.forEach(function (d) {
      var k = d.commodity;
      if (!procByTrade[k]) procByTrade[k] = { maxPull: 0, count: 0, topTask: null };
      procByTrade[k].count++;
      if (Math.abs(d.startVar) > procByTrade[k].maxPull) {
        procByTrade[k].maxPull = Math.abs(d.startVar);
        procByTrade[k].topTask = d;
      }
    });

    Object.entries(procByTrade)
      .filter(function (e) { return !seenCommodities[e[0]]; })
      .sort(function (a, b) { return b[1].maxPull - a[1].maxPull; })
      .slice(0, 2)
      .forEach(function (e) {
        var trade = e[0], info = e[1];
        var d = info.topTask;
        var loc = blk(d);
        actions.push({
          priority: 'Medium',
          title: 'Order ' + trade + ' materials ' + info.maxPull.toFixed(0) + 'd earlier' + (loc ? ' for ' + loc : '') + ' \u2014 needed on-site by ' + fmtDate(d.oStart),
          detail: '\u201C' + shortName(d.task_name) + '\u201D kicks off ' + info.maxPull.toFixed(0) + ' days sooner than the old plan. Place POs now, confirm delivery dates with the vendor, and make sure the laydown has space to receive it. If lead times are tight, get the procurement team on a weekly call with the supplier until it ships.',
          by: fmtDate(d.oStart)
        });
      });

    var order = { Critical: 0, High: 1, Medium: 2 };
    return actions.sort(function (a, b) { return order[a.priority] - order[b.priority]; }).slice(0, 10);
  };

})(window.ATT = window.ATT || {});
