(function (ATT) {
  'use strict';

  ATT.parseDate = function (s) {
    if (!s || s.trim() === '') return null;
    var d = new Date(s.trim().replace(' ', 'T'));
    return isNaN(d) ? null : d;
  };

  ATT.dateDiffDays = function (d1, d2) {
    if (!d1 || !d2) return 0;
    return (d2 - d1) / 86400000;
  };

  ATT.fmtDate = function (d) {
    if (!d) return '\u2014';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  ATT.fmtDays = function (n, plusSign) {
    if (isNaN(n) || n === 0) return '0d';
    var s = n > 0 && plusSign ? '+' : '';
    return s + n.toFixed(1) + 'd';
  };

  ATT.monthLabel = function (d) {
    if (!d) return '?';
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  };

  ATT.differentMonth = function (d1, d2) {
    if (!d1 || !d2) return false;
    return d1.getFullYear() !== d2.getFullYear() || d1.getMonth() !== d2.getMonth();
  };

  ATT.sleep = function (ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  };

})(window.ATT = window.ATT || {});
