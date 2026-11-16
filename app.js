/* Momentum — live Solana meme coin momentum by market-cap tier */
(() => {
'use strict';

// ---------- Config ----------
const TIERS = [
  { id: 't1b', min: 1e9, max: Infinity, label: '$1B+' },
  { id: 't100m', min: 100e6, max: 1e9, label: '$100M+' },
  { id: 't50m', min: 50e6, max: 100e6, label: '$50M+' },
  { id: 't25m', min: 25e6, max: 50e6, label: '$25M+' },
  { id: 't10m', min: 10e6, max: 25e6, label: '$10M+' },
  { id: 't7.5m', min: 7.5e6, max: 10e6, label: '$7.5M+' },
  { id: 't5m', min: 5e6, max: 7.5e6, label: '$5M+' },
  { id: 't2.5m', min: 2.5e6, max: 5e6, label: '$2.5M+' },
  { id: 't1m', min: 1e6, max: 2.5e6, label: '$1M+' },
  { id: 't750k', min: 750e3, max: 1e6, label: '$750K+' },
  { id: 't500k', min: 500e3, max: 750e3, label: '$500K+' },
  { id: 't250k', min: 250e3, max: 500e3, label: '$250K+' },
  { id: 't100k', min: 100e3, max: 250e3, label: '$100K+' },
  { id: 't50k', min: 50e3, max: 100e3, label: '$50K+' },
  { id: 't25k', min: 25e3, max: 50e3, label: '$25K+' },
  { id: 't10k', min: 10e3, max: 25e3, label: '$10K+' },
  { id: 't5k', min: 5e3, max: 10e3, label: '$5K+' },
  { id: 't0', min: 0, max: 5e3, label: 'Under $5K' },
];
const TMAP = Object.fromEntries(TIERS.map((t) => [t.id, t]));
const WIN_LABEL = { m5: '5m', h1: '1h', h6: '6h', h24: '24h' };
const RANK_MS = 12000, IG_MS = 15000;
const SCAN_MS = 12000, PRICE_MS = 3000, TOKEN_MS = 2000, CANDLE_MS = 15000;
const CARD_ROWS = 5, SHEET_ROWS = 500;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const CLOCK = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';

// ---------- State ----------
const store = {
  get() { try { return JSON.parse(localStorage.getItem('momentum:v2')) || {}; } catch { return {}; } },
  set(v) { try { localStorage.setItem('momentum:v2', JSON.stringify(v)); } catch {} },
};
const saved = store.get();
const S = {
  win: 'h24',
  sort: ['heat', 'g24', 'g1', 'mc'].includes(saved.sort) ? saved.sort : 'heat',
  safety: saved.safety || 'all',
  order: Array.isArray(saved.order) ? saved.order.filter((id) => TMAP[id]) : TIERS.map((t) => t.id),
  hidden: new Set(saved.hidden || []),
  tf: saved.tf || '5m',
  unit: saved.unit || 'mc',
  q: '',
  tokens: new Map(),
  risk: new Map(),
  info: new Map(),
  ath: new Map(),
  h4: new Map(),
  site: new Map(),
  prevRank: new Map(),
  topOf: new Map(),
  openTier: null,
  lastScan: 0,
  first: true,
};
TIERS.forEach((t) => { if (!S.order.includes(t.id)) S.order.splice(TIERS.indexOf(t), 0, t.id); });
const persist = () => store.set({ sort: S.sort, safety: S.safety, order: S.order, hidden: [...S.hidden], tf: S.tf, unit: S.unit });

// ---------- Format ----------
const SUB = '₀₁₂₃₄₅₆₇₈₉';
const sub = (n) => String(n).split('').map((d) => SUB[d]).join('');
function fmtPrice(p) {
  if (p == null || !isFinite(p)) return '—';
  if (p >= 1000) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 1) return '$' + p.toFixed(p >= 100 ? 2 : 3);
  if (p >= 0.0001) return '$' + p.toPrecision(4).replace(/0+$/, '').replace(/\.$/, '');
  const [m, e] = p.toExponential(3).split('e-');
  return '$0.0' + sub(Number(e) - 1) + m.replace('.', '').replace(/0+$/, '');
}
function fmtUsd(x) {
  if (x == null || !isFinite(x)) return '—';
  const a = Math.abs(x);
  if (a >= 1e9) return '$' + (x / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return '$' + (x / 1e6).toFixed(a >= 1e8 ? 0 : 2) + 'M';
  if (a >= 1e3) return '$' + (x / 1e3).toFixed(a >= 1e5 ? 0 : 1) + 'K';
  return '$' + Math.round(x);
}
const fmtPct = (x) => (x == null || !isFinite(x) ? '—' : (x > 0 ? '+' : '') + (Math.abs(x) >= 100 ? Math.round(x).toLocaleString() : x.toFixed(1)) + '%');
const fmtMove = (x) => (x == null || !isFinite(x) ? '—' : (x > 0 ? '▲ ' : x < 0 ? '▼ ' : '') + (Math.abs(x) >= 100 ? Math.round(Math.abs(x)).toLocaleString() : Math.abs(x).toFixed(1)) + '%');
function fmtRatio(r) {
  if (!isFinite(r)) return '—';
  const p = r * 100;
  if (p >= 1000) return r.toFixed(r >= 100 ? 0 : 1) + '×';
  if (p >= 100) return Math.round(p) + '%';
  if (p >= 10) return p.toFixed(1) + '%';
  return p.toFixed(2) + '%';
}
function fmtAge(ms) {
  if (!ms) return '—';
  const s = (Date.now() - ms) / 1000;
  if (s < 3600) return Math.max(1, Math.floor(s / 60)) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  if (s < 86400 * 60) return Math.floor(s / 86400) + 'd';
  if (s < 86400 * 730) return Math.floor(s / 86400 / 30.4) + 'mo';
  return Math.floor(s / 86400 / 365) + 'y';
}
function fmtAgeLong(ms) {
  if (!ms) return '—';
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 60) return `${Math.max(1, m)} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  if (d < 60) return `${d}d ${h % 24}h`;
  const mo = Math.floor(d / 30.4);
  if (mo < 24) return `${mo} mo ${Math.floor(d - mo * 30.4)}d`;
  return `${Math.floor(d / 365)}y ${Math.floor((d % 365) / 30.4)}mo`;
}
const ageCls = (ms) => { if (!ms) return 'a-old'; const h = (Date.now() - ms) / 3600e3; return h < 1 ? 'a-new' : h < 24 ? 'a-hrs' : h < 24 * 30 ? 'a-days' : 'a-old'; };
const fmtWhen = (ms, dayOnly) => new Date(ms).toLocaleString('en-US', dayOnly ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const ago = (ms) => { const a = fmtAge(ms); return a === '—' ? '' : a + ' ago'; };
const cls = (x) => (x > 0 ? 'up' : x < 0 ? 'down' : '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : null);
const short = (a) => (a ? a.slice(0, 4) + '…' + a.slice(-4) : '—');
const $ = (s, el = document) => el.querySelector(s);
const setHTML = (el, h) => { if (el._h !== h) { el.innerHTML = h; el._h = h; } };

function tween(el, to, fmt) {
  const from = el._v; el._v = to;
  if (from == null || !isFinite(from) || !isFinite(to) || from === to || REDUCED || document.hidden) { el.textContent = fmt(to); return; }
  cancelAnimationFrame(el._raf);
  const t0 = performance.now(), d = 650;
  const step = (now) => {
    const k = Math.min(1, (now - t0) / d), e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (k < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}
function flash(el, prev, now) {
  if (prev == null || prev === now) return;
  el.classList.remove('flash-up', 'flash-down'); void el.offsetWidth;
  el.classList.add(now > prev ? 'flash-up' : 'flash-down');
}
const avatar = (t) => {
  const img = safeUrl(t.img);
  const ph = () => Object.assign(document.createElement('span'), { className: 'ph', textContent: (t.s || '?').slice(0, 2) });
  if (!img) return ph();
  const im = Object.assign(document.createElement('img'), { src: img, alt: '', loading: 'lazy' });
  im.addEventListener('error', () => im.replaceWith(ph()), { once: true });
  return im;
};

// ---------- Heat score ----------
// The early-ignition score lives in heat.js (window.MomentumHeat); coin explanations in about.js.
const MH = window.MomentumHeat, MA = window.MomentumAbout;
function heatOf(t) {
  const key = t.p + '|' + t.v.m5 + '|' + t.c.h1 + '|' + (t.tx?.m5?.b ?? '') + '|' + (t.tx?.m5?.s ?? '') + '|' + MH.version() + '|' + (S.risk.get(t.a)?.risks?.length ?? '');
  if (t._hk === key) return t._heat;
  t._heat = MH.score(t, gradeOf(t));
  t._hk = key;
  return t._heat;
}
MH.onUpdate = () => { render(); if (openMint) paintDrawer(); };
// Keep scanner-only fields (social signals) when a faster price refresh replaces a row.
function keep(t) { const prev = S.tokens.get(t.a); if (prev && prev.so && !t.so) t.so = prev.so; if (prev && prev.tr && !t.tr) t.tr = prev.tr; if (prev && prev.ct && !t.ct) t.ct = prev.ct; if (prev && prev.c15 != null && t.c15 == null) t.c15 = prev.c15; if (prev && prev.devM != null && t.devM == null) t.devM = prev.devM; return t; }

// ---------- Derived ----------
const ratio = (t) => (t.mc ? (t.v[S.win] || 0) / t.mc : 0);
const sortKey = (t) => (S.sort === 'g24' ? (t.c.h24 ?? -1e9) : S.sort === 'g1' ? (t.c.h1 ?? -1e9) : S.sort === 'mc' ? t.mc : heatOf(t));
const tierOf = (mc) => TIERS.find((t) => mc >= t.min && mc < t.max)?.id || 't0';
const SHORT = { liq: 'Thin liquidity', liqmc: 'Low liquidity for its size', wash: 'Possible wash trading', fewtx: 'Volume from few trades', whale: 'Whale/bot-sized trades', dump1: 'Dumping this hour', dump24: 'Down hard in 24h', sells: 'Heavy selling', new: 'Under 30 min old', nosoc: 'No socials' };
function allFlags(t) {
  const r = S.risk.get(t.a), extra = [];
  if (r && r.risks) r.risks.forEach((x) => {
    if (x.l === 'danger') extra.push({ l: 3, k: 'rc', t: x.n });
    else if (x.l === 'warn') extra.push({ l: /mutable metadata/i.test(x.n) ? 1 : 2, k: 'rc', t: x.n });
  });
  return [...t.f, ...extra];
}
function gradeOf(t) {
  const f = allFlags(t);
  const d = f.filter((x) => x.l === 3).length, w = f.filter((x) => x.l === 2).length;
  return d || w >= 3 ? 'red' : w ? 'amber' : 'green';
}
const topWhy = (t) => { const f = allFlags(t).filter((x) => x.l > 1).sort((a, b) => b.l - a.l)[0]; return f ? SHORT[f.k] || f.t : ''; };
const GRADE_TXT = { green: 'Clean', amber: 'Caution', red: 'Red flag' };
// Organic mode: real traders only, and already Clean (no caution flags). No bot signals, Jupiter
// organic score healthy, dev holds under 3%, mint and freeze revoked, and RugCheck has confirmed no
// insider ring and LP locked/burned. A coin is not Organic until its RugCheck report is in.
const BOT_FLAGS = new Set(['wash', 'fewtx', 'whale', 'inorganic', 'boost']);
function organicPre(t) {
  if (gradeOf(t) !== 'green') return false;
  if (t.f.some((x) => BOT_FLAGS.has(x.k))) return false;
  if (t.ol === 'low') return false;
  if (t.os != null && t.os < 50) return false;
  if (t.dev != null && t.dev >= 3) return false;
  if (t.aud && (!t.mintOff || !t.frzOff)) return false;
  const p = MH.parts(t, 'green');
  return !(p.bot || p.botChurn || p.organic < 0.35);
}
function isOrganic(t) {
  if (!organicPre(t)) return false;
  const r = S.risk.get(t.a);
  if (!r || r.pending || r.failed) return false;
  if (r.ins != null && r.ins >= 5) return false;
  if (r.insN != null && r.insN >= 3) return false;
  if (r.lp != null && r.lp < 50) return false;
  if (r.cre != null && r.cre >= 3) return false;
  return true;
}

// ---------- Data ----------
async function api(path) {
  const r = await fetch(path, { cache: 'no-store' });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}
// This page's own price samples (one every 30s, 17 minutes kept), used for the 15-minute change when
// the scanner doesn't have one yet.
const PXH = new Map();
function pxNote(t) {
  if (!(t.p > 0)) return;
  const now = Date.now();
  let a = PXH.get(t.a);
  if (!a) { a = []; PXH.set(t.a, a); }
  if (!a.length || now - a[a.length - 1][0] >= 30e3) a.push([now, t.p]);
  while (a.length && now - a[0][0] > 17 * 60e3) a.shift();
}
// Measured 15-minute change in %, or null if neither the scanner nor this page has 13+ minutes of prices.
function chg15(t) {
  if (t.c15 != null) return t.c15;
  const a = PXH.get(t.a), now = Date.now();
  const old = a && a.find((x) => now - x[0] >= 13 * 60e3);
  return old && old[1] > 0 ? (t.p / old[1] - 1) * 100 : null;
}
// Ranking key: the measured 15-minute change, or an estimate from the 5-minute and 1-hour changes
// until one exists (the row then shows 5m instead of 15m).
const mv15 = (t) => { const c = chg15(t); if (c != null) return c; const m5 = t.c.m5 || 0, h1 = t.c.h1 || 0; return m5 + Math.max(-m5, Math.min(h1 - m5, 60)) * (10 / 55); };
let scanBusy = false;
async function scan() {
  if (scanBusy || document.hidden) return;
  scanBusy = true;
  try {
    const d = await api('/api/scan');
    const seen = new Set();
    for (const t of d.tokens) { t._new = !S.tokens.has(t.a) && !S.first; S.tokens.set(t.a, t); seen.add(t.a); pxNote(t); }
    for (const k of [...S.tokens.keys()]) if (!seen.has(k) && k !== openMint) S.tokens.delete(k);
    S.lastScan = Date.now();
    setStatus('live');
    render(); renderTape(); paintCto();
    S.first = false;
    queueRisk();
  } catch { setStatus('err'); } finally { scanBusy = false; }
}
let priceBusy = false;
async function tickPrices() {
  if (priceBusy || document.hidden || !S.lastScan || (openMint && !S.openTier)) return;
  const addrs = [...new Set([...rowEls.keys()].map((k) => k.split('|')[1]))].filter((a) => a !== openMint).sort();
  if (!addrs.length) return;
  priceBusy = true;
  try {
    const chunks = [];
    for (let i = 0; i < addrs.length; i += 90) chunks.push(addrs.slice(i, i + 90));
    const res = await Promise.allSettled(chunks.map((c) => api('/api/prices?a=' + c.join(','))));
    let n = 0;
    res.forEach((r) => { if (r.status === 'fulfilled') r.value.tokens.forEach((t) => { S.tokens.set(t.a, keep(t)); n++; }); });
    if (n) { S.lastScan = Date.now(); render(); }
  } finally { priceBusy = false; }
}
function setStatus(st) {
  const el = $('#status');
  el.classList.toggle('live', st === 'live');
  el.classList.toggle('err', st === 'err');
  if (st === 'err') $('#statusText').textContent = 'Reconnecting…';
}
setInterval(() => {
  if (!S.lastScan || $('#status').classList.contains('err')) return;
  const s = Math.round((Date.now() - S.lastScan) / 1000);
  $('#statusText').innerHTML = `Live<span class="cnt"> · ${S.tokens.size} coins</span> · ${s < 2 ? 'now' : s + 's'}`;
}, 1000);

const riskQ = [];
let riskActive = 0;
function queueRisk() {
  const vis = [];
  for (const id of S.order) if (!S.hidden.has(id)) vis.push(...(groups.get(id) || []).slice(0, CARD_ROWS));
  if (S.openTier) vis.push(...(groups.get(S.openTier) || []).slice(0, 30));
  // Organic mode needs the insider/LP check for every candidate, not just the rows on screen.
  if (S.safety === 'organic') for (const t of S.tokens.values()) if (organicPre(t)) vis.push(t);
  vis.forEach((t) => { if (!S.risk.has(t.a) && !riskQ.includes(t.a)) riskQ.push(t.a); });
  pumpRisk();
}
function pumpRisk() {
  while (riskActive < 2 && riskQ.length) {
    const a = riskQ.shift();
    if (S.risk.has(a)) continue;
    riskActive++;
    S.risk.set(a, { pending: true });
    api('/api/risk?a=' + a)
      .then((r) => { S.risk.set(a, r.error ? { failed: true } : r); updateRiskUI(a); })
      .catch(() => S.risk.set(a, { failed: true }))
      .finally(() => { riskActive--; setTimeout(pumpRisk, 350); });
  }
}
function updateRiskUI(a) {
  const t = S.tokens.get(a);
  if (S.safety === 'organic' && t) { render(); renderTape(); return; }
  if (t) rowEls.forEach((el, k) => { if (k.endsWith('|' + a)) paintSafety(el, t); });
  if (openMint === a) paintDrawer();
}

// ---------- Home ----------
const main = $('#tiers');
const rowEls = new Map();
const tierEls = new Map();
let groups = new Map();
let dragging = false;

const colsHTML = () => `<div class="rkh">#</div><div class="h-coin">Coin · age · safety</div><div class="h-mc">Market cap</div><div class="h-w">Vol 24h</div><div class="h-w h-heat">Heat</div><div class="h-w">24h</div><div class="h-w">1h</div><div class="h-w">5m</div>`;

function buildTier(t) {
  const el = document.createElement('section');
  el.className = 'tier';
  el.dataset.id = t.id;
  el.innerHTML = `
    <div class="thead">
      <span class="handle" title="Drag to move"><svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/></svg></span>
      <span class="tlabel">${t.label}</span>
      <span class="trange">${t.max === Infinity ? 'market cap' : 'to ' + fmtUsd(t.max)}</span>
      <span class="tcount">0</span>
    </div>
    <div class="list"><div class="cols"></div><div class="tbody"></div></div>
    <button class="more"></button>`;
  el.querySelector('.more').addEventListener('click', () => openTier(t.id));
  bindDrag(el);
  return el;
}

function buildRow(t) {
  const el = document.createElement('div');
  el.className = 'row';
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.innerHTML = `
    <div class="rk"><span class="n"></span><span class="mv"></span></div>
    <div class="tok"><span class="avw"><i class="fdot"></i></span><div class="tt">
      <div class="l1"><span class="sym"></span><span class="price"></span></div>
      <div class="l2"><span class="age"></span><span class="sf"><i></i><span class="sft"></span><span class="why"></span></span></div>
    </div></div>
    <div class="c-mc"><b class="mcv"></b></div>
    <div class="c-vol"><em>Vol 24h</em><span class="vv"></span></div>
    <div class="c-heat"><em>Heat</em><b class="hv"></b><span class="hbar"><i></i></span><span class="stg"></span></div>
    <div class="chgs"><span class="cc c24"><em>24h</em><b></b></span><span class="cc c1"><em>1h</em><b></b></span><span class="cc c5"><em>5m</em><b></b></span></div>`;
  el.querySelector('.avw').prepend(avatar(t));
  el.addEventListener('click', () => openToken(t.a));
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openToken(t.a); } });
  return el;
}

function paintSafety(el, t) {
  const g = gradeOf(t);
  const sf = el.querySelector('.sf');
  const org = g === 'green' && isOrganic(t);
  sf.className = 'sf ' + g + (org ? ' organic' : '');
  sf.querySelector('.sft').innerHTML = org ? 'Clean<i class="od"></i><span class="org">Organic</span>' : GRADE_TXT[g];
  const why = g === 'green' ? '' : topWhy(t);
  sf.querySelector('.why').textContent = why ? '· ' + why : '';
  const f = allFlags(t).filter((x) => x.l > 1).map((x) => x.t);
  el.title = f.length ? `${GRADE_TXT[g]}: ${f.join(' · ')}` : org ? 'Clean & Organic: real traders, no bots, no insider ring, dev holds under 3%, mint/freeze revoked, LP locked or burned' : 'No automated red flags';
  el.classList.toggle('red', g === 'red');
  el.classList.remove('g-red', 'g-amber', 'g-green'); el.classList.add('g-' + g);
}

function paintRow(el, t, rank, tierId) {
  el.querySelector('.n').textContent = rank;
  const prev = S.prevRank.get(t.a), mv = el.querySelector('.mv');
  if (prev && prev.tier === tierId && prev.rank !== rank) {
    const d = prev.rank - rank;
    mv.textContent = d > 0 ? '▲' + d : '▼' + -d;
    mv.className = 'mv ' + (d > 0 ? 'u' : 'd');
    el._mvT = Date.now();
  } else if (!prev || prev.tier !== tierId || Date.now() - (el._mvT || 0) > 10000) { mv.textContent = ''; mv.className = 'mv'; }
  el.querySelector('.sym').textContent = t.s;
  const pr = el.querySelector('.price');
  pr.textContent = fmtPrice(t.p);
  flash(pr, el._p, t.p);
  const age = el.querySelector('.age');
  age.className = 'age ' + ageCls(t.age);
  const at = fmtAge(t.age);
  if (age._t !== at) { age.innerHTML = CLOCK + at; age._t = at; age.title = t.age ? 'Age · trading since ' + fmtWhen(t.age) : 'Age unknown'; }
  [['.c24', 'h24'], ['.c1', 'h1'], ['.c5', 'm5']].forEach(([s, k]) => {
    const b = el.querySelector(s + ' b');
    b.textContent = fmtMove(t.c[k]);
    b.className = cls(t.c[k]);
  });
  el.querySelector('.vv').textContent = fmtUsd(t.v.h24);
  const h = heatOf(t);
  tween(el.querySelector('.hv'), h, (x) => Math.round(x) + '%');
  el.querySelector('.hbar i').style.width = Math.max(2, Math.min(100, h)) + '%';
  el.querySelector('.c-heat').className = 'c-heat ' + (h >= 65 ? 'hot' : h < 35 ? 'cool' : '');
  const st = MH.stage(t), sg = el.querySelector('.stg');
  const stTxt = st.l ? st.l + (st.ago != null ? ' ' + st.ago + 'm' : '') : '';
  if (sg._t !== stTxt) { sg.textContent = stTxt; sg.className = 'stg ' + st.k; sg._t = stTxt; }
  const mc = el.querySelector('.mcv');
  tween(mc, t.mc, fmtUsd);
  flash(mc, el._mc, t.mc);
  if (el._r != null && h - el._r >= 8) { el.classList.remove('surge'); void el.offsetWidth; el.classList.add('surge'); }
  el._r = h; el._p = t.p; el._mc = t.mc;
  paintSafety(el, t);
}

function visibleTokens() {
  const q = S.q.trim().toLowerCase();
  const out = [];
  for (const t of S.tokens.values()) {
    if (q && !(t.s || '').toLowerCase().includes(q) && !(t.nm || '').toLowerCase().includes(q) && t.a.toLowerCase() !== q) continue;
    const g = gradeOf(t);
    if (S.safety === 'nored' && g === 'red') continue;
    if (S.safety === 'clean' && g !== 'green') continue;
    if (S.safety === 'organic' && !isOrganic(t)) continue;
    out.push(t);
  }
  return out;
}

function fillList(body, scope, list, limit, tierId, used) {
  const shown = list.slice(0, limit);
  body.querySelector('.tempty')?.remove();
  shown.forEach((t, i) => {
    const key = scope + '|' + t.a;
    let row = rowEls.get(key);
    if (!row) { row = buildRow(t); rowEls.set(key, row); if (t._new) row.classList.add('enter'); }
    paintRow(row, t, i + 1, tierId);
    used.add(key);
    if (body.children[i] !== row) body.insertBefore(row, body.children[i] || null);
  });
  while (body.children.length > shown.length) body.lastElementChild.remove();
  if (!shown.length) body.innerHTML = `<div class="tempty">${S.q ? 'No matches in this tier' : 'Nothing trading in this range right now'}</div>`;
}

function explain() {
  const heat = `<b>Heat</b> spots coins as they start to run: volume surging versus the coin's own normal, a fresh breakout, dip recoveries and buyers stepping in. Coins that already ran score low.`;
  const txt = {
    heat: heat,
    g24: `Ranked by <b>24h change</b>. ` + heat,
    g1: `Ranked by <b>1h change</b>. ` + heat,
    mc: `Ranked by <b>market cap</b>. ` + heat,
  }[S.sort];
  setHTML($('#explain'), txt);
}

function render() {
  if (S.tokens.size) $('#loading').hidden = true;
  // While a coin is open the lists behind it are covered, so they redraw at most every 15 seconds.
  // Keeps the coin page and chart smooth on slower computers.
  if (openMint && !S.openTier && S.drawnAt && Date.now() - S.drawnAt < 15000) return;
  S.drawnAt = Date.now();
  explain();
  groups = new Map(TIERS.map((t) => [t.id, []]));
  // Lists hold still for 12 to 15 seconds at a time so rows can be read and tapped. Between re-ranks a coin
  // keeps both its position and its tier (even if its market cap crosses a tier line), and new coins
  // join at the bottom. Prices and numbers still update live in place; only the order waits.
  const reRank = !S.rankAt || Date.now() - S.rankAt >= RANK_MS;
  const prevPos = (t) => S.prevRank.get(t.a)?.rank ?? 1e9;
  for (const t of visibleTokens()) groups.get((!reRank && S.prevRank.get(t.a)?.tier) || tierOf(t.mc)).push(t);
  for (const arr of groups.values()) arr.sort(reRank ? (a, b) => sortKey(b) - sortKey(a) : (a, b) => prevPos(a) - prevPos(b) || sortKey(b) - sortKey(a));
  if (reRank) S.rankAt = Date.now();

  const first = new Map();
  rowEls.forEach((el, k) => { if (el.isConnected) first.set(k, el.getBoundingClientRect().top); });

  const wanted = S.order.filter((id) => !S.hidden.has(id));
  wanted.forEach((id) => { if (!tierEls.has(id)) tierEls.set(id, buildTier(TMAP[id])); });
  tierEls.forEach((el, id) => { if (!wanted.includes(id)) el.remove(); });
  if (!dragging) wanted.forEach((id, i) => { const el = tierEls.get(id); if (main.children[i] !== el) main.insertBefore(el, main.children[i] || null); });
  else wanted.forEach((id) => { const el = tierEls.get(id); if (!el.isConnected) main.appendChild(el); });

  setHTML($('#jump'), `<button data-j="ignite" class="jig">Top 10<span>${window.__igN || 0}</span></button>` + wanted.map((id) => `<button data-j="${id}">${TMAP[id].label}<span>${groups.get(id).length}</span></button>`).join(''));
  const used = new Set();
  const cols = colsHTML();
  for (const id of wanted) {
    const el = tierEls.get(id), list = groups.get(id);
    el.querySelector('.tcount').textContent = `${list.length} coins`;
    setHTML(el.querySelector('.cols'), cols);
    fillList(el.querySelector('.tbody'), id, list, CARD_ROWS, id, used);
    const more = el.querySelector('.more');
    more.hidden = list.length <= CARD_ROWS;
    more.innerHTML = `View all ${list.length} <svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>`;
    const top = list[0]?.a || null;
    if (!S.first && top && S.topOf.get(id) && S.topOf.get(id) !== top) { el.classList.remove('newtop'); void el.offsetWidth; el.classList.add('newtop'); }
    S.topOf.set(id, top);
  }
  if (S.openTier) {
    const list = groups.get(S.openTier) || [];
    const by = { heat: 'heat score', g24: '24h change', g1: '1h change', mc: 'market cap' }[S.sort];
    $('#sSub').textContent = `${list.length} coins · ranked by ${by}`;
    setHTML($('#sCols'), cols);
    fillList($('#sBody'), 'sheet', list, SHEET_ROWS, S.openTier, used);
  }
  rowEls.forEach((el, k) => { if (!used.has(k)) { el.remove(); rowEls.delete(k); } });

  MH.want(visibleTokens(), openMint ? S.tokens.get(openMint) : null);

  const nextRank = new Map();
  groups.forEach((list, id) => list.forEach((t, i) => nextRank.set(t.a, { tier: id, rank: i + 1 })));
  S.prevRank = nextRank;

  if (REDUCED) return;
  rowEls.forEach((el, k) => {
    const f = first.get(k);
    if (f == null) return;
    const dy = f - el.getBoundingClientRect().top;
    if (Math.abs(dy) < 2 || Math.abs(dy) > 600) return;
    el.style.transition = 'none';
    el.style.transform = `translateY(${dy}px)`;
    requestAnimationFrame(() => { el.style.transition = 'transform .55s cubic-bezier(.2,.8,.2,1), background .15s'; el.style.transform = ''; });
  });
}

function renderTape() {
  const items = [];
  for (const id of S.order) {
    if (S.hidden.has(id)) continue;
    const list = groups.get(id) || [];
    const t = list.find((x) => gradeOf(x) !== 'red') || list[0];
    if (t) items.push([id, t]);
  }
  if (!items.length) return;
  const html = items.map(([id, t]) => {
    const img = safeUrl(t.img);
    const av = img ? `<img src="${esc(img)}" alt="" loading="lazy">` : `<span class="ph">${esc((t.s || '?').slice(0, 2))}</span>`;
    const c = t.c.h24;
    return `<button class="ti" data-a="${esc(t.a)}"><span class="lbl">${TMAP[id].label}</span>${av}<b>${esc(t.s)}</b><span class="m">${fmtUsd(t.mc)}</span><span class="${cls(c)}">${fmtMove(c)}</span><span class="lbl">Heat ${Math.round(heatOf(t))}%</span></button>`;
  }).join('');
  const track = $('#track');
  track.innerHTML = html + html;
  track.style.setProperty('--dur', Math.max(30, items.length * 5) + 's');
  track.querySelectorAll('img').forEach((im) => im.addEventListener('error', () => im.remove(), { once: true }));
}
$('#jump').addEventListener('click', (e) => { const b = e.target.closest('[data-j]'); if (b) (b.dataset.j === 'ignite' ? $('#ignite') : b.dataset.j === 'cto' ? $('#cto') : tierEls.get(b.dataset.j))?.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' }); });
$('#track').addEventListener('click', (e) => { const b = e.target.closest('.ti'); if (b) openToken(b.dataset.a); });

function bindDrag(sec) {
  const h = sec.querySelector('.handle');
  h.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    h.setPointerCapture(e.pointerId);
    sec.classList.add('dragging'); dragging = true;
    const move = (ev) => {
      const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.tier');
      if (over && over !== sec && over.parentNode === main) {
        const kids = [...main.children];
        if (kids.indexOf(sec) > kids.indexOf(over)) main.insertBefore(sec, over);
        else main.insertBefore(sec, over.nextSibling);
      }
      if (ev.clientY < 90) window.scrollBy(0, -14);
      if (ev.clientY > innerHeight - 70) window.scrollBy(0, 14);
    };
    const up = () => {
      sec.classList.remove('dragging'); dragging = false;
      h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up);
      const vis = [...main.querySelectorAll('.tier')].map((s) => s.dataset.id);
      S.order = [...vis, ...S.order.filter((id) => !vis.includes(id))];
      persist(); renderTape();
    };
    h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
  });
}

// ---------- Controls ----------
function segInit(sel, key, attr, after) {
  const seg = $(sel);
  const paint = () => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset[attr] === S[key]));
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    S[key] = b.dataset[attr]; paint(); persist(); after && after();
  });
  paint();
  return paint;
}
const resetRank = () => { S.rankAt = 0; S.prevRank = new Map(); rowEls.forEach((el) => { el._r = null; }); };
segInit('#sortSeg', 'sort', 'o', () => { resetRank(); render(); renderTape(); });
segInit('#safetySeg', 'safety', 's', () => { render(); renderTape(); queueRisk(); });
let qT;
$('#q').addEventListener('input', (e) => { clearTimeout(qT); qT = setTimeout(() => { S.q = e.target.value; render(); }, 120); });

function paintTierList() {
  $('#tierList').innerHTML = S.order.map((id, i) => `
    <li class="${S.hidden.has(id) ? 'off' : ''}" data-id="${id}">
      <input type="checkbox" ${S.hidden.has(id) ? '' : 'checked'} aria-label="Show ${TMAP[id].label}">
      <span class="lbl">${TMAP[id].label}</span>
      <button class="icon" data-mv="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up"><svg viewBox="0 0 24 24"><path d="m6 15 6-6 6 6"/></svg></button>
      <button class="icon" data-mv="1" ${i === S.order.length - 1 ? 'disabled' : ''} aria-label="Move down"><svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></button>
    </li>`).join('');
}
$('#tierList').addEventListener('click', (e) => {
  const li = e.target.closest('li'); if (!li) return;
  const id = li.dataset.id;
  if (e.target.matches('input')) { e.target.checked ? S.hidden.delete(id) : S.hidden.add(id); }
  const b = e.target.closest('[data-mv]');
  if (b) {
    const i = S.order.indexOf(id), j = i + Number(b.dataset.mv);
    if (j < 0 || j >= S.order.length) return;
    [S.order[i], S.order[j]] = [S.order[j], S.order[i]];
  }
  persist(); paintTierList(); render(); renderTape();
});
$('#customizeBtn').onclick = () => { paintTierList(); $('#modal').hidden = false; };
$('#closeModal').onclick = $('#doneTiers').onclick = () => { $('#modal').hidden = true; queueRisk(); };
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') $('#modal').hidden = true; });
$('#resetTiers').onclick = () => { S.order = TIERS.map((t) => t.id); S.hidden.clear(); persist(); paintTierList(); render(); renderTape(); };

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), 1800);
}
// Outside links open in a separate browser window so Heat Check stays put. This matters most for the
// home-screen app: loading DexScreener etc. in the same window replaced the app with no way back.
// Only if the browser blocks the new window (some in-app browsers) do we fall back to the same tab.
const STANDALONE = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
document.addEventListener('click', (e) => {
  const l = e.target.closest('a[href^="http"]');
  if (!l) return;
  e.preventDefault();
  const w = window.open(l.href, '_blank');
  if (w) { try { w.opener = null; } catch {} return; }
  if (!STANDALONE) location.href = l.href;
  else toast('Allow pop-ups to open links');
});
// Copy that works everywhere: the clipboard API when allowed, else the old select-and-copy way.
function copyText(v) {
  const legacy = () => {
    const ta = document.createElement('textarea');
    ta.value = v; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, v.length);
    let ok = false; try { ok = document.execCommand('copy'); } catch {}
    ta.remove();
    if (!ok) throw new Error('copy failed');
  };
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(v).catch(() => legacy());
  return new Promise((ok) => { legacy(); ok(); });
}
document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-copy]');
  if (!c) return;
  e.preventDefault();
  const v = c.dataset.copy;
  copyText(v).then(() => toast('Copied ' + short(v)), () => toast(v));
});

// ---------- Routing ----------
let navDepth = 0;
// Close the screen right away, then tidy the browser history. Never wait on history to close it.
function goBack() {
  if (openMint) hideToken(); else if (S.openTier) hideTier();
  if (navDepth > 0) { history.back(); return; }
  setHash(S.openTier, null, false);
  route();
}
function setHash(tier, mint, push) {
  if (push) navDepth++;
  const p = new URLSearchParams();
  if (tier) p.set('tier', tier);
  if (mint) p.set('t', mint);
  const h = p.toString() ? '#' + p.toString() : location.pathname;
  push ? history.pushState(null, '', h) : history.replaceState(null, '', h);
}
function route() {
  const p = new URLSearchParams(location.hash.slice(1));
  const tier = TMAP[p.get('tier')] ? p.get('tier') : null;
  const mint = (p.get('t') || '').replace(/[^1-9A-HJ-NP-Za-km-z]/g, '') || null;
  tier ? showTier(tier) : hideTier();
  mint ? showToken(mint) : hideToken();
}
addEventListener('popstate', () => { navDepth = Math.max(0, navDepth - 1); route(); });
const scrimSync = () => { const on = !!(S.openTier || openMint); $('#scrim').classList.toggle('on', on); $('#backFab').classList.toggle('on', on); };
$('#backFab').onclick = (e) => { e.preventDefault(); e.stopPropagation(); goBack(); };
$('#scrim').onclick = () => goBack();

function openTier(id) { setHash(id, null, true); route(); }
function showTier(id) {
  const fresh = S.openTier !== id;
  S.openTier = id;
  if (fresh) {
    $('#sTitle').textContent = TMAP[id].label + (TMAP[id].max === Infinity ? ' market cap' : ' to ' + fmtUsd(TMAP[id].max));
    $('#sBody').innerHTML = '';
    $('#sheet').querySelector('.sbody').scrollTop = 0;
  }
  $('#sheet').classList.add('on'); $('#sheet').setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  scrimSync(); render(); queueRisk();
}
function hideTier() {
  if (!S.openTier) return;
  S.openTier = null;
  $('#sheet').classList.remove('on'); $('#sheet').setAttribute('aria-hidden', 'true');
  if (!openMint) document.body.style.overflow = '';
  scrimSync(); render();
}
$('#closeSheet').onclick = () => goBack();

// ---------- Coin page ----------
let openMint = null, tokenTimer = null, candleTimer = null;
function openToken(a) { window.HCCrumb && HCCrumb('open coin ' + a.slice(0, 8)); setHash(S.openTier, a, true); route(); }
function showToken(a) {
  if (openMint === a) return;
  openMint = a;
  $('#drawer').classList.add('on'); $('#drawer').setAttribute('aria-hidden', 'false');
  document.body.classList.add('coin-open');
  document.body.style.overflow = 'hidden';
  scrimSync();
  $('#drawer').querySelector('.dbody').scrollTop = 0;
  ['#dKeys', '#dChips', '#dTop', '#dHeat', '#dSafety', '#dAbout', '#dTraction', '#dStats', '#dLinks'].forEach((s) => { $(s)._h = null; $(s).innerHTML = ''; });
  dPrev = {};
  candles = []; lastCandle = null; chartFor = null; chartPool = null;
  if (!tfManual) { S.tf = autoTf(S.tokens.get(a)); paintTf(); }
  if (cS) { cS.setData([]); vS.setData([]); setAthLine(); }
  $('#dCa').dataset.copy = a; $('#dCaTxt').textContent = a;
  paintDrawer(); loadChart();
  clearInterval(tokenTimer); tokenTimer = setInterval(refreshToken, TOKEN_MS); refreshToken();
  clearInterval(candleTimer); candleTimer = setInterval(refreshCandles, CANDLE_MS);
  if (!S.risk.has(a)) { riskQ.unshift(a); pumpRisk(); }
  if (!S.info.has(a)) api('/api/info?a=' + a).then((d) => { S.info.set(a, d); if (openMint === a) paintDrawer(); }).catch(() => S.info.set(a, { failed: true }));
  loadAth(a);
}
function loadAth(a, tries = 0) {
  const t = S.tokens.get(a);
  if (!t) { if (tries < 5) setTimeout(() => loadAth(a, tries + 1), 1500); return; }
  if (S.ath.get(a)?.t) return;
  api(`/api/ath?pool=${t.pair}&a=${a}&p=${t.p}`).then((d) => {
    if (d.ath) { S.ath.set(a, d.ath); if (openMint === a) { paintDrawer(); setAthLine(); } }
    else S.ath.set(a, { none: true });
  }).catch(() => { if (tries < 2) setTimeout(() => loadAth(a, tries + 1), 4000); });
}
function hideToken() {
  if (!openMint) return;
  openMint = null;
  clearInterval(tokenTimer); clearInterval(candleTimer);
  setFull(false);
  $('#drawer').classList.remove('on'); $('#drawer').setAttribute('aria-hidden', 'true');
  document.body.classList.remove('coin-open');
  S.drawnAt = 0; render();
  if (!S.openTier) document.body.style.overflow = '';
  scrimSync();
}
$('#closeDrawer').onclick = () => goBack();
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#modal').hidden) $('#modal').hidden = true;
  else if ($('#chartWrap').classList.contains('full')) setFull(false);
  else if (openMint || S.openTier) goBack();
});

async function refreshToken() {
  const a = openMint; if (!a || document.hidden) return;
  try {
    const d = await api('/api/prices?one=1&a=' + a);
    if (a !== openMint) return;
    S.tokens.set(a, keep(d.token));
    const ath = S.ath.get(a);
    if (ath && ath.price && d.token.p > ath.price) { S.ath.set(a, { ...ath, price: d.token.p, t: Math.floor(Date.now() / 1000), precision: 'live' }); setAthLine(); }
    loadH4(d.token);
    paintDrawer();
    liveCandle(d.token);
    if (chartFor !== a) { loadChart(); loadAth(a); }
    render();
  } catch {}
}

// 4-hour change and volume for the coin page (the data feeds only give 1h and 6h, so this comes from
// the coin's own 15-minute candles). Refreshed once a minute while the coin is open.
function loadH4(t) {
  const h = S.h4.get(t.a);
  if (h && Date.now() - h.at < 60e3) return;
  S.h4.set(t.a, { ...(h || {}), at: Date.now() });
  api(`/api/h4?a=${t.a}&pool=${t.pair || ''}`).then((d) => { if (!d.error) { S.h4.set(t.a, { ...d, at: Date.now() }); if (openMint === t.a) paintDrawer(); } }).catch(() => {});
}
function momentumRead(t, ath) {
  const r1 = t.mc ? t.v.h1 / t.mc : 0, c1 = t.c.h1 ?? 0, c24 = t.c.h24 ?? 0;
  const ageH = t.age ? (Date.now() - t.age) / 3600e3 : 999;
  const fromAth = ath?.mc ? (t.mc / ath.mc - 1) * 100 : null;
  if (ageH < 1) return 'Brand new — the fastest, riskiest stage. Most coins this young fail; watch liquidity and holders closely.';
  if (fromAth != null && fromAth > -5 && c1 > 0) return 'Pushing all-time highs right now with buyers in control.';
  if (r1 > 0.25 && c1 > 3) return 'Heavy trading with price rising — active upward momentum.';
  if (r1 > 0.25 && c1 < -3) return 'Heavy trading while price falls — sellers are in control.';
  if (fromAth != null && fromAth < -80) return `Down ${Math.round(-fromAth)}% from its peak — either a deep-dip recovery play or a fading coin.`;
  if (c24 > 50 && c1 >= 0) return 'Strong 24h run that is still holding.';
  if (r1 < 0.02) return 'Quiet — little trading relative to its size.';
  return c1 >= 0 ? 'Steady, with modest buying.' : 'Drifting lower on modest trading.';
}

let dPrev = {};
function paintDrawer() {
  const t = S.tokens.get(openMint);
  if (!t) { $('#dSym').textContent = 'Loading…'; $('#dPrice').textContent = ''; $('#dMc').textContent = ''; return; }
  const info = S.info.get(t.a);
  const athRaw = S.ath.get(t.a);
  const supply = t.p ? t.mc / t.p : 0;
  const ath = athRaw?.price ? { ...athRaw, mc: Math.max(athRaw.price * supply, t.mc) } : null;
  const g = gradeOf(t);
  const img = safeUrl(t.img);
  $('#dImg').hidden = !img; if (img && $('#dImg').src !== img) $('#dImg').src = img;
  $('#dDot').className = 'fdot g-' + g;
  $('#dSym').textContent = t.s;
  const ca = $('#dCa'); if (ca.dataset.copy !== t.a) { ca.dataset.copy = t.a; $('#dCaTxt').textContent = t.a; }
  $('#dName').textContent = t.nm;
  const pe = $('#dPrice'), me = $('#dMc');
  pe.textContent = fmtPrice(t.p); flash(pe, dPrev.p, t.p);
  tween(me, t.mc, fmtUsd); flash(me, dPrev.mc, t.mc);
  dPrev = { p: t.p, mc: t.mc };
  const c = t.c[S.win];
  setHTML($('#dChg'), `<span class="${cls(c)}">${fmtMove(c)}</span> <span class="muted">${WIN_LABEL[S.win]}</span>`);

  // Key tiles: age, ATH, distance from ATH, liquidity
  const born = info?.created && info.created < (t.age || Infinity) ? info.created : t.age;
  const ac = ageCls(born);
  let athTile;
  if (ath) {
    const when = ath.precision === 'live' ? 'Right now' : `${fmtWhen(ath.t * 1000, ath.precision === 'day')} · ${ago(ath.t * 1000)}`;
    const partial = ath.firstDay && born && ath.firstDay * 1000 - born > 3 * 86400e3;
    athTile = `<div class="key ath"><span>All-time high MC</span><b>${fmtUsd(ath.mc)}</b><small>${when}${partial ? ` · DEX data since ${fmtWhen(ath.firstDay * 1000, true)}` : ''}</small></div>`;
  } else athTile = `<div class="key ath"><span>All-time high MC</span><b>${athRaw?.none ? '—' : '…'}</b><small>${athRaw?.none ? 'No history yet' : 'Finding the peak…'}</small></div>`;
  let fromTile = `<div class="key"><span>From ATH</span><b>—</b><small>&nbsp;</small></div>`;
  if (ath) {
    const d = (t.mc / ath.mc - 1) * 100;
    fromTile = d > -2
      ? `<div class="key"><span>From ATH</span><b class="up">At ATH</b><small>Trading at its peak</small></div>`
      : `<div class="key"><span>From ATH</span><b class="down">${fmtPct(d)}</b><small>Needs ${fmtPct((ath.mc / t.mc - 1) * 100)} to retake</small></div>`;
  }
  setHTML($('#dKeys'),
    `<div class="key agek ${ac}"><span>Age</span><b>${fmtAgeLong(born)}</b><small>${born ? 'Since ' + fmtWhen(born) : '&nbsp;'}</small></div>` + athTile + fromTile +
    `<div class="key"><span>Liquidity</span><b>${t.liq ? fmtUsd(t.liq) : 'Curve'}</b><small>${t.liq && t.mc ? (t.liq / t.mc * 100).toFixed(1) + '% of MC' : 'pump.fun bonding curve'}</small></div>`);
  const h4 = S.h4.get(t.a), c4 = h4?.p4 && t.p ? (t.p / h4.p4 - 1) * 100 : null;
  setHTML($('#dChips'), ['m5', 'h1', 'h4', 'h24'].map((k) => { const v = k === 'h4' ? c4 : t.c[k]; return `<div class="chip ${k === S.win ? 'hero' : ''}">Change ${k === 'h4' ? '4h' : WIN_LABEL[k]}<b class="${cls(v)}">${fmtMove(v)}</b></div>`; }).join(''));
  const ts = topStatus(t);
  setHTML($('#dTop'), `<b class="${ts.on ? 'on' : ''}">${esc(ts.txt)}</b>` + (ts.on ? '' : `<small>${esc(ts.a)}</small><small>${esc(ts.b)}</small>`));
  setHTML($('#dHeat'), MH.card(t, esc, g));

  // Safety
  const rc = S.risk.get(t.a);
  const flags = [];
  t.f.forEach((f) => flags.push([f.l, f.t, '']));
  (info?.risks || (rc?.risks) || []).forEach((x) => flags.push([x.l === 'danger' ? 3 : x.l === 'warn' && !/mutable metadata/i.test(x.n) ? 2 : 1, x.n + (x.v ? ` (${x.v})` : ''), x.d]));
  if (info && !info.failed) {
    if (info.rugged) flags.push([3, 'RugCheck marks this token as rugged', 'Liquidity was pulled or the dev dumped.']);
    if (info.mintAuth) flags.push([3, 'Dev can still mint new tokens', 'Mint authority is active — supply can be inflated.']);
    if (info.freezeAuth) flags.push([3, 'Dev can freeze wallets', 'Freeze authority is active — holders could be blocked from selling.']);
    if (info.insiders) { const n = Number(info.insiders) || 0; flags.push([n >= 10 && t.mc < 50e6 ? 3 : 2, n > 1 ? `${n} linked insider wallets detected` : 'Insider wallets detected', 'Wallets linked to each other or the creator — coordinated selling risk.']); }
    if (info.top10 != null) flags.push([info.top10 > 50 ? 3 : info.top10 > 30 ? 2 : 0, `Top 10 wallets hold ${info.top10.toFixed(1)}%`, info.top10 > 30 ? 'Concentrated supply — a few wallets can move the price.' : 'Supply is reasonably spread out.']);
    if (info.devPct != null && info.devPct > 0.5) flags.push([info.devPct > 10 ? 3 : info.devPct > 3 ? 2 : 1, `Dev wallet holds ${info.devPct.toFixed(1)}%`, '']);
    if (info.mintAuth === false && info.freezeAuth === false) flags.push([0, 'Mint and freeze authority revoked', 'The dev can’t print tokens or freeze wallets.']);
  }
  const seenT = new Set();
  const rows = flags.filter(([, txt]) => !seenT.has(txt) && seenT.add(txt)).sort((a, b) => b[0] - a[0]);
  const fl = (l, txt, d) => `<div class="flag ${l === 3 ? 'l3' : l === 2 ? 'l2' : l === 0 ? 'ok' : ''}"><i></i><div><b>${esc(txt)}</b>${d ? `<small>${esc(d)}</small>` : ''}</div></div>`;
  const head = { red: 'Red flags found — high risk', amber: 'Some warning signs', green: 'No major red flags' }[g];
  setHTML($('#dSafety'), `<h4><span class="badge ${g}"><i></i>${GRADE_TXT[g]}</span>${head}</h4>` +
    (rows.length ? rows.map(([l, txt, d]) => fl(l, txt, d)).join('') : fl(0, 'No red flags from live trading data', '')) +
    (!info ? `<p class="muted small">Loading on-chain checks…</p>` : ''));

  // About: what it is, why it exists, why it's moving, utility evidence
  const site = MA.siteUrl(t, info);
  if (site && info && !S.site.has(site)) {
    S.site.set(site, null);
    api(`/api/site?u=${encodeURIComponent(site)}&a=${t.a}`).then((d) => { S.site.set(site, d); if (openMint === t.a) paintDrawer(); }).catch(() => S.site.set(site, { ok: false, error: 'unreachable' }));
  }
  setHTML($('#dAbout'), MA.render(t, info, site ? S.site.get(site) : null, MH.stage(t), { esc, short, ago, fmtPct }));

  // Traction
  const tr = [];
  tr.push(`<b>Momentum read:</b> ${momentumRead(t, ath)}`);
  if (info?.holders) tr.push(`<b>${info.holders.toLocaleString()} holders</b>${info.s24?.holderChange != null ? ` · <span class="${cls(info.s24.holderChange)}">${fmtPct(info.s24.holderChange)}</span> in 24h` : ''}`);
  if (info?.s24?.traders) tr.push(`<b>${info.s24.traders.toLocaleString()} traders</b> in 24h${info.s24.organicBuyers ? ` · ${info.s24.organicBuyers.toLocaleString()} organic buyers` : ''}`);
  const b24 = t.tx.h24.b, s24 = t.tx.h24.s;
  if (b24 + s24) tr.push(`<b>${Math.round(b24 / (b24 + s24) * 100)}% of trades are buys</b> (${b24.toLocaleString()} buys / ${s24.toLocaleString()} sells, 24h)`);
  if (t.v.h24 > 0) {
    const pace = (t.v.h1 * 24) / t.v.h24;
    tr.push(pace > 1.5 ? `<b>Volume accelerating</b> — the last hour is running ${pace.toFixed(1)}× its 24h average pace.` : pace < 0.5 ? '<b>Volume cooling</b> — the last hour is well below its 24h pace.' : 'Volume is steady versus its 24h pace.');
  }
  if (info?.organicLabel) tr.push(`Organic activity: <b>${esc(info.organicLabel)}</b> <span class="muted">(Jupiter's measure of real vs bot trading)</span>`);
  if (info?.ct?.smart) tr.push(`Mentioned by <b>${info.ct.smart}</b> tracked crypto-Twitter accounts.`);
  if (info?.kingAt) tr.push(`Hit pump.fun "King of the Hill" ${ago(info.kingAt)}.`);
  if (info?.verified) tr.push('Verified on Jupiter.');
  setHTML($('#dTraction'), `<h4><svg viewBox="0 0 24 24"><path d="M3 17l6-6 4 4 8-8M15 7h6v6"/></svg>Traction so far</h4><ul class="bullets">${tr.map((x) => `<li>${x}</li>`).join('')}</ul>${info ? '' : '<p class="muted small">Loading holders and traders…</p>'}`);

  const tx1 = t.tx.h1;
  const st = [
    ['Vol 5m', fmtUsd(t.v.m5)], ['Vol 1h', fmtUsd(t.v.h1)], ['Vol 4h', h4?.v4 != null ? fmtUsd(h4.v4) : '—'], ['Vol 24h', fmtUsd(t.v.h24)],
    ['Heat 1h', fmtRatio(t.mc ? t.v.h1 / t.mc : 0)], ['Heat 24h', fmtRatio(t.mc ? t.v.h24 / t.mc : 0)], ['Buys / sells 1h', `${tx1.b} / ${tx1.s}`], ['Heat score', Math.round(heatOf(t)) + '%'],
  ];
  setHTML($('#dStats'), st.map(([k, v]) => `<div class="stat"><span>${k}</span><b>${esc(v)}</b></div>`).join(''));
  const links = [
    [t.url || `https://dexscreener.com/solana/${t.pair}`, 'DexScreener'], ['https://solscan.io/token/' + t.a, 'Solscan'], ['https://rugcheck.xyz/tokens/' + t.a, 'RugCheck'],
    ...(/pump$/.test(t.a) || /pump/i.test(info?.launchpad || '') ? [['https://pump.fun/coin/' + t.a, 'pump.fun']] : []),
    ['https://jup.ag/swap/SOL-' + t.a, 'Jupiter'], ['https://gmgn.ai/sol/token/' + t.a, 'GMGN'], ['https://larpcheck.app', 'LARPCHECK'],
    ...[info?.website, ...(t.web || [])].filter(Boolean).slice(0, 1).map((u) => [u, 'Website']),
    ...(t.soc || []).map((s) => [s.u, /twitter/i.test(s.t || '') ? 'X' : String(s.t || 'Link').replace(/^./, (x) => x.toUpperCase())]),
  ].filter(([u]) => safeUrl(u));
  setHTML($('#dLinks'), `<button data-copy="${esc(t.a)}">Copy contract</button>` + links.map(([u, l]) => `<a class="lk-${esc(l.toLowerCase().replace(/[^a-z]/g, ''))}" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(l)}</a>`).join(''));
}

// ---------- Chart ----------
const C = { bg: '#10141b', grid: 'rgba(255,255,255,.04)', text: '#8a95a8', up: '#4fe0a8', down: '#ff6f7d' };
const TF_SEC = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };
let chart = null, cS, vS, athLine = null;
let candles = [], lastCandle = null, chartToken = 0, chartFor = null, chartPool = null;
let loadingMore = false, noMore = false, armMore = false, chartOff = false;
const scaleK = () => { const t = S.tokens.get(openMint); return S.unit === 'mc' && t && t.p ? t.mc / t.p : 1; };
// Axis labels with enough precision to stay distinct at any size ($5.12K, $48.3K, $5.124M…)
function fmtMcAxis(x) {
  if (!isFinite(x)) return '';
  const a = Math.abs(x);
  const [d, u] = a >= 1e9 ? [1e9, 'B'] : a >= 1e6 ? [1e6, 'M'] : a >= 1e3 ? [1e3, 'K'] : [1, ''];
  return '$' + Number((x / d).toPrecision(4)).toString() + u;
}
const fmtAxis = (p) => (S.unit === 'mc' ? fmtMcAxis(p) : fmtPrice(p));
// Trim freak wicks (bad ticks) so they can't squash the chart.
const trimWicks = (cs) => cs.map((c) => {
  const hi = Math.max(c.o, c.c), lo = Math.min(c.o, c.c);
  return { ...c, h: Math.min(c.h, hi * 1.6), l: Math.max(c.l, lo / 1.6) };
});
// Focus on the 1-minute and 5-minute charts: 1m for brand-new coins, 5m otherwise.
function autoTf(t) {
  const ageH = t?.age ? (Date.now() - t.age) / 3600e3 : 1e9;
  return ageH < 6 ? '1m' : '5m';
}
let tfManual = false;
// Chart history comes from GeckoTerminal; the live market cap comes from DexScreener. Lock the
// history to the live price so the chart's last value always equals the live market cap.
let anchor = 1;
const scaleC = (c, r) => (r === 1 ? c : { ...c, o: c.o * r, h: c.h * r, l: c.l * r, c: c.c * r });

function ensureChart() {
  if (chart || !window.LightweightCharts) return !!chart;
  const LC = window.LightweightCharts;
  chart = LC.createChart($('#chart'), {
    autoSize: true,
    layout: { background: { type: 'solid', color: C.bg }, textColor: C.text, fontFamily: 'Inter, system-ui, sans-serif', fontSize: 12, attributionLogo: false },
    grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
    rightPriceScale: { borderColor: '#1f2632', scaleMargins: { top: 0.14, bottom: 0.26 }, autoScale: true },
    timeScale: { borderColor: '#1f2632', timeVisible: true, secondsVisible: false, rightOffset: 4, barSpacing: 8, fixLeftEdge: false },
    crosshair: { mode: LC.CrosshairMode.Normal },
    // On phones a vertical swipe over the chart must scroll the page, not grab the chart (that felt frozen).
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: { axisPressedMouseMove: { time: true, price: false }, mouseWheel: true, pinch: true },
    kineticScroll: { touch: false, mouse: false },
    localization: { priceFormatter: fmtAxis },
  });
  cS = chart.addCandlestickSeries({ upColor: C.up, downColor: C.down, borderUpColor: C.up, borderDownColor: C.down, wickUpColor: C.up, wickDownColor: C.down, priceFormat: { type: 'custom', minMove: 1e-12, formatter: fmtAxis } });
  vS = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
  chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
  chart.timeScale().subscribeVisibleLogicalRangeChange((r) => { if (r && r.from < 15) loadMore(); });
  return true;
}
function setAthLine() {
  if (!cS) return;
  if (athLine) { cS.removePriceLine(athLine); athLine = null; }
  const a = S.ath.get(openMint);
  if (!a?.price || chartFor !== openMint) return;
  athLine = cS.createPriceLine({ price: a.price * scaleK(), color: '#f2b84b', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'ATH' });
}
function setChartData() {
  const k = scaleK();
  cS.setData(candles.map((c) => ({ time: c.t, open: c.o * k, high: c.h * k, low: c.l * k, close: c.c * k })));
  vS.setData(candles.map((c) => ({ time: c.t, value: c.v, color: c.c >= c.o ? 'rgba(79,224,168,.33)' : 'rgba(255,111,125,.33)' })));
  lastCandle = candles.length ? { ...candles[candles.length - 1] } : null;
  setAthLine();
}
async function loadChart(retry = 0) {
  const t = S.tokens.get(openMint);
  const msg = $('#chartMsg');
  if (!t) { msg.hidden = false; msg.innerHTML = '<div class="spinner"></div>'; return; }
  if (!ensureChart()) { msg.hidden = false; msg.textContent = 'Chart library failed to load. Check your connection and reopen.'; return; }
  const my = ++chartToken;
  chartFor = openMint; noMore = false; loadingMore = false; armMore = false;
  msg.hidden = false; msg.innerHTML = '<div class="spinner"></div>';
  try {
    const d = await api(`/api/ohlcv?pool=${chartPool || t.pair}&a=${t.a}&tf=${S.tf}&p=${t.p}`);
    if (my !== chartToken) return;
    chartPool = d.pool || t.pair;
    chartOff = !!d.mismatch;
    $('#liveTag').hidden = chartOff;
    if (chartOff) toast('Chart history for this coin may be off — check DexScreener');
    candles = trimWicks(d.candles || []);
    anchor = 1;
    const last = candles[candles.length - 1], live = S.tokens.get(openMint)?.p;
    if (last && live && !chartOff) { const r = live / last.c; if (r > 0.4 && r < 2.5) anchor = r; }
    candles = candles.map((c) => scaleC(c, anchor));
    msg.hidden = true;
    setChartData();
    liveCandle(S.tokens.get(openMint));
    centerChart();
    if (!(d.candles || []).length) toast('No trade history yet — building candles live');
    setTimeout(() => { if (my === chartToken) armMore = true; }, 700);
  } catch {
    if (my !== chartToken) return;
    if (retry < 2) { setTimeout(() => { if (my === chartToken) loadChart(retry + 1); }, 2500); return; }
    msg.hidden = true; candles = []; setChartData();
  }
}
// Show the most recent candles and let the price axis fit them, so any size coin sits centered.
function centerChart() {
  const n = candles.length, show = innerWidth < 680 ? 60 : 100;
  chart.priceScale('right').applyOptions({ autoScale: true });
  if (n > show) chart.timeScale().setVisibleLogicalRange({ from: n - show, to: n + 3 });
  else chart.timeScale().fitContent();
}
async function loadMore() {
  if (!armMore || loadingMore || noMore || !candles.length || !chartPool || chartFor !== openMint) return;
  loadingMore = true;
  const my = chartToken;
  try {
    const d = await api(`/api/ohlcv?pool=${chartPool}&a=${openMint}&tf=${S.tf}&before=${candles[0].t}&limit=500`);
    if (my !== chartToken) return;
    const older = trimWicks((d.candles || []).filter((c) => c.t < candles[0].t)).map((c) => scaleC(c, anchor));
    if (!older.length) { noMore = true; return; }
    const range = chart.timeScale().getVisibleLogicalRange();
    candles = [...older, ...candles];
    setChartData();
    if (range) chart.timeScale().setVisibleLogicalRange({ from: range.from + older.length, to: range.to + older.length });
  } catch { noMore = true; } finally { loadingMore = false; }
}
async function refreshCandles() {
  if (!openMint || document.hidden || !chartPool || !candles.length) return;
  const my = chartToken;
  try {
    const d = await api(`/api/ohlcv?pool=${chartPool}&a=${openMint}&tf=${S.tf}&limit=10`);
    if (my !== chartToken || !d.candles?.length) return;
    const idx = new Map(candles.map((c, i) => [c.t, i]));
    trimWicks(d.candles).map((c) => scaleC(c, anchor)).forEach((c) => {
      if (idx.has(c.t)) { const i = idx.get(c.t); candles[i] = i === candles.length - 1 && lastCandle ? { ...c, c: lastCandle.c, h: Math.max(c.h, lastCandle.h), l: Math.min(c.l, lastCandle.l) } : c; }
      else if (c.t > candles[candles.length - 1].t) candles.push(c);
    });
    const range = chart.timeScale().getVisibleLogicalRange();
    setChartData();
    if (range) chart.timeScale().setVisibleLogicalRange(range);
  } catch {}
}
function liveCandle(t) {
  if (!cS || !t || chartFor !== openMint || !t.p || chartOff) return;
  const step = TF_SEC[S.tf], now = Math.floor(Date.now() / 1000), bucket = now - (now % step), k = scaleK();
  if (!lastCandle) {
    lastCandle = { t: bucket, o: t.p, h: t.p, l: t.p, c: t.p, v: 0 };
    candles.push({ ...lastCandle });
  } else if (bucket > lastCandle.t) {
    lastCandle = { t: bucket, o: lastCandle.c, h: Math.max(lastCandle.c, t.p), l: Math.min(lastCandle.c, t.p), c: t.p, v: 0 };
    candles.push({ ...lastCandle });
  } else {
    lastCandle.h = Math.max(lastCandle.h, t.p); lastCandle.l = Math.min(lastCandle.l, t.p); lastCandle.c = t.p;
    candles[candles.length - 1] = { ...lastCandle, v: candles[candles.length - 1].v };
  }
  const lc = candles[candles.length - 1];
  cS.update({ time: lc.t, open: lc.o * k, high: lc.h * k, low: lc.l * k, close: lc.c * k });
}
function setFull(on) { $('#chartWrap').classList.toggle('full', on); $('#fsBtn').classList.toggle('on', on); }
const paintTf = segInit('#tfSeg', 'tf', 'tf', () => { tfManual = true; chartPool = null; loadChart(); });
segInit('#unitSeg', 'unit', 'u', () => { if (chart) { setChartData(); centerChart(); } });
$('#fsBtn').onclick = () => setFull(!$('#chartWrap').classList.contains('full'));
$('#exitFs').onclick = () => setFull(false);

// ---------- Buzz: is the community actually paying attention? ----------
// Social arbitrage: runs like WASTED are driven by people caring. Built from free signals:
//   CT attention   Jupiter's Crypto Twitter likes, smart-account likes weighted 10x (30%)
//   holder growth  % new holders in the last hour (25%)
//   traders        unique traders in the last hour (20%)
//   calls          Telegram calls, CTO claim, DexScreener boost or profile in the last few hours (15%)
//   Telegram       members in the coin's own Telegram, once its profile has loaded (10%)
const sat = (x, k) => (x > 0 ? 1 - Math.exp(-x / k) : 0);
function buzzOf(t) {
  const info = S.info.get(t.a);
  const ct = sat((t.ctl || 0) + 10 * (t.sctl || 0), 120);
  const hold = sat(t.hc?.h1 || 0, 4);
  const trad = sat(t.tr?.h1 || 0, 400);
  const so = t.so || {}, fresh = (m) => (m != null && m <= 180 ? 1 - m / 240 : 0);
  const calls = Math.min(1, 0.6 * fresh(so.tg) + 0.5 * fresh(so.c) + 0.25 * fresh(so.p) + 0.15 * fresh(so.b));
  const tg = sat(info?.tgMembers || 0, 1500);
  const s = Math.round(100 * (0.3 * ct + 0.25 * hold + 0.2 * trad + 0.15 * calls + 0.1 * tg));
  const why = [];
  if (t.sctl) why.push(`${t.sctl} smart CT likes`);
  if (t.ctl) why.push(`${t.ctl} CT likes`);
  if ((t.hc?.h1 || 0) > 0) why.push(`holders +${t.hc.h1}% 1h`);
  if (t.tr?.h1) why.push(`${t.tr.h1} traders 1h`);
  if (so.tg != null) why.push(`TG call ${so.tg}m ago`);
  if (info?.tgMembers) why.push(`${info.tgMembers.toLocaleString()} in Telegram`);
  return { s, why };
}
const BUZZ_MIN = 20;

// ---------- Igniting Top 10 ----------
// The strict list: coins moving right now that are as clean and spread out as we can verify, weighted
// toward the $40K–$120K zone and toward a coin's FIRST run. Coins that already ran only make it as a
// confirmed rebound (higher low, back above the floor, buyers in control) or a breakout over old highs.
// Every coin needs a full RugCheck report, run history and a real description before it can list.
const IG = { run: new Map(), seen: new Map(), log: igLoad(), at: 0, fetching: 0, scanned: 0, listed: [], fill: [], fillSince: new Map() };
window.HCRun = IG.run;
function igLoad() { try { const o = JSON.parse(localStorage.getItem('hc_ig') || '{}'); const cut = Date.now() - 48 * 3600e3; for (const k in o) if (!(o[k].t0 > cut)) delete o[k]; return o; } catch { return {}; } }
function igSave() { try { localStorage.setItem('hc_ig', JSON.stringify(IG.log)); } catch {} }
const clamp01 = (x) => (x > 1 ? 1 : x > 0 ? x : 0);
// No market-cap preference above $40K: a confirmed run at any size competes on equal terms.
const igZone = (mc) => (mc < 25e3 ? 0 : mc < 40e3 ? 0.9 : 1);
// Holder limits scale with size: small caps are where insiders can rug, so they're strict; bigger caps
// get more room. Top 10 wallets (insiders counted): 20% under $100K, 25% at $250K, 30% at $500K,
// 35% at $1M, 40% at $5M+, sliding between.
const slide = (mc, pts) => { for (let i = 1; i < pts.length; i++) { const [m0, v0] = pts[i - 1], [m1, v1] = pts[i]; if (mc <= m1) return mc <= m0 ? v0 : v0 + (v1 - v0) * (mc - m0) / (m1 - m0); } return pts[pts.length - 1][1]; };
const igConcLim = (mc) => slide(mc, [[100e3, 20], [250e3, 25], [500e3, 30], [1e6, 35], [5e6, 40]]);
// Insiders: under 5% (2 linked wallets) below $250K, 7% (3) up to $1M, 10% (4) above. Dev/creator: 3% below $250K, 5% above.
const igIns = (mc) => (mc < 250e3 ? { pct: 5, n: 2, dev: 3 } : mc <= 1e6 ? { pct: 7, n: 3, dev: 5 } : { pct: 10, n: 4, dev: 5 });
// Unloading, at any size: big wallets selling into a crowd of small buys. Over the last hour, more sell
// dollars than buy dollars while buys outnumber sells, or the average sell is 3x+ the average buy with
// sellers taking most of the flow, or the price is falling while more people are buying.
function unloading(t) {
  const bs = t.bs?.h1, tx = t.tx?.h1;
  const nb = tx?.b || 0, ns = tx?.s || 0;
  if ((t.c.h1 ?? 0) <= -5 && nb > ns) return true;
  if (!bs) return false;
  const [bv, sv] = bs;
  if (sv > bv && nb > ns) return true;
  if (nb > 0 && ns > 0 && sv / ns >= 3 * (bv / nb) && sv >= bv * 0.8) return true;
  return false;
}
// What counts as a good call, measured over the 4 hours after a coin lists: 3x if it listed under
// $100K market cap, 2x at $100K and up.
const IG_WIN_MS = 4 * 3600e3;
const igTarget = (mc0) => (mc0 < 100e3 ? 3 : 2);
function igRecord() {
  let done = 0, wins = 0, open = 0;
  for (const k in IG.log) {
    const L = IG.log[k];
    if (!L.p0) continue;
    const hit = (L.hi4 || L.p0) / L.p0 >= igTarget(L.mc0 || 0);
    if (hit) { wins++; done++; } else if (Date.now() - L.t0 >= IG_WIN_MS) done++; else open++;
  }
  return { done, wins, open };
}
const IG_PH = { run: 'Confirmed run', start: 'Run starting', brk: 'Breakout', ext: 'Late in run' };

function igPhase(t, p, r) {
  if (!r || r.pending || r.failed || !r.n) return null;
  // Only coins being pushed right now: short-term price up, buyers in control, more new buyers than sellers.
  if (!(p.short >= 0.3 && p.buying >= 0.55 && (t.nb?.h1 || 0) > 0)) return { k: 'no', m: 0 };
  // How far into THIS move: price vs its 6-hour low. Past 4x (or +500% on the day) it's late.
  const lo6 = r.lo6 || r.lo72;
  const off6 = lo6 ? t.p / lo6 : 1;
  if (off6 >= 4 || (p.h24 || 0) >= 500) return { k: 'ext', m: 0.5 };
  const nearHi = r.hi ? t.p >= r.hi * 0.8 : false;
  const higherLow = r.lo6 && r.lo72 && r.lo6 >= r.lo72 * 1.05;
  // Confirmed run: green on the hour and 6 hours, at or near its 7-day high, a higher low underneath.
  // Best when it's still early in the move (under 2x off the 6-hour low).
  const h4 = r.p4 ? (t.p / r.p4 - 1) * 100 : (p.h6 || 0);
  if ((p.h1 || 0) >= 8 && h4 >= 20 && p.trend >= 0.4 && nearHi && higherLow) return { k: 'run', m: off6 <= 2 ? 1.3 : 1.1 };
  // Run starting: just turned up this hour and still close to its 6-hour low.
  if ((p.h1 || 0) >= 3 && off6 <= 1.8) return { k: 'start', m: 1.2 };
  // Breakout: pushing through its 7-day high.
  if (r.hi && t.p >= r.hi * 0.95) return { k: 'brk', m: 1.1 };
  return { k: 'no', m: 0 };
}
// Cheap checks on data we already have. Returns the heat parts if the coin is worth a deeper look.
// Established = $250K+ market cap and at least a day old: may list with Caution flags (labeled).
// Community coin = $250K+, a week or more old, 1,000+ holders: concentration and insider limits no
// longer block it, and it may list with any grade. Hard rug signals always block.
const igEstablished = (t) => t.mc >= 250e3 && t.age && Date.now() - t.age >= 24 * 3600e3;
const igCommunity = (t) => t.mc >= 250e3 && t.age && Date.now() - t.age >= 7 * 86400e3 && (S.info.get(t.a)?.holders || t.hold || 0) >= 1000;
// Things that block a coin from both parts of the Top 10, whatever its size or age.
function hardBlock(t) {
  if (!(t.mc >= 25e3) || !t.p) return 'Under $25K market cap';
  if (t.aud && (!t.mintOff || !t.frzOff)) return 'The dev can still mint new coins or freeze wallets';
  if (t.f.some((x) => BOT_FLAGS.has(x.k))) return 'Bot or wash-trading signals';
  if (S.risk.get(t.a)?.risks?.some((x) => /rugged/i.test(x.n))) return 'Marked as rugged';
  if (unloading(t)) return 'Big wallets are selling into the buys';
  // Serial launchers, insider networks and bots. Some of each is in almost every coin, so these
  // block only at levels that mean a setup. Established community coins (a week+ old, 1,000+
  // holders, $250K+) are exempt: by then the community, not the dev, decides the price.
  if (igCommunity(t)) return '';
  const rk = S.risk.get(t.a), ok = rk && !rk.pending && !rk.failed;
  const devN = Math.max(t.devM || 0, (ok && rk.devN) || 0);
  if (devN >= 20) return `Serial launcher: dev has made ${devN} coins`;
  if (devN >= 5 && t.mc < 500e3) return `Dev has made ${devN} coins (serial launcher)`;
  if (t.ol === 'low') return 'Mostly bot trading';
  if (t.os != null && t.os < 40 && t.mc < 1e6) return `Organic score ${t.os}: mostly bots`;
  if (ok) {
    if ((rk.graph || 0) >= 25 && t.mc < 1e6) return `${rk.graph} linked insider wallets`;
    if ((rk.ins || 0) >= 15 && t.mc < 500e3) return `Insiders hold ${Math.round(rk.ins)}%`;
    if ((rk.insN || 0) >= 8 && t.mc < 250e3) return `${rk.insN} insider wallets in the top holders`;
  }
  return '';
}
function igPre(t, out = {}) {
  const no = (w) => { out.why = w; return null; };
  const hb = hardBlock(t);
  if (hb) return no(hb);
  const g0 = gradeOf(t), com = igCommunity(t);
  if (g0 === 'red' && !com) return no('Red safety flags (' + (topWhy(t) || 'see safety report') + '), and not yet an established community coin');
  if (g0 === 'amber' && !igEstablished(t)) return no('Caution flags (' + (topWhy(t) || 'see safety report') + ') on a coin under $250K or less than a day old');
  if (t.ol === 'low') return no('Trading looks mostly non-organic');
  if (!com && t.dev != null && t.dev >= igIns(t.mc).dev) return no(`Dev wallet holds ${t.dev}%`);
  if ((t.devM || 0) >= 5 && !com) return no(`Dev has launched ${t.devM} coins`);
  if (!com && t.top != null && t.top >= igConcLim(t.mc) + 10) return no(`Top holders own ${Math.round(t.top)}%`);
  if (t.hold != null && t.hold < 150) return no('Fewer than 150 holders');
  const p = MH.parts(t, g0);
  if (p.dead || p.stale) return no('Barely trading right now');
  if (p.dumping) return no('Selling is winning right now');
  if (p.bot || p.botChurn) return no('Looks like bot trading');
  if (p.short < 0.3) return no('Price isn\'t pushing up right now');
  if (p.buying < 0.5) return no('Buyers aren\'t in control right now');
  if (p.organic < 0.45) return no('Not enough real-trader activity');
  if ((t.v.m5 || 0) < Math.max(1500, t.mc * 0.006) || (p.tr5 || 0) < 12) return no('Not enough volume or traders in the last 5 minutes');
  const ageH = t.age ? (Date.now() - t.age) / 3600e3 : 99;
  if (ageH > 2 && t.os != null && t.os < 55) return no(`Organic score ${t.os} is under 55`);
  return p;
}
const IG_WHY = { wait: 'Still loading its safety report and price history', norisk: 'No safety report available', conc: 'Holders too concentrated or too many insider wallets for its size and age', dump: 'Big wallets are selling into the buys', rug: 'Marked as rugged', lp: 'Liquidity isn\'t locked', phase: 'Moving, but not at the start of a run (or no fresh breakout)', desc: 'No website or X account', buzz: 'Not enough community attention yet (Buzz under 20)', young: 'Under an hour old: needs to be fully clean (no insiders, no bots, not a repeat dev) with a working product or real attention, and at least 30 minutes old' };
// A working product: the coin's site is live and links an app, docs or code (not a template or "coming soon").
function productOf(t) {
  const u = MA.siteUrl(t, S.info.get(t.a)), s = u ? S.site.get(u) : null;
  if (!s || !s.ok || s.soon || s.template) return '';
  return s.app ? 'Live app' : s.github ? 'Public code' : s.docs ? 'Docs' : s.spa ? 'Web app' : '';
}
function siteFetch(t) {
  const info = S.info.get(t.a);
  if (!info || info.pending) return;
  const u = MA.siteUrl(t, info);
  if (!u || S.site.has(u)) return;
  S.site.set(u, null);
  api(`/api/site?u=${encodeURIComponent(u)}&a=${t.a}`).then((d) => S.site.set(u, d)).catch(() => S.site.set(u, { ok: false, error: 'unreachable' }));
}
const igMom = (p) => 0.4 * p.short + 0.15 * p.accel + 0.25 * p.buying + 0.2 * p.volume;
// Full check. Returns { s, p, ph, rk, info } or a string saying what's still missing / failed.
function igCheck(t, p) {
  const rk = S.risk.get(t.a);
  if (!rk || rk.pending) return 'wait';
  if (rk.failed || rk.top10 == null) return 'norisk';
  const lim = igConcLim(t.mc);
  const il = igIns(t.mc);
  const com = igCommunity(t);
  if (!com && (rk.top10 >= lim || (rk.ins || 0) >= il.pct || (rk.insN || 0) > il.n || (rk.cre || 0) >= il.dev)) return 'conc';
  if (unloading(t)) return 'dump';
  if (!com && (rk.graph || 0) >= 25) return 'conc';
  if (rk.risks?.some((x) => /rugged/i.test(x.n))) return 'rug';
  if (youngRisk(t)) return 'young';
  const curve = t.f.some((x) => x.k === 'curve');
  if (!curve && rk.lp != null && rk.lp < 50) return 'lp';
  const run = IG.run.get(t.a);
  if (!run || run.pending) return 'wait';
  const ph = igPhase(t, p, run);
  if (!ph || !ph.m) return 'phase';
  const info = S.info.get(t.a);
  if (!info || info.pending) return 'wait';
  const desc = String(info.desc || '').trim();
  if (info.failed || !(info.website || info.twitter)) return 'desc';
  if (desc.length < 20 && !(info.website && info.twitter)) return 'desc';
  const conc = clamp01((lim - rk.top10) / 15);
  const spread = 1 - Math.exp(-(info.holders || t.hold || 0) / 500);
  const insF = 1 - Math.min(rk.ins || 0, il.pct) / (il.pct * 2);
  const qual = 0.4 * p.organic + 0.25 * spread + 0.2 * conc + 0.15 * insF;
  // Soft cap so the very best spread out instead of all reading 99.
  const prod = productOf(t);
  const raw = 100 * igMom(p) * (0.55 + 0.45 * qual) * igZone(t.mc) * ph.m * (prod ? 1.15 : 1);
  const bz = buzzOf(t);
  if (bz.s < BUZZ_MIN) return 'buzz';
  const s = 100 * (1 - Math.exp(-(raw * (0.7 + 0.6 * bz.s / 100)) / 60));
  return { s, p, ph, rk, info, desc, bz, prod, com };
}
const SMALL_MC = 100e3, SMALL_MAX = 3;
// Overall quality for the Running part of the board: the heat score (short-term price, buying,
// organic activity, volume) blended with the measured 15-minute gain, then adjusted for safety,
// how many holders it has and its size.
function runScore(t) {
  const g = gradeOf(t), h = heatOf(t), m = mv15(t);
  const gain = 100 * (m > 0 ? 1 - Math.exp(-m / 40) : 0);
  const hold = S.info.get(t.a)?.holders || t.hold || 0;
  const safe = g === 'green' ? (isOrganic(t) ? 1.12 : 1) : g === 'amber' ? 0.85 : 0.6;
  const com = igCommunity(t) ? 1.1 : 1;
  const size = t.mc < SMALL_MC ? 0.8 : 1;
  return (0.55 * h + 0.45 * gain) * safe * com * size * (0.8 + 0.2 * (1 - Math.exp(-hold / 1500)));
}
// A coin already on the board stays unless something serious changes: a hard rug signal, it stops
// trading, selling takes over, or bot trading.
function keepWhy(t) {
  const hb = hardBlock(t);
  if (hb) return hb;
  const p = MH.parts(t, gradeOf(t));
  if (p.dead || p.stale) return 'stopped trading';
  if (p.dumping) return 'selling took over';
  if (p.bot || p.botChurn) return 'bot trading';
  if (mv15(t) < -8) return 'falling';
  if ((t.c.m5 || 0) < -20) return 'crashing';
  if (smallRisk(t)) return smallRisk(t);
  return '';
}
// The coin's current move, in plain words: Igniting, Running, Recovering (rebound), or Cooling.
function stageOf(t) {
  const st = MH.stage(t);
  if (st.l) return st;
  const m5 = t.c.m5 || 0, h1 = t.c.h1 || 0, m = mv15(t);
  if (h1 < -5 && m5 > 2) return { k: 'rec', l: 'Rebound' };
  if (m > 5 && m5 > 3) return { k: 'ign', l: 'Igniting' };
  if (m > 0 || h1 > 5) return { k: 'run', l: 'Running' };
  return { k: 'cool', l: 'Cooling' };
}
// Running now: fills the Top 10 under the Igniting coins. Anything moving up over the last 15 minutes
// with real volume and no hard rug signal, whatever its safety grade (the grade is shown on the row).
// Red-flag coins need to be at least a day old.
// Small, young coins are where rugs live, so Running now holds them to a stricter bar: an hour old,
// Clean, real liquidity, socials and some community attention. Anything that fails waits for the
// fully vetted Igniting check instead.
const WAIT_RISK = 'Checking dev history and insider wallets';
// Any coin under an hour old, at any size, in any part of the Top 10. Under 30 minutes: never.
// 30 to 60 minutes: only if truly clean (Organic: no insiders, no bots, dev holds little, LP locked),
// no linked-wallet network, the dev isn't a repeat launcher, and it has a working product or real attention.
function youngRisk(t) {
  const age = t.age ? Date.now() - t.age : 0;
  if (age >= 60 * 60e3) return '';
  if (age < 30 * 60e3) return 'Less than 30 minutes old';
  const rk = S.risk.get(t.a);
  if (!rk || rk.pending || rk.failed) return WAIT_RISK;
  const devN = Math.max(t.devM || 0, rk.devN || 0);
  if (!isOrganic(t) || (rk.graph || 0) > 0 || devN >= 2) return 'Under an hour old and not fully clean (insiders, bots or a repeat dev)';
  if (!productOf(t) && buzzOf(t).s < BUZZ_MIN) return 'Under an hour old with no working product or real attention yet';
  return '';
}
function smallRisk(t) {
  const yr = youngRisk(t);
  if (yr) return yr;
  if (t.mc >= SMALL_MC) return '';
  if (gradeOf(t) !== 'green') return 'Under $100K and not Clean';
  if (t.liq && t.liq < t.mc * 0.08) return 'Under $100K with thin liquidity';
  if (!(t.soc || []).length && !(t.web || []).length) return 'Under $100K with no website or socials';
  if (buzzOf(t).s < 10) return 'Under $100K with no community attention (Buzz under 10)';
  return '';
}
function runWhy(t) {
  const hb = hardBlock(t);
  if (hb) return hb;
  const sr = smallRisk(t);
  if (sr) return sr;
  const rk = S.risk.get(t.a);
  if (t.mc < 500e3 && !igCommunity(t) && (!rk || rk.pending || rk.failed)) return WAIT_RISK;
  if ((t.c.m5 || 0) < -20) return 'Crashing right now';
  const g = gradeOf(t);
  if (g === 'red' && !(t.age && Date.now() - t.age >= 24 * 3600e3)) return 'Red safety flags on a coin less than a day old';
  const p = MH.parts(t, g);
  if (p.dead || p.stale) return 'Barely trading right now';
  if (p.bot || p.botChurn) return 'Looks like bot trading';
  if (p.dumping) return 'Selling is winning right now';
  if ((t.v.m5 || 0) < Math.max(1000, t.mc * 0.003)) return 'Not enough volume in the last 5 minutes';
  if (!(mv15(t) > 1)) return 'Not up over the last 15 minutes';
  return '';
}
// Plain-English Top 10 status for the coin page.
function topStatus(t) {
  const i = IG.listed.findIndex((x) => x[0].a === t.a);
  if (i >= 0) return { on: true, txt: `#${i + 1} in the Top 10 · Igniting` };
  const j = IG.fill.findIndex((x) => x.a === t.a);
  if (j >= 0) return { on: true, txt: `#${IG.listed.length + j + 1} in the Top 10 · Running now` };
  const out = {}, p = igPre(t, out);
  let w = out.why;
  if (p) { const r = igCheck(t, p); w = typeof r === 'string' ? IG_WHY[r] || r : 'Passes every check; waiting for a second confirmation or outranked by ten others'; }
  const rw = runWhy(t);
  return { on: false, txt: 'Not in the Top 10', a: 'Igniting: ' + w + '.', b: 'Running now: ' + (rw || 'qualifies, but ten other coins are moving faster') + '.' };
}
window.HCIgWhy = (a) => { const t = S.tokens.get(a); return t ? topStatus(t) : 'not tracked'; };
// Run histories are fetched through a small queue (3 at a time) so every shortlisted coin is ready
// by the next 10-second refresh without hammering the rate-limited chart source.
const igQ = [];
function igPump() {
  while (IG.fetching < 3 && igQ.length) {
    const a = igQ.shift(), t = S.tokens.get(a);
    if (!t) continue;
    const r = IG.run.get(a);
    IG.fetching++;
    IG.run.set(a, { ...(r || {}), pending: !(r && r.n), at: Date.now() });
    api(`/api/runup?a=${a}&pool=${t.pair || ''}`)
      .then((d) => IG.run.set(a, d.error ? { failed: true, at: Date.now() } : { ...d, at: Date.now() }))
      .catch(() => IG.run.set(a, { failed: true, at: Date.now() - 180e3 }))
      .finally(() => { IG.fetching--; igPump(); });
  }
}
function igFetch(list) {
  for (const t of list) {
    if (!S.risk.has(t.a) && !riskQ.includes(t.a)) riskQ.unshift(t.a);
    const r = IG.run.get(t.a);
    const stale = !r || (!r.pending && Date.now() - r.at > 240e3);
    if (stale && !igQ.includes(t.a)) igQ.push(t.a);
    if (!S.info.has(t.a)) {
      S.info.set(t.a, { pending: true });
      api('/api/info?a=' + t.a).then((d) => S.info.set(t.a, d)).catch(() => S.info.set(t.a, { failed: true }));
    }
  }
  igPump();
  pumpRisk();
  list.forEach(siteFetch);
}
// Running coins only need the safety report and profile (no chart history, which is rate limited).
function fillFetch(list) {
  for (const t of list) {
    if (!S.risk.has(t.a) && !riskQ.includes(t.a)) riskQ.unshift(t.a);
    if (!S.info.has(t.a)) { S.info.set(t.a, { pending: true }); api('/api/info?a=' + t.a).then((d) => S.info.set(t.a, d)).catch(() => S.info.set(t.a, { failed: true })); }
    siteFetch(t);
  }
  pumpRisk();
}
function igTick() {
  const now = Date.now();
  if (now - IG.at < IG_MS - 500) return;
  IG.at = now;
  const pre = [];
  for (const t of S.tokens.values()) { const p = igPre(t); if (p) pre.push([t, p, igMom(p) * igZone(t.mc)]); }
  pre.sort((a, b) => b[2] - a[2]);
  const short = pre.slice(0, 16);
  igFetch(short.map((x) => x[0]));
  IG.scanned = S.tokens.size;
  const ok = new Map();
  for (const [t, p] of short) { const r = igCheck(t, p); if (typeof r === 'object') ok.set(t.a, r); }
  // Steady list, refreshed every 15 seconds: a coin needs two passing checks in a row to list, and
  // one missed check doesn't drop it, so the list doesn't flicker on a noisy tick.
  const rows = [];
  for (const [a, r] of ok) {
    const sn = IG.seen.get(a) || { hits: 0 };
    sn.hits++; sn.last = now; sn.r = r; IG.seen.set(a, sn);
  }
  for (const [a, sn] of IG.seen) {
    if (!ok.has(a)) { sn.hits = Math.min(sn.hits, 1); if (now - sn.last > 35e3) { IG.seen.delete(a); continue; } }
    const t = S.tokens.get(a);
    if (!t || !(sn.hits >= 2 || (sn.listed && now - sn.last <= 35e3))) continue;
    rows.push([t, sn]);
  }
  rows.sort((x, y) => y[1].r.s - x[1].r.s);
  // Small caps (under $100K) run often but would crowd the board, so at most 3 are on it at a time.
  const small = (t) => t.mc < SMALL_MC;
  let nSmall = 0;
  IG.listed = [];
  for (const row of rows) { if (IG.listed.length >= 10) break; if (small(row[0])) { if (nSmall >= SMALL_MAX) continue; nSmall++; } IG.listed.push(row); }
  // Fill the rest of the ten with the best coins that are running, by overall quality (runScore).
  // The board is sticky: a coin that's on it stays while it still qualifies and keeps a fair rank
  // (it gets a 30% edge over newcomers, and holds at least 3 minutes), so the ten shift around
  // instead of turning over every refresh.
  const have = new Set(IG.listed.map((x) => x[0].a));
  const cand = [], waitRisk = [];
  for (const t of S.tokens.values()) {
    if (have.has(t.a)) continue;
    const on = IG.fillSince.has(t.a);
    const why = on ? keepWhy(t) : runWhy(t);
    if (why === WAIT_RISK) { waitRisk.push(t); continue; }
    if (why) continue;
    const held = on ? now - IG.fillSince.get(t.a) : 0;
    cand.push([t, runScore(t) * (on ? 1.3 : 1) + (on && held < 180e3 ? 1000 : 0)]); // keepWhy above already dropped any coin that's crashing
  }
  cand.sort((x, y) => y[1] - x[1]);
  IG.fill = [];
  for (const [t] of cand) {
    if (IG.listed.length + IG.fill.length >= 10) break;
    if (small(t)) { if (nSmall >= SMALL_MAX) continue; nSmall++; }
    IG.fill.push(t);
  }
  // Show the fill in order of quality (the 3-minute hold only decides who stays, not the order).
  IG.fill.sort((x, y) => runScore(y) - runScore(x));
  const keepSet = new Set(IG.fill.map((t) => t.a));
  for (const a of [...IG.fillSince.keys()]) if (!keepSet.has(a)) IG.fillSince.delete(a);
  for (const t of IG.fill) if (!IG.fillSince.has(t.a)) IG.fillSince.set(t.a, now);
  fillFetch(IG.fill);
  // Fetch safety reports for the best coins still waiting on one, so they can qualify next refresh.
  waitRisk.sort((x, y) => runScore(y) - runScore(x));
  for (const t of waitRisk.slice(0, 6)) if (!S.risk.has(t.a) && !riskQ.includes(t.a)) riskQ.push(t.a);
  pumpRisk();
  window.__igN = IG.listed.length + IG.fill.length;
  let dirty = false;
  for (const [t, sn] of IG.listed) {
    sn.listed = true;
    const L = IG.log[t.a];
    if (!L) { IG.log[t.a] = { p0: t.p, mc0: t.mc, t0: now, s: t.s, hi: t.p, hi4: t.p }; dirty = true; }
    else if (t.p > L.hi) { L.hi = t.p; dirty = true; }
  }
  // Keep grading every call for its 4 hours, even after it drops off the list.
  for (const k in IG.log) {
    const L = IG.log[k], t = S.tokens.get(k);
    if (t && t.p && now - L.t0 < IG_WIN_MS && t.p > (L.hi4 || 0)) { L.hi4 = t.p; dirty = true; }
  }
  if (dirty) igSave();
  paintIgnite();
}
function paintIgnite() {
  const box = $('#igBody');
  if (!box) return;
  const total = IG.listed.length + IG.fill.length;
  $('#igCount').textContent = `${total} of 10` + (total ? ` · ${IG.listed.length} igniting` : '');
  const rec = igRecord(), recEl = $('#igRecord');
  if (recEl) recEl.textContent = rec.done || rec.open ? 'Calls seen on this device, last 48h: ' + (rec.done ? `${rec.wins} of ${rec.done} finished calls hit target` : 'none finished yet') + (rec.open ? ` · ${rec.open} still in their 4-hour window` : '') + '.' : '';
  if (!total) {
    setHTML(box, `<div class="igempty"><b>Nothing is running right now.</b><span>Watching ${IG.scanned} coins.</span></div>`);
    return;
  }
  const moves = (t) => { const c15 = chg15(t); return `<span class="igmv"><span class="${cls(t.c.m5)}">5m ${fmtMove(t.c.m5)}</span><span class="${cls(c15)}">15m ${c15 == null ? '—' : fmtMove(c15)}</span><span class="${cls(t.c.h1)}">1h ${fmtMove(t.c.h1)}</span></span>`; };
  // Safety tags first, in capitals (CLEAN, ORGANIC, CAUTION, HIGH RISK); the warning in normal text;
  // then holders, Buzz, product and age in yellow.
  const tags = (t, extra) => {
    const g = gradeOf(t), why = topWhy(t);
    const out = [`<i class="tag g-${g}">${g === 'green' ? 'CLEAN' : g === 'amber' ? 'CAUTION' : 'HIGH RISK'}</i>`];
    if (g === 'green' && isOrganic(t)) out.push('<i class="tag g-org">ORGANIC</i>');
    if (g !== 'green' && why) out.push(`<i class="warn g-${g}">${esc(why)}</i>`);
    if (igCommunity(t)) out.push('<i class="tag g-com">COMMUNITY</i>');
    const hold = S.info.get(t.a)?.holders || t.hold, prod = productOf(t);
    const y = [hold ? `${Math.round(hold).toLocaleString()} holders` : '', `Buzz ${buzzOf(t).s}`, prod, t.age ? `Age ${fmtAge(t.age)}` : ''].filter(Boolean);
    return out.join('') + y.map((c) => `<i class="yl">${esc(c)}</i>`).join('') + (extra || []).filter(Boolean).map((c) => `<i>${esc(c)}</i>`).join('');
  };
  const av = (t) => { const img = safeUrl(t.img); return img ? `<img src="${esc(img)}" alt="" loading="lazy">` : `<span class="ph">${esc((t.s || '?').slice(0, 2))}</span>`; };
  const heatBox = (t) => `<span class="igscore"><b>${Math.round(heatOf(t))}</b><small>heat</small></span>`;
  const fillHTML = (IG.fill.length ? `<div class="igdiv"><b>Running now</b><span>The best coins moving right now, by heat score, 15-minute gain, safety and holders. Check each label.</span></div>` : '') + IG.fill.map((t, i) => {
    const st = stageOf(t);
    return `<button class="igrow runrow" data-a="${esc(t.a)}">
      <span class="igrk">${IG.listed.length + i + 1}</span>
      <span class="igav">${av(t)}</span>
      <span class="igmain">
        <span class="igl1"><b>${esc(t.s)}</b><span class="igph ${st.k}">${st.l}</span><span class="igmc">${fmtUsd(t.mc)}</span></span>
        <span class="igchips">${tags(t, [t.os != null ? `Organic score ${t.os}` : ''])}</span>
      </span>
      <span class="igside">${heatBox(t)}${moves(t)}</span>
    </button>`;
  }).join('');
  setHTML(box, (IG.listed.length ? `<div class="igdiv first"><b>Igniting</b><span>At the start of a run and vetted for safety. Target: 3x in 4 hours under $100K, 2x at $100K+.</span></div>` : '') + IG.listed.map(([t, sn], i) => {
    const r = sn.r, L = IG.log[t.a];
    const since = L && L.p0 ? (t.p / L.p0 - 1) * 100 : null;
    const tg = L ? igTarget(L.mc0 || 0) : null;
    const left = L ? IG_WIN_MS - (Date.now() - L.t0) : 0;
    const bestX = L && L.p0 ? (L.hi4 || L.p0) / L.p0 : null;
    const goal = !L ? '' : bestX >= tg ? `Hit ${tg}x target` : left > 0 ? `Target ${tg}x · best ${bestX.toFixed(1)}x · ${left >= 3600e3 ? Math.floor(left / 3600e3) + 'h ' : ''}${Math.floor((left % 3600e3) / 60e3)}m left` : `Missed ${tg}x · best ${bestX.toFixed(1)}x`;
    return `<button class="igrow" data-a="${esc(t.a)}">
      <span class="igrk">${i + 1}</span>
      <span class="igav">${av(t)}</span>
      <span class="igmain">
        <span class="igl1"><b>${esc(t.s)}</b><span class="igph ${r.ph.k}">${IG_PH[r.ph.k]}</span><span class="igmc">${fmtUsd(t.mc)}</span></span>
        ${r.desc ? `<span class="igdesc">${esc(r.desc)}</span>` : ''}
        <span class="igchips">${tags(t, [`Top 10 hold ${Math.round(r.rk.top10)}%`, `Insiders ${(r.rk.ins || 0).toFixed(1)}%`, t.os != null ? `Organic score ${t.os}` : ''])}</span>
      </span>
      <span class="igside">
        ${heatBox(t)}
        ${moves(t)}
        <span class="igign">Ignition ${Math.round(r.s)}</span>
        ${since != null ? `<span class="igsince ${cls(since)}">${fmtPct(since)} since listed</span>` : ''}
        ${goal ? `<span class="iggoal${bestX >= tg ? ' hit' : ''}">${esc(goal)}</span>` : ''}
      </span>
    </button>`;
  }).join('') + fillHTML);
  box.querySelectorAll('img').forEach((im) => im.addEventListener('error', () => im.remove(), { once: true }));
}
$('#igBody').addEventListener('click', (e) => { const b = e.target.closest('.igrow'); if (b) openToken(b.dataset.a); });
setInterval(() => { if (!document.hidden && S.tokens.size) igTick(); }, IG_MS);
setTimeout(() => { IG.at = 0; igTick(); }, 4000);

// ---------- Community Takeovers ----------
// Coins the community took over (DexScreener CTO claims), newest claim first, because the earlier a
// takeover is known the better. Red-flag coins and takeovers that have gone quiet are left off.
// The page's safety filter and search still apply.
const CTO_MAX = 12;
const CT = { log: ctoLoad(), at: 0 };
function ctoLoad() { try { const o = JSON.parse(localStorage.getItem('hc_cto') || '{}'); const cut = Date.now() - 96 * 3600e3; for (const k in o) if (!(o[k].t0 > cut)) delete o[k]; return o; } catch { return {}; } }
function ctoList() {
  const out = [];
  for (const t of visibleTokens()) {
    if (!t.ct || !t.p) continue;
    if (gradeOf(t) === 'red') continue;
    if (!ctoBacked(t)) continue;
    out.push(t);
  }
  return out.sort((a, b) => a.ct.m - b.ct.m).slice(0, CTO_MAX);
}
// Real backing, not exit liquidity: enough volume for its size, more dollars buying than selling over
// the hour, more new buyers than sellers, holders growing, and not bleeding. A takeover where every
// buy gets sold into (price falling while buys come in) doesn't list.
function ctoBacked(t) {
  if (!(t.mc >= 25e3)) return false;
  // A real takeover happens after the dev walks away, not hours after launch. A claim within 24h of the
  // coin's creation is the dev (or their friends) buying a CTO badge as marketing.
  const claimAt = Date.now() - t.ct.m * 60e3;
  if (!t.age || claimAt - t.age < 24 * 3600e3) return false;
  // Safety report must be in: no big insider network, no serial launcher.
  const rk = S.risk.get(t.a);
  if (!rk || rk.pending || rk.failed) return false;
  if ((rk.graph || 0) >= 10 || (rk.devN || 0) >= 5 || (t.devM || 0) >= 5) return false;
  if ((t.v.h1 || 0) < Math.max(5000, t.mc * 0.03)) return false;
  if ((t.v.m5 || 0) < 300) return false;
  const bs = t.bs?.h1;
  if (bs) { if (!(bs[0] >= bs[1] * 1.1)) return false; }
  else if (!((t.tx?.h1?.b || 0) >= (t.tx?.h1?.s || 0) * 1.3)) return false;
  if (t.nb?.h1 != null && t.nb.h1 <= 0) return false;
  if (t.hc?.h1 != null && t.hc.h1 < 0) return false;
  if ((t.c.h1 ?? 0) <= -8) return false;
  if (unloading(t)) return false;
  if (buzzOf(t).s < BUZZ_MIN) return false;
  return true;
}
const ctoAge = (m) => (m < 60 ? Math.max(1, m) + 'm' : m < 1440 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : Math.floor(m / 1440) + 'd ' + Math.floor((m % 1440) / 60) + 'h');
function paintCto() {
  const box = $('#ctoBody');
  if (!box || !S.tokens.size) return;
  for (const t of S.tokens.values()) if (t.ct && !S.risk.has(t.a) && !riskQ.includes(t.a)) riskQ.unshift(t.a);
  pumpRisk();
  for (const t of S.tokens.values()) if (t.ct && !S.info.has(t.a)) { S.info.set(t.a, { pending: true }); api('/api/info?a=' + t.a).then((d) => S.info.set(t.a, d)).catch(() => S.info.set(t.a, { failed: true })); }
  const list = ctoList();
  // A footnote under the Top 10: good to know, not a pick.
  setHTML(box, `<b>Community takeovers</b>` + (list.length
    ? list.map((t) => `<button class="ctorow" data-a="${esc(t.a)}">${esc(t.s)} · ${fmtUsd(t.mc)} · claimed ${ctoAge(t.ct.m)} ago</button>`).join('')
    : `<span>None with real backing right now.</span>`) +
    `<small>From DexScreener's takeover claims, kept only if claimed 24h+ after launch, with real buying, under 10 linked insider wallets and no serial-launcher dev.</small>`);
}
$('#ctoBody').addEventListener('click', (e) => { const b = e.target.closest('.ctorow'); if (b) openToken(b.dataset.a); });
setInterval(() => { if (!document.hidden) paintCto(); }, 10000);

// ---------- Boot ----------
scan();
setInterval(scan, SCAN_MS);
setInterval(tickPrices, PRICE_MS);
setInterval(() => { if (!document.hidden) rowEls.forEach((el, k) => { const t = S.tokens.get(k.split('|')[1]); if (t) { const age = el.querySelector('.age'); const at = fmtAge(t.age); if (age._t !== at) { age.innerHTML = CLOCK + at; age._t = at; age.className = 'age ' + ageCls(t.age); } } }); }, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { scan(); if (openMint) refreshToken(); } });
if (location.hash) route();
})();
