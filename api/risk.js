import { getJSON, send } from './_lib.js';

// Safety report from RugCheck. Uses the full report so we can see insider wallets (RugCheck links
// wallets funded from the same source) and real top-holder concentration (pools/lockers excluded).
// Insider and concentration findings are added as risks so the page grades them like any other flag.
const RC = 'https://api.rugcheck.xyz/v1/tokens/';
const n = (x) => (typeof x === 'number' && isFinite(x) ? x : Number(x) || 0);

export default async function handler(req, res) {
  const a = String(req.query.a || '').replace(/[^1-9A-HJ-NP-Za-km-z]/g, '');
  if (!a) return send(res, 400, { error: 'missing a' }, 'no-store');
  let j = null, full = true;
  try { j = await getJSON(`${RC}${a}/report`, { timeout: 8000 }); }
  catch { full = false; }
  if (!j) {
    try { j = await getJSON(`${RC}${a}/report/summary`, { timeout: 6000 }); }
    catch (e) { return send(res, 502, { a, error: String(e.message || e) }, 's-maxage=60'); }
  }
  const risks = (j.risks || []).map((r) => ({ n: r.name, d: r.description, v: r.value || '', l: r.level, s: r.score }));
  const out = { a, score: j.score ?? null, norm: j.score_normalised ?? null, lp: j.lpLockedPct ?? null, risks };

  if (full) {
    // Accounts that are pools, vaults or lockers aren't real holders.
    const skip = new Set();
    for (const m of j.markets || []) {
      [m.pubkey, m.liquidityA, m.liquidityB, m.liquidityAAccount, m.liquidityBAccount, m.mintLP].forEach((x) => x && skip.add(x));
      const lp = m.lp || {};
      [lp.lpMint, lp.baseVault, lp.quoteVault].forEach((x) => x && skip.add(x));
    }
    for (const [addr, info] of Object.entries(j.knownAccounts || {})) if (info && /amm|pool|locker|vault|curve|exchange|cex/i.test(String(info.type || info.name || ''))) skip.add(addr);
    for (const [addr] of Object.entries(j.lockers || {})) skip.add(addr);
    const holders = (j.topHolders || []).filter((h) => !skip.has(h.address) && !skip.has(h.owner));
    const ins = holders.filter((h) => h.insider).reduce((s, h) => s + n(h.pct), 0);
    const top10 = holders.slice(0, 10).reduce((s, h) => s + n(h.pct), 0);
    const insN = holders.filter((h) => h.insider).length;
    out.graph = n(j.graphInsidersDetected);
    const supply = n(j.token?.supply);
    const creatorPct = supply > 0 ? (n(j.creatorBalance) / supply) * 100 : 0;
    out.ins = Math.round(ins * 10) / 10;
    out.insN = insN;
    out.top10 = Math.round(top10 * 10) / 10;
    out.cre = Math.round(creatorPct * 10) / 10;
    const add = (l, name, d) => risks.unshift({ n: name, d, v: '', l, s: 0, hc: true });
    if (ins >= 20) add('danger', `Insiders hold ${Math.round(ins)}%`, `${insN} linked wallets in the top holders. They can dump together.`);
    else if (ins >= 8) add('warn', `Insiders hold ${Math.round(ins)}%`, `${insN} linked wallets in the top holders.`);
    else if (insN >= 5) add('warn', `${insN} insider wallets in the top holders`, 'Wallets funded from the same source are among the biggest holders.');
    if (creatorPct >= 8) add('danger', `Creator holds ${creatorPct.toFixed(1)}%`, 'The wallet that created the coin still holds a large share.');
    else if (creatorPct >= 3) add('warn', `Creator holds ${creatorPct.toFixed(1)}%`, 'The wallet that created the coin still holds some supply.');
    if (j.rugged) add('danger', 'Marked as rugged', 'RugCheck has flagged this coin as rugged.');
  }
  send(res, 200, out, 's-maxage=300, stale-while-revalidate=900');
}
