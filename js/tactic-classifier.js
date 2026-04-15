(function (ATT) {
  'use strict';

  var TACTICS = {
    RESEQUENCING: 'Workfront Resequencing',
    RAMP:         'Crew Ramp Timing',
    PEAK_TIMING:  'Crew Peak Timing',
    INTENSITY:    'Crew Sizing / Intensity',
    OVERLAP:      'Trade Overlap',
    HANDOFF:      'Handoff Compression',
    SMOOTHING:    'Resource Smoothing',
    CONSTRAINT:   'Constraint Relief',
    CP:           'Critical Path Migration',
  };

  var TACTIC_COLORS = {};
  TACTIC_COLORS[TACTICS.RESEQUENCING] = '#4f8ef7';
  TACTIC_COLORS[TACTICS.RAMP]         = '#22d3a8';
  TACTIC_COLORS[TACTICS.PEAK_TIMING]  = '#f97316';
  TACTIC_COLORS[TACTICS.INTENSITY]    = '#f59e0b';
  TACTIC_COLORS[TACTICS.OVERLAP]      = '#a78bfa';
  TACTIC_COLORS[TACTICS.HANDOFF]      = '#f472b6';
  TACTIC_COLORS[TACTICS.SMOOTHING]    = '#60a5fa';
  TACTIC_COLORS[TACTICS.CONSTRAINT]   = '#34d399';
  TACTIC_COLORS[TACTICS.CP]           = '#fb7185';

  var TACTIC_RULES = [
    { name: TACTICS.CP,           signals: 'Activity moves on/off critical path',                          example: 'Was critical in baseline \u2192 now has float \u22651d' },
    { name: TACTICS.INTENSITY,    signals: 'Start date similar (|\u0394|<5d) + crew increases + duration shortens', example: 'Same window, +8 workers \u2192 3d shorter' },
    { name: TACTICS.RAMP,         signals: 'Start significantly earlier (>5d) + labor crew increases',     example: 'Pile crew mobilized 12d earlier with bigger crew' },
    { name: TACTICS.PEAK_TIMING,  signals: 'Same crew + same duration + start month changes (|\u0394|\u22657d)',  example: 'Tracker install shifted from Aug\u2192Oct; same crew & duration' },
    { name: TACTICS.OVERLAP,      signals: 'New SS relationship or negative lag added',                    example: 'DC stringing starts while module install is still active' },
    { name: TACTICS.HANDOFF,      signals: 'FS relationship lag reduced by >1 working day',                example: 'Civil-to-tracker handoff shrunk by 5d' },
    { name: TACTICS.RESEQUENCING, signals: 'Earlier start (>3d) + same duration + no major crew change',   example: 'Blocks reordered: area B starts before area A completes' },
    { name: TACTICS.SMOOTHING,    signals: 'Crew qty changes without shifting schedule dates significantly', example: 'Resource leveled: peak reduced, spread wider' },
    { name: TACTICS.CONSTRAINT,   signals: 'Calendar change, uniform block-level shift, or area-release pattern', example: 'Land disturbance permit received \u2192 area release earlier' },
  ];

  /**
   * Pre-pass: detect blocks with uniform start shifts suggesting an area-level constraint release.
   * Returns a Set of blockNum values where constraint relief is likely.
   */
  ATT.detectAreaConstraints = function (diffs) {
    var blockShifts = {};
    for (var i = 0; i < diffs.length; i++) {
      var d = diffs[i];
      if (!d.blockNum || d.blockNum === '' || Math.abs(d.startVar) < 2) continue;
      if (!blockShifts[d.blockNum]) blockShifts[d.blockNum] = [];
      blockShifts[d.blockNum].push(d.startVar);
    }
    var constraintBlocks = new Set();
    var blockKeys = Object.keys(blockShifts);
    for (var j = 0; j < blockKeys.length; j++) {
      var shifts = blockShifts[blockKeys[j]];
      if (shifts.length < 5) continue;
      var mean = shifts.reduce(function (s, v) { return s + v; }, 0) / shifts.length;
      if (Math.abs(mean) < 3) continue;
      var variance = shifts.reduce(function (s, v) { return s + (v - mean) * (v - mean); }, 0) / shifts.length;
      var cv = Math.sqrt(variance) / Math.abs(mean);
      if (cv < 0.4) constraintBlocks.add(blockKeys[j]);
    }
    return constraintBlocks;
  };

  ATT.classifyTactics = function (diff, constraintBlocks) {
    var tactics = [];
    var startVar = diff.startVar, finishVar = diff.finishVar, durVar = diff.durVar;
    var laborVar = diff.laborVar, calChange = diff.calChange, logic = diff.logic;
    var bCritical = diff.bCritical, oCritical = diff.oCritical;
    var bStart = diff.bStart, oStart = diff.oStart;

    var earlyImprovement = startVar < -3;
    var finishImprovement = finishVar < -1;
    var sameTiming    = Math.abs(startVar) < 5 && Math.abs(finishVar) < 5;
    var crewStable    = Math.abs(laborVar) < 0.5;
    var durStable     = Math.abs(durVar) < 1;
    var crewIncrease  = laborVar > 0.5;
    var durShorter    = durVar < -0.5;

    if (bCritical !== oCritical) {
      tactics.push({
        tactic: TACTICS.CP,
        detail: bCritical ? 'Moved off critical path \u2014 gained schedule buffer' : 'Moved onto critical path in optimized',
        impactDays: Math.max(0, -finishVar)
      });
    }

    if (sameTiming && crewIncrease && durShorter) {
      tactics.push({
        tactic: TACTICS.INTENSITY,
        detail: '+' + laborVar.toFixed(1) + ' crew/hr \u2192 ' + Math.abs(durVar).toFixed(1) + 'd shorter duration',
        impactDays: Math.abs(durVar)
      });
    }

    if (earlyImprovement && crewIncrease && !sameTiming) {
      tactics.push({
        tactic: TACTICS.RAMP,
        detail: Math.abs(startVar).toFixed(0) + 'd earlier mobilization with larger crew',
        impactDays: Math.abs(startVar)
      });
    }

    if (Math.abs(startVar) >= 7 && crewStable && durStable && ATT.differentMonth(bStart, oStart)) {
      var direction = startVar < 0 ? 'earlier' : 'later';
      tactics.push({
        tactic: TACTICS.PEAK_TIMING,
        detail: Math.abs(startVar).toFixed(0) + 'd ' + direction + ' \u2014 crew peak shifts from ' + ATT.monthLabel(bStart) + ' \u2192 ' + ATT.monthLabel(oStart) + ', same crew size & duration',
        impactDays: Math.max(0, -finishVar)
      });
    }

    if (logic.newSS > 0 || logic.hasNegLag) {
      tactics.push({
        tactic: TACTICS.OVERLAP,
        detail: logic.newSS + ' new parallel-start relationship(s) \u2014 activities now overlapping',
        impactDays: Math.max(0, -startVar)
      });
    }

    if (logic.lagDelta < -24 && logic.sameDriving) {
      tactics.push({
        tactic: TACTICS.HANDOFF,
        detail: (Math.abs(logic.lagDelta) / 24).toFixed(1) + 'd lag cut from predecessor \u201C' + (logic.drivingPredName || '').split(' - ')[0] + '\u201D',
        impactDays: Math.min(Math.abs(finishVar), Math.abs(logic.lagDelta) / 24)
      });
    }

    if (earlyImprovement && Math.abs(durVar) < 1 && Math.abs(laborVar) < 0.5) {
      if (!tactics.find(function (t) { return t.tactic === TACTICS.OVERLAP; })) {
        tactics.push({
          tactic: TACTICS.RESEQUENCING,
          detail: Math.abs(startVar).toFixed(0) + 'd earlier area release, same work scope and crew',
          impactDays: Math.abs(startVar)
        });
      }
    }

    if (calChange && finishImprovement) {
      tactics.push({
        tactic: TACTICS.CONSTRAINT,
        detail: 'Calendar or constraint change enabled earlier execution',
        impactDays: Math.max(0, -finishVar)
      });
    }

    if (constraintBlocks && constraintBlocks.has(diff.blockNum) && finishImprovement) {
      if (!tactics.find(function (t) { return t.tactic === TACTICS.CONSTRAINT; })) {
        tactics.push({
          tactic: TACTICS.CONSTRAINT,
          detail: 'Uniform block-level shift suggests area constraint released (Block ' + diff.blockNum + ')',
          impactDays: Math.max(0, -finishVar)
        });
      }
    }

    if (Math.abs(laborVar) > 0.5 && sameTiming && Math.abs(durVar) > 0.5 && !tactics.find(function (t) { return t.tactic === TACTICS.INTENSITY; })) {
      tactics.push({
        tactic: TACTICS.SMOOTHING,
        detail: 'Crew adjusted ' + (laborVar > 0 ? '+' : '') + laborVar.toFixed(1) + '/hr, duration adjusted without shifting dates',
        impactDays: Math.abs(durVar)
      });
    }

    if (tactics.length === 0 && (Math.abs(startVar) > 3 || Math.abs(finishVar) > 3)) {
      tactics.push({
        tactic: TACTICS.RESEQUENCING,
        detail: Math.abs(startVar).toFixed(0) + 'd start / ' + Math.abs(finishVar).toFixed(0) + 'd finish shift',
        impactDays: Math.max(0, -finishVar)
      });
    }

    return tactics.length ? tactics : [{ tactic: 'No Change', detail: 'Negligible difference', impactDays: 0 }];
  };

  ATT.TACTICS = TACTICS;
  ATT.TACTIC_COLORS = TACTIC_COLORS;
  ATT.TACTIC_RULES = TACTIC_RULES;

})(window.ATT = window.ATT || {});
