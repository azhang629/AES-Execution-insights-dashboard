(function (ATT) {
  'use strict';

  var parseDate = ATT.parseDate;

  function classifyCommodity(name, trade) {
    var n = (name || '').toLowerCase();

    if (/dc trench|dc backfill|dc feeders|dc ug/.test(n)) return 'DC Collection UG';
    if (/harness cable|module wire|module connect|string \(array|bla\+|homerun|cab system|disconnect box/.test(n)) return 'DC Collection AG';
    if (/\bac trench|\bac ag cable|\bac ug|\bac ag line pile|\bac collection/.test(n)) return 'AC Collection';
    if (/inverter/.test(n)) return 'Inverter';

    if (trade) {
      var t = trade.toLowerCase();
      if (/pil/i.test(t)) return 'Piling';
      if (/tracker/i.test(t)) return 'Tracker Install';
      if (/module/i.test(t)) return 'Module Install';
      if (/dc.*ug|trenching|backfill/i.test(t)) return 'DC Collection UG';
      if (/dc|string|array|wiring/i.test(t)) return 'DC Collection AG';
      if (/\bac\b/i.test(t)) return 'AC Collection';
      if (/inverter/i.test(t)) return 'Inverter';
      if (/commission/i.test(t)) return 'Commissioning';
      if (/civil|foundation|grading/i.test(t)) return 'Civil / Foundation';
      if (/substation|hv/i.test(t)) return 'Substation';
      if (/procurement|material|deliver/i.test(t)) return 'Procurement';
      if (/mileston|mobiliz/i.test(t)) return 'Milestones';
      if (/fiber|scada|met\s*station/i.test(t)) return 'Electrical';
      if (/electrical/i.test(t)) {
        if (/fiber optic|scada|met\s*station/.test(n)) return 'Electrical';
        if (/pile install|pile survey|pile remed/.test(n)) return 'Piling';
        if (/tracker install/.test(n)) return 'Tracker Install';
        if (/modules install/.test(n)) return 'Module Install';
        if (/cold commission|pre-functional/.test(n)) return 'Commissioning';
        if (/substation|gsu|transformer/.test(n)) return 'Substation';
        if (/grading|stump|grubbing|interior road/.test(n)) return 'Civil / Foundation';
        if (/mobilize|milestone/.test(n)) return 'Milestones';
        return 'Electrical';
      }
    }

    if (/pile install|pile survey|pile remed/.test(n)) return 'Piling';
    if (/tracker install/.test(n)) return 'Tracker Install';
    if (/modules install/.test(n)) return 'Module Install';
    if (/fiber optic|scada|met\s*station/.test(n)) return 'Electrical';
    if (/cold commission|pre-functional/.test(n)) return 'Commissioning';
    if (/grading|stump|grubbing|interior road|basin|swpp|erosion|pre-seed|stabilize/.test(n)) return 'Civil / Foundation';
    if (/substation|gsu|transformer/.test(n)) return 'Substation';
    if (/deliver.*site|procurement/.test(n)) return 'Procurement';
    if (/mobilize|milestone/.test(n)) return 'Milestones';
    return 'Other';
  }

  function extractBlockNotation(taskName, propBlock) {
    if (propBlock && propBlock.trim()) return propBlock.trim();
    var m = (taskName || '').match(/_(\d+\.[A-Z]\.\d+)$/);
    return m ? m[1] : '';
  }

  ATT.classifyCommodity = classifyCommodity;
  ATT.extractBlockNotation = extractBlockNotation;

  function parsePredString(raw) {
    raw = raw.trim();
    if (!raw) return null;
    var m = raw.match(/^(.+?)\s*(FS|SS|FF|SF)\s*([+\-]\s*\d+(?:\.\d+)?\s*[dDhH]?)?\s*$/i);
    if (m) {
      var lagDays = 0;
      if (m[3]) {
        var ls = m[3].replace(/\s+/g, '');
        var isH = /[hH]$/.test(ls);
        ls = ls.replace(/[dDhH]$/, '');
        lagDays = parseFloat(ls) || 0;
        if (isH) lagDays = lagDays / 24;
      }
      return { id: m[1].trim(), relType: m[2].toUpperCase(), lagDays: lagDays };
    }
    var id = raw.replace(/\s*(FS|SS|FF|SF)\s*/i, '').replace(/[+\-]\s*\d+(\.\d+)?\s*[dDhH]?\s*$/, '').trim();
    return id ? { id: id, relType: 'FS', lagDays: 0 } : null;
  }

  ATT.buildScheduleFromCSV = function (rows, name) {
    var sched = { name: name, sourceFormat: 'csv' };
    sched.taskById = {};
    sched.taskByCode = {};
    sched.taskByName = {};
    sched.predByTaskId = {};
    sched.succByTaskId = {};

    var headers = rows.length ? Object.keys(rows[0]) : [];
    var crewCols = headers.filter(function (h) { return h.startsWith('Crew: '); });

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var taskCode = row['Task ID'] || '';
      if (!taskCode) continue;

      var earlyStart = parseDate(row['Start Date']);
      var earlyEnd   = parseDate(row['End Date']);
      var lateStart  = parseDate(row['Latest Start']);
      var lateEnd    = parseDate(row['Latest End']);

      var blockNotation = extractBlockNotation(row['Task Name'], row['Property: custom_alice_block_name']);
      var parts = blockNotation.split('.');

      var totalFloatHr = parseFloat(row['Total Slack (hrs)']) || 0;
      var criticalFlag = (row['Critical'] || '').toLowerCase() === 'true';
      var durationHr   = parseFloat(row['At Completion Duration (Workhours)']) || 0;
      var calDurHr     = parseFloat(row['Duration (Calendar Hours)']) || 0;

      var laborCrewSize = parseFloat(row['Workforce']) || 0;
      if (!laborCrewSize) {
        laborCrewSize = crewCols.reduce(function (s, c) { return s + (parseFloat(row[c]) || 0); }, 0);
      }

      var resources = crewCols
        .filter(function (c) { return parseFloat(row[c]) > 0; })
        .map(function (c) {
          return { rsrc_name: c.replace('Crew: ', ''), rsrc_type: 'RT_Labor', qty_per_hr: parseFloat(row[c]) || 0 };
        });

      var laborHrs = parseFloat(row['Labor Hours Budgeted']) || 0;

      var task = {
        task_id:        taskCode,
        task_code:      taskCode,
        task_name:      row['Task Name'] || '',
        early_start:    earlyStart,
        early_end:      earlyEnd,
        late_start:     lateStart,
        late_end:       lateEnd,
        duration_hr:    durationHr,
        cal_duration_hr: calDurHr,
        total_float_hr: totalFloatHr,
        isCritical:     criticalFlag,
        clndr_id:       null,
        wbs_id:         row['WBS Outline'] || '',
        cstr_type:      (row['Primary Constraint Type'] || row['Constraint Type'] || row['Primary Constraint'] || '').trim(),
        cstr_date:      parseDate(row['Primary Constraint Date'] || row['Constraint Date'] || ''),
        commodity:      classifyCommodity(row['Task Name'], row['Trade']),
        trade:          row['Trade'] || '',
        blockNotation:  blockNotation,
        blockNum:       parts[0] || '',
        area:           parts[1] || '',
        subArea:        parts[2] || '',
        laborCrewSize:  laborCrewSize,
        laborHrs:       laborHrs,
        resources:      resources,
        phase:          row['Property: Phase'] || '',
        elementType:    row['Property: custom_alice_element_type'] || '',
        subcontractor:  row['Subcontractor'] || '',
        circuit:        row['Property: custom_alice_circuit'] || '',
        pvBlock:        row['Property: custom_alice_pv_block'] || '',
        rawRow:         row,
      };

      sched.taskById[taskCode] = task;
      sched.taskByCode[taskCode] = task;
      if (task.task_name) sched.taskByName[task.task_name] = task;
    }

    for (var j = 0; j < rows.length; j++) {
      var r = rows[j];
      var tc = r['Task ID'] || '';
      if (!tc) continue;
      var predStr = r['Predecessors'] || '';
      if (!predStr.trim()) continue;

      var predEntries = [];
      var seen = {};
      predStr.split(',').forEach(function (s) {
        var parsed = parsePredString(s);
        if (!parsed || !parsed.id) return;
        if (seen[parsed.id]) return;
        seen[parsed.id] = true;
        predEntries.push(parsed);
      });

      if (!sched.predByTaskId[tc]) sched.predByTaskId[tc] = [];
      for (var k = 0; k < predEntries.length; k++) {
        var pe = predEntries[k];
        sched.predByTaskId[tc].push({ pred_task_id: pe.id, pred_type: 'PR_' + pe.relType, rel_type: pe.relType, lag_hr: null, lag_days: pe.lagDays });
        if (!sched.succByTaskId[pe.id]) sched.succByTaskId[pe.id] = [];
        sched.succByTaskId[pe.id].push({ task_id: tc, pred_type: 'PR_' + pe.relType, rel_type: pe.relType, lag_hr: null, lag_days: pe.lagDays });
      }
    }

    var projectEnd = null, projectStart = null;
    var tasks = Object.values(sched.taskById);
    for (var ti = 0; ti < tasks.length; ti++) {
      var tsk = tasks[ti];
      if (!tsk.early_end) continue;
      if (tsk.isCritical || tsk.total_float_hr <= 8) {
        if (!projectEnd || tsk.early_end > projectEnd) projectEnd = tsk.early_end;
      }
      if (!projectStart || (tsk.early_start && tsk.early_start < projectStart)) projectStart = tsk.early_start;
    }
    if (!projectEnd) {
      for (var ti2 = 0; ti2 < tasks.length; ti2++) {
        if (tasks[ti2].early_end && (!projectEnd || tasks[ti2].early_end > projectEnd))
          projectEnd = tasks[ti2].early_end;
      }
    }
    sched.projectEnd = projectEnd;
    sched.projectStart = projectStart;

    sched.mcDate = null;
    sched.codDate = null;
    sched.substDate = null;
    sched.mcTask = null;
    sched.mcCandidates = [];

    for (var mi = 0; mi < tasks.length; mi++) {
      var tn = (tasks[mi].task_name || '').toLowerCase();
      var tEnd = tasks[mi].early_end || tasks[mi].early_start;

      if (/mechanical[\s_-]*completion/i.test(tasks[mi].task_name) || /\bmc\b.*milestone/i.test(tasks[mi].task_name)) {
        sched.mcCandidates.push(tasks[mi]);
      }

      if (!sched.codDate && (/\bcod\b/.test(tn) || /commercial.{0,10}operat/.test(tn))) {
        sched.codDate = tEnd;
      }
      if (!sched.substDate && /substantial.*complet/.test(tn)) {
        sched.substDate = tEnd;
      }
    }

    if (sched.mcCandidates.length > 0) {
      sched.mcCandidates.sort(function (a, b) {
        var ae = a.early_end || a.early_start || new Date(0);
        var be = b.early_end || b.early_start || new Date(0);
        return be - ae;
      });
      sched.mcTask = sched.mcCandidates[0];
      sched.mcDate = sched.mcTask.early_end || sched.mcTask.early_start;
    }

    sched.projectName = name.replace(/_[0-9a-f-]{36}\.csv$/i, '').replace(/_/g, ' ').trim() || name;

    var CRIT_MS = 3 * 86400000;
    for (var ci = 0; ci < tasks.length; ci++) {
      tasks[ci].nearCritical = tasks[ci].isCritical
        || tasks[ci].total_float_hr <= 0
        || (tasks[ci].early_end && projectEnd && (projectEnd - tasks[ci].early_end) < CRIT_MS);
    }

    return sched;
  };

})(window.ATT = window.ATT || {});
