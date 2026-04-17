(function (ATT) {
  'use strict';

  var TACTICS = ATT.TACTICS;
  var fmtDate = ATT.fmtDate;

  function shortName(name) { return (name || '').replace(/_/g, ' ').trim(); }
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

  function normCrew(s) {
    return (s || '').toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function formatCrewForLabel(name) {
    var words = (name || '').split(/\s+/);
    var result = [];
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (w.toUpperCase() === 'EPC') {
        result.push('EPC');
      } else if (i > 0 && words[i - 1].toUpperCase() === 'EPC') {
        result.push(w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
      } else {
        result.push(w.toLowerCase());
      }
    }
    return "'" + result.join(' ') + "'";
  }

  function matchCrewToDiffs(crewName, diffs) {
    var rawCN = shortName(crewName);
    if (!rawCN) return [];

    // 1. Direct resource column match — "Crew: X" columns in the schedule CSV
    //    rsrc_name is the column header with "Crew: " stripped, so it should
    //    exactly match the crew names from the ALICE crew CSV.
    var byResource = diffs.filter(function (d) {
      var bRes = (d.b && d.b.resources) || [];
      var oRes = (d.o && d.o.resources) || [];
      return bRes.concat(oRes).some(function (r) {
        return normCrew(r.rsrc_name) === normCrew(rawCN);
      });
    });
    if (byResource.length > 0) return byResource;

    // 2. Fuzzy resource match (contains)
    var cn = normCrew(rawCN).replace(/\s+crew$/i, '');
    var byResFuzzy = diffs.filter(function (d) {
      var bRes = (d.b && d.b.resources) || [];
      var oRes = (d.o && d.o.resources) || [];
      return bRes.concat(oRes).some(function (r) {
        var rn = normCrew(r.rsrc_name).replace(/\s+crew$/i, '');
        return rn.indexOf(cn) >= 0 || cn.indexOf(rn) >= 0;
      });
    });
    if (byResFuzzy.length > 0) return byResFuzzy;

    // 3. Match by trade field on original task
    var byTrade = diffs.filter(function (d) {
      var t = normCrew(d.b ? d.b.trade : '');
      return t && (t === cn || t.indexOf(cn) >= 0 || cn.indexOf(t) >= 0);
    });
    if (byTrade.length > 0) return byTrade;

    // 4. Exact commodity match
    var exact = diffs.filter(function (d) {
      return d.commodity && normCrew(d.commodity) === cn;
    });
    if (exact.length > 0) return exact;

    // 5. Contains match on commodity
    var contains = diffs.filter(function (d) {
      if (!d.commodity) return false;
      var comm = normCrew(d.commodity);
      return cn.indexOf(comm) >= 0 || comm.indexOf(cn) >= 0;
    });
    if (contains.length > 0) return contains;

    // 6. Token overlap — at least 2 shared words
    var cnTokens = cn.split(' ');
    if (cnTokens.length >= 2) {
      return diffs.filter(function (d) {
        var comm = normCrew(d.commodity);
        var commTokens = comm.split(' ');
        var overlap = cnTokens.filter(function (t) { return commTokens.indexOf(t) >= 0; });
        return overlap.length >= 2;
      });
    }

    return [];
  }

  var _idNameCache = null;

  function buildIdNameMap(baseline, optimized) {
    var map = {};
    [baseline, optimized].forEach(function (sched) {
      if (!sched) return;
      var seen = {};
      var byId = sched.taskById || {};
      var ids = Object.keys(byId);
      for (var i = 0; i < ids.length; i++) {
        var t = byId[ids[i]];
        if (!t || !t.task_name || seen[t.task_id]) continue;
        seen[t.task_id] = true;
        var n = t.task_name;
        map[t.task_id] = n;
        if (t.task_code) map[t.task_code] = n;
        if (t.activity_id) map[t.activity_id] = n;
        var prefix = (t.task_id || '').split('-')[0];
        if (prefix && !map[prefix]) map[prefix] = n;
      }
    });
    return map;
  }

  function resolveIdToName(predId, idMap) {
    if (!predId) return predId;
    if (idMap[predId]) return idMap[predId];
    var prefix = predId.split('-')[0];
    if (prefix && idMap[prefix]) return idMap[prefix];
    return predId;
  }

  function normalizeName(name) {
    return (name || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function fuzzyMatch(a, b) {
    if (a === b) return true;
    var na = normalizeName(a), nb = normalizeName(b);
    if (na === nb) return true;
    if (!na || !nb) return false;
    if (na.indexOf(nb) >= 0 || nb.indexOf(na) >= 0) return true;
    var ta = na.split(' '), tb = nb.split(' ');
    var maxLen = Math.max(ta.length, tb.length);
    if (maxLen < 2) return false;
    var shared = 0;
    for (var i = 0; i < ta.length; i++) {
      if (tb.indexOf(ta[i]) >= 0) shared++;
    }
    return shared / maxLen >= 0.7;
  }

  function findFuzzyMatch(name, nameSet) {
    var keys = Object.keys(nameSet);
    for (var i = 0; i < keys.length; i++) {
      if (fuzzyMatch(name, keys[i])) return keys[i];
    }
    return null;
  }

  function comparePredecessors(diff, baseline, optimized) {
    if (!_idNameCache) _idNameCache = buildIdNameMap(baseline, optimized);
    var idMap = _idNameCache;

    var bTask = diff.b, oTask = diff.o;
    var bPreds = baseline.predByTaskId[bTask.task_id] || [];
    var oPreds = optimized.predByTaskId[oTask.task_id] || [];

    var bNames = {};
    for (var i = 0; i < bPreds.length; i++) {
      var p = bPreds[i];
      var name = resolveIdToName(p.pred_task_id, idMap);
      if (name && !bNames[name]) bNames[name] = true;
    }

    var oNames = {};
    for (var j = 0; j < oPreds.length; j++) {
      var op = oPreds[j];
      var oname = resolveIdToName(op.pred_task_id, idMap);
      if (oname && !oNames[oname]) oNames[oname] = true;
    }

    var items = [];
    var matchedO = {};
    var bKeys = Object.keys(bNames);
    for (var bi = 0; bi < bKeys.length; bi++) {
      var k = bKeys[bi];
      if (oNames[k]) {
        items.push({ name: shortName(k), status: 'same' });
        matchedO[k] = true;
      } else {
        var fuzzyHit = findFuzzyMatch(k, oNames);
        if (fuzzyHit && !matchedO[fuzzyHit]) {
          items.push({ name: shortName(k), status: 'same' });
          matchedO[fuzzyHit] = true;
        } else {
          items.push({ name: shortName(k), status: 'deleted' });
        }
      }
    }
    var oKeys = Object.keys(oNames);
    for (var oi = 0; oi < oKeys.length; oi++) {
      if (!matchedO[oKeys[oi]] && !bNames[oKeys[oi]] && !findFuzzyMatch(oKeys[oi], bNames)) {
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

  function generateCrewLevers(crewDiffs, R, crewName) {
    var mcCutoff = R.oMCDate || R.bMCDate || null;
    var levers = [];
    var preMC = crewDiffs.filter(function (d) { return isPreMC(d, mcCutoff) && d.oStart && d.bStart; });
    if (preMC.length === 0) return levers;
    var fCrew = formatCrewForLabel(crewName);

    // 1. Workfront Resequencing — always include with full block sequence
    var withBlock = preMC.filter(function (d) { return d.blockNum || d.blockNotation; });
    if (withBlock.length > 0) {
      var basePath = getBlockProgression(withBlock, 'bStart');
      var optPath = getBlockProgression(withBlock, 'oStart');
      var bStr = basePath.map(function (p) { return p.block; }).join(' \u2192 ');
      var oStr = optPath.map(function (p) { return p.block; }).join(' \u2192 ');
      var changed = bStr !== oStr;
      var movedBlocks = [];
      optPath.forEach(function (p, i) {
        var bIdx = -1;
        basePath.forEach(function (bp, bi) { if (bp.block === p.block) bIdx = bi; });
        if (bIdx >= 0 && bIdx !== i) movedBlocks.push(p.block);
      });
      var reseqLabel = changed
        ? 'Redirect ' + fCrew + ' to follow a new block installation order — ' + movedBlocks.length + ' block' + (movedBlocks.length !== 1 ? 's move' : ' moves') + ' position (e.g. ' + movedBlocks.slice(0, 3).join(', ') + (movedBlocks.length > 3 ? ' and ' + (movedBlocks.length - 3) + ' more' : '') + ')'
        : fCrew + ' maintains the same block installation order — no crew redirection needed.';
      levers.push({
        type: 'resequencing',
        shortLabel: 'Workfront Resequencing',
        label: reseqLabel,
        baselinePath: bStr,
        optimizedPath: oStr,
        baselineBlocks: basePath.map(function (p) { return p.block; }),
        optimizedBlocks: optPath.map(function (p) { return p.block; }),
        changed: changed,
        count: withBlock.length,
      });
    }

    // 2. Execution Path Changes
    var pathDiffs = preMC.filter(function (d) {
      return Math.abs(d.finishVar) > 3 && d.logic &&
        (d.logic.added > 0 || d.logic.removed > 0 || !d.logic.sameDriving);
    }).sort(function (a, b) { return a.finishVar - b.finishVar; });
    if (pathDiffs.length > 0) {
      var epDetails = pathDiffs.map(function (d) {
        return {
          taskName: shortName(d.task_name),
          block: blockTag(d),
          finishShift: d.finishVar,
          predComparison: comparePredecessors(d, R.baseline, R.optimized),
        };
      });
      var epWithChanges = epDetails.filter(function (d) {
        return d.predComparison.some(function (p) { return p.status !== 'same'; });
      });
      if (epWithChanges.length > 0) {
        var epLabel = 'Update the driving logic for ' + epWithChanges.length + ' ' + fCrew + ' activit' + (epWithChanges.length === 1 ? 'y' : 'ies') + ' — predecessors have been added, removed, or swapped (often a result of workfront resequencing or idle time reduction changes)';
        levers.push({
          type: 'execution_path',
          shortLabel: 'Execution Path',
          label: epLabel,
          details: epDetails,
          count: epWithChanges.length,
        });
      }
    }

    // 3. Parallel Execution — sweep-line block concurrency + group detail
    var overlapDiffs = preMC.filter(function (d) {
      return d.logic && d.logic.newSS > 0 && Math.abs(d.finishVar) > 1;
    });
    if (overlapDiffs.length > 0) {
      var allWithDates = preMC.filter(function (d) { return d.bStart && d.bEnd && d.oStart && d.oEnd; });

      function blockConcurrency(tasks, startKey, endKey) {
        var blockSpans = {};
        for (var bi = 0; bi < tasks.length; bi++) {
          var t = tasks[bi];
          var blk = blockTag(t);
          if (!blk || !t[startKey] || !t[endKey]) continue;
          var s = t[startKey].getTime(), e = t[endKey].getTime();
          if (!blockSpans[blk]) { blockSpans[blk] = { start: s, end: e }; }
          else {
            if (s < blockSpans[blk].start) blockSpans[blk].start = s;
            if (e > blockSpans[blk].end) blockSpans[blk].end = e;
          }
        }
        var events = [];
        var blocks = Object.keys(blockSpans);
        for (var ej = 0; ej < blocks.length; ej++) {
          events.push({ time: blockSpans[blocks[ej]].start, delta: 1 });
          events.push({ time: blockSpans[blocks[ej]].end + 1, delta: -1 });
        }
        events.sort(function (a, b) { return a.time - b.time || b.delta - a.delta; });
        var cur = 0, maxConc = 0;
        for (var ek = 0; ek < events.length; ek++) {
          cur += events[ek].delta;
          if (cur > maxConc) maxConc = cur;
        }
        var overlapping = 0;
        for (var m = 0; m < blocks.length; m++) {
          var span = blockSpans[blocks[m]];
          for (var n = 0; n < blocks.length; n++) {
            if (m === n) continue;
            var other = blockSpans[blocks[n]];
            if (span.start < other.end && other.start < span.end) { overlapping++; break; }
          }
        }
        return { maxConcurrent: maxConc, totalBlocks: blocks.length, overlappingBlocks: overlapping };
      }

      function findConcurrentGroups(tasks, startKey, endKey) {
        var blockSpans = {};
        for (var i = 0; i < tasks.length; i++) {
          var t = tasks[i];
          var blk = blockTag(t);
          if (!blk || !t[startKey] || !t[endKey]) continue;
          var s = t[startKey].getTime(), e = t[endKey].getTime();
          if (!blockSpans[blk]) { blockSpans[blk] = { start: s, end: e }; }
          else {
            if (s < blockSpans[blk].start) blockSpans[blk].start = s;
            if (e > blockSpans[blk].end) blockSpans[blk].end = e;
          }
        }
        var blocks = Object.keys(blockSpans);
        if (!blocks.length) return [];

        var events = [];
        for (var j = 0; j < blocks.length; j++) {
          events.push({ time: blockSpans[blocks[j]].start, block: blocks[j], delta: 1 });
          events.push({ time: blockSpans[blocks[j]].end + 1, block: blocks[j], delta: -1 });
        }
        events.sort(function (a, b) { return a.time - b.time || b.delta - a.delta; });

        var active = {};
        var groups = [];
        var lastSnap = null;

        for (var k = 0; k < events.length; k++) {
          var ev = events[k];
          if (ev.delta > 0) active[ev.block] = true;
          else delete active[ev.block];

          var nextTime = (k + 1 < events.length) ? events[k + 1].time : null;
          if (nextTime !== null && nextTime === ev.time) continue;

          var current = Object.keys(active).sort();
          if (!current.length) { lastSnap = null; continue; }
          var key = current.join('|');
          if (key === lastSnap) continue;
          lastSnap = key;
          groups.push({ blocks: current });
        }
        return groups;
      }

      var bConc = blockConcurrency(allWithDates, 'bStart', 'bEnd');
      var oConc = blockConcurrency(allWithDates, 'oStart', 'oEnd');
      var bGroups = findConcurrentGroups(allWithDates, 'bStart', 'bEnd');
      var oGroups = findConcurrentGroups(allWithDates, 'oStart', 'oEnd');

      var parLabel = fCrew + ' must staff up to ' + oConc.maxConcurrent + ' active workfronts at the same time' +
        (bConc.maxConcurrent !== oConc.maxConcurrent ? ' (baseline: ' + bConc.maxConcurrent + ')' : '') +
        ' — ' + oConc.overlappingBlocks + ' of ' + oConc.totalBlocks + ' blocks share time with at least one other block';
      levers.push({
        type: 'parallel',
        shortLabel: 'Parallel Execution',
        label: parLabel,
        baselineGroups: bGroups,
        optimizedGroups: oGroups,
        baselineConcurrency: bConc,
        optimizedConcurrency: oConc,
        count: overlapDiffs.length,
      });
    }

    // 4. Duration Compression
    var durDiffs = preMC.filter(function (d) {
      return d.durVar < -1 && d.laborVar > 0.5 && Math.abs(d.startVar) < 5;
    }).sort(function (a, b) { return a.durVar - b.durVar; });
    if (durDiffs.length > 0) {
      var dcDetails = durDiffs.map(function (d) {
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
      var avgSaved = Math.round(durDiffs.reduce(function (s, d) { return s + Math.abs(d.durVar); }, 0) / durDiffs.length);
      var durLabel = 'Add crew to ' + durDiffs.length + ' ' + fCrew + ' activit' + (durDiffs.length === 1 ? 'y' : 'ies') + ' to compress durations — saves an average of ' + avgSaved + ' days per activity';
      levers.push({
        type: 'duration',
        shortLabel: 'Duration Compression',
        label: durLabel,
        details: dcDetails,
        count: durDiffs.length,
      });
    }

    // 5. Handoff Compression
    var handoffDiffs = preMC.filter(function (d) {
      return d.logic && d.logic.lagDelta < -24 && d.logic.sameDriving;
    }).sort(function (a, b) { return a.logic.lagDelta - b.logic.lagDelta; });
    if (handoffDiffs.length > 0) {
      var hoDetails = handoffDiffs.map(function (d) {
        var bGap = d.logic.bDrivingLagDays !== null ? Math.round(d.logic.bDrivingLagDays) : null;
        var oGap = d.logic.oDrivingLagDays !== null ? Math.round(d.logic.oDrivingLagDays) : null;
        // Infer effective relationship: ALICE CSV doesn't label SS explicitly.
        // Any handoff that made it here has significant gap reduction (lagDelta < -24hr).
        // ALICE achieves this by changing FS to SS, so classify the optimized side as SS
        // whenever the gap was meaningfully compressed.
        var bEffective = (bGap !== null && bGap < 0) ? 'SS' : 'FS';
        var oEffective = (bGap !== null && oGap !== null && bGap > oGap) ? 'SS' : (oGap !== null && oGap < 0) ? 'SS' : 'FS';
        var bRel = d.logic.bDrivingRelType || 'FS';
        var oRel = d.logic.oDrivingRelType || 'FS';
        if (bRel === 'SS') bEffective = 'SS';
        if (oRel === 'SS') oEffective = 'SS';
        var relChanged = bEffective !== oEffective;
        return {
          taskName: shortName(d.task_name),
          block: blockTag(d),
          predName: d.logic.drivingPredName ? shortName(d.logic.drivingPredName) : 'predecessor',
          bGap: bGap,
          oGap: oGap,
          bRel: bEffective,
          oRel: oEffective,
          relChanged: relChanged,
          saved: (bGap !== null && oGap !== null) ? Math.abs(bGap - oGap) : Math.abs(Math.round(d.logic.lagDelta / 24)),
        };
      });
      var avgHoSaved = Math.round(hoDetails.reduce(function (s, h) { return s + h.saved; }, 0) / hoDetails.length);
      var fsToSsCount = hoDetails.filter(function (h) { return h.relChanged && h.bRel === 'FS' && h.oRel === 'SS'; }).length;
      var hoLabel;
      if (fsToSsCount > 0) {
        hoLabel = 'Change ' + fsToSsCount + ' of ' + hoDetails.length + ' ' + fCrew + ' task relationships from finish-to-start to start-to-start — activities begin while predecessors are still in progress, saving ' + avgHoSaved + ' days of idle time per transition';
      } else {
        hoLabel = 'Reduce gaps between ' + fCrew + ' activities and their predecessors across ' + handoffDiffs.length + ' transition' + (handoffDiffs.length !== 1 ? 's' : '') + ' — saving ' + avgHoSaved + ' days of idle time per transition';
      }
      levers.push({
        type: 'handoff',
        shortLabel: 'Idle Time Reduction',
        label: hoLabel,
        details: hoDetails,
        count: handoffDiffs.length,
      });
    }

    return levers;
  }

  ATT.generateEPCActions = function (aggregations, diffs, R) {
    _idNameCache = null;
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
        var cn = shortName(crew);
        var crewDiffs = matchCrewToDiffs(crew, diffs);
        var levers = generateCrewLevers(crewDiffs, R, cn);

        crewBuckets.push({
          crewName: cn,
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
        var levers = generateCrewLevers(commDiffs, R, comm);

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
