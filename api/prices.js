import { DS, getJSON, settle, send, rowsFrom, withJupiter, summarize, grade } from './_lib.js';

// Vercel's Hobby plan allows 12 functions, so this one also serves the single-coin refresh
// (?one=1, formerly /api/token) and browser freeze reports (POST, formerly /api/log).

// Fast refresh for the tokens currently on screen (up to 90 per call).
export default async function handler(req, res) {
  if (req.method === 'POST') return logReport(req, res);
  if (req.query.one) return oneToken(req, res);
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

async function oneToken(req, res) {
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

async function logReport(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }
  try {
    let body = req.body;
    if (typeof body !== 'string') body = body ? JSON.stringify(body) : '';
    if (!body) body = await new Promise((ok) => { let s = ''; req.on('data', (c) => { s += c; if (s.length > 20000) req.destroy(); }); req.on('end', () => ok(s)); });
    const d = JSON.parse(String(body).slice(0, 20000));
    console.error('CLIENT_REPORT ' + JSON.stringify({ kind: String(d.kind).slice(0, 20), extra: String(d.extra || '').slice(0, 400), url: String(d.url || '').slice(0, 120), ua: String(d.ua || '').slice(0, 200), w: d.w, trail: (Array.isArray(d.trail) ? d.trail : []).slice(-25).map((x) => String(x).slice(0, 200)) }));
  } catch (e) { console.error('CLIENT_REPORT unreadable'); }
  res.status(204).end();
}
