import { DS, GT, QUOTE_MINTS, getJSON, settle, send, rowsFrom, withJupiter } from './_lib.js';

// Warm-instance memory: remember tokens we've discovered for a while so lists stay stable.
const seen = new Map(); // mint -> lastSeen ms
let lastDiscover = 0;
const KEEP_MS = 25 * 60e3;
// Established Solana memes, so the big-cap tiers ($100M+ / $1B+) are always populated.
const SEEDS = [
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
  'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', // WIF
  '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN', // TRUMP
  '2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv', // PENGU
  '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump', // FARTCOIN
  '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', // POPCAT
  'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5', // MEW
  'ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY', // MOODENG
  'CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump', // GOAT
  '2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump', // PNUT
  'ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82', // BOME
];
const MAX_TOKENS = 840;
const GT_JOBS = 6;
const DISCOVER_MS = 90e3;


function gtMints(json) {
  const out = [];
  for (const pool of json?.data || []) {
    for (const rel of ['base_token', 'quote_token']) {
      const id = pool?.relationships?.[rel]?.data?.id || '';
      const mint = id.startsWith('solana_') ? id.slice(7) : null;
      if (mint && !QUOTE_MINTS.has(mint)) out.push(mint);
    }
  }
  return out;
}

const dsMints = (arr) =>
  (Array.isArray(arr) ? arr : [])
    .filter((x) => x.chainId === 'solana' && x.tokenAddress)
    .map((x) => x.tokenAddress);

const JUP = 'https://lite-api.jup.ag/tokens/v2';
// Free social signals: when a coin first shows up in DexScreener's boost / profile / takeover feeds,
// and when public Telegram channels (env TG_CHANNELS, comma-separated usernames) first post its contract.
const promo = { b: new Map(), p: new Map(), c: new Map(), tg: new Map() };
let warm = false;
const TG = String(process.env.TG_CHANNELS || '').split(',').map((x) => x.trim().replace(/^@/, '')).filter((x) => /^[A-Za-z0-9_]{4,40}$/.test(x)).slice(0, 15);
const MINT_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
async function tgCalls(ch) {
  const r = await fetch(`https://t.me/s/${ch}`, { signal: AbortSignal.timeout(6000), headers: { 'user-agent': 'Momentum/1.0' } });
  if (!r.ok) return [];
  const html = (await r.text()).slice(0, 600000);
  const out = [];
  for (const block of html.split('tgme_widget_message_wrap').slice(1)) {
    const when = Date.parse((block.match(/<time[^>]+datetime="([^"]+)"/) || [])[1] || '');
    if (!when) continue;
    for (const m of new Set(block.replace(/<[^>]+>/g, ' ').match(MINT_RE) || [])) if (!QUOTE_MINTS.has(m)) out.push([m, when]);
  }
  return out;
}
function mark(map, mints, now) {
  // Right after a cold start we can't tell what's new, so existing entries count as old news.
  for (const m of mints) if (!map.has(m)) map.set(m, warm ? now : now - 6 * 3600e3);
}
// Bot-farmed or broken listings: claimed MC with almost no liquidity behind it,
// one-way buy flow no real market has, or MC far below its own liquidity (bad supply data).
const PINNED = new Set([...SEEDS, 'pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn']); // + PUMP
function looksFake(r) {
  if (PINNED.has(r.a)) return false;
  const liq = r.liq || 0, mc = r.mc || 0, b = r.tx?.h24?.b || 0, s = r.tx?.h24?.s || 0;
  const faceless = !r.img || (r.f || []).some((x) => x.k === 'nosoc');
  if (mc >= 10e6 && liq < mc * 0.02 && faceless) return true; // big claimed MC, no face, no depth
  if (b > 3000 && b / (s + 1) > 8) return true;               // buy-bot flow, almost nobody sells
  if (mc < 1e6 && liq > mc * 2 && liq > 50e3) return true;    // broken supply data
  return false;
}
const jupMints = (arr) => (Array.isArray(arr) ? arr : []).map((x) => x && x.id).filter((m) => typeof m === 'string' && m.length >= 32 && !QUOTE_MINTS.has(m));

async function discover() {
  const g = (path) => getJSON(`${GT}${path}`, { headers: { accept: 'application/json;version=20230302' } });
  const jobs = [
    // GeckoTerminal is rate limited and also serves every chart, so discovery uses only 6 calls.
    g('/networks/solana/trending_pools?page=1&duration=5m'),
    g('/networks/solana/trending_pools?page=1&duration=1h'),
    g('/networks/solana/pools?page=1&sort=h24_volume_usd_desc'),
    g('/networks/solana/new_pools?page=1'),
    g('/networks/solana/dexes/pumpswap/pools?page=1&sort=h24_volume_usd_desc'),
    g('/networks/solana/dexes/pump-fun/pools?page=1&sort=h24_volume_usd_desc'),
    getJSON(`${DS}/token-boosts/top/v1`),
    getJSON(`${DS}/token-boosts/latest/v1`),
    getJSON(`${DS}/token-profiles/latest/v1`),
    getJSON(`${DS}/community-takeovers/latest/v1`),
    // Jupiter's live lists widen coverage (trending, most traded, organic, brand new).
    getJSON(`${JUP}/toptrending/1h?limit=100`),
    getJSON(`${JUP}/toptraded/1h?limit=100`),
    getJSON(`${JUP}/toptrending/24h?limit=100`),
    getJSON(`${JUP}/toporganicscore/1h?limit=100`),
    getJSON(`${JUP}/recent`),
  ];
  const tgJobs = TG.map((ch) => tgCalls(ch).catch(() => []));
  const [res, tg] = await Promise.all([settle(jobs), Promise.all(tgJobs)]);
  const now = Date.now();
  let found = 0;
  res.forEach((r, i) => {
    if (!r) return;
    const mints = i < GT_JOBS ? gtMints(r) : i < GT_JOBS + 4 ? dsMints(r) : jupMints(r);
    mints.forEach((m) => { seen.set(m, now); found++; });
    if (i === GT_JOBS || i === GT_JOBS + 1) mark(promo.b, mints, now);
    if (i === GT_JOBS + 2) mark(promo.p, mints, now);
    if (i === GT_JOBS + 3) mark(promo.c, mints, now);
  });
  // Telegram calls: the post time is known, so use it directly; called coins get tracked too.
  tg.flat().forEach(([m, when]) => {
    if (now - when > 6 * 3600e3) return;
    if (!promo.tg.has(m) || promo.tg.get(m) > when) promo.tg.set(m, when);
    seen.set(m, now); found++;
  });
  for (const map of Object.values(promo)) for (const [m, t] of map) if (now - t > 12 * 3600e3) map.delete(m);
  warm = true;
  SEEDS.forEach((m) => seen.set(m, now));
  lastDiscover = now;
  return { sources: res.filter(Boolean).length, of: jobs.length, found };
}

// Fast lane: Jupiter's 5-minute lists (what's trending / most traded / most organic RIGHT NOW),
// checked every 30s so a fresh breakout shows up within a minute instead of up to 3.
let lastFast = 0;
const FAST_MS = 30e3;
const hot = new Map(); // mint -> when it last appeared on a 5-minute list
async function fastDiscover() {
  lastFast = Date.now();
  const res = await settle([
    getJSON(`${JUP}/toptrending/5m?limit=100`, { timeout: 4000 }),
    getJSON(`${JUP}/toptraded/5m?limit=100`, { timeout: 4000 }),
    getJSON(`${JUP}/toporganicscore/5m?limit=100`, { timeout: 4000 }),
  ]);
  const now = Date.now();
  res.forEach((r) => jupMints(r).forEach((m) => { seen.set(m, now); hot.set(m, now); }));
  for (const [m, t] of hot) if (now - t > 20 * 60e3) hot.delete(m);
}

export default async function handler(req, res) {
  try {
    let disc = null;
    if (Date.now() - lastDiscover > DISCOVER_MS || seen.size === 0) disc = await discover();
    if (Date.now() - lastFast > FAST_MS) await fastDiscover().catch(() => {});
    const now = Date.now();
    for (const [m, t] of seen) if (now - t > KEEP_MS) seen.delete(m);
    const mints = [...seen.entries()].sort((a, b) => (hot.has(b[0]) - hot.has(a[0])) || b[1] - a[1]).slice(0, MAX_TOKENS).map((x) => x[0]);

    const chunks = [];
    for (let i = 0; i < mints.length; i += 30) chunks.push(mints.slice(i, i + 30));
    const results = await settle(chunks.map((c) => getJSON(`${DS}/tokens/v1/solana/${c.join(',')}`)));

    // Slim rows for the list (the coin page fetches full detail); keep every meme with any trading.
    const tokens = (await withJupiter(rowsFrom(results))).filter((r) => r.v.h24 >= 50 && !looksFake(r)).map((r) => {
      const { web, soc, url, fdv, boost, ...rest } = r;
      const so = {};
      for (const k of ['b', 'p', 'c', 'tg']) { const t = promo[k].get(r.a); if (t != null && now - t < 6 * 3600e3) so[k] = Math.max(0, Math.round((now - t) / 60e3)); }
      if (Object.keys(so).length) rest.so = so;
      if (hot.has(r.a)) rest.hot5 = Math.max(0, Math.round((now - hot.get(r.a)) / 60e3));
      return rest;
    });
    send(res, 200, { t: Date.now(), n: tokens.length, disc, tokens }, 's-maxage=10, stale-while-revalidate=5');
  } catch (e) {
    send(res, 500, { error: String(e.message || e) }, 'no-store');
  }
}
