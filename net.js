/* Heat Check — resilient requests for the coin page. Loaded before app.js.
 * The free chart source is rate limited, so chart and coin requests that fail are retried
 * with backoff (instead of giving up after a few seconds), with a visible "loading" note. */
(function () {
  'use strict';
  var raw = window.fetch.bind(window);
  var RULES = [
    { re: /\/api\/ohlcv\?/, tries: 7, chart: true },
    { re: /\/api\/(token|info|ath|runup)\?/, tries: 4 },
  ];
  var wait = function (ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); };
  function note(on, n) {
    var m = document.getElementById('chartMsg');
    if (!m || m.hidden) return;
    var p = m.querySelector('.cmnote');
    if (!on) { if (p) p.remove(); return; }
    if (!p) { p = document.createElement('div'); p.className = 'cmnote'; m.appendChild(p); }
    p.textContent = 'Loading chart history… (busy, retrying ' + n + ')';
  }
  // Safety reports (insiders, top holders) are kept here so the heat score can use them too.
  var RISK = window.HCRisk = new Map();
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (/\/api\/risk\?/.test(url)) {
      return raw(input, init).then(function (r) {
        if (r.ok) r.clone().json().then(function (d) { if (d && d.a) RISK.set(d.a, d); }).catch(function () {});
        return r;
      });
    }
    var rule = null;
    for (var i = 0; i < RULES.length; i++) if (RULES[i].re.test(url)) { rule = RULES[i]; break; }
    // Paging back through older candles or small refreshes shouldn't hold anything up.
    if (!rule || /[?&](before|limit=10)\b/.test(url)) return raw(input, init);
    var attempt = 0;
    var go = function () {
      return raw(input, init).then(function (r) {
        if (r.ok || attempt + 1 >= rule.tries || (r.status >= 400 && r.status < 500 && r.status !== 429)) return r;
        throw r;
      }).catch(function (e) {
        attempt++;
        if (attempt >= rule.tries) { if (rule.chart) note(false); if (e && e.status) return e; throw e; }
        if (rule.chart) note(true, attempt);
        return wait(Math.min(1500 * attempt, 6000)).then(go);
      });
    };
    return go().then(function (r) { if (rule.chart) note(false); return r; });
  };
  var css = document.createElement('style');
  css.textContent = '.cmnote{margin-top:10px;font-size:12px;color:#9aa4b5;text-align:center}';
  document.head.appendChild(css);
})();
