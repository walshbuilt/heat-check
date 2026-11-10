import { DS, GT, getJSON, send } from './_lib.js';

// Chart-source probe: status, timing and candle count straight from GeckoTerminal.
async function probe(url) {
  const t = Date.now();
  try {
    const r = await fetch(url, { headers: { accept: 'application/json;version=20230302', 'user-agent': 'Momentum/1.0' }, signal: AbortSignal.timeout(8000) });
    const body = await r.text();
    let n = null; try { n = JSON.parse(body)?.data?.attributes?.ohlcv_list?.length ?? null; } catch {}
    return { status: r.status, ms: Date.now() - t, candles: n, retryAfter: r.headers.get('retry-after'), head: n == null ? body.slice(0, 160) : undefined };
  } catch (e) { return { error: String(e.name || e.message), ms: Date.now() - t }; }
}

// Diagnostic: the same coin from every source at the same instant, to catch stale or wrong numbers.
const clean = (v) => String(v || '').replace(/[^1-9A-HJ-NP-Za-km-z]/g, '');
const JUP = 'https://lite-api.jup.ag';
const n = (x) => (x == null ? null : Number(x));

export default async function handler(req, res) {
  const a = clean(req.query.a);
  if (a.length < 32) return send(res, 400, { error: 'missing a' }, 'no-store');
  const t0 = Date.now();
  if (req.query.chart) {
    const pool = clean(req.query.pool);
    const base = `${GT}/networks/solana/pools/${pool}/ohlcv`;
    const out = {};
    for (const [k, path] of [['1m', 'minute?aggregate=1'], ['5m', 'minute?aggregate=5'], ['1h', 'hour?aggregate=1'], ['1d', 'day?aggregate=1']]) out[k] = await probe(`${base}/${path}&limit=300&currency=usd&token=${a}`);
    // Our own chart endpoint, exactly as the site calls it.
    for (const tf of ['1m', '5m', '1h']) {
      const t = Date.now();
      try {
        const r = await fetch(`https://${req.headers.host}/api/ohlcv?pool=${pool}&a=${a}&tf=${tf}&p=${Number(req.query.p) || 0}`, { signal: AbortSignal.timeout(12000) });
        const body = await r.text();
        let j = null; try { j = JSON.parse(body); } catch {}
        out['ours_' + tf] = { status: r.status, ms: Date.now() - t, candles: j?.candles?.length ?? null, pool: j?.pool, mismatch: j?.mismatch, last: j?.candles?.at?.(-1), head: j ? undefined : body.slice(0, 200) };
      } catch (e) { out['ours_' + tf] = { error: String(e.name || e.message), ms: Date.now() - t }; }
    }
    return send(res, 200, { at: new Date(t0).toISOString(), pool, out }, 'no-store');
  }
  const bust = `?_=${t0}`;
  const [ds, dsBust, jp, jt, gt] = await Promise.all([
    getJSON(`${DS}/tokens/v1/solana/${a}`).catch((e) => ({ err: String(e.message) })),
    getJSON(`${DS}/tokens/v1/solana/${a}${bust}`).catch((e) => ({ err: String(e.message) })),
    getJSON(`${JUP}/price/v3?ids=${a}`).catch((e) => ({ err: String(e.message) })),
    getJSON(`${JUP}/tokens/v2/search?query=${a}`).catch((e) => ({ err: String(e.message) })),
    getJSON(`${GT}/networks/solana/tokens/${a}`, { headers: { accept: 'application/json;version=20230302' } }).catch((e) => ({ err: String(e.message) })),
  ]);
  const dsRow = (arr) => (Array.isArray(arr) ? arr : []).filter((p) => p.baseToken?.address === a).map((p) => ({
    pair: p.pairAddress, dex: p.dexId, price: n(p.priceUsd), mc: n(p.marketCap), fdv: n(p.fdv), liq: n(p.liquidity?.usd),
    v: p.volume, c: p.priceChange, tx: p.txns,
  }));
  const jtok = Array.isArray(jt) ? jt.find((x) => x.id === a) : null;
  const ga = gt?.data?.attributes;
  send(res, 200, {
    at: new Date(t0).toISOString(), ms: Date.now() - t0,
    dexscreener: dsRow(ds), dexscreenerNoCache: dsRow(dsBust),
    jupiterPrice: jp?.[a] ? { price: n(jp[a].usdPrice), change24h: n(jp[a].priceChange24h), block: jp[a].blockId } : jp,
    jupiterToken: jtok ? { price: n(jtok.usdPrice), mcap: n(jtok.mcap), fdv: n(jtok.fdv), circ: n(jtok.circSupply), total: n(jtok.totalSupply), liq: n(jtok.liquidity), holders: jtok.holderCount, updated: jtok.updatedAt, s5m: jtok.stats5m, s1h: jtok.stats1h, s24h: jtok.stats24h, launchpad: jtok.launchpad, website: jtok.website, twitter: jtok.twitter, tags: jtok.tags } : null,
    gecko: ga ? { price: n(ga.price_usd), mc: n(ga.market_cap_usd), fdv: n(ga.fdv_usd), supply: n(ga.normalized_total_supply), vol24: n(ga.volume_usd?.h24) } : gt,
  }, 'no-store');
}
