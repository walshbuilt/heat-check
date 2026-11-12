import { send, candlesFor, poolsFor } from './_lib.js';

const clean = (v) => String(v || '').replace(/[^1-9A-HJ-NP-Za-km-z]/g, '');

// Run history for the Igniting list: has this coin already had its big move, and where is its floor?
// One hourly-candle call (up to 7 days). Everything older than 3 hours is "before the current move".
//   preRun  biggest low-to-high multiple the coin made before the last 3 hours (4+ = already ran)
//   preHi   highest price before the last 3 hours
//   lo72    lowest price in the last 72 hours (the floor a rebound has to hold above)
//   lo6     lowest price in the last 6 hours (a higher low than lo72 means the bottom is in)
//   hi / hiT  7-day high and when it printed
export default async function handler(req, res) {
  const a = clean(req.query.a);
  let pool = clean(req.query.pool);
  if (!a && !pool) return send(res, 400, { error: 'missing a' }, 'no-store');
  try {
    let c = pool ? await candlesFor(pool, 'hour', 1, 0, 168, a || 'base').catch(() => null) : null;
    if ((!c || !c.length) && a) {
      pool = (await poolsFor(a))[0];
      c = pool ? await candlesFor(pool, 'hour', 1, 0, 168, a).catch(() => null) : null;
    }
    if (c === null) return send(res, 503, { error: 'history unavailable' }, 'no-store');
    c = (c || []).filter((x) => x.h > 0 && x.l > 0);
    if (!c.length) return send(res, 200, { a, n: 0 }, 's-maxage=120');

    // Drop single-candle wicks more than 4x the candle body's range (bad prints on thin pools).
    for (const x of c) { const top = Math.max(x.o, x.c), bot = Math.min(x.o, x.c); if (x.h > top * 4) x.h = top; if (x.l < bot / 4) x.l = bot; }

    const now = Math.floor(Date.now() / 1000);
    const pre = c.filter((x) => x.t < now - 3 * 3600);
    let preRun = 1, preHi = null, runLo = Infinity;
    for (const x of pre) {
      runLo = Math.min(runLo, x.l);
      if (preHi == null || x.h > preHi) preHi = x.h;
      preRun = Math.max(preRun, x.h / runLo);
    }
    const lowIn = (hrs) => { const s = c.filter((x) => x.t >= now - hrs * 3600); return s.length ? Math.min(...s.map((x) => x.l)) : null; };
    const hiC = c.reduce((m, x) => (x.h > m.h ? x : m), c[0]);
    send(res, 200, {
      a, pool, n: c.length,
      t0: c[0].t, open0: c[0].o,
      hi: hiC.h, hiT: hiC.t,
      preHi, preRun: Math.round(preRun * 100) / 100,
      lo72: lowIn(72), lo6: lowIn(6),
    }, 's-maxage=180, stale-while-revalidate=600');
  } catch (e) {
    send(res, 502, { error: String(e.message || e) }, 'no-store');
  }
}
