(function (ATT) {
  'use strict';

  var TACTICS = {
    RESEQUENCING: 'Workfront Resequencing',
    EXECUTION:    'Execution Path',
    PARALLEL:     'Parallel Execution',
    DURATION:     'Duration Compression',
    HANDOFF:      'Idle Time Reduction',
  };

  var TACTIC_COLORS = {};
  TACTIC_COLORS[TACTICS.RESEQUENCING] = '#4f8ef7';
  TACTIC_COLORS[TACTICS.EXECUTION]    = '#a78bfa';
  TACTIC_COLORS[TACTICS.PARALLEL]     = '#22d3a8';
  TACTIC_COLORS[TACTICS.DURATION]     = '#f59e0b';
  TACTIC_COLORS[TACTICS.HANDOFF]      = '#f472b6';

  var TACTIC_RULES = [
    { name: TACTICS.RESEQUENCING, signals: 'Earlier start (>3d) with same duration and crew — block order changed',        example: 'Blocks reordered: area B starts before area A completes' },
    { name: TACTICS.EXECUTION,    signals: 'Predecessor logic changed — relationships added, removed, or driving pred swapped', example: 'Driving predecessor changed from pile install to survey' },
    { name: TACTICS.PARALLEL,     signals: 'New SS relationship or negative lag — activities now overlap predecessors',    example: 'DC stringing starts while module install is still active' },
    { name: TACTICS.DURATION,     signals: 'Duration shortened via crew increase, start date similar',                     example: 'Same window, +8 workers, 3d shorter duration' },
    { name: TACTICS.HANDOFF,      signals: 'Relationship changed from FS to SS — activities overlap with predecessors',   example: 'Tracker install starts while civil is still in progress' },
  ];

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
    var laborVar = diff.laborVar, logic = diff.logic;

    var earlyImprovement = startVar < -3;
    var sameTiming    = Math.abs(startVar) < 5 && Math.abs(finishVar) < 5;
    var crewIncrease  = laborVar > 0.5;
    var durShorter    = durVar < -0.5;

    // 1. Duration Compression — crew added to shorten duration
    if (durShorter && crewIncrease && sameTiming) {
      tactics.push({
        tactic: TACTICS.DURATION,
        detail: '+' + laborVar.toFixed(1) + ' crew \u2192 ' + Math.abs(durVar).toFixed(1) + 'd shorter',
        impactDays: Math.abs(durVar)
      });
    }

    // 2. Parallel Execution — new SS or negative lag
    if (logic.newSS > 0 || logic.hasNegLag) {
      tactics.push({
        tactic: TACTICS.PARALLEL,
        detail: logic.newSS + ' relationship(s) changed to Start-to-Start \u2014 activities now overlap',
        impactDays: Math.max(0, -startVar)
      });
    }

    // 3. Handoff Compression — same driving predecessor, gap reduced
    if (logic.lagDelta < -24 && logic.sameDriving) {
      tactics.push({
        tactic: TACTICS.HANDOFF,
        detail: (Math.abs(logic.lagDelta) / 24).toFixed(1) + 'd gap reduced with predecessor',
        impactDays: Math.min(Math.abs(finishVar), Math.abs(logic.lagDelta) / 24)
      });
    }

    // 4. Execution Path — predecessor logic changed
    if (logic.added > 0 || logic.removed > 0 || (logic.bPredCount > 0 && !logic.sameDriving)) {
      if (!tactics.find(function (t) { return t.tactic === TACTICS.PARALLEL || t.tactic === TACTICS.HANDOFF; })) {
        tactics.push({
          tactic: TACTICS.EXECUTION,
          detail: (logic.added || 0) + ' predecessor(s) added, ' + (logic.removed || 0) + ' removed',
          impactDays: Math.max(0, -finishVar)
        });
      }
    }

    // 5. Workfront Resequencing — earlier start, same scope
    if (earlyImprovement && Math.abs(durVar) < 1 && Math.abs(laborVar) < 0.5) {
      if (!tactics.find(function (t) { return t.tactic === TACTICS.PARALLEL; })) {
        tactics.push({
          tactic: TACTICS.RESEQUENCING,
          detail: Math.abs(startVar).toFixed(0) + 'd earlier \u2014 block order changed',
          impactDays: Math.abs(startVar)
        });
      }
    }

    // Fallback — if nothing matched but dates shifted significantly
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
