# Heat Check

Real-time Solana meme coin rankings by market-cap tier, from the trenches to $1B+.
Live at https://inflection-gold.vercel.app

## How it's built

- Plain HTML/CSS/JS front end (no build step), hosted on Vercel.
- Serverless functions in `api/` (Node 22) pull free data:
  - **Jupiter** tokens API: price, market cap, volume, buys/sells, net buyers, organic score, top holders.
  - **DexScreener**: discovery, pairs, boosts and profiles.
  - **GeckoTerminal**: chart candles (rate limited, cached).
  - **RugCheck**: safety report, insider wallets.

## Key files

| File | What it does |
|---|---|
| `heat.js` | The heat score: price ladder (30s to 24h), net buying, organic growth, volume, clean, and safety gates |
| `api/_lib.js` | Shared data helpers, Jupiter overlay, red-flag rules and grading |
| `api/scan.js` | Coin discovery (Jupiter 5m/1h lists every 30–90s) and the main coin list |
| `api/risk.js` | RugCheck safety report with insider and creator holdings |
| `api/ohlcv.js` | Chart candles with cache and fallback |
| `ui.js` | Search, paste-a-contract, hottest-coins ticker |
| `net.js` | Request retries and safety-report capture |
| `app.js` | Main page: tiers, coin page, charts |

Not financial advice. Safety flags are automated signals, not guarantees.
