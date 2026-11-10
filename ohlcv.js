import { send, candlesFor, poolsFor } from './_lib.js';

const TF = {
  '1m': ['minute', 1], '5m': ['minute', 5], '15m': ['minute', 15],
  '1h': ['hour', 1], '4h': ['hour', 4], '1d': ['day', 1],
};
const clean = (v) => String(v || '').replace(/[^1-9A-HJ-NP-Za-km-z]/g, '');
// How far (in multiples) the chart's last close is from the live price.
const off = (candles, p) => (candles.length && p > 0 ? Math.abs(Math.log(candles[candles.length - 1].c / p)) : 0);
const BAD = Math.log(2.5);
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Warm-instance candle cache. The chart source is rate limited, so a good result is reused for a few
// seconds, and if a fresh request fails the last good chart is served instead of an empty one.
const cache = new Map(); // key -> { at, candles, pool }
const KEEP_STALE = 30 * 60e3;

// Chart candles for a token. Prices are always for the requested token (not the pool's other side).
// If the pool has no history, or its prices don't match the live price, try the token's other pools.
export default async function handler(req, res) {
  let pool = clean(req.query.pool);
  const mint = clean(req.query.a);
  const live = Number(req.query.p) || 0;
  const tf = TF[req.query.tf] ? req.query.tf : '5m';
  const before = Number(req.query.before) || 0;
  const limit = Math.min(1000, Math.max(5, Number(req.query.limit) || 500));
  if (!pool && !mint) return send(res, 400, { error: 'missing pool' }, 'no-store');
  const [unit, agg] = TF[tf];
  const fresh_ttl = unit === 'minute' ? 15e3 : 60e3;
  const key = `${pool}|${mint}|${tf}|${limit}`;
  const hit = !before && cache.get(key);
  if (hit && Date.now() - hit.at < fresh_ttl) {
    return send(res, 200, { tf, pool: hit.pool, candles: hit.candles, mismatch: hit.mismatch, cached: true }, 's-maxage=5, stale-while-revalidate=10');
  }

  // null = the request failed (usually a rate limit); [] = the pool genuinely has no history.
  let failed = 0;
  const get = async (p) => {
    for (let i = 0; i < 2; i++) {
      try { return await candlesFor(p, unit, agg, before, limit, mint || 'base'); }
      catch { failed++; if (i === 0) await wait(1500); }
    }
    return null;
  };
  const step = { minute: 60, hour: 3600, day: 86400 }[unit] * agg;
  const fresh = (c) => c && c.length > 0 && Date.now() / 1000 - c[c.length - 1].t < Math.max(step * 12, 3 * 3600);
  const better = (a, b) => (!a || !a.length ? false : !b || !b.length ? true : fresh(a) !== fresh(b) ? fresh(a) : off(a, live) < off(b, live));
  try {
    let candles = pool ? await get(pool) : null;
    // Only look at the coin's other pools when the main pool actually answered (empty, old or off).
    // If it failed, the source is rate limited and more calls would just make it worse.
    const rateLimited = pool && candles === null;
    if (mint && !before && !rateLimited && (!candles || !candles.length || !fresh(candles) || off(candles, live) > BAD)) {
      const alts = (await poolsFor(mint)).filter((a) => a !== pool).slice(0, 3);
      for (const alt of alts) {
        const c = await get(alt);
        if (better(c, candles)) { candles = c; pool = alt; }
        if (fresh(candles) && off(candles, live) <= BAD) break;
      }
    }
    if (!candles || (!candles.length && failed)) {
      // Source unavailable: serve the last good chart if we have one, otherwise tell the page to retry.
      if (hit && Date.now() - hit.at < KEEP_STALE) return send(res, 200, { tf, pool: hit.pool, candles: hit.candles, mismatch: hit.mismatch, stale: true }, 'no-store');
      return send(res, 503, { error: 'chart history temporarily unavailable', candles: [] }, 'no-store');
    }
    const mismatch = !before && live > 0 && off(candles, live) > BAD;
    if (!before && candles.length) {
      cache.set(key, { at: Date.now(), candles, pool, mismatch });
      if (cache.size > 400) for (const [k, v] of cache) if (Date.now() - v.at > KEEP_STALE) cache.delete(k);
    }
    const ttl = before ? 300 : unit === 'minute' ? 10 : 60;
    send(res, 200, { tf, pool, candles, mismatch }, candles.length ? `s-maxage=${ttl}, stale-while-revalidate=${ttl}` : 'no-store');
  } catch (e) {
    if (hit) return send(res, 200, { tf, pool: hit.pool, candles: hit.candles, mismatch: hit.mismatch, stale: true }, 'no-store');
    send(res, 503, { error: String(e.message || e), candles: [] }, 'no-store');
  }
}
