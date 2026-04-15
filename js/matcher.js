(function (ATT) {
  'use strict';

  ATT.matchSchedules = function (baseline, optimized) {
    var matched = [], onlyB = [], onlyO = [];
    var usedOCodes = {};

    var bEntries = Object.entries(baseline.taskByCode);
    for (var i = 0; i < bEntries.length; i++) {
      var code = bEntries[i][0], bTask = bEntries[i][1];
      var oTask = optimized.taskByCode[code];
      if (oTask) {
        matched.push({ b: bTask, o: oTask });
        usedOCodes[code] = true;
      } else {
        onlyB.push(bTask);
      }
    }

    var oByName = {};
    var oEntries = Object.entries(optimized.taskByCode);
    for (var j = 0; j < oEntries.length; j++) {
      if (!usedOCodes[oEntries[j][0]]) oByName[oEntries[j][1].task_name] = oEntries[j][1];
    }

    var stillUnmatched = [];
    for (var k = 0; k < onlyB.length; k++) {
      var oMatch = oByName[onlyB[k].task_name];
      if (oMatch) {
        matched.push({ b: onlyB[k], o: oMatch });
        usedOCodes[oMatch.task_code] = true;
        delete oByName[onlyB[k].task_name];
      } else {
        stillUnmatched.push(onlyB[k]);
      }
    }
    onlyB = stillUnmatched;

    for (var m = 0; m < oEntries.length; m++) {
      if (!usedOCodes[oEntries[m][0]]) onlyO.push(oEntries[m][1]);
    }

    return { matched: matched, onlyB: onlyB, onlyO: onlyO };
  };

})(window.ATT = window.ATT || {});
