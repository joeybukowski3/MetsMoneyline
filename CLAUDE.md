# MetsMoneyline — Claude Code Instructions

## Bot-Generated Files

The files below are owned exclusively by scheduled GitHub Actions workflows.
**Never stage or commit them during code changes.**

| File | Updated by |
|------|-----------|
| `public/data/sample-game.json` | `report-send.yml` |
| `public/report.html` | `report-send.yml` |
| `bot/report-send-state.json` | `report-send.yml` |
| `public/api/mlb/mets/next-game` | `daily-update.yml` |
| `public/api/mlb/mets/live-game` | `daily-update.yml` |
| `public/api/mlb/mets/standings` | `daily-update.yml` |
| `public/api/mlb/mets/recent-games` | `daily-update.yml` |
| `public/api/mlb/mets/overview` | `daily-update.yml` |
| `public/api/mlb/mets/odds.json` | `daily-update.yml` |
| `public/data/odds-history.json` | `daily-update.yml` |
| `public/data/trends.json` | `daily-update.yml` |
| `public/data/prospects.json` | `daily-update.yml` |
| `public/rss.xml` | `x-post.yml` |

### Why this matters

Running `node bot/generator.js` locally without API credentials sets
`canonicalGameSource.source: "local/public-data"` in `sample-game.json`.
The live site's `shouldDiscardUntrustedCurrentDayCachedGame` logic discards
any game with a `local/` source, causing the homepage to show "No game today."

Only CI runs with `GROK_API_KEY`, `ODDS_API_KEY`, etc. produce valid `external/mlb-stats` data.

### Pre-commit hook

A pre-commit hook at `.githooks/pre-commit` blocks commits of `sample-game.json`
with a `local/` source. Activate it once per clone:

```bash
git config core.hooksPath .githooks
```

## Architecture Notes

- **GitHub Pages** deploys from `./public` via `.github/workflows/daily-build.yml`
- The cron schedule (`*/30 * * * *`) ensures bot-committed data (with `[skip ci]`) goes live within 30 minutes
- The `[skip ci]` tag in bot commits is intentional — bot data commits should not trigger a full Pages rebuild; the cron handles that
- `public/js/featured-game-state.js` — UMD module that resolves which game to feature; does not require a build step
