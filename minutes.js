import { send, candlesFor } from './_lib.js';

// Minute-level ignition signals for a shortlist of coins.
// Query: q=pool:mint,pool:mint,... (max 12). Returns compact features per mint, not raw candles.
const clean = (v) => String(v || '').replace(/[^1-9A-HJ-NP-Za-km-z]/g, '');
const cache = new Map(); // pool -> { at, f }
const TTL = 60e3;

const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

// Turn up to 6h of 1-minute candles into ignition features.
export function features(cs, nowSec = Date.now() / 1000) {
  if (cs.length < 20) return null;
  // Fill gaps so a quiet minute counts as zero volume, not "missing".
  const byT = new Map(cs.map((c) => [c.t, c]));
  const end = cs[cs.length - 1].t, start = Math.max(cs[0].t, end - 360 * 60);
  const m = [];
  let last = cs.find((c) => c.t >= start) || cs[0];
  for (let t = start; t <= end; t += 60) {
    const c = byT.get(t);
    if (c) { m.push(c); last = c; } else m.push({ t, o: last.c, h: last.c, l: last.c, c: last.c, v: 0 });
  }
  const n = m.length;
  const stale = nowSec - end > 20 * 60; // no trades for 20+ min
  const recent = m.slice(-3), prior = m.slice(Math.max(0, n - 63), n - 3);
  const base = Math.max(median(prior.map((c) => c.v)), mean(prior.map((c) => c.v)) * 0.35, 1);
  const surge = mean(recent.map((c) => c.v)) / base;                                   // last 3 min vs its normal minute
  const surge15 = mean(m.slice(-15).map((c) => c.v)) / Math.max(mean(m.slice(Math.max(0, n - 75), n - 15).map((c) => c.v)), 1);
  const close = m[n - 1].c;
  const rangeHi = Math.max(...m.slice(Math.max(0, n - 33), n - 3).map((c) => c.h));
  const brk = rangeHi > 0 ? close / rangeHi - 1 : 0;                                   // above the prior 30-min high?
  const ch1 = close / m[Math.max(0, n - 2)].o - 1, ch5 = close / m[Math.max(0, n - 5)].o - 1;
  // Dip and recovery over the window: peak → lowest point after it → now.
  let hiI = 0; m.forEach((c, i) => { if (c.h > m[hiI].h) hiI = i; });
  let loI = hiI; for (let i = hiI; i < n; i++) if (m[i].l < m[loI].l) loI = i;
  const hi = m[hiI].h, lo = m[loI].l;
  const dd = hi > 0 ? lo / hi - 1 : 0;                                                  // e.g. -0.6 = fell 60%
  const rec = lo > 0 ? close / lo - 1 : 0;                                              // bounce off the low
  const lowAgo = n - 1 - loI;
  const higherLow = lowAgo >= 10 && Math.min(...m.slice(-8).map((c) => c.l)) > lo * 1.04;
  // When did the current burst start? Walk back while 3-min volume stays well above normal.
  let ign = -1;
  for (let i = n - 1; i >= Math.max(2, n - 60); i--) {
    const v3 = (m[i].v + m[i - 1].v + m[i - 2].v) / 3;
    if (v3 > base * 2.5) ign = i - 2; else if (ign !== -1) break;
  }
  const ago = ign >= 0 ? n - 1 - ign : null;
  const run = ign >= 0 && m[ign].o > 0 ? close / m[ign].o - 1 : null;                   // move since the burst began
  const r = (x, d = 3) => (x == null || !isFinite(x) ? null : Number(x.toFixed(d)));
  return { s: r(surge, 2), s15: r(surge15, 2), brk: r(brk), c1: r(ch1), c5: r(ch5), dd: r(dd), rec: r(rec), lowAgo, hl: higherLow, ago, run: r(run), stale, n, t: end };
}

export default async function handler(req, res) {
  const pairs = String(req.query.q || '').split(',').map((x) => x.split(':').map(clean)).filter(([p, a]) => p && a).slice(0, 8);
  if (!pairs.length) return send(res, 400, { error: 'missing q' }, 'no-store');
  const now = Date.now(), out = {};
  await Promise.all(pairs.map(async ([pool, mint]) => {
    const hit = cache.get(pool);
    if (hit && now - hit.at < TTL) { out[mint] = hit.f; return; }
    try {
      const cs = await candlesFor(pool, 'minute', 1, null, 360, mint);
      const f = features(cs);
      cache.set(pool, { at: now, f });
      out[mint] = f;
    } catch { out[mint] = null; }
  }));
  if (cache.size > 2000) for (const [k, v] of cache) if (now - v.at > TTL * 3) cache.delete(k);
  send(res, 200, { t: now, f: out }, 's-maxage=30, stale-while-revalidate=15');
}
