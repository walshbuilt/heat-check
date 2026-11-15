import { send, candlesFor, poolsFor } from './_lib.js';

const clean = (v) => String(v || '').replace(/[^1-9A-HJ-NP-Za-km-z]/g, '');
const cache = new Map(); // mint|pool -> { at, d }

// 4-hour price reference and volume for the coin page, from 15-minute candles.
//   p4  price 4 hours ago (or at the coin's first trade if it's younger than that)
//   v4  USD volume over the last 4 hours
export default async function handler(req, res) {
  const a = clean(req.query.a);
  let pool = clean(req.query.pool);
  if (!a && !pool) return send(res, 400, { error: 'missing a' }, 'no-store');
  const key = a + '|' + pool, hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60e3) return send(res, 200, hit.d, 's-maxage=30');
  try {
    let c = pool ? await candlesFor(pool, 'minute', 15, 0, 18, a || 'base').catch(() => null) : null;
    if ((!c || !c.length) && a) {
      pool = (await poolsFor(a))[0];
      c = pool ? await candlesFor(pool, 'minute', 15, 0, 18, a).catch(() => null) : null;
    }
    if (!c) { if (hit) return send(res, 200, hit.d, 'no-store'); return send(res, 503, { error: 'history unavailable' }, 'no-store'); }
    const from = Math.floor(Date.now() / 1000) - 4 * 3600;
    const win = c.filter((x) => x.t >= from && x.o > 0);
    const d = { a, p4: win.length ? win[0].o : null, v4: Math.round(win.reduce((s, x) => s + (x.v || 0), 0)), n: win.length };
    cache.set(key, { at: Date.now(), d });
    if (cache.size > 500) for (const [k, v] of cache) if (Date.now() - v.at > 10 * 60e3) cache.delete(k);
    send(res, 200, d, 's-maxage=60, stale-while-revalidate=120');
  } catch (e) {
    send(res, 502, { error: String(e.message || e) }, 'no-store');
  }
}
