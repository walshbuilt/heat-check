/* Heat Check — top-of-page controls: search clear button, paste-a-contract, and the
 * "hottest coins" ticker. Loaded after app.js; talks to it only through the page
 * (input events and the URL), so it works with the app as-is. */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  var q = $('#q'), clear = $('#qClear');

  // ---- Search ----
  function sync() { clear.hidden = !q.value; }
  q.addEventListener('input', function () {
    sync();
    var v = q.value.trim();
    // A pasted contract address opens that coin directly, even if it isn't in the lists yet.
    if (MINT_RE.test(v) && location.hash.indexOf('t=' + v) < 0) location.hash = 't=' + v;
  });
  q.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') q.blur();
    if (e.key === 'Escape') clear.click();
  });
  clear.addEventListener('click', function (e) {
    e.preventDefault();
    q.value = '';
    q.dispatchEvent(new Event('input', { bubbles: true })); // the app re-filters on input
    sync();
    q.focus();
  });
  sync();

  // ---- Hottest-coins ticker ----
  // Built from the same live data the page scores every few seconds. Shows coins that are actually
  // moving (Igniting / Running or high heat), skips tiny caps (at most one under $50K, and only
  // if it's ripping), and rotates a fresh batch in every loop so it isn't the same names.
  var H = window.MomentumHeat;
  var track = $('#hotTrack');
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var usd = function (x) { var a = Math.abs(x); return '$' + (a >= 1e9 ? (x / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (x / 1e6).toFixed(2) + 'M' : a >= 1e3 ? (x / 1e3).toFixed(1) + 'K' : Math.round(x)); };
  var move = function (x) { if (x == null || !isFinite(x)) return '—'; var a = Math.abs(x); return (x > 0 ? '▲ ' : x < 0 ? '▼ ' : '') + (a >= 100 ? Math.round(a).toLocaleString() : a.toFixed(1)) + '%'; };
  var cls = function (x) { return x > 0 ? 'up' : x < 0 ? 'down' : ''; };
  var BIG = 50e3, PER = 12, FIXED = 4;
  var turn = 0, shown = '';

  function pool() {
    var seen = {}, out = [], small = 0;
    H.live()
      .filter(function (x) { return x.g !== 'red' && x.t.mc > 0 && (x.t.v && x.t.v.m5) >= 300; })
      .map(function (x) { var p = H.parts(x.t, x.g); return { t: x.t, h: H.total(p), st: H.stage(x.t, p), p: p }; })
      .filter(function (x) { return !(x.p.ins >= 15) && !x.p.bot && !x.p.dumping && (x.h >= 30 || x.st.k === 'ign' || x.st.k === 'run'); })
      .sort(function (a, b) { return b.h - a.h; })
      .forEach(function (x) {
        if (out.length >= 45) return;
        var k = String(x.t.s || '').toLowerCase().replace(/\d+$/, '');
        if (seen[k]) return;
        if (x.t.mc < BIG) { if (small >= 1 || x.h < 40) return; small++; }
        seen[k] = 1; out.push(x);
      });
    return out;
  }
  function batch() {
    var all = pool();
    if (!all.length) return [];
    var head = all.slice(0, FIXED), rest = all.slice(FIXED), n = PER - head.length, pick = [];
    if (rest.length <= n) pick = rest;
    else { var start = (turn * n) % rest.length; for (var i = 0; i < n; i++) pick.push(rest[(start + i) % rest.length]); }
    turn++;
    return head.concat(pick);
  }
  function itemHtml(x, i) {
    var t = x.t, p = x.p, c1 = t.c && t.c.h1;
    var fast = p.g1 != null && Math.abs(p.g1) >= 1 ? [p.g1, '1m'] : [p.g5, '5m'];
    var img = /^https?:\/\//i.test(t.img || '') ? '<img src="' + esc(t.img) + '" alt="" loading="lazy">' : '<span class="ph">' + esc(String(t.s || '?').slice(0, 2)) + '</span>';
    return '<button class="ti" data-a="' + esc(t.a) + '"><span class="rk">' + (i + 1) + '</span>' + img + '<b>' + esc(t.s) + '</b>' +
      '<span class="' + cls(fast[0]) + '">' + move(fast[0]) + '<small> ' + fast[1] + '</small></span>' +
      '<span class="' + cls(c1) + '">' + move(c1) + '<small> 1h</small></span>' +
      '<span class="th">Heat ' + Math.round(x.h) + '%</span>' +
      (x.st.l ? '<span class="stg ' + x.st.k + '">' + x.st.l + '</span>' : '') +
      '<span class="m">MC ' + usd(t.mc) + '</span></button>';
  }
  function paint() {
    var items = batch();
    if (!items.length) return false;
    var html = items.map(itemHtml).join('');
    if (html === shown) return true;
    shown = html;
    track.innerHTML = html + html;
    track.style.setProperty('--dur', Math.max(28, items.length * 3.2) + 's');
    [].forEach.call(track.querySelectorAll('img'), function (im) { im.addEventListener('error', function () { im.remove(); }, { once: true }); });
    return true;
  }
  // New batch each time the tape loops back to the start (no visible jump mid-scroll).
  track.addEventListener('animationiteration', paint);
  // Fill as soon as the page has data, then keep it fresh if a loop takes a while.
  var boot = setInterval(function () { if (paint()) clearInterval(boot); }, 1500);
  setInterval(function () { if (!track.children.length) paint(); }, 5000);
  track.addEventListener('click', function (e) {
    var b = e.target.closest('.ti');
    if (!b) return;
    var hash = 't=' + b.dataset.a;
    if (location.hash.slice(1) === hash) return;
    location.hash = hash;
  });
})();
