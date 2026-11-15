import { DS, getJSON, settle, send } from './_lib.js';

const clean = (v) => String(v || '').replace(/[^1-9A-HJ-NP-Za-km-z]/g, '');
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const pickStats = (s) => (s ? {
  holderChange: num(s.holderChange), traders: num(s.numTraders), buys: num(s.numBuys), sells: num(s.numSells),
  netBuyers: num(s.numNetBuyers), organicBuyers: num(s.numOrganicBuyers), buyVol: num(s.buyVolume), sellVol: num(s.sellVolume),
} : null);

// Coin profile: description, origin, creator, holders, traction and on-chain risks.
export default async function handler(req, res) {
  const a = clean(req.query.a);
  if (!a) return send(res, 400, { error: 'missing a' }, 'no-store');
  const [rc, jupArr, pump, gti, dsArr] = await settle([
    getJSON(`https://api.rugcheck.xyz/v1/tokens/${a}/report`, { timeout: 7000 }),
    getJSON(`https://lite-api.jup.ag/tokens/v2/search?query=${a}`, { timeout: 5000 }),
    getJSON(`https://frontend-api-v3.pump.fun/coins/${a}`, { timeout: 4000, headers: { origin: 'https://pump.fun', referer: 'https://pump.fun/' } }),
    getJSON(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/${a}/info`, { timeout: 5000, headers: { accept: 'application/json;version=20230302' } }),
    getJSON(`${DS}/tokens/v1/solana/${a}`, { timeout: 5000 }),
  ]);
  // DexScreener is where most coins list their website and socials, so check every pair's profile.
  const dsInfo = (Array.isArray(dsArr) ? dsArr : []).map((p) => p?.info).filter(Boolean);
  const dsWeb = dsInfo.flatMap((i) => i.websites || []).map((w) => w?.url).find((u) => /^https?:\/\//.test(u || '')) || null;
  const dsSoc = (type) => dsInfo.flatMap((i) => i.socials || []).find((s) => s?.type === type && /^https?:\/\//.test(s?.url || ''))?.url || null;
  const gt = gti?.data?.attributes || null;
  const jup = Array.isArray(jupArr) ? jupArr.find((x) => x && x.id === a) || null : null;
  const pf = pump && pump.mint === a ? pump : null;
  const holders = Array.isArray(rc?.topHolders) ? rc.topHolders : [];
  const rcTop10 = holders.slice(0, 10).reduce((s, h) => s + (num(h.pct) || 0), 0);
  const lpLocked = Array.isArray(rc?.markets) && rc.markets.length
    ? Math.max(...rc.markets.map((m) => num(m?.lp?.lpLockedPct) || 0)) : num(rc?.lpLockedPct);
  // Members of the coin's own Telegram, read from its public t.me page (free, no API key).
  let tgMembers = null;
  const tgLink = pf?.telegram || dsSoc('telegram');
  const tgName = (String(tgLink || '').match(/t(?:elegram)?\.me\/([A-Za-z0-9_]{4,40})\/?$/) || [])[1];
  if (tgName) {
    try {
      const r = await fetch(`https://t.me/${tgName}`, { signal: AbortSignal.timeout(4000), headers: { 'user-agent': 'HeatCheck/1.0' } });
      const m = r.ok ? (await r.text()).match(/tgme_page_extra">\s*([\d\s,]+)\s+(?:members|subscribers)/i) : null;
      if (m) tgMembers = Number(m[1].replace(/[\s,]/g, '')) || null;
    } catch {}
  }
  const out = {
    tgMembers,
    a,
    desc: String(pf?.description || rc?.fileMeta?.description || gt?.description || '').trim().slice(0, 900),
    categories: Array.isArray(gt?.categories) ? gt.categories.slice(0, 5) : [],
    creator: pf?.creator || rc?.creator || jup?.dev || null,
    created: num(pf?.created_timestamp) || (jup?.firstPool?.createdAt ? Date.parse(jup.firstPool.createdAt) : null),
    launchpad: jup?.launchpad || rc?.launchpad?.name || (pf ? 'pump.fun' : null),
    twitter: pf?.twitter || jup?.twitter || dsSoc('twitter') || (gt?.twitter_handle ? 'https://x.com/' + gt.twitter_handle : null),
    website: pf?.website || jup?.website || dsWeb || (Array.isArray(gt?.websites) ? gt.websites[0] : null) || null,
    telegram: pf?.telegram || dsSoc('telegram') || null,
    holders: num(jup?.holderCount) ?? num(rc?.totalHolders),
    top10: num(jup?.audit?.topHoldersPercentage) ?? (holders.length ? rcTop10 : null),
    devPct: num(jup?.audit?.devBalancePercentage),
    devMints: num(jup?.audit?.devMints),
    mintAuth: rc ? !!rc.mintAuthority : jup?.audit ? !jup.audit.mintAuthorityDisabled : null,
    freezeAuth: rc ? !!rc.freezeAuthority : jup?.audit ? !jup.audit.freezeAuthorityDisabled : null,
    lpLocked,
    insiders: rc?.graphInsidersDetected ?? null,
    rugged: rc?.rugged ?? null,
    score: rc?.score ?? null,
    risks: (rc?.risks || []).map((r) => ({ n: r.name, d: r.description, v: r.value || '', l: r.level })),
    organic: num(jup?.organicScore), organicLabel: jup?.organicScoreLabel || null,
    verified: jup?.isVerified ?? null,
    tags: Array.isArray(jup?.tags) ? jup.tags.slice(0, 6) : [],
    ct: jup ? { likes: num(jup.ctLikes), smart: num(jup.smartCtLikes) } : null,
    s1h: pickStats(jup?.stats1h), s24: pickStats(jup?.stats24h),
    graduated: pf ? !!pf.complete : null,
    kingAt: num(pf?.king_of_the_hill_timestamp),
    src: { rugcheck: !!rc, jupiter: !!jup, pump: !!pf, gecko: !!gt, dex: dsInfo.length > 0 },
  };
  send(res, 200, out, 's-maxage=120, stale-while-revalidate=300');
}
