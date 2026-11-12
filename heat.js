/* Heat Check — heat score (0–100). Loaded before app.js.
 *
 * Five equal-minded pillars, then hard safety gates:
 *
 *   price    32  live price ladder: 30s, 1m, 2m, 3m, 4m, 5m (sampled in the browser every few
 *                seconds) plus 1h / 6h / 24h trend, how many windows are green, and whether the
 *                move is accelerating (last 5 min faster than the hour's pace).
 *   buying   22  net buyers vs sellers: buy share of volume, net new buyers per trader, and whether
 *                buying is INCREASING (last 5 min vs the hour).
 *   organic  20  real growth: new traders arriving, holders growing, many wallets each trading a
 *                little (not a few bots churning), Jupiter organic score.
 *   volume   15  volume right now vs normal pace, sized to market cap.
 *   clean    15  safety grade, holder concentration, insiders.
 *
 * Gates (multiply the total): insiders / top-10 concentration, red flags, bot churn, dumping,
 * faded runs, dead trading and tiny market cap. A violent move only lifts the score when the coin
 * is reasonably clean AND the buying looks organic.
 */
(function () {
  'use strict';
  var W = { price: 32, buying: 22, organic: 16, volume: 18, clean: 12 };
  var SOCIAL = 6;
  var SIG_MC = 40e3;

  var clamp01 = function (x) { return x > 1 ? 1 : x > 0 ? x : 0; };
  var sat = function (x, ref) { return 1 - Math.exp(-Math.max(0, x || 0) / ref); };
  var log2 = function (x) { return Math.log(x) / Math.LN2; };
  var num = function (x) { return typeof x === 'number' && isFinite(x) ? x : null; };

  // ---- Live price history (browser-side, every refresh the app gets) ----
  var HIST = new Map();        // mint -> [[ms, price], ...]
  var KEEP = 6 * 60e3;
  function record(t) {
    if (!t || !t.a || !(t.p > 0)) return;
    var now = Date.now(), h = HIST.get(t.a);
    if (!h) { h = []; HIST.set(t.a, h); }
    var last = h[h.length - 1];
    if (last && last[1] === t.p) return;
    // A cached (older) copy of the coin can arrive after a fresher one and repeat a price we already
    // saw a moment ago. Skip it so it doesn't look like a sudden move.
    for (var j = h.length - 2; j >= 0 && j >= h.length - 10; j--) { if (h[j][1] === t.p && now - h[j][0] < 30e3) return; }
    if (last && now - last[0] < 1500) { last[1] = t.p; return; }
    h.push([now, t.p]);
    while (h.length && now - h[0][0] > KEEP) h.shift();
    if (HIST.size > 3000) HIST.forEach(function (v, k) { if (!v.length || now - v[v.length - 1][0] > KEEP) HIST.delete(k); });
  }
  // % change over the last `ms`, or null if we haven't watched the coin that long.
  function liveChg(t, ms) {
    var h = HIST.get(t.a);
    if (!h || h.length < 2) return null;
    var now = Date.now(), target = now - ms, cur = h[h.length - 1][1];
    if (h[0][0] > now - ms * 0.75) return null;
    var ref = h[0];
    for (var i = h.length - 1; i >= 0; i--) { if (h[i][0] <= target) { ref = h[i]; break; } }
    return ref[1] > 0 ? (cur / ref[1] - 1) * 100 : null;
  }

  // ---- Minute candles for a rotating shortlist (rate-limited source) ----
  var MIN = new Map(), asked = new Map();
  var MIN_FRESH = 180e3;
  var ver = 0, busy = false, lastPull = 0;
  function minOf(t) { var m = MIN.get(t.a); return m && m.f && Date.now() - m.at < MIN_FRESH ? m.f : null; }

  var SEEN = new Map();        // latest copy of every coin scored (the ticker reads this)
  function riskOf(t) { var r = window.HCRisk && window.HCRisk.get(t.a); return r || null; }
  // $40K–$120K is the early-runner zone, so it scores at full size.
  function sizeF(mc) { return mc >= 250e3 ? 1 : mc > 120e3 ? 0.95 : mc >= 40e3 ? 1 : mc >= 20e3 ? 0.6 : mc >= 10e3 ? 0.35 : 0.22; }

  function parts(t, grade) {
    var mc = t.mc || 1, v = t.v || {}, c = t.c || {}, tx = t.tx || {}, mf = minOf(t);
    var m5 = c.m5 || 0, h1 = c.h1 || 0, h6 = c.h6 || 0, h24 = c.h24 || 0;
    var n5 = tx.m5 ? (tx.m5.b || 0) + (tx.m5.s || 0) : 0;
    var n1 = tx.h1 ? (tx.h1.b || 0) + (tx.h1.s || 0) : 0;
    var ageH = t.age ? (Date.now() - t.age) / 3600e3 : null;

    // ================= PRICE =================
    var g30 = liveChg(t, 30e3), g1 = liveChg(t, 60e3), g2 = liveChg(t, 120e3), g3 = liveChg(t, 180e3), g4 = liveChg(t, 240e3);
    if (g1 == null && mf && mf.c1 != null) g1 = mf.c1 * 100;
    var g5 = m5;
    if (mf && mf.c5 != null && Math.abs(mf.c5 * 100) > Math.abs(g5)) g5 = mf.c5 * 100;
    // Right now: +4% in 30s, +6% in 1m ... +12% in 5m each read ~0.63; double those reads ~0.86.
    var short = Math.max(sat(g30, 4), sat(g1, 6), sat(g2, 8), sat(g3, 9), sat(g4, 10), sat(g5, 12));
    var trend = 0.5 * sat(h1, 50) + 0.3 * sat(h6, 100) + 0.2 * sat(h24, 200);
    var lad = [g1 != null ? g1 : g30, g5, h1, h6].filter(function (x) { return x != null; });
    var ladder = lad.length ? lad.filter(function (x) { return x > 0; }).length / lad.length : 0;
    // Accelerating: the last 5 minutes moving faster than the hour's average pace.
    var accel = 0;
    if (g5 > 0) accel = h1 > 1 ? clamp01(((g5 / 5) / (h1 / 60) - 1) / 3) : sat(g5, 8);
    var falling = Math.min(g30 == null ? 0 : g30, g1 == null ? 0 : g1, g2 == null ? 0 : g2, m5);
    // A 24h/1h run only keeps its trend credit while the coin is still moving right now. Cooling off
    // (no short-term push, ticking down) cuts it hard; still surging keeps it in full.
    var sustain = short >= 0.3 ? 1 : falling < -2 ? 0.3 : short >= 0.12 ? 0.7 : 0.5;
    var price = clamp01(0.6 * short + 0.1 * trend * sustain + 0.1 * ladder + 0.2 * accel);

    // ================= NET BUYING =================
    var bs = t.bs || {};
    var share = function (w) {
      var x = bs[w];
      if (x && x[0] + x[1] > 0) return x[0] / (x[0] + x[1]);
      var q = tx[w];
      return q && q.b + q.s > 0 ? q.b / (q.b + q.s) : null;
    };
    var s5 = share('m5'), sH = share('h1');
    var tr = t.tr || {}, nb = t.nb || {}, hc = t.hc || {};
    var buyShare = s5 == null ? 0.5 : clamp01((s5 - 0.45) / 0.25);           // 70%+ buys = full
    var nbRatio = tr.m5 ? (nb.m5 || 0) / tr.m5 : null;                       // net new buyers per trader
    var nbF = nbRatio == null ? 0.5 : clamp01(nbRatio / 0.45);
    var bv5 = bs.m5 ? bs.m5[0] : null, bvH = bs.h1 ? bs.h1[0] : null;
    var buyAccel = bv5 != null && bvH ? clamp01(log2(Math.max((bv5 / 5) / Math.max(bvH / 60, 1), 1)) / 2) : 0;
    var shift = s5 != null && sH != null ? clamp01(0.5 + (s5 - sH) * 4) : 0.5; // buying share rising vs the hour
    var buying = 0.35 * buyShare + 0.3 * nbF + 0.2 * buyAccel + 0.15 * shift;

    // ================= ORGANIC =================
    var tr5 = tr.m5 || 0, tr1 = tr.h1 || 0;
    var trPace = tr5 / Math.max(tr1 / 12, 1);
    var paceF = clamp01(log2(Math.max(trPace, 1)) / 2) * 0.6 + 0.4 * sat(tr5, 60);
    var holdF = 0.5 * clamp01((hc.m5 || 0) / 2) + 0.35 * clamp01((hc.h1 || 0) / 10) + 0.15 * clamp01((hc.h24 || 0) / 50);
    // Many wallets each making a few trades = real people. A few wallets making thousands = bots.
    var spread = n5 > 20 && tr5 ? clamp01((tr5 / n5 - 0.08) / 0.25) : 0.5;
    var osF = t.os != null && ageH != null && ageH > 2 ? t.os / 100 : 0.5;    // Jupiter scores need a few hours of history
    var organic = 0.3 * paceF + 0.25 * holdF + 0.25 * spread + 0.2 * osF;
    var botChurn = n5 > 300 && tr5 && tr5 / n5 < 0.07;

    // ================= VOLUME =================
    var rate5 = (v.m5 || 0) / 5;
    var baseRate = Math.max(0.5 * Math.max((v.h1 || 0) - (v.m5 || 0), 0) / 55 + 0.5 * (v.h6 || 0) / 360, 1);
    var ratio = rate5 / baseRate;
    if (mf && mf.s != null) ratio = 0.65 * mf.s + 0.35 * ratio;
    var volume = clamp01(log2(Math.max(ratio, 1)) / 3.3) * (0.35 + 0.65 * sat((v.m5 || 0) / mc, 0.008));
    volume = Math.max(volume, sat((v.h1 || 0) / mc, 0.5) * sat(h1, 60) * 0.8);

    // ================= CLEAN =================
    var rk = riskOf(t);
    var ins = rk && rk.ins != null ? rk.ins : null;
    var top = t.top != null ? t.top : rk && rk.top10 != null ? rk.top10 : null;
    var topBad = mc < 5e6 ? 40 : mc < 25e6 ? 50 : 70;
    var clean = grade === 'red' ? 0 : grade === 'amber' ? 0.55 : 1;
    if (top != null && mc < 100e6) clean *= 1 - clamp01((top - topBad * 0.6) / (topBad * 0.6)) * 0.7;
    if (ins != null) clean *= 1 - clamp01(ins / 25) * 0.8;
    if (!rk) clean *= 0.9;                                                       // insiders not checked yet

    // ================= Social =================
    var so = t.so || {}, social = 0, hits = 0;
    var fresh = function (mins, a, b, c3) { return mins == null ? 0 : mins < a ? 1 : mins < b ? 0.6 : mins < c3 ? 0.3 : 0; };
    [fresh(so.b, 15, 60, 180), fresh(so.p, 15, 60, 180), fresh(so.c, 30, 120, 360), fresh(so.tg, 10, 30, 120)].forEach(function (x) { if (x) { hits++; social = Math.max(social, x); } });
    if (hits > 1) social = Math.min(1, social + 0.2 * (hits - 1));

    var faded = (h1 > 60 || h24 > 200) && short < 0.15 && falling < -2;
    var cooling = (h1 > 40 || h24 > 100) && short < 0.1 && !faded;
    var h24tx = tx.h24 || {};
    var bot = botChurn || ((h24tx.b || 0) > 3000 && (h24tx.b || 0) / ((h24tx.s || 0) + 1) > 8);
    var dead = (v.m5 || 0) < 250 || n5 < 4;
    var dumping = falling < -8 || (s5 != null && s5 < 0.35 && m5 < -3);
    // Run history (loaded for the coins worth a closer look). A coin that already had a 4x+ move and
    // sits well under that high only counts as recovering once the bottom is confirmed: a higher low
    // over the last 6 hours, 30%+ off the 3-day floor and green on the hour and 6 hours.
    var rr = window.HCRun && window.HCRun.get(t.a);
    var hist = !!(rr && rr.n);
    var ranBefore = hist && (rr.preRun >= 4 || (rr.preHi && rr.preHi >= t.p * 3)) && !(rr.preHi && t.p >= rr.preHi * 0.85);
    var bottomIn = hist && rr.lo6 && rr.lo72 && rr.lo6 >= rr.lo72 * 1.08 && t.p >= rr.lo72 * 1.3 && h1 >= 10 && h6 >= 0;

    return { price: price, short: short, trend: trend, ladder: ladder, accel: accel, g30: g30, g1: g1, g2: g2, g3: g3, g4: g4, g5: g5,
      h1: h1, h6: h6, h24: h24, falling: falling,
      buying: buying, s5: s5, sH: sH, nbRatio: nbRatio, buyAccel: buyAccel,
      organic: organic, trPace: trPace, tr5: tr5, hc: hc, spread: spread, os: t.os, ol: t.ol, ageH: ageH, botChurn: botChurn,
      volume: volume, ratio: ratio, clean: clean, ins: ins, insN: rk && rk.insN, top: top, topBad: topBad, checked: !!rk,
      social: social, faded: faded, cooling: cooling, bot: bot, dead: dead, hist: hist, ranBefore: ranBefore, bottomIn: bottomIn, stale: !!(mf && mf.stale), dumping: dumping,
      size: sizeF(mc), mc: mc, n5: n5, mf: mf, live: g30 != null || g1 != null, grade: grade };
  }

  function total(p) {
    // Momentum (price, buying, volume) earns the points; organic and clean are quality that only
    // counts once the coin is actually moving, so a clean coin doing nothing doesn't rank.
    var mw = W.price + W.buying + W.volume, qw = W.organic + W.clean;
    var M = (W.price * p.price + W.buying * p.buying + W.volume * p.volume) / mw;
    var Q = (W.organic * p.organic + W.clean * p.clean) / qw;
    var s = 100 * (mw / 100 * M + qw / 100 * Q * clamp01(M / 0.5));
    s += SOCIAL * p.social;
    // A big move right now lifts the score on its own — but only if the coin is clean enough and
    // the buying looks real. Pumps by insiders or bots don't get the lift.
    var trusted = p.grade !== 'red' && (p.ins == null || p.ins < 15) && p.organic >= 0.35 && p.buying >= 0.45 && !p.bot;
    if (trusted && p.short >= 0.6) s = Math.max(s, 55 + 40 * (p.short - 0.6) / 0.4);
    var run = sat(p.h1, 60) * (p.falling < -6 ? 0.35 : p.falling < -2 ? 0.7 : 1) * ((p.g5 || 0) >= 0 ? 1 : 0.6);
    if (trusted && run >= 0.6) s = Math.max(s, 45 + 35 * (run - 0.6) / 0.4);
    // Gates.
    s *= p.size;
    if (p.ins != null) s *= p.ins >= 25 ? 0.3 : p.ins >= 15 ? 0.6 : 1;
    if (p.top != null && p.mc < 100e6 && p.top >= p.topBad) s *= 0.5;
    if (p.grade === 'red') s *= 0.45;
    if (p.bot) s *= 0.4;
    if (p.faded) s *= 0.5;
    if (p.cooling) s *= 0.75;
    if (p.ranBefore && !p.bottomIn) s *= 0.7;
    if (p.dumping) s *= 0.55;
    if (p.dead) s *= 0.45;
    if (p.stale) s *= 0.4;
    return Math.max(0, Math.min(100, s));
  }

  function score(t, grade) {
    record(t);
    if (t && t.a) SEEN.set(t.a, { t: t, g: grade, at: Date.now() });
    return total(parts(t, grade));
  }

  function stage(t, p) {
    p = p || parts(t, SEEN.get(t.a) ? SEEN.get(t.a).g : undefined);
    if (p.dead || p.stale) return { k: '', l: '' };
    if (p.faded) return { k: 'ext', l: 'Extended' };
    var big = p.mc >= SIG_MC || (p.short >= 0.85 && (t.v && t.v.m5) >= 5000);
    var ok = p.grade !== 'red' && (p.ins == null || p.ins < 15) && !p.bot && !p.dumping;
    if (!big || !ok) return { k: '', l: '' };
    if (p.short >= 0.55 && p.buying >= 0.5 && p.organic >= 0.35) return { k: 'ign', l: 'Igniting' };
    if (p.trend >= 0.4 && p.short >= 0.15 && p.buying >= 0.45) return { k: 'run', l: 'Running' };
    if (p.h6 < -20 && p.short >= 0.3 && p.buying >= 0.5 && p.h1 >= 5 && (!p.hist || p.bottomIn)) return { k: 'rec', l: 'Recovering' };
    return { k: '', l: '' };
  }

  // ---- Coin page breakdown ----
  function card(t, esc, grade) {
    var p = parts(t, grade), hs = total(p), st = stage(t, p);
    record(t);
    var pct = function (w) { return w + '%'; };
    var sg = function (v) { return v == null ? '—' : (v > 0 ? '+' : '') + (Math.abs(v) >= 100 ? Math.round(v) : v.toFixed(1)) + '%'; };
    var row = function (label, w, v, why) {
      return '<div class="hrow"><span>' + label + '<small>' + w + '</small></span><span class="hbar"><i style="width:' + Math.max(2, v * 100) + '%"></i></span><b>' + Math.round(v * 100) + '</b>' +
        (why ? '<em class="hwhy">' + esc(why) + '</em>' : '') + '</div>';
    };
    var priceWhy = '30s ' + sg(p.g30) + ' · 1m ' + sg(p.g1) + ' · 2m ' + sg(p.g2) + ' · 3m ' + sg(p.g3) + ' · 4m ' + sg(p.g4) + ' · 5m ' + sg(p.g5) +
      ' · 1h ' + sg(p.h1) + ' · 6h ' + sg(p.h6) + ' · 24h ' + sg(p.h24) + (p.accel >= 0.5 ? ' · accelerating' : '');
    var buyWhy = (p.s5 != null ? Math.round(p.s5 * 100) + '% of volume is buys (5m)' : 'Buy share unknown') +
      (p.sH != null ? ', ' + Math.round(p.sH * 100) + '% over 1h' : '') +
      (p.nbRatio != null ? ' · ' + (t.nb && t.nb.m5 || 0) + ' net new buyers of ' + p.tr5 + ' traders' : '') +
      (p.buyAccel >= 0.5 ? ' · buying speeding up' : '');
    var f = function (x) { return x == null ? '—' : (x > 0 ? '+' : '') + (Math.abs(x) >= 10 ? Math.round(x) : x.toFixed(1)) + '%'; };
    var orgWhy = p.tr5 + ' traders in 5m (' + (p.trPace >= 10 ? Math.round(p.trPace) : p.trPace.toFixed(1)) + '× hourly pace) · holders ' + f(p.hc.m5) + ' 5m, ' + f(p.hc.h1) + ' 1h' +
      (p.os != null ? ' · organic score ' + p.os + (p.ageH != null && p.ageH <= 2 ? ' (too new to rate)' : '') : '') +
      (p.botChurn ? ' · few wallets making most trades' : '');
    var volWhy = 'Last 5 min trading at ' + (p.ratio >= 10 ? Math.round(p.ratio) : p.ratio.toFixed(1)) + '× its normal pace';
    var cleanWhy = (grade === 'green' ? 'No red flags' : grade === 'amber' ? 'Caution flags' : 'Red flags') +
      (p.top != null ? ' · top 10 hold ' + Math.round(p.top) + '%' : '') +
      (p.ins != null ? ' · insiders ' + p.ins.toFixed(1) + '%' + (p.insN ? ' (' + p.insN + ' wallets)' : '') : ' · insider check loading');
    var html = '<h4><svg viewBox="0 0 24 24"><path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-7 2 1 3 3 3 5"/></svg>Heat score' +
      (st.l ? ' <span class="stg ' + st.k + '">' + st.l + '</span>' : '') +
      '<span class="hscore ' + (hs >= 65 ? 'hot' : '') + '">' + Math.round(hs) + '%</span></h4>' +
      row('Price action', pct(W.price), p.price, priceWhy) +
      row('Net buying', pct(W.buying), p.buying, buyWhy) +
      row('Organic growth', pct(W.organic), p.organic, orgWhy) +
      row('Volume', pct(W.volume), p.volume, volWhy) +
      row('Clean', pct(W.clean), p.clean, cleanWhy) +
      (p.social > 0 ? row('Social buzz', 'bonus', p.social, socialWhy(t.so)) : '');
    var notes = [];
    if (p.ins != null && p.ins >= 15) notes.push('Insiders hold ' + Math.round(p.ins) + '%. Score cut ' + (p.ins >= 25 ? '70' : '40') + '%. Linked wallets can dump together.');
    if (p.top != null && p.mc < 100e6 && p.top >= p.topBad) notes.push('Top 10 wallets hold ' + Math.round(p.top) + '%. Score cut in half.');
    if (p.bot) notes.push('Looks like bot trading (a few wallets making most of the trades). Score cut 60%.');
    if (p.short >= 0.6 && (p.organic < 0.35 || p.buying < 0.45)) notes.push('Price is spiking, but the buying doesn\'t look organic yet, so the spike isn\'t boosting the score.');
    else if (p.short >= 0.6) notes.push('Price spiking right now with real buying: score lifted.');
    if (p.size < 1) notes.push('Small market cap: score scaled to ' + Math.round(p.size * 100) + '%.');
    if (p.faded) notes.push('Ran earlier but fading now. Score cut 40%.');
    if (p.dumping) notes.push('Selling is winning right now. Score cut 45%.');
    if (p.cooling) notes.push('Ran earlier but not moving now. Score cut 25% until it surges again.');
    if (p.ranBefore && !p.bottomIn) notes.push('Already had a big run and the bottom isn\'t confirmed yet. Score cut 30%.');
    if (p.dead) notes.push('Very few trades in the last 5 minutes.');
    if (grade === 'red') notes.push('Red safety flags. Score cut 55%.');
    notes.push(p.live ? 'Live price checks every few seconds.' : 'Live 30s–4m price checks start once the coin has been on screen briefly.');
    return html + notes.map(function (n) { return '<p class="hnote">' + esc(n) + '</p>'; }).join('');
  }
  function socialWhy(so) {
    so = so || {}; var out = [];
    if (so.tg != null) out.push('Telegram call ' + so.tg + 'm ago');
    if (so.b != null) out.push('DexScreener boost ' + so.b + 'm ago');
    if (so.p != null) out.push('Profile updated ' + so.p + 'm ago');
    if (so.c != null) out.push('Community takeover ' + so.c + 'm ago');
    return out.join(' · ');
  }

  // ---- Shortlist minute checks ----
  function want(list, pinned) {
    var now = Date.now();
    if (busy || (now - lastPull < 75e3 && !(pinned && !minOf(pinned)))) return;
    var cands = list.filter(function (t) { return t.pair && (t.v.m5 || 0) >= 500 && (t.mc || 0) >= 30e3; })
      .map(function (t) { return [t, score(t)]; })
      .sort(function (a, b) { return b[1] - a[1]; })
      .slice(0, 24)
      .map(function (x) { return x[0]; })
      .sort(function (a, b) { return (asked.get(a.a) || 0) - (asked.get(b.a) || 0); })
      .slice(0, pinned ? 3 : 4);
    if (pinned && pinned.pair) cands.unshift(pinned);
    if (!cands.length) return;
    busy = true; lastPull = now;
    cands.forEach(function (t) { asked.set(t.a, now); });
    var q = cands.map(function (t) { return t.pair + ':' + t.a; }).join(',');
    fetch('/api/minutes?q=' + q).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || !d.f) return;
      var at = Date.now();
      Object.keys(d.f).forEach(function (m) { MIN.set(m, { f: d.f[m], at: at }); });
      ver++;
      if (api.onUpdate) api.onUpdate();
    }).catch(function () {}).finally(function () { busy = false; });
  }

  function live() {
    var now = Date.now(), out = [];
    SEEN.forEach(function (x, k) { if (now - x.at < 150e3) out.push(x); else SEEN.delete(k); });
    return out;
  }

  var api = { W: W, parts: parts, score: score, total: total, stage: stage, card: card, want: want, live: live, record: record,
    version: function () { return ver + '.' + Math.floor(Date.now() / 5000) + '.' + (window.HCRisk ? window.HCRisk.size : 0); }, onUpdate: null };
  window.MomentumHeat = api;
})();
