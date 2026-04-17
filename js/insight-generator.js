(function (ATT) {
  'use strict';

  var TACTICS = ATT.TACTICS;
  var fmtDate = ATT.fmtDate;
  var monthLabel = ATT.monthLabel;

  ATT.generateInsights = function (aggregations, diffs, totalGainDays) {
    var insights = [];
    var byTactic = aggregations.byTactic;

    var sortedTactics = Object.entries(byTactic)
      .map(function (e) { return { name: e[0], count: e[1].count, scaledDays: e[1].scaledDays, diffs: e[1].diffs }; })
      .sort(function (a, b) { return b.scaledDays - a.scaledDays; })
      .slice(0, 6);

    for (var i = 0; i < sortedTactics.length; i++) {
      var t = sortedTactics[i];
      if (!t.scaledDays || t.scaledDays < 0.5) continue;

      var blockCount = {}, commCount = {};
      for (var di = 0; di < t.diffs.length; di++) {
        var dd = t.diffs[di];
        blockCount[dd.blockNum || 'General'] = (blockCount[dd.blockNum || 'General'] || 0) + 1;
        commCount[dd.commodity] = (commCount[dd.commodity] || 0) + 1;
      }
      var topBlocks = Object.entries(blockCount).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 3)
        .map(function (e) { return e[0]; }).filter(function (b) { return b && b !== 'General'; });
      var topComm = Object.entries(commCount).sort(function (a, b) { return b[1] - a[1]; })[0];
      topComm = topComm ? topComm[0] : '';

      var blockStr = topBlocks.length ? 'Block' + (topBlocks.length > 1 ? 's' : '') + ' ' + topBlocks.join(', ') : 'across the project';
      var commStr = topComm ? ' in ' + topComm : '';

      var text = '', exec = '';
      switch (t.name) {
        case TACTICS.RESEQUENCING:
          text = 'About ' + Math.round(t.scaledDays) + ' of the ' + totalGainDays + ' saved days come from earlier area releases and resequenced workfronts' + commStr + ' in ' + blockStr + '.';
          exec = 'Execution requires area-by-area release discipline \u2014 field leads must be ready to mobilize immediately when each zone clears.';
          break;
        case TACTICS.RAMP:
          text = 'About ' + Math.round(t.scaledDays) + ' days come from earlier crew mobilization' + commStr + '. Trades ramp up sooner in the optimized plan, especially in ' + blockStr + '.';
          exec = 'Procurement and subcontractor agreements must be signed earlier to support the accelerated mobilization schedule.';
          break;
        case TACTICS.PEAK_TIMING:
          var shiftCounts = {};
          for (var pi = 0; pi < t.diffs.length; pi++) {
            if (t.diffs[pi].bStart && t.diffs[pi].oStart) {
              var key = monthLabel(t.diffs[pi].bStart) + ' \u2192 ' + monthLabel(t.diffs[pi].oStart);
              shiftCounts[key] = (shiftCounts[key] || 0) + 1;
            }
          }
          var topShift = Object.entries(shiftCounts).sort(function (a, b) { return b[1] - a[1]; })[0];
          topShift = topShift ? topShift[0] : 'a different month';
          text = 'About ' + Math.round(t.scaledDays) + ' days reflect crew peak re-timing' + commStr + ': ' + t.count + ' activities have the same crew size and duration but are scheduled in a different calendar month (most common shift: ' + topShift + ').';
          exec = 'Subcontractor schedules and site logistics \u2014 camp capacity, equipment, materials staging \u2014 must be updated to reflect the new peak periods.';
          break;
        case TACTICS.INTENSITY:
          text = 'About ' + Math.round(t.scaledDays) + ' days come from higher crew intensity' + commStr + ' \u2014 more workers on each activity compresses duration without adding calendar days.';
          exec = 'Crew sizing agreements and site logistics (laydown, equipment, safety supervision) must be scaled to support peak headcounts.';
          break;
        case TACTICS.OVERLAP:
          text = 'About ' + Math.round(t.scaledDays) + ' days come from earlier overlap of parallel trades' + commStr + ' \u2014 successor activities start while predecessors are still completing in ' + blockStr + '.';
          exec = 'Area managers must coordinate concurrent crews and establish clear front-of-work boundaries to avoid interference.';
          break;
        case TACTICS.HANDOFF:
          text = 'About ' + Math.round(t.scaledDays) + ' days come from tighter handoffs between sequential trades' + commStr + ' \u2014 the wait time between predecessor finish and successor start has been cut significantly.';
          exec = 'Punchlist and pre-acceptance processes must be streamlined so receiving trades can mobilize within days of handoff.';
          break;
        case TACTICS.CONSTRAINT:
          text = 'About ' + Math.round(t.scaledDays) + ' days come from constraint relief \u2014 calendar changes and removed date constraints allow earlier work in ' + blockStr + '.';
          exec = 'Permit and regulatory milestones must be tracked weekly. Any permit delay cascades directly into the critical path.';
          break;
        case TACTICS.CP:
          text = 'About ' + Math.round(t.scaledDays) + ' days reflect critical path migration \u2014 activities shifted on or off the driving path, changing where schedule risk lives.';
          exec = 'Project controls must update the driving path analysis monthly and redirect weekly lookahead focus accordingly.';
          break;
        default:
          text = 'About ' + Math.round(t.scaledDays) + ' days come from ' + t.name.toLowerCase() + ' in ' + blockStr + '.';
          exec = 'Field leads should review these activities in the 6-week lookahead.';
      }

      insights.push({ tactic: t.name, text: text, exec: exec, days: Math.round(t.scaledDays) });
    }

    // Commodity-level insights aligned with the Gain by Commodity chart
    var byCommodity = aggregations.byCommodity || {};
    var commEntries = Object.entries(byCommodity)
      .map(function (e) { return { name: e[0], val: Math.abs(e[1].totalFinishVar), diffs: e[1].diffs }; })
      .filter(function (c) { return c.val > 0 && c.name !== 'Other' && c.name !== 'Milestones' && c.name !== 'Procurement'; })
      .sort(function (a, b) { return b.val - a.val; });
    var commTotal = commEntries.reduce(function (s, c) { return s + c.val; }, 0) || 1;

    var topComms = commEntries.slice(0, 4);
    for (var ci = 0; ci < topComms.length; ci++) {
      var comm = topComms[ci];
      var pct = Math.round((comm.val / commTotal) * 100);
      if (pct < 5) continue;

      var tacticBreakdown = {};
      for (var di2 = 0; di2 < comm.diffs.length; di2++) {
        var cd = comm.diffs[di2];
        var impact = Math.abs(cd.finishVar || 0);
        if (!cd.tactics) continue;
        for (var ti2 = 0; ti2 < cd.tactics.length; ti2++) {
          var tn2 = cd.tactics[ti2].tactic;
          if (tn2 === 'No Change') continue;
          tacticBreakdown[tn2] = (tacticBreakdown[tn2] || 0) + impact;
        }
      }

      var sortedLevers = Object.entries(tacticBreakdown)
        .sort(function (a, b) { return b[1] - a[1]; });
      if (!sortedLevers.length) continue;

      var leverTotal = sortedLevers.reduce(function (s, l) { return s + l[1]; }, 0) || 1;
      var topLever = sortedLevers[0];
      var topLeverPct = Math.round((topLever[1] / leverTotal) * 100);
      var topLeverName = topLever[0].toLowerCase();

      var commText = pct + '% of schedule gains come from ' + comm.name;
      if (topLeverPct >= 50) {
        commText += ', driven primarily by ' + topLeverName;
      } else if (sortedLevers.length >= 2) {
        commText += ', split between ' + topLeverName + ' and ' + sortedLevers[1][0].toLowerCase();
      }

      insights.push({
        tactic: sortedLevers[0][0],
        text: commText,
        days: null,
        isCommodityInsight: true,
      });
    }

    return insights;
  };

})(window.ATT = window.ATT || {});
