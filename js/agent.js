(function (ATT) {
  'use strict';

  var TACTICS = ATT.TACTICS;
  var fmtDate = ATT.fmtDate;
  var fmtDays = ATT.fmtDays;
  var dateDiffDays = ATT.dateDiffDays;
  var monthLabel = ATT.monthLabel;

  function topN(obj, n) {
    return Object.entries(obj).sort(function (a, b) { return b[1] - a[1]; }).slice(0, n || 3);
  }

  ATT.computeAgentAnswer = function (q, results) {
    if (!results) return 'Please upload and analyze schedules first.';
    var diffs = results.diffs, aggregations = results.aggregations;
    var totalGainDays = results.totalGainDays, usingMC = results.usingMC;
    var bMCDate = results.bMCDate, oMCDate = results.oMCDate;
    var bSubstDate = results.bSubstDate, oSubstDate = results.oSubstDate;
    var insights = results.insights, requirements = results.requirements;
    var ql = q.toLowerCase();

    // Mechanical completion / milestone dates
    if (/mechanical.?complet|mc date|\bmc\b|cod\b|substantial.?complet|milestone date/i.test(ql)) {
      var mcGain = (bMCDate && oMCDate) ? Math.round(dateDiffDays(oMCDate, bMCDate)) : null;
      var substGain = (bSubstDate && oSubstDate) ? Math.round(dateDiffDays(oSubstDate, bSubstDate)) : null;
      var ans = '';
      if (bMCDate) ans += '<b>Mechanical Completion:</b> ' + fmtDate(bMCDate) + ' \u2192 ' + fmtDate(oMCDate);
      if (mcGain !== null) ans += '  <span style="color:#22d3a8">(' + Math.abs(mcGain) + 'd earlier)</span>';
      if (results.bCODDate) ans += '<br><b>COD:</b> ' + fmtDate(results.bCODDate) + ' \u2192 ' + fmtDate(results.oCODDate);
      if (bSubstDate) ans += '<br><b>Substantial Completion:</b> ' + fmtDate(bSubstDate) + ' \u2192 ' + fmtDate(oSubstDate);
      if (substGain !== null) ans += '  <span style="color:#22d3a8">(' + Math.abs(substGain) + 'd earlier)</span>';
      return ans || 'No specific milestone dates found in these schedules.';
    }

    // What drove the most gain?
    if (/drove|most gain|biggest|top tactic|primary driver/i.test(ql)) {
      var compLabel = usingMC ? 'MC' : 'schedule';
      var sortedT = Object.entries(aggregations.byTactic)
        .map(function (e) { return { n: e[0], d: e[1].scaledDays || 0 }; })
        .sort(function (a, b) { return b.d - a.d; }).slice(0, 3);
      return 'The top 3 drivers of the <b>' + totalGainDays + '-day ' + compLabel + ' improvement</b> are:<br><br>' +
        sortedT.map(function (t, i) { return '<b>' + (i + 1) + '. ' + t.n + '</b> (~' + Math.round(t.d) + ' days)'; }).join('<br>');
    }

    // Critical path
    if (/critical path|driving path|cp /i.test(ql)) {
      var gained = diffs.filter(function (d) { return d.bCritical && !d.oCritical; }).length;
      var became = diffs.filter(function (d) { return !d.bCritical && d.oCritical; }).length;
      var still = diffs.filter(function (d) { return d.bCritical && d.oCritical; }).length;
      var topCP = diffs.filter(function (d) { return d.oCritical; }).sort(function (a, b) { return a.finishVar - b.finishVar; }).slice(0, 3);
      return 'Critical path shifts:<br><br>\u2022 <b>' + gained + '</b> activities moved <b>off</b> the critical path (gained buffer)<br>\u2022 <b>' + became + '</b> moved <b>onto</b> the critical path<br>\u2022 <b>' + still + '</b> remain near-critical in both<br><br>Top near-critical:<br>' +
        topCP.map(function (d) { return '\u2022 ' + d.task_name.substring(0, 50) + '\u2026 (finish: ' + fmtDate(d.oEnd) + ')'; }).join('<br>');
    }

    // Block query
    var blockMatch = ql.match(/block\s*(\d+)/i) || ql.match(/area\s*([a-d0-9])/i);
    if (blockMatch) {
      var bn = blockMatch[1];
      var blockDiffs = diffs.filter(function (d) { return d.blockNum === bn; });
      if (blockDiffs.length === 0) {
        var available = Array.from(new Set(diffs.map(function (d) { return d.blockNum; }).filter(Boolean))).sort();
        return 'No activities found for Block ' + bn + '. Available blocks: ' + available.join(', ') + '.';
      }
      var avgShift = blockDiffs.reduce(function (s, d) { return s + d.finishVar; }, 0) / blockDiffs.length;
      var topTactic = topN(blockDiffs.flatMap(function (d) { return d.tactics; }).reduce(function (acc, t) { acc[t.tactic] = (acc[t.tactic] || 0) + 1; return acc; }, {}), 1)[0];
      var topCommodity = topN(blockDiffs.reduce(function (acc, d) { acc[d.commodity] = (acc[d.commodity] || 0) + 1; return acc; }, {}), 1)[0];
      return '<b>Block ' + bn + '</b> has <b>' + blockDiffs.length + '</b> matched activities.<br><br>Average finish shift: <b>' + (-avgShift).toFixed(1) + ' days earlier</b>.<br>Primary driver: <b>' + (topTactic ? topTactic[0] : 'mixed') + '</b> (' + (topTactic ? topTactic[1] : 0) + ' activities).<br>Most affected trade: <b>' + (topCommodity ? topCommodity[0] : 'mixed') + '</b>.';
    }

    // Float / slack
    if (/float|slack|buffer/i.test(ql)) {
      var floatImproved = diffs.filter(function (d) { return d.floatVar > 1; }).length;
      var floatReduced = diffs.filter(function (d) { return d.floatVar < -1; }).length;
      var avgFloatChange = diffs.reduce(function (s, d) { return s + d.floatVar; }, 0) / diffs.length;
      return '<b>Float (schedule slack) changes:</b><br><br>\u2022 <b>' + floatImproved + '</b> activities gained float (more buffer)<br>\u2022 <b>' + floatReduced + '</b> activities lost float (less buffer)<br>\u2022 Average float change: <b>' + avgFloatChange.toFixed(1) + ' days</b><br><br>Activities that lost float may need closer monitoring in the weekly lookahead.';
    }

    // Crew / resource
    if (/crew|labor|worker|resource|headcount|manpower/i.test(ql)) {
      var crewChanges = diffs.filter(function (d) { return Math.abs(d.laborVar) > 0.5; });
      var increased = crewChanges.filter(function (d) { return d.laborVar > 0.5; });
      var decreased = crewChanges.filter(function (d) { return d.laborVar < -0.5; });
      var maxIncrease = increased.reduce(function (m, d) { return d.laborVar > m.v ? { v: d.laborVar, n: d.task_name } : m; }, { v: 0, n: '' });
      var crewDaysGain = Math.round((aggregations.byTactic[TACTICS.INTENSITY] ? aggregations.byTactic[TACTICS.INTENSITY].scaledDays : 0) + (aggregations.byTactic[TACTICS.RAMP] ? aggregations.byTactic[TACTICS.RAMP].scaledDays : 0));
      return 'Crew changes across <b>' + crewChanges.length + '</b> activities:<br><br>\u2022 <b>' + increased.length + '</b> with increased crew<br>\u2022 <b>' + decreased.length + '</b> with reduced crew<br><br>Largest increase: <b>+' + maxIncrease.v.toFixed(1) + '/hr</b> on ' + maxIncrease.n.substring(0, 50) + '\u2026<br><br>Crew intensity/ramp tactics account for ~' + crewDaysGain + ' days of the total gain.';
    }

    // Resequencing
    if (/resequen|sequence|order|workfront/i.test(ql)) {
      var rd = aggregations.byTactic[TACTICS.RESEQUENCING];
      if (!rd) return 'No resequencing changes identified in this analysis.';
      var topRBlocks = topN(rd.diffs.reduce(function (a, d) { a[d.blockNum || 'General'] = (a[d.blockNum || 'General'] || 0) + 1; return a; }, {}), 3);
      return '<b>Workfront Resequencing</b> affects <b>' + rd.count + '</b> activities (~' + Math.round(rd.scaledDays) + ' days of gain).<br><br>Most activity in: <b>' + topRBlocks.map(function (b) { return b[0] === 'General' ? 'General work' : 'Block ' + b[0]; }).join(', ') + '</b>.<br><br>Pattern: activities start earlier because their area was released sooner, without changing crew size or duration.';
    }

    // Crew peak timing
    if (/peak timing|peak.?time|different month|month shift|re.?tim|when.*crew|crew.*when|season/i.test(ql)) {
      var pd = aggregations.byTactic[TACTICS.PEAK_TIMING];
      if (!pd) return 'No crew peak timing changes were identified.';
      var shiftCounts = {};
      for (var pi = 0; pi < pd.diffs.length; pi++) {
        if (pd.diffs[pi].bStart && pd.diffs[pi].oStart) {
          var sk = monthLabel(pd.diffs[pi].bStart) + ' \u2192 ' + monthLabel(pd.diffs[pi].oStart);
          shiftCounts[sk] = (shiftCounts[sk] || 0) + 1;
        }
      }
      var topShifts = topN(shiftCounts, 4);
      var commBreakdown = topN(pd.diffs.reduce(function (a, d) { a[d.commodity] = (a[d.commodity] || 0) + 1; return a; }, {}), 4);
      return '<b>Crew Peak Timing</b> \u2014 ' + pd.count + ' activities (~' + Math.round(pd.scaledDays) + ' days impact).<br><br><b>Month shifts:</b><br>' + topShifts.map(function (s) { return '\u2022 ' + s[0] + ': ' + s[1] + ' activities'; }).join('<br>') + '<br><br><b>By trade:</b><br>' + commBreakdown.map(function (c) { return '\u2022 ' + c[0] + ': ' + c[1] + ' activities'; }).join('<br>');
    }

    // Handoff
    if (/handoff|hand.?off|compress|lag|wait/i.test(ql)) {
      var hd = aggregations.byTactic[TACTICS.HANDOFF];
      if (!hd) return 'No significant handoff compression identified.';
      var avgLag = hd.diffs.reduce(function (s, d) { return s + Math.abs(d.logic.lagDelta) / 24; }, 0) / (hd.diffs.length || 1);
      return '<b>Handoff Compression</b> affects <b>' + hd.count + '</b> activities (~' + Math.round(hd.scaledDays) + ' days of gain).<br><br>Average lag reduction: <b>' + avgLag.toFixed(1) + ' working days</b> per handoff.<br><br>This requires punchlist sign-off and trade mobilization within days of predecessor completion.';
    }

    // Overlap
    if (/overlap|parallel|concurrent|trade/i.test(ql)) {
      var od = aggregations.byTactic[TACTICS.OVERLAP];
      if (!od) return 'No trade overlap changes identified.';
      return '<b>Trade Overlap</b> affects <b>' + od.count + '</b> activities (~' + Math.round(od.scaledDays) + ' days of gain).<br><br>The optimized plan introduces start-to-start relationships allowing successor trades to begin while predecessors are still completing. Requires concurrent area management.';
    }

    // Constraint
    if (/constraint|permit|area.?release/i.test(ql)) {
      var cd = aggregations.byTactic[TACTICS.CONSTRAINT];
      if (!cd) return 'No constraint relief changes identified.';
      return '<b>Constraint Relief</b> affects <b>' + cd.count + '</b> activities (~' + Math.round(cd.scaledDays) + ' days of gain).<br><br>Activities benefit from earlier area releases or relaxed calendar constraints. Any permit or area-access delay will cascade back to the baseline dates.';
    }

    // Field team / do differently
    if (/field team|field lead|do differently|operationally|require|must/i.test(ql)) {
      return requirements.slice(0, 3).map(function (r) {
        return '<b>' + r.icon + ' ' + r.title + '</b><br>' + r.detail.substring(0, 180) + '\u2026';
      }).join('<br><br>');
    }

    // Commodity / trade
    if (/commodity|trade|pile|tracker|module|dc|ac|inverter|commission/i.test(ql)) {
      var sorted = Object.entries(aggregations.byCommodity)
        .map(function (e) { return { n: e[0], gain: -e[1].totalFinishVar / e[1].count }; })
        .sort(function (a, b) { return b.gain - a.gain; }).slice(0, 5);
      return 'Average finish improvement by trade (days earlier):<br><br>' +
        sorted.map(function (c) { return '\u2022 <b>' + c.n + '</b>: ' + c.gain.toFixed(1) + 'd avg improvement'; }).join('<br>');
    }

    // Duration changes
    if (/duration|shorter|longer|compress/i.test(ql)) {
      var durChanged = diffs.filter(function (d) { return Math.abs(d.durVar) > 0.5; });
      var shorter = durChanged.filter(function (d) { return d.durVar < -0.5; });
      var longer = durChanged.filter(function (d) { return d.durVar > 0.5; });
      return '<b>Duration changes:</b><br><br>\u2022 <b>' + shorter.length + '</b> activities with shorter duration<br>\u2022 <b>' + longer.length + '</b> activities with longer duration<br><br>Most compressions are associated with higher crew intensity (more workers = shorter duration with same work scope).';
    }

    // EPC actions
    if (/action|epc|plan|what.*do|implement/i.test(ql)) {
      if (results.epcActions && results.epcActions.length) {
        return '<b>Top EPC Actions:</b><br><br>' + results.epcActions.slice(0, 3).map(function (a, i) {
          return '<b>' + (i + 1) + '. [' + a.priority + '] ' + a.title + '</b>';
        }).join('<br>');
      }
      return 'No EPC actions generated \u2014 the schedule differences may be minimal.';
    }

    // Default
    var topT = Object.entries(aggregations.byTactic).sort(function (a, b) { return (b[1].scaledDays || 0) - (a[1].scaledDays || 0); })[0];
    var compLabel2 = usingMC ? 'Mechanical Completion' : 'project end';
    var bComp = usingMC ? bMCDate : bSubstDate;
    var oComp = usingMC ? oMCDate : oSubstDate;
    return 'The optimized schedule pulls in <b>' + compLabel2 + '</b> by <b>' + totalGainDays + ' days</b> (' + fmtDate(bComp) + ' \u2192 ' + fmtDate(oComp) + ').<br><br>Top driver: <b>' + (topT ? topT[0] : 'mixed') + '</b> (~' + Math.round(topT ? topT[1].scaledDays || 0 : 0) + ' days).<br><br>Try: <em>"What changed in Block 3?"</em>, <em>"Where is the biggest handoff compression?"</em>, or <em>"What do field teams need to do differently?"</em>';
  };

  ATT.appendMsg = function (text, role) {
    var msgs = document.getElementById('agent-messages');
    var div = document.createElement('div');
    div.className = 'msg msg-' + role;
    div.innerHTML = text;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  };

  ATT.sendAgent = function () {
    var inp = document.getElementById('agent-input');
    var q = inp.value.trim();
    if (!q) return;
    inp.value = '';
    ATT.askAgent(q);
  };

  ATT.askAgent = function (question) {
    ATT.appendMsg(question, 'user');
    var answer = ATT.computeAgentAnswer(question, window.APP ? window.APP.results : null);
    setTimeout(function () { ATT.appendMsg(answer, 'agent'); }, 400);
  };

})(window.ATT = window.ATT || {});
