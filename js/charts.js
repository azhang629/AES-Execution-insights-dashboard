(function (ATT) {
  'use strict';

  ATT.plotDark = function (elId, data, extraLayout) {
    var layout = Object.assign({
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      font: { color: '#e2e8f0', family: 'Segoe UI, system-ui, sans-serif' },
      margin: { l: 50, r: 20, t: 20, b: 40 },
    }, extraLayout || {});
    Plotly.react(elId, data, layout, {
      responsive: true, displayModeBar: false, staticPlot: false,
    });
  };

})(window.ATT = window.ATT || {});
