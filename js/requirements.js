(function (ATT) {
  'use strict';

  var TACTICS = ATT.TACTICS;
  var fmtDate = ATT.fmtDate;
  var monthLabel = ATT.monthLabel;

  ATT.generateRequirements = function (aggregations, diffs, totalGainDays) {
    var reqs = [];
    var byTactic = aggregations.byTactic;

    var earliestOptStart = diffs
      .filter(function (d) { return d.oStart && d.finishVar < -3; })
      .sort(function (a, b) { return a.oStart - b.oStart; })[0];
    if (earliestOptStart) {
      reqs.push({ category: 'Mobilization', icon: '\uD83D\uDE80', priority: 'Critical',
        title: 'Earlier Crew Mobilization Required',
        detail: 'The first impacted activities start ' + Math.abs(earliestOptStart.startVar).toFixed(0) + ' days earlier than the baseline. Key trades \u2014 especially ' + earliestOptStart.commodity + ' \u2014 must be under contract and mobilized by ' + fmtDate(earliestOptStart.oStart) + '.',
        date: fmtDate(earliestOptStart.oStart) });
    }

    var constraintDiffs = (byTactic[TACTICS.CONSTRAINT] ? byTactic[TACTICS.CONSTRAINT].diffs : []).sort(function (a, b) { return a.oStart - b.oStart; });
    if (constraintDiffs.length > 0) {
      reqs.push({ category: 'Permitting', icon: '\uD83D\uDCCB', priority: 'Critical',
        title: 'Permit & Constraint Milestones Must Hold',
        detail: constraintDiffs.length + ' activities have earlier dates because constraints were relaxed. If the land disturbance permit or any area-release constraint slips, these activities will cascade back toward the baseline. Permit status must be tracked weekly starting ' + fmtDate(constraintDiffs[0].oStart) + '.',
        date: fmtDate(constraintDiffs[0].oStart) });
    }

    var handoffDiffs = byTactic[TACTICS.HANDOFF] ? byTactic[TACTICS.HANDOFF].diffs : [];
    if (handoffDiffs.length > 5) {
      var avgLagCut = handoffDiffs.reduce(function (s, d) { return s + Math.abs(d.logic.lagDelta) / 24; }, 0) / handoffDiffs.length;
      reqs.push({ category: 'Field Discipline', icon: '\u26A1', priority: 'High',
        title: 'Tighter Handoff Discipline Between Trades',
        detail: 'The optimized plan assumes an average ' + avgLagCut.toFixed(1) + '-day reduction in wait time between sequential trades across ' + handoffDiffs.length + ' handoffs. Punchlist sign-offs, QC inspections, and trade mobilization must happen within days \u2014 not weeks \u2014 of handoff.',
        date: null });
    }

    var crewDiffs = (byTactic[TACTICS.INTENSITY] ? byTactic[TACTICS.INTENSITY].diffs : []).concat(byTactic[TACTICS.RAMP] ? byTactic[TACTICS.RAMP].diffs : []);
    if (crewDiffs.length > 0) {
      var maxCrewIncrease = crewDiffs.reduce(function (m, d) { return Math.max(m, d.laborVar); }, 0);
      var peakMonth = crewDiffs.filter(function (d) { return d.oStart; }).sort(function (a, b) { return b.laborVar - a.laborVar; })[0];
      reqs.push({ category: 'Resources', icon: '\uD83D\uDC77', priority: 'High',
        title: 'Higher Peak Crew Capacity Required',
        detail: crewDiffs.length + ' activities require larger crews than the baseline. Peak increase of ~' + maxCrewIncrease.toFixed(0) + ' workers/hr' + (peakMonth ? ' concentrated around ' + fmtDate(peakMonth.oStart) : '') + '. Confirm subcontractor max crew commitments and site accommodation are sized accordingly.',
        date: peakMonth ? fmtDate(peakMonth.oStart) : null });
    }

    var overlapDiffs = byTactic[TACTICS.OVERLAP] ? byTactic[TACTICS.OVERLAP].diffs : [];
    if (overlapDiffs.length > 3) {
      reqs.push({ category: 'Area Management', icon: '\uD83D\uDD04', priority: 'High',
        title: 'Concurrent Trade Coordination Needed',
        detail: overlapDiffs.length + ' activities now overlap with predecessors that are still active. Area managers must maintain clear front-of-work maps, daily coordination meetings between trades, and defined exclusion zones.',
        date: null });
    }

    var peakDiffs = byTactic[TACTICS.PEAK_TIMING] ? byTactic[TACTICS.PEAK_TIMING].diffs : [];
    if (peakDiffs.length > 3) {
      var commCount = peakDiffs.reduce(function (a, d) { a[d.commodity] = (a[d.commodity] || 0) + 1; return a; }, {});
      var topComm = Object.entries(commCount).sort(function (a, b) { return b[1] - a[1]; })[0];
      var shiftCounts = {};
      for (var si = 0; si < peakDiffs.length; si++) {
        if (peakDiffs[si].bStart && peakDiffs[si].oStart) {
          var key = monthLabel(peakDiffs[si].bStart) + ' \u2192 ' + monthLabel(peakDiffs[si].oStart);
          shiftCounts[key] = (shiftCounts[key] || 0) + 1;
        }
      }
      var topShift = Object.entries(shiftCounts).sort(function (a, b) { return b[1] - a[1]; })[0];
      reqs.push({ category: 'Resources', icon: '\uD83D\uDCC5', priority: 'High',
        title: 'Update Crew Mobilization Dates \u2014 Peak Periods Have Shifted',
        detail: peakDiffs.length + ' activities \u2014 primarily ' + (topComm ? topComm[0] : 'key trades') + ' \u2014 have the same crew size and work scope as the baseline but are now scheduled in a different calendar month (most common shift: ' + (topShift ? topShift[0] : 'new windows') + '). Subcontractor mobilization notices and equipment reservations must be renegotiated.',
        date: null });
    }

    var reseqDiffs = byTactic[TACTICS.RESEQUENCING] ? byTactic[TACTICS.RESEQUENCING].diffs : [];
    if (reseqDiffs.length > 5) {
      var topReseqBlock = Object.entries(reseqDiffs.reduce(function (acc, d) { acc[d.blockNum || 'General'] = (acc[d.blockNum || 'General'] || 0) + 1; return acc; }, {}))
        .sort(function (a, b) { return b[1] - a[1]; })[0];
      reqs.push({ category: 'Scheduling', icon: '\uD83D\uDDD3\uFE0F', priority: 'Medium',
        title: 'Updated Lookahead Must Reflect New Sequence',
        detail: reseqDiffs.length + ' activities have been resequenced \u2014 the order of blocks and sub-areas has changed. Field superintendents must receive updated 6-week lookaheads that reflect the new sequence' + (topReseqBlock && topReseqBlock[0] !== 'General' ? ', especially in Block ' + topReseqBlock[0] : '') + '.',
        date: null });
    }

    var criticalFinishers = diffs
      .filter(function (d) { return d.oCritical; })
      .sort(function (a, b) { return b.oEnd - a.oEnd; })
      .slice(0, 3);
    if (criticalFinishers.length > 0) {
      reqs.push({ category: 'Project Controls', icon: '\uD83C\uDFAF', priority: 'Medium',
        title: 'Track Critical Path Weekly Through Completion',
        detail: 'The final ' + criticalFinishers.length + ' activities on the critical path \u2014 including ' + criticalFinishers[0].task_name.split(' - ')[0] + ' \u2014 must be tracked against the optimized schedule every week. A 1-day slip on these activities equals 1 day of project delay.',
        date: fmtDate(criticalFinishers[0].oEnd) });
    }

    return reqs;
  };

})(window.ATT = window.ATT || {});
