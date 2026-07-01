# CLAUDE.md — zz_StockWatch

Scheduled agent reference for the StockWatch daily dashboard.

## Your Job

You are a scheduled agent. Every run you must:
1. Read `watchlist.json` to get the user's ticker list.
2. Use WebSearch to look up each ticker: current price, daily % change, brief context.
3. Use WebSearch for top tech movers and top ETF movers today.
4. Select 3–5 curated picks with one-sentence reasoning each.
5. Write the result to `data/stocks.json` using the schema below.

## Output Schema

Write `data/stocks.json` with this exact shape:

```json
{
  "updated_at": "<ISO 8601 datetime, e.g. 2026-05-24T17:00:00Z>",
  "watchlist": [
    { "ticker": "AAPL", "name": "Apple Inc.", "price": 189.30, "change_pct": 1.2 }
  ],
  "sector_picks": [
    { "ticker": "QQQ", "name": "Invesco QQQ Trust", "price": 450.10, "change_pct": 0.8, "sector": "ETF" }
  ],
  "claude_picks": [
    {
      "ticker": "NVDA",
      "name": "NVIDIA Corp.",
      "price": 875.00,
      "change_pct": 3.4,
      "reasoning": "Strong AI chip demand continues; beat estimates last quarter."
    }
  ]
}
```

Rules:
- `change_pct`: positive = gain, negative = loss. No % sign, just the number.
- `price`: USD, two decimal places.
- `sector`: one of `"Tech"`, `"ETF"`, `"Energy"`, `"Finance"`, `"Health"`, or similar short label.
- `reasoning`: one sentence, max ~120 characters. Focus on *why it's notable today*.
- Always include all three arrays, even if empty.

## Serving the Page

The page uses `fetch('./data/stocks.json')` which requires an HTTP server (browsers block
fetch over `file://`). Easiest options:
- VS Code → right-click `index.html` → "Open with Live Server"
- Or run: `python -m http.server 8080` from this folder, then open http://localhost:8080

## Watchlist

Edit `watchlist.json` to keep your Revolut tickers up to date. Use uppercase symbols (e.g. `"TSLA"`, `"NVDA"`).

## Publishing

After writing `data/stocks.json`, always commit and push so GitHub Pages updates automatically:

```
git add data/stocks.json
git commit -m "chore: daily stock update YYYY-MM-DD"
git push
```

Live URL: https://runarstudio.github.io/stock-watch/

## Schedule

Runs daily at market close (~17:00 US Eastern). Configured via Claude Code `/schedule`.
