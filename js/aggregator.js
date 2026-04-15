(function (ATT) {
  'use strict';

  ATT.aggregate = function (classifiedDiffs, totalGainDays) {
    var byTactic = {}, byBlock = {}, byCommodity = {}, byMonth = {};

    for (var i = 0; i < classifiedDiffs.length; i++) {
      var d = classifiedDiffs[i];

      for (var j = 0; j < d.tactics.length; j++) {
        var tac = d.tactics[j];
        if (tac.tactic === 'No Change') continue;
        if (!byTactic[tac.tactic]) byTactic[tac.tactic] = { count: 0, rawImpact: 0, diffs: [] };
        byTactic[tac.tactic].count++;
        byTactic[tac.tactic].rawImpact += tac.impactDays || 0;
        if (byTactic[tac.tactic].diffs.indexOf(d) === -1) byTactic[tac.tactic].diffs.push(d);
      }

      var bn = d.blockNum || 'General';
      if (!byBlock[bn]) byBlock[bn] = { count: 0, totalFinishVar: 0, diffs: [] };
      byBlock[bn].count++;
      byBlock[bn].totalFinishVar += d.finishVar;
      byBlock[bn].diffs.push(d);

      if (!byCommodity[d.commodity]) byCommodity[d.commodity] = { count: 0, totalFinishVar: 0, diffs: [] };
      byCommodity[d.commodity].count++;
      byCommodity[d.commodity].totalFinishVar += d.finishVar;
      byCommodity[d.commodity].diffs.push(d);

      if (d.oStart) {
        var m = d.oStart.getFullYear() + '-' + String(d.oStart.getMonth() + 1).padStart(2, '0');
        if (!byMonth[m]) byMonth[m] = { count: 0, laborB: 0, laborO: 0, tacticCounts: {} };
        byMonth[m].count++;
        byMonth[m].laborB += d.bCrewSize * (d.bDurDays || 0);
        byMonth[m].laborO += d.oCrewSize * (d.oDurDays || 0);
        for (var ti = 0; ti < d.tactics.length; ti++) {
          var tn = d.tactics[ti].tactic;
          if (tn === 'No Change') continue;
          byMonth[m].tacticCounts[tn] = (byMonth[m].tacticCounts[tn] || 0) + 1;
        }
      }
    }

    var totalRaw = Object.values(byTactic).reduce(function (s, v) { return s + v.rawImpact; }, 0);
    var scale = totalRaw > 0 ? totalGainDays / totalRaw : 1;
    var tacVals = Object.values(byTactic);
    for (var k = 0; k < tacVals.length; k++) {
      tacVals[k].scaledDays = Math.round(tacVals[k].rawImpact * scale * 10) / 10;
    }

    return { byTactic: byTactic, byBlock: byBlock, byCommodity: byCommodity, byMonth: byMonth };
  };

})(window.ATT = window.ATT || {});
