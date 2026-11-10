import { DS, getJSON, settle, send, rowsFrom, withJupiter } from './_lib.js';

// Fast refresh for the tokens currently on screen (up to 90 per call).
export default async function handler(req, res) {
  const list = [...new Set(String(req.query.a || '').split(','))]
    .map((s) => s.replace(/[^1-9A-HJ-NP-Za-km-z]/g, ''))
    .filter((s) => s.length >= 32)
    .slice(0, 90);
  if (!list.length) return send(res, 400, { error: 'missing a' }, 'no-store');
  try {
    const chunks = [];
    for (let i = 0; i < list.length; i += 30) chunks.push(list.slice(i, i + 30));
    const results = await settle(chunks.map((c) => getJSON(`${DS}/tokens/v1/solana/${c.join(',')}`, { timeout: 5000 })));
    const tokens = await withJupiter(rowsFrom(results, new Set(list)));
    send(res, 200, { t: Date.now(), tokens }, 's-maxage=2, stale-while-revalidate=2');
  } catch (e) {
    send(res, 502, { error: String(e.message || e) }, 'no-store');
  }
}
