// Momentum theme: draws the all-time-high line on charts in blue.
(function () {
  var LC = window.LightweightCharts; if (!LC || !LC.createChart) return;
  var ATH = '#6cb4ff', make = LC.createChart;
  function wrap(series) {
    var add = series.createPriceLine.bind(series);
    series.createPriceLine = function (o) { if (o && o.title === 'ATH') o = Object.assign({}, o, { color: ATH }); return add(o); };
    return series;
  }
  var patched = Object.assign({}, LC);
  patched.createChart = function () {
    var chart = make.apply(this, arguments);
    ['addCandlestickSeries', 'addLineSeries', 'addAreaSeries', 'addBarSeries', 'addBaselineSeries'].forEach(function (k) {
      var f = chart[k]; if (f) chart[k] = function () { return wrap(f.apply(chart, arguments)); };
    });
    return chart;
  };
  window.LightweightCharts = patched; // library export is frozen, so swap in a patched copy
})();
