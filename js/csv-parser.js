(function (ATT) {
  'use strict';

  ATT.parseCSVLine = function (line) {
    var fields = [], cur = '', inQ = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (c === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (c === ',' && !inQ) {
        fields.push(cur); cur = '';
      } else {
        cur += c;
      }
    }
    fields.push(cur);
    return fields;
  };

  ATT.parseCSVText = function (text) {
    var lines = text.split('\n').map(function (l) { return l.replace(/\r$/, ''); }).filter(function (l) { return l.trim(); });
    if (lines.length < 2) return [];
    var headers = ATT.parseCSVLine(lines[0]);
    var rows = [];
    for (var i = 1; i < lines.length; i++) {
      var vals = ATT.parseCSVLine(lines[i]);
      if (vals.every(function (v) { return !v.trim(); })) continue;
      var row = {};
      headers.forEach(function (h, k) { row[h] = (vals[k] !== undefined ? vals[k] : '').trim(); });
      rows.push(row);
    }
    return rows;
  };

})(window.ATT = window.ATT || {});
