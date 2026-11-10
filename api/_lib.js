// Shared helpers for Inflection serverless functions.
export const DS = 'https://api.dexscreener.com';
export const GT = 'https://api.geckoterminal.com/api/v2';

export const QUOTE_MINTS = new Set([
  'So11111111111111111111111111111111111111112', // SOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB',  // USD1
  '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo', // PYUSD
]);

export async function getJSON(url, { timeout = 6500, headers = {}, retry = 0 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: 'application/json', 'user-agent': 'Momentum/1.0', ...headers },
    });
    if (r.status === 429 && retry > 0) {
      clearTimeout(t);
      await new Promise((ok) => setTimeout(ok, 1200));
      return getJSON(url, { timeout, headers, retry: retry - 1 });
    }
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

export async function settle(promises) {
  const out = await Promise.allSettled(promises);
  return out.map((o) => (o.status === 'fulfilled' ? o.value : null));
}

export function send(res, status, body, cache) {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('access-control-allow-origin', '*');
  if (cache) res.setHeader('cache-control', cache);
  res.status(status).send(JSON.stringify(body));
}

const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

// Collapse all DexScreener pairs for one token into a single row.
export function summarize(pairs) {
  if (!pairs || !pairs.length) return null;
  const sorted = [...pairs].sort(
    (a, b) => (n(b.liquidity?.usd) || 0) - (n(a.liquidity?.usd) || 0) ||
      (n(b.volume?.h24) || 0) - (n(a.volume?.h24) || 0)
  );
  const p = sorted[0];
  const sum = (k) => pairs.reduce((s, x) => s + (n(x.volume?.[k]) || 0), 0);
  const txs = (k) =>
    pairs.reduce(
      (s, x) => {
        s.b += n(x.txns?.[k]?.buys) || 0;
        s.s += n(x.txns?.[k]?.sells) || 0;
        return s;
      },
      { b: 0, s: 0 }
    );
  const mc = n(p.marketCap) || n(p.fdv);
  const liq = pairs.reduce((s, x) => s + (n(x.liquidity?.usd) || 0), 0);
  const created = Math.min(...pairs.map((x) => n(x.pairCreatedAt) || Infinity));
  const info = p.info || {};
  const row = {
    a: p.baseToken.address,
    s: p.baseToken.symbol,
    nm: p.baseToken.name,
    img: info.imageUrl || null,
    pair: p.pairAddress,
    dex: p.dexId,
    url: p.url,
    p: n(p.priceUsd),
    mc,
    fdv: n(p.fdv),
    liq: liq || null,
    v: { m5: sum('m5'), h1: sum('h1'), h6: sum('h6'), h24: sum('h24') },
    c: {
      m5: n(p.priceChange?.m5), h1: n(p.priceChange?.h1),
      h6: n(p.priceChange?.h6), h24: n(p.priceChange?.h24),
    },
    tx: { m5: txs('m5'), h1: txs('h1'), h24: txs('h24') },
    age: Number.isFinite(created) ? created : null,
    web: (info.websites || []).map((w) => w.url).slice(0, 2),
    soc: (info.socials || []).map((s) => ({ t: s.type, u: s.url })).slice(0, 4),
    boost: n(p.boosts?.active) || 0,
  };
  row.f = flags(row);
  return row;
}

// Red-flag heuristics. level: 3 = danger, 2 = caution, 1 = info
export function flags(r) {
  const f = [];
  const add = (l, k, t) => f.push({ l, k, t });
  const bonding = !r.liq && /pump/i.test(r.dex || '');
  const mc = r.mc || 0;
  if (bonding) add(1, 'curve', 'Still on the pump.fun bonding curve');
  else if (!r.liq || r.liq < 3000) add(3, 'liq', 'Very thin liquidity (under $3K)');
  else if (mc && mc < 50e6) {
    // Bigger caps naturally carry a smaller liquidity share (and trade on many venues), so scale the bar by size.
    const lm = r.liq / mc;
    const [dl, wl] = mc >= 5e6 ? [0.005, 0.01] : [0.02, 0.05];
    const pct = (lm * 100).toFixed(lm < 0.01 ? 2 : 1);
    if (lm < dl) add(3, 'liqmc', `Liquidity only ${pct}% of market cap`);
    else if (lm < wl) add(2, 'liqmc', `Liquidity only ${pct}% of market cap`);
  }

  if (r.liq && r.v.h24 / r.liq > 60) add(2, 'wash', 'Volume is 60x+ liquidity — possible wash trading');
  const t24 = r.tx.h24.b + r.tx.h24.s;
  if (r.v.h24 > 50000 && t24 < 40) add(2, 'fewtx', 'Big volume from very few trades');
  else if (t24 > 0 && mc < 1e6 && r.v.h24 / t24 > 6000) add(2, 'whale', 'Average trade size unusually large (bots/whales)');
  if (r.c.h1 != null && r.c.h1 <= -50) add(3, 'dump1', `Down ${Math.round(-r.c.h1)}% in the last hour`);
  else if (r.c.h24 != null && r.c.h24 <= -80) add(3, 'dump24', `Down ${Math.round(-r.c.h24)}% in 24h`);
  const h1 = r.tx.h1;
  if (h1.s >= 20 && h1.s > h1.b * 2) add(2, 'sells', 'Sells outnumber buys 2:1 this hour');
  if (r.age && Date.now() - r.age < 30 * 60e3) add(2, 'new', 'Less than 30 minutes old');
  if (!r.web.length && !r.soc.length) add(2, 'nosoc', 'No website or socials listed');
  if (r.boost) add(1, 'boost', 'Paid DexScreener boost active');
  // Holder concentration and dev control (from Jupiter's audit). Big established coins naturally have
  // treasuries/exchanges in their top 10, so the bar scales with size.
  if (r.top != null && mc < 100e6) {
    const [bad, warn] = mc < 5e6 ? [40, 28] : mc < 25e6 ? [50, 35] : [70, 55];
    if (r.top >= bad) add(3, 'top10', `Top 10 wallets hold ${Math.round(r.top)}%`);
    else if (r.top >= warn) add(2, 'top10', `Top 10 wallets hold ${Math.round(r.top)}%`);
  }
  if (r.dev != null && mc < 100e6) {
    if (r.dev >= 8) add(3, 'dev', `Dev wallet still holds ${r.dev.toFixed(1)}%`);
    else if (r.dev >= 3) add(2, 'dev', `Dev wallet still holds ${r.dev.toFixed(1)}%`);
  }
  if (r.src === 'jup' && r.aud && mc < 50e6) {
    if (!r.mintOff) add(3, 'mint', 'Dev can still mint new tokens');
    if (!r.frzOff) add(3, 'freeze', 'Dev can still freeze wallets');
  }
  const old = r.age && Date.now() - r.age > 3 * 3600e3;
  if (old && r.ol === 'low' && (r.v.h24 || 0) > 50e3) add(2, 'inorganic', 'Low organic score: mostly bot trading');
  return f;
}

// ---- Meme filter: drop stablecoins, staked SOL, wrapped majors, tokenized stocks and DeFi/infra tokens ----
const NOT_MEME = new Set([
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', // JUP, RAY
  'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL', // PYTH, JTO
  '85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ', 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE', // W, ORCA
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', // mSOL, jitoSOL
  'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1', '5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm', // bSOL, INF
  '27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4', 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij', // JLP, cbBTC
  '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh', '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', // WBTC, WETH
  'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof', 'hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux', // RENDER, HNT
  'DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7', 'KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS', // DRIFT, KMNO
  'TNSRxcUxoT9xBG3de7PiJyTDYu7kskLqcpddxnEJAS6', 'Grass7B4RdKfBCjTKgSqnXkqjwiGvQyFbuSCUJr3XXjs', // TNSR, GRASS
  'ZEUS1aR7aX8DFFJf5QjWj2ftDDdNTroMNGo8YoQm3Gq', 'DEkqHyPN7GMRJ5cArtQFAWefqbZb33Hyf6s5iCwjEonT', // ZEUS, USDe
]);
const NOT_MEME_NAME = /(xstock|tokenized|wrapped|bridged|\(wormhole\)|\(portal\)|staked sol|liquid stak|usd coin|tether|stablecoin|\bdollar\b|\byield\b|treasury|gold token|\bvault\b)/i;
const NOT_MEME_SYM = /^(usd.*|.*usd|.*usdc|.*usdt|[a-z]{0,6}sol|w?btc|.*btc|w?eth|.*eth|eurc|pyusd|.*x)$/i;
const LAUNCHPAD = /(pump|bonk|boop|bags|moon|daos)$/;
export function isMeme(r) {
  if (LAUNCHPAD.test(r.a)) return true; // launched on a meme launchpad
  if (NOT_MEME.has(r.a) || QUOTE_MINTS.has(r.a)) return false;
  if (NOT_MEME_NAME.test(r.nm || '')) return false;
  if (NOT_MEME_SYM.test(r.s || '') && /(stak|wrap|bridge|stock|usd|bitcoin|ether|sol\b|liquid)/i.test(r.nm || '')) return false;
  return true;
}

// Group DexScreener pair arrays by base token and summarize each.
export function rowsFrom(results, only) {
  const byToken = new Map();
  for (const arr of results) {
    for (const p of Array.isArray(arr) ? arr : []) {
      if (p.chainId !== 'solana' || !p.baseToken?.address) continue;
      const k = p.baseToken.address;
      if (QUOTE_MINTS.has(k) || (only && !only.has(k))) continue;
      if (!byToken.has(k)) byToken.set(k, []);
      byToken.get(k).push(p);
    }
  }
  const out = [];
  for (const pairs of byToken.values()) {
    const row = summarize(pairs);
    if (!row || !row.mc || !row.p || row.mc <= 0 || !isMeme(row)) continue;
    row.g = grade(row.f);
    out.push(row);
  }
  return out;
}

export function grade(f) {
  const d = f.filter((x) => x.l === 3).length;
  const w = f.filter((x) => x.l === 2).length;
  if (d || w >= 3) return 'red';
  if (w) return 'amber';
  return 'green';
}

// ---- GeckoTerminal candles ----
export const GT_HDR = { headers: { accept: 'application/json;version=20230302' } };
// `token` = the mint we want prices for, so candles are right even when our coin is the pool's quote side.
export async function candlesFor(pool, unit, agg, before, limit, token) {
  const q = `aggregate=${agg}&limit=${limit}&currency=usd&token=${token || 'base'}${before ? `&before_timestamp=${before}` : ''}`;
  const j = await getJSON(`${GT}/networks/solana/pools/${pool}/ohlcv/${unit}?${q}`, { ...GT_HDR, retry: 1 });
  return (j?.data?.attributes?.ohlcv_list || [])
    .map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
    .sort((x, y) => x.t - y.t);
}
// The token's pools on GeckoTerminal, most active first.
export async function poolsFor(mint) {
  const j = await getJSON(`${GT}/networks/solana/tokens/${mint}/pools?page=1`, { ...GT_HDR, retry: 1 }).catch(() => null);
  return (j?.data || []).map((p) => String(p?.attributes?.address || '')).filter(Boolean);
}

// ---- Live market data from Jupiter: aggregated across ALL pools, real circulating supply ----
// DexScreener often tracks only one pool for a coin (missing much of its trading) and prices
// market cap on total supply. Jupiter's token feed covers every pool and uses circulating supply,
// so it overrides price, market cap, liquidity, volume, price change and trade counts.
const JUP_TOK = 'https://lite-api.jup.ag/tokens/v2/search?query=';
const jupCache = new Map(); // mint -> { at, d }
const JUP_TTL = 2500;
export async function jupTokens(mints) {
  const now = Date.now(), out = new Map(), need = [];
  for (const m of mints) { const c = jupCache.get(m); if (c && now - c.at < JUP_TTL) out.set(m, c.d); else need.push(m); }
  const chunks = [];
  for (let i = 0; i < need.length; i += 100) chunks.push(need.slice(i, i + 100));
  const res = await settle(chunks.map((c) => getJSON(JUP_TOK + c.join(','), { timeout: 5000, retry: 1 })));
  res.forEach((arr) => (Array.isArray(arr) ? arr : []).forEach((d) => { if (d && d.id) { out.set(d.id, d); jupCache.set(d.id, { at: now, d }); } }));
  if (jupCache.size > 5000) for (const [k, v] of jupCache) if (now - v.at > 60e3) jupCache.delete(k);
  return out;
}
export async function withJupiter(rows) {
  if (!rows.length) return rows;
  let map;
  try { map = await jupTokens(rows.map((r) => r.a)); } catch { return rows; }
  for (const r of rows) {
    const j = map.get(r.a);
    if (!j || !(n(j.usdPrice) > 0)) continue;
    r.p = n(j.usdPrice);
    r.mc = n(j.mcap) || n(j.fdv) || r.mc;
    r.fdv = n(j.fdv) || r.fdv;
    if (n(j.liquidity) > 0) r.liq = n(j.liquidity);
    const win = { m5: j.stats5m, h1: j.stats1h, h6: j.stats6h, h24: j.stats24h };
    for (const k of ['m5', 'h1', 'h6', 'h24']) {
      const s = win[k];
      if (!s) continue;
      const vol = (n(s.buyVolume) || 0) + (n(s.sellVolume) || 0);
      if (vol > 0 || n(s.numBuys) != null) r.v[k] = vol;
      if (n(s.priceChange) != null) r.c[k] = n(s.priceChange);
      if (k !== 'h6' && (n(s.numBuys) != null || n(s.numSells) != null)) r.tx[k] = { b: n(s.numBuys) || 0, s: n(s.numSells) || 0 };
    }
    // Attention: unique traders, new-holder growth (%) and net new buyers per window.
    const tr = {}, hc = {}, nb = {};
    for (const k of ['m5', 'h1', 'h24']) {
      const s = win[k];
      if (!s) continue;
      if (n(s.numTraders) != null) tr[k] = n(s.numTraders);
      if (n(s.holderChange) != null) hc[k] = Math.round(n(s.holderChange) * 100) / 100;
      if (n(s.numNetBuyers) != null) nb[k] = n(s.numNetBuyers);
    }
    if (Object.keys(tr).length) r.tr = tr;
    if (Object.keys(hc).length) r.hc = hc;
    if (Object.keys(nb).length) r.nb = nb;
    // Buy vs sell volume and the organic (non-bot) part of it: [buyVol, sellVol, organicBuyVol, organicSellVol].
    const bs = {};
    for (const k of ['m5', 'h1', 'h24']) {
      const s = win[k];
      if (s && (n(s.buyVolume) != null || n(s.sellVolume) != null)) bs[k] = [Math.round(n(s.buyVolume) || 0), Math.round(n(s.sellVolume) || 0), Math.round(n(s.buyOrganicVolume) || 0), Math.round(n(s.sellOrganicVolume) || 0)];
    }
    if (Object.keys(bs).length) r.bs = bs;
    // Organic score (0-100, Jupiter's bot-vs-real-trader rating) and holder concentration.
    if (n(j.organicScore) != null) r.os = Math.round(n(j.organicScore));
    if (j.organicScoreLabel) r.ol = String(j.organicScoreLabel).slice(0, 8);
    const au = j.audit || {};
    if (n(au.topHoldersPercentage) != null) r.top = Math.round(n(au.topHoldersPercentage) * 10) / 10;
    if (n(au.devBalancePercentage) != null) r.dev = Math.round(n(au.devBalancePercentage) * 10) / 10;
    r.aud = Object.keys(au).length > 0;
    r.mintOff = au.mintAuthorityDisabled === true;
    r.frzOff = au.freezeAuthorityDisabled === true;
    const first = j.firstPool?.createdAt ? Date.parse(j.firstPool.createdAt) : null;
    if (first && (!r.age || first < r.age)) r.age = first;
    if (!r.img && j.icon) r.img = j.icon;
    if (n(j.holderCount)) r.hold = n(j.holderCount);
    r.src = 'jup';
    r.f = flags(r);
    r.g = grade(r.f);
  }
  return rows;
}
