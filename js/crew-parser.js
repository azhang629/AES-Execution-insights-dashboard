(function (ATT) {
  'use strict';

  var parseDate = ATT.parseDate;

  ATT.parseCrewCSV = function (text) {
    var rows = ATT.parseCSVText(text);
    if (!rows || !rows.length) return null;

    var headers = Object.keys(rows[0]);
    var crewCol = headers[0];
    var dateHeaders = headers.slice(1);

    var dates = dateHeaders.map(function (h) { return parseDate(h); }).filter(Boolean);
    var dateStrs = dateHeaders.filter(function (h) { return parseDate(h) !== null; });

    var crews = {};
    var dailyTotal = {};

    for (var i = 0; i < dateStrs.length; i++) {
      dailyTotal[dateStrs[i]] = 0;
    }

    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var crewName = (row[crewCol] || '').trim();
      if (!crewName) continue;

      crews[crewName] = {};
      for (var d = 0; d < dateStrs.length; d++) {
        var val = parseFloat(row[dateStrs[d]]) || 0;
        crews[crewName][dateStrs[d]] = val;
        dailyTotal[dateStrs[d]] += val;
      }
    }

    var peakDate = null, peakCount = 0;
    for (var dt in dailyTotal) {
      if (dailyTotal[dt] > peakCount) {
        peakCount = dailyTotal[dt];
        peakDate = dt;
      }
    }

    var crewPeaks = {};
    for (var cn in crews) {
      var cPeak = 0, cPeakDate = null;
      for (var cd in crews[cn]) {
        if (crews[cn][cd] > cPeak) {
          cPeak = crews[cn][cd];
          cPeakDate = cd;
        }
      }
      crewPeaks[cn] = { peak: cPeak, date: cPeakDate ? parseDate(cPeakDate) : null };
    }

    return {
      crewNames: Object.keys(crews),
      dates: dateStrs,
      parsedDates: dates,
      crews: crews,
      dailyTotal: dailyTotal,
      peakDate: peakDate ? parseDate(peakDate) : null,
      peakCount: Math.round(peakCount),
      crewPeaks: crewPeaks,
    };
  };

})(window.ATT = window.ATT || {});
