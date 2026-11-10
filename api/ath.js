import { send, candlesFor, poolsFor } from './_lib.js';

const clean = (v) => String(v || '').replace(/[^1-9A-HJ-NP-Za-km-z]/g, '');
const peak = (arr) => arr.reduce((m, c) => (c.h > m.h ? c : m));
// Skip pools whose latest price doesn't match the live price (wrong pairing / stale data).
const sane = (days, live) => !live || !days.length || Math.abs(Math.log(days[days.length - 1].c / live)) < Math.log(2.5);

// All-time high and exactly when it happened. Checks the token's main pools (older coins often
// migrated liquidity), finds the peak day, then narrows to the peak hour and minute.
export default async function handler(req, res) {
  const pool0 = clean(req.query.pool);
  const mint = clean(req.query.a);
  const live = Number(req.query.p) || 0;
  if (!pool0 && !mint) return send(res, 400, { error: 'missing pool' }, 'no-store');
  try {
    const pools = [...new Set([pool0, ...(mint ? (await poolsFor(mint)).slice(0, 3) : [])].filter(Boolean))].slice(0, 4);
    const series = await Promise.all(pools.map((p) => candlesFor(p, 'day', 1, 0, 1000, mint || 'base').catch(() => null)));
    // Every lookup failed (usually a rate limit): say so instead of caching "no ATH".
    if (series.every((x) => x === null)) return send(res, 503, { error: 'history unavailable', ath: null }, 'no-store');
    let best = null, firstDay = null;
    series.forEach((days, i) => {
      if (!days || !days.length || !sane(days, live)) return;
      firstDay = firstDay == null ? days[0].t : Math.min(firstDay, days[0].t);
      const d = peak(days);
      if (!best || d.h > best.d.h) best = { d, pool: pools[i] };
    });
    if (!best) return send(res, 200, { pool: pool0, ath: null }, 's-maxage=120');
    const { d, pool } = best;
    let t = d.t, precision = 'day';
    const hours = (await candlesFor(pool, 'hour', 1, d.t + 86400, 24, mint || 'base').catch(() => [])).filter((c) => c.t >= d.t && c.t < d.t + 86400);
    if (hours.length) {
      const h = peak(hours);
      t = h.t; precision = 'hour';
      const mins = (await candlesFor(pool, 'minute', 1, h.t + 3600, 60, mint || 'base').catch(() => [])).filter((c) => c.t >= h.t && c.t < h.t + 3600);
      if (mins.length) { t = peak(mins).t; precision = 'minute'; }
    }
    send(res, 200, { pool, ath: { price: d.h, t, precision, firstDay } }, 's-maxage=300, stale-while-revalidate=900');
  } catch (e) {
    send(res, 502, { error: String(e.message || e), ath: null }, 'no-store');
  }
}
