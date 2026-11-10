import { send } from './_lib.js';

// Looks at a coin's website for evidence behind any utility claim:
// is it live, does it link docs / an app / GitHub, does it show the contract, is it a template page.
const clean = (v) => String(v || '').replace(/[^1-9A-HJ-NP-Za-km-z]/g, '');
const PRIVATE = /^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|\d+\.\d+\.\d+\.\d+)$/i;
const cache = new Map();

function safe(u) {
  try {
    const x = new URL(u);
    if (!/^https?:$/.test(x.protocol) || PRIVATE.test(x.hostname) || x.port) return null;
    return x;
  } catch { return null; }
}
async function grab(url, max = 500000) {
  // Follow redirects by hand so every hop is checked against the private-address block.
  let r, final = safe(url);
  for (let hop = 0; hop < 4; hop++) {
    if (!final) throw new Error('blocked');
    r = await fetch(final.href, { redirect: 'manual', signal: AbortSignal.timeout(6000), headers: { 'user-agent': 'Mozilla/5.0 (compatible; Momentum/1.0)', accept: 'text/html' } });
    if (r.status < 300 || r.status >= 400 || !r.headers.get('location')) break;
    final = safe(new URL(r.headers.get('location'), final).href);
  }
  if (!final) throw new Error('blocked');
  const reader = r.body.getReader();
  let out = '', len = 0;
  while (len < max) { const { done, value } = await reader.read(); if (done) break; len += value.length; out += new TextDecoder().decode(value); }
  reader.cancel().catch(() => {});
  return { status: r.status, url: final, html: out };
}
const pick = (html, re) => (html.match(re) || [])[1]?.replace(/\s+/g, ' ').trim().slice(0, 300) || null;

async function github(link) {
  const m = link.match(/github\.com\/([A-Za-z0-9-]+)(?:\/([A-Za-z0-9._-]+))?/i);
  if (!m) return null;
  const api = m[2] ? `https://api.github.com/repos/${m[1]}/${m[2].replace(/\.git$/, '')}` : `https://api.github.com/users/${m[1]}`;
  const r = await fetch(api, { signal: AbortSignal.timeout(5000), headers: { 'user-agent': 'Momentum/1.0', accept: 'application/vnd.github+json' } });
  if (!r.ok) return { url: link, ok: false };
  const j = await r.json();
  return m[2]
    ? { url: link, ok: true, repo: true, stars: j.stargazers_count, pushed: j.pushed_at, created: j.created_at, fork: j.fork, desc: j.description }
    : { url: link, ok: true, repo: false, repos: j.public_repos, created: j.created_at };
}

export default async function handler(req, res) {
  const u = safe(String(req.query.u || ''));
  const mint = clean(req.query.a);
  if (!u) return send(res, 400, { error: 'bad url' }, 'no-store');
  const key = u.href + '|' + mint;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 30 * 60e3) return send(res, 200, hit.v, 's-maxage=1800, stale-while-revalidate=600');
  let v;
  try {
    const { status, url, html } = await grab(u.href);
    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const links = [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["']/gi)].map((m) => { try { return new URL(m[1], url).href; } catch { return null; } }).filter(Boolean);
    const has = (re) => links.find((l) => re.test(l)) || null;
    const RESERVED = /^(login|logout|join|signup|features|about|pricing|sponsors|topics|collections|marketplace|enterprise|security|site|contact|readme|team|customer-stories|solutions|resources|trending|explore|settings|orgs|apps|github|opensearch\.xml)$/i;
    const gh = links.find((l) => { const m = l.match(/^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9-]+)(?:[/?#]|$)/i); return m && !RESERVED.test(m[1]); }) || null;
    v = {
      ok: status < 400,
      status,
      url: url.href,
      host: url.hostname,
      title: pick(html, /<title[^>]*>([^<]*)<\/title>/i),
      desc: pick(html, /<meta[^>]+(?:name|property)=["'](?:og:)?description["'][^>]+content=["']([^"']*)["']/i),
      words: text.split(' ').length,
      docs: has(/(docs\.|\/docs|gitbook|whitepaper|litepaper|notion\.site|medium\.com)/i),
      app: has(/(\/\/app\.|\/\/dapp\.|\/app\b|launch-?app|t\.me\/[A-Za-z0-9_]*bot\b|chrome\.google\.com\/webstore|apps\.apple\.com|play\.google\.com)/i),
      github: gh,
      audit: has(/(certik|hacken|solidproof|audit)/i),
      contract: mint.length >= 32 ? html.includes(mint) : null,
      template: /carrd\.co|linktr\.ee|built with carrd|pump\.fun\/coin|wix\.com|framer\.(com|website)|webflow/i.test(html + url.href),
      soon: /coming soon|launching soon|under construction|stay tuned/i.test(text),
    };
    // Web apps render in the browser, so the raw page has little text; that's not the same as an empty site.
    v.spa = v.words < 200 && /<script[^>]+src=|__NEXT_DATA__|id=["'](root|app|__next)["']/i.test(html);
    v.heads = [...html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)].map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).filter((x) => x.length > 3).slice(0, 4);
    v.text = text.trim().slice(0, 500);
    // Docs on the same site usually explain what the project actually does.
    if (v.docs) {
      const d = safe(v.docs);
      if (d && d.hostname.replace(/^www\./, '').split('.').slice(-2).join('.') === url.hostname.replace(/^www\./, '').split('.').slice(-2).join('.')) {
        try {
          const dp = await grab(d.href, 300000);
          const dt = dp.html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<nav[\s\S]*?<\/nav>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
          v.docsText = dt.slice(0, 1200);
          v.docsTitle = pick(dp.html, /<title[^>]*>([^<]*)<\/title>/i);
        } catch {}
      }
    }
    if (gh) v.gh = await github(gh).catch(() => null);
  } catch (e) {
    v = { ok: false, error: e.name === 'TimeoutError' ? 'timeout' : 'unreachable', url: u.href, host: u.hostname };
  }
  cache.set(key, { at: Date.now(), v });
  if (cache.size > 500) cache.clear();
  send(res, 200, v, 's-maxage=1800, stale-while-revalidate=600');
}
