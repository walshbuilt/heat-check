import { DS, getJSON, send, summarize, grade, withJupiter } from './_lib.js';

export default async function handler(req, res) {
  const a = String(req.query.a || '').replace(/[^1-9A-HJ-NP-Za-km-z]/g, '');
  if (!a) return send(res, 400, { error: 'missing a' }, 'no-store');
  try {
    const pairs = await getJSON(`${DS}/tokens/v1/solana/${a}`, { timeout: 5000 });
    const own = (Array.isArray(pairs) ? pairs : []).filter((p) => p.baseToken?.address === a);
    const row = summarize(own);
    if (!row) return send(res, 404, { error: 'not found' }, 's-maxage=5');
    row.g = grade(row.f);
    await withJupiter([row]);
    send(res, 200, { t: Date.now(), token: row }, 's-maxage=2, stale-while-revalidate=5');
  } catch (e) {
    send(res, 502, { error: String(e.message || e) }, 'no-store');
  }
}
