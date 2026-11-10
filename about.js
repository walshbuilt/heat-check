/* Momentum — coin explanations: what the coin is, why it exists, why it's moving,
 * and whether any utility claim is backed by evidence. Loaded before app.js. */
(function () {
  'use strict';

  // Theme → what the meme is riding, in plain words.
  var THEMES = [
    [/elon|musk|tesla|spacex|grok|x\.ai/, 'Elon / X', 'Elon Musk and X attention. These move when he posts or is in the news.'],
    [/trump|maga|biden|kamala|election|president|politic|congress|senate/, 'Political', 'politics and political figures. These trade on headlines and fade between news cycles.'],
    [/\bai\b|agent|gpt|llm|neural|robot|agi/, 'AI', 'the AI / AI-agent trend.'],
    [/\bdog\b|doge|shib|\binu\b|puppy|\bpup\b|\bwif\b/, 'Dog', 'the dog-coin narrative (DOGE, WIF, BONK), the oldest meme category.'],
    [/\bcat\b|kitty|kitten|meow|popcat|\bmew\b/, 'Cat', 'the cat-coin narrative (POPCAT, MEW).'],
    [/frog|pepe|toad|fwog/, 'Frog', 'Pepe and frog meme culture.'],
    [/penguin|pengu/, 'Penguin', 'the penguin meme (PENGU / Pudgy Penguins).'],
    [/monkey|\bape\b|chimp|gorilla|harambe/, 'Ape', 'ape and monkey memes.'],
    [/hippo|moodeng|squirrel|peanut|pnut|goat|hamster|\bbear\b|\bbull\b|fish|duck|capybara/, 'Animal', 'viral-animal memes (MOODENG, PNUT). Usually tied to a real animal that went viral.'],
    [/anime|waifu|manga/, 'Anime', 'anime culture.'],
    [/news|breaking|viral|tiktok|trend|today|just happened|meme of the day/, 'Current event', 'a news or viral moment. These fade fast once attention moves on.'],
    [/celebrity|rapper|singer|actor|kanye|drake|streamer|kick\.com|twitch|youtuber/, 'Celebrity / streamer', 'a celebrity or streamer and their audience.'],
    [/fart|poop|butt|toilet|retard|useless|nothing/, 'Absurd humor', 'absurd or self-aware humor (FARTCOIN, USELESS style).'],
  ];
  // Utility claims we can look for, and what they mean.
  var CLAIMS = [
    [/trading bot|sniper|telegram bot|copy[- ]?trad|\bbot\b/, 'trading bot'],
    [/ai agent|autonomous agent|\bagent\b/, 'AI agent'],
    [/\bgame\b|gaming|play[- ]to[- ]earn|\bp2e\b/, 'game'],
    [/staking|\bstake\b|yield|\bapy\b/, 'staking / yield'],
    [/launchpad|launch (coins|tokens|your|on)|token launch|bonding curve|\bdex\b|\bswap\b|exchange|bridge/, 'launchpad / exchange'],
    [/tokeni[sz]ed (stocks?|equit|commodit|assets?|shares)|stock tokens?|\brwa\b|real[- ]world assets?|pre-?ipo|xstocks?/, 'tokenized stocks / RWA'],
    [/platform|\bapp\b|dapp|protocol|dashboard|analytics|\btool\b|software/, 'app / platform'],
    [/\bnfts?\b/, 'NFTs'],
    [/revenue|buyback|profit share|dividend/, 'revenue share / buybacks'],
    [/\bdao\b|governance/, 'DAO / governance'],
  ];

  function siteUrl(t, info) {
    var u = (info && info.website) || (t.web || [])[0];
    return u && /^https?:\/\//i.test(u) && !/pump\.fun|dexscreener|x\.com|twitter\.com|t\.me/i.test(u) ? u : null;
  }

  function themesOf(t, info) {
    var text = (t.nm + ' ' + t.s + ' ' + ((info && info.desc) || '')).toLowerCase();
    return THEMES.filter(function (x) { return x[0].test(text); }).slice(0, 3);
  }
  function siteText(site) {
    if (!site || !site.ok) return '';
    return [site.title, site.desc, (site.heads || []).join(' '), site.docsTitle, (site.docsText || '').slice(0, 1200)].filter(Boolean).join(' ');
  }
  function claimsOf(info, site) {
    var text = (((info && info.desc) || '') + ' ' + siteText(site)).toLowerCase();
    var out = [];
    CLAIMS.forEach(function (c) { if (c[0].test(text) && out.indexOf(c[1]) < 0) out.push(c[1]); });
    return out;
  }

  function origin(t, info, h) {
    var out = [];
    var tw = [info && info.twitter].concat((t.soc || []).filter(function (s) { return /twitter|x\b/i.test(s.t); }).map(function (s) { return s.u; })).filter(Boolean);
    var post = tw.map(function (u) { return u.match(/(?:x|twitter)\.com\/([^/?#]+)\/status\/(\d+)/i); }).filter(Boolean)[0];
    var comm = tw.filter(function (u) { return /\/i\/communities\//i.test(u); })[0];
    var prof = tw.map(function (u) { return u.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/?(?:[?#].*)?$/i); }).filter(Boolean)[0];
    if (post) {
      var link = tw.filter(function (u) { return u.indexOf(post[2]) >= 0; })[0];
      out.push(/^elonmusk$/i.test(post[1])
        ? '<b>Born from an Elon Musk post on X.</b> <a href="' + h.esc(link) + '" target="_blank" rel="noopener">View the post</a>'
        : '<b>Launched off an X post</b> by @' + h.esc(post[1]) + '. <a href="' + h.esc(link) + '" target="_blank" rel="noopener">View the post</a>');
    }
    if (comm) out.push('Has an <b>X Community</b> for holders.');
    if (prof && !post) out.push('Official X account: <b>@' + h.esc(prof[1]) + '</b>.');
    if (!tw.length) out.push('<b>No X account linked</b>, so it is hard to verify who is behind it.');
    var text = (t.nm + ' ' + t.s + ' ' + ((info && info.desc) || '')).toLowerCase();
    if (/elon|musk/.test(text) && !post) out.push('References <b>Elon Musk</b> in its name or description.');
    if ((info && info.telegram) || (t.soc || []).some(function (s) { return /telegram/i.test(s.t); })) out.push('Has a Telegram group.');
    return out;
  }

  var usd = function (x) { var a = Math.abs(x); return '$' + (a >= 1e9 ? (x / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (x / 1e6).toFixed(2) + 'M' : a >= 1e3 ? (x / 1e3).toFixed(1) + 'K' : Math.round(x)); };
  // Data-backed reasons the coin is moving right now.
  function drivers(t, info, stage, h) {
    var out = [], so = t.so || {};
    if (stage && stage.k === 'ign') out.push('<b>Igniting:</b> volume and price just broke out of their normal range' + (stage.ago != null ? ' about ' + stage.ago + ' min ago' : '') + '.');
    if (stage && stage.k === 'rec') out.push('<b>Recovering:</b> bouncing after a hard drop, buyers defending a higher low.');
    if (stage && stage.k === 'run') out.push('<b>Running:</b> already moving with strong volume.');
    if (stage && stage.k === 'ext') out.push('<b>Extended:</b> already up a lot since the move began. Late entries carry more risk.');
    if (so.tg != null) out.push('Called in a tracked Telegram channel ' + so.tg + ' min ago.');
    if (so.b != null) out.push('Paid DexScreener boost ' + so.b + ' min ago. Someone is spending to promote it.');
    if (so.p != null) out.push('DexScreener profile updated ' + so.p + ' min ago. Often done right before a push.');
    if (so.c != null) out.push('Community takeover filed ' + so.c + ' min ago. The original dev left and holders took over.');
    var v24 = t.v && t.v.h24, mc = t.mc || 0;
    if (v24 && mc && v24 / mc >= 0.5) out.push('Traded ' + usd(v24) + ' in 24h, ' + Math.round(v24 / mc * 100) + '% of its market cap. Heavy, real interest.');
    if (t.c && t.c.h24 != null && Math.abs(t.c.h24) >= 30) out.push((t.c.h24 > 0 ? 'Up ' : 'Down ') + Math.round(Math.abs(t.c.h24)) + '% in 24h.');
    if (info && info.s24 && info.s24.holderChange != null && info.s24.holderChange > 3) out.push('Holders up ' + h.fmtPct(info.s24.holderChange) + ' in 24h: new people are buying in.');
    if (info && info.ct && info.ct.smart) out.push('Mentioned by ' + info.ct.smart + ' tracked crypto-Twitter accounts.');
    if (info && info.kingAt && Date.now() - info.kingAt < 6 * 3600e3) out.push('Hit pump.fun "King of the Hill" ' + h.ago(info.kingAt) + '.');
    if (info && info.graduated && t.age && Date.now() - t.age < 24 * 3600e3) out.push('Recently graduated from the pump.fun bonding curve to a full DEX pool.');
    return out;
  }

  // Score the evidence behind a utility claim.
  function proof(site, info, t) {
    var items = [], pts = 0;
    var add = function (ok, label, w) { items.push([ok, label]); if (ok) pts += w; };
    if (!site) return null;
    if (!site.ok) { items.push([false, 'Website did not load (' + (site.error || site.status || 'error') + ')']); return { items: items, pts: 0 }; }
    add(true, 'Website is live: ' + (site.title || site.host), 1);
    var appLike = /launch|trade|swap|stake|bridge|exchange|dashboard|app|bot/i.test((site.title || '') + ' ' + (site.desc || ''));
    if (site.spa && !site.template && !site.soon) add(true, 'Site is a working web app (it loads in your browser)', 1);
    else add(site.words > 250 && !site.template && !site.soon, site.soon ? 'Site says "coming soon"' : site.template ? 'Built from a one-page template (Carrd, Linktree, etc.)' : site.words > 250 ? 'Has real written content' : 'Very little content on the site', 1);
    add(!!site.docs, site.docs ? 'Has docs' + (site.docsText ? ' that explain how it works' : '') : 'No docs or whitepaper', 1);
    if (site.app) add(true, 'Links an app or bot you can try', 2);
    else if (site.spa && appLike) add(true, 'The website itself is the product (' + (site.title || site.host) + ')', 2);
    else add(false, 'No working app or bot linked', 2);
    if (site.gh && site.gh.ok && site.gh.repo) {
      var fresh = site.gh.pushed && Date.now() - Date.parse(site.gh.pushed) < 90 * 86400e3;
      add(true, 'GitHub repo: ' + (site.gh.stars || 0) + ' stars, last update ' + (site.gh.pushed ? site.gh.pushed.slice(0, 10) : 'unknown'), fresh ? 2 : 1);
    } else add(false, site.github ? 'GitHub linked but no public code found' : 'No GitHub / public code', 2);
    add(site.contract === true, site.contract ? 'Shows this exact contract address' : 'Does not show this contract address', 1);
    if (site.audit) add(true, 'Mentions an audit (verify it on the auditor\'s site)', 1);
    return { items: items, pts: pts };
  }

  function render(t, info, site, stage, h) {
    var desc = info && info.desc ? String(info.desc).trim() : '';
    var themes = themesOf(t, info);
    var claims = claimsOf(info, site);
    var url0 = siteUrl(t, info);
    var pr0 = claims.length && url0 && site ? proof(site, info, t) : null;
    var strong = pr0 && pr0.pts >= 6;
    var html = '<h4><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>About ' + h.esc(t.s) + '</h4>';

    // 1. What it is, with the reason.
    var kind = claims.length ? (strong ? 'Utility project: ' : 'Claims utility: ') + claims.join(', ') : 'Meme coin' + (themes.length ? ' · ' + themes[0][1] : '');
    html += '<div class="kind ' + (claims.length ? 'util' : 'meme') + '">' + h.esc(kind) + '</div>';
    var siteDesc = site && site.ok ? [site.title, site.desc].filter(Boolean).join(' — ') : '';
    if (desc) html += '<div class="quote">' + h.esc(desc.length > 420 ? desc.slice(0, 420) + '…' : desc) + '</div>';
    if (siteDesc && siteDesc.toLowerCase() !== desc.toLowerCase()) html += '<div class="quote"><span class="qsrc">From its website</span>' + h.esc(siteDesc.slice(0, 300)) + '</div>';
    if (site && site.docsText && claims.length) html += '<div class="quote"><span class="qsrc">From its docs</span>' + h.esc(site.docsText.slice(0, 380)) + '…</div>';
    if (!desc && !siteDesc) html += '<p class="muted">' + (!info ? 'Loading description…' : url0 && !site ? 'Reading its website…' : 'No description from the creator or a website.') + '</p>';
    if (info && info.categories && info.categories.length) themes = themes.concat(info.categories.map(function (c) { return [null, c, '']; })).slice(0, 4);

    var why, memeThemes = themes.filter(function (x) { return x[2]; });
    if (claims.length) why = strong
      ? 'It is the token of a working ' + claims.join(' / ') + ' project, not a joke coin. Price is driven by how much the product gets used and by attention on it.'
      : 'It presents itself as more than a meme: a ' + claims.join(' / ') + '. The evidence check below shows whether anything real backs that up.';
    else if (memeThemes.length) why = 'There is no product. Its value comes from ' + memeThemes.map(function (x) { return x[2]; }).join(' It also draws on ') + ' Price runs on attention, community and timing.';
    else if (desc || siteDesc) why = 'No product or clear meme theme was found beyond the description above. Price runs on attention and community.';
    else why = 'No description, no website text and no clear theme: the only reason given is the name itself. This is pure speculation.';
    html += '<p class="why"><b>Why it exists:</b> ' + h.esc(why) + '</p>';

    var og = origin(t, info, h);
    if (og.length) html += '<div class="sub2">Origin</div><ul class="bullets">' + og.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>';

    var dr = drivers(t, info, stage, h);
    html += '<div class="sub2">Why it\'s moving</div>' + (dr.length
      ? '<ul class="bullets">' + dr.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>'
      : '<p class="muted small">No clear catalyst in the data right now.</p>');

    // 2. Utility proof check.
    if (claims.length) {
      html += '<div class="sub2">Utility check</div>';
      var url = siteUrl(t, info);
      if (!url) html += '<div class="verdict bad"><b>Unproven.</b> No website to check. Treat it as a meme coin with a utility story.</div>';
      else if (!site) html += '<p class="muted small">Checking the website…</p>';
      else {
        var pr = pr0 || proof(site, info, t);
        var v = pr.pts >= 6 ? ['good', 'Evidence looks real.', 'Pieces of a real product exist. Still try it with a small amount before trusting it.']
          : pr.pts >= 3 ? ['mid', 'Partly backed.', 'Some pieces exist, but the product is not proven. Verify it works before buying for the utility.']
          : ['bad', 'Unproven.', 'Little or nothing backs the claim. Treat it as a meme coin with a utility story.'];
        html += '<div class="verdict ' + v[0] + '"><b>' + v[1] + '</b> ' + v[2] + '</div><ul class="checks">' +
          pr.items.map(function (x) { return '<li class="' + (x[0] ? 'ok' : 'no') + '">' + h.esc(x[1]) + '</li>'; }).join('') + '</ul>';
      }
    }

    // 3. Tags and basics.
    var tags = themes.map(function (x) { return '<span class="tag hot">' + h.esc(x[1]) + '</span>'; }).join('') +
      ((info && info.tags) || []).map(function (x) { return '<span class="tag">' + h.esc(String(x).replace(/-/g, ' ')) + '</span>'; }).join('');
    if (tags) html += '<div class="tags">' + tags + '</div>';
    var launch = (info && info.launchpad) || (/pump$/.test(t.a) ? 'pump.fun' : /bonk$/.test(t.a) ? 'LetsBonk' : null);
    html += '<div class="sub2">Basics</div><dl class="kv">' +
      '<dt>Chain</dt><dd>Solana</dd>' +
      (launch ? '<dt>Launched on</dt><dd>' + h.esc(launch) + (info && info.graduated === false ? ' · still on bonding curve' : info && info.graduated ? ' · graduated' : '') + '</dd>' : '') +
      '<dt>Trading on</dt><dd>' + h.esc(t.dex) + '</dd>' +
      (site && site.ok ? '<dt>Website</dt><dd>' + h.esc(site.host) + '</dd>' : '') +
      '<dt>Contract</dt><dd><span class="addr" data-copy="' + h.esc(t.a) + '" title="Copy">' + h.short(t.a) + ' ⧉</span></dd>' +
      '<dt>Pool</dt><dd><span class="addr" data-copy="' + h.esc(t.pair) + '" title="Copy">' + h.short(t.pair) + ' ⧉</span></dd>' +
      (info && info.creator ? '<dt>Creator</dt><dd><span class="addr" data-copy="' + h.esc(info.creator) + '" title="Copy">' + h.short(info.creator) + ' ⧉</span></dd>' : '') +
      '</dl>';
    return html;
  }

  window.MomentumAbout = { render: render, siteUrl: siteUrl };
})();
