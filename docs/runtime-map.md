# Runtime Map

## Overview

This repository has three distinct runtime contexts:

1. Browser runtime
2. Serverless Node runtime
3. Scheduled/offline Node runtime

They share data, but they are not the same system.

## 1. Browser Runtime

Location:

- `public/`

Purpose:

- Serve static pages
- Render game-day UI
- Render stats, history, and news pages
- Fetch JSON from static/generated data or API-like endpoints

Primary entrypoints:

- `public/index.html`
- `public/advanced-stats.html`
- `public/betting-history.html`
- `public/news.html`
- `public/report.html`

Primary scripts:

- `public/js/main.js`
- `public/js/advanced-stats.js`
- `public/js/site-header.js`
- `public/js/team-logo-helper.js`

Notes:

- Multi-page site
- No SPA router
- No React
- No bundler is present in the current repo

## 2. Serverless Node Runtime

Location:

- `api/`

Purpose:

- Return live or semi-live JSON payloads
- Hide provider-specific fetching and normalization behind thin handlers

Primary route entrypoints:

- `api/mlb/mets/live-game.js`
- `api/mlb/mets/next-game.js`
- `api/mlb/mets/odds.js`
- `api/mlb/mets/overview.js`
- `api/mlb/mets/recent-games.js`
- `api/mlb/mets/standings.js`

Shared implementation:

- `api/_lib/api-sports.js`
- `api/_lib/http.js`
- `api/_lib/mlb-data.js`
- `api/_lib/normalizers.js`
- `api/_lib/respond.js`

Notes:

- Handlers are intentionally thin
- Logic is mostly centralized in `_lib`
- Config is shaped for Vercel-style serverless execution

## 3. Scheduled/Offline Node Runtime

Location:

- `bot/`

Purpose:

- Generate reports and static data
- Build static API caches
- Refresh betting history
- Prepare/publish email/report artifacts
- Support scheduled automation in GitHub workflows

Primary script entrypoints:

- `bot/generator.js`
- `bot/build-api-cache.js`
- `bot/build-advanced-stats-json.js`
- `bot/refresh-pick-history.js`
- `bot/check-and-send-report.js`

Notes:

- `bot/` has its own `package.json`
- This is the main content-generation pipeline for the repo
- Many files written by the bot are consumed directly by the browser runtime

## Shared Files Across Boundaries

Shared helper:

- `lib/mlb-team-identity.js`

Consumed by browser runtime:

- `public/data/sample-game.json`
- `public/data/pick-history.json`
- `public/api/mlb/mets/*`

Produced by scheduled/offline runtime:

- `public/report.html`
- `public/data/*`
- `public/api/*`

Potentially mirrored by serverless runtime:

- `api/mlb/mets/*`

## Boundary Rules

- Browser code should not be treated as interchangeable with `bot/` code.
- `api/` handlers should remain thin unless there is a clear reason otherwise.
- Generated artifacts under `public/data/` and `public/api/` should not usually be hand-edited.
- Changes to one runtime should be checked for effects on the others.

## High-Risk Files by Runtime

Browser:

- `public/js/main.js`
- `public/js/advanced-stats.js`

Serverless:

- `api/_lib/mlb-data.js`

Scheduled/offline:

- `bot/generator.js`
- `bot/build-api-cache.js`
- `bot/check-and-send-report.js`

## Unclear Runtime Behavior

The exact precedence between:

- static cache files in `public/api/*`
- live handlers in `api/*`

is unclear from repository contents alone. Treat host behavior as environment-dependent unless confirmed.
