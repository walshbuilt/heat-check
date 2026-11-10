/* Momentum — TradingView-style readout in the chart's top-left corner.
 * Shows time, open / high / low / close, change and volume for the candle under the cursor
 * (or the latest candle when not hovering). Works for every timeframe and for MC or price view.
 * Attaches by wrapping LightweightCharts.createChart, so the app needs no changes. */
(function () {
  'use strict';
  var LC = window.LightweightCharts; if (!LC || !LC.createChart) return;
  var make = LC.createChart;

  function fmtTime(sec, step) {
    var d = new Date(sec * 1000);
    if (step >= 86400) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function fmtVol(v) {
    if (v == null || !isFinite(v)) return '—';
    var a = Math.abs(v);
    return '$' + (a >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : a >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : Math.round(v));
  }
  function find(bars, time) { // binary search by time
    var lo = 0, hi = bars.length - 1;
    while (lo <= hi) { var m = (lo + hi) >> 1; if (bars[m].time === time) return m; if (bars[m].time < time) lo = m + 1; else hi = m - 1; }
    return -1;
  }

  var patched = Object.assign({}, LC);
  patched.createChart = function (container, opts) {
    var chart = make.apply(this, arguments);
    var fmt = (opts && opts.localization && opts.localization.priceFormatter) || function (p) { return String(p); };
    var bars = [], vols = new Map(), candle = null, hovering = false;
    var box = document.createElement('div');
    box.className = 'lgd';
    container.appendChild(box);

    function paint(i) {
      if (i < 0 || !bars[i]) { box.innerHTML = ''; return; }
      var b = bars[i], prev = bars[i - 1];
      var step = prev ? b.time - prev.time : 60;
      var base = prev ? prev.close : b.open;
      var ch = base ? (b.close / base - 1) * 100 : 0;
      var cls = b.close >= b.open ? 'u' : 'd';
      var v = vols.get(b.time);
      box.innerHTML =
        '<div class="l1"><span class="lt">' + fmtTime(b.time, step) + '</span>' +
        '<span class="lc ' + (ch >= 0 ? 'u' : 'd') + '">' + (ch >= 0 ? '+' : '') + ch.toFixed(2) + '%</span></div>' +
        '<div class="l2 ' + cls + '"><span><i>O</i>' + fmt(b.open) + '</span><span><i>H</i>' + fmt(b.high) + '</span><span><i>L</i>' + fmt(b.low) + '</span><span><i>C</i>' + fmt(b.close) + '</span>' +
        (v != null ? '<span class="lv"><i>Vol</i>' + fmtVol(v) + '</span>' : '') + '</div>';
    }
    var latest = function () { if (!hovering) paint(bars.length - 1); };

    var wrapAdd = function (name, onSet, onUpd) {
      var f = chart[name]; if (!f) return;
      chart[name] = function () {
        var s = f.apply(chart, arguments);
        var set = s.setData.bind(s), upd = s.update.bind(s);
        s.setData = function (d) { onSet(s, d || []); var r = set(d); latest(); return r; };
        s.update = function (x) { onUpd(s, x); var r = upd(x); latest(); return r; };
        return s;
      };
    };
    wrapAdd('addCandlestickSeries',
      function (s, d) { candle = s; bars = d.slice(); },
      function (s, x) { if (bars.length && bars[bars.length - 1].time === x.time) bars[bars.length - 1] = x; else if (!bars.length || x.time > bars[bars.length - 1].time) bars.push(x); });
    wrapAdd('addHistogramSeries',
      function (s, d) { vols = new Map(d.map(function (x) { return [x.time, x.value]; })); },
      function (s, x) { vols.set(x.time, x.value); });

    chart.subscribeCrosshairMove(function (p) {
      if (!p || p.time == null || !p.point || p.point.x < 0) { hovering = false; latest(); return; }
      hovering = true;
      paint(find(bars, p.time));
    });
    return chart;
  };
  window.LightweightCharts = patched;
})();
