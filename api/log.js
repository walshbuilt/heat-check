// Receives freeze and error reports from visitors' browsers (see watch.js) and writes them to the
// server log, where they can be read in Vercel. Small and capped; nothing is stored.
export default async function handler(req, res) {
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
