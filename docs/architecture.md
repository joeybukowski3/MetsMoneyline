# Architecture

## Summary

This repository is a hybrid architecture with three main runtime areas:

- `public/` is the static multi-page frontend.
- `api/` contains thin Node/CommonJS serverless handlers.
- `bot/` contains the data, report, and publishing pipeline.

The frontend is plain HTML, CSS, and JavaScript. It is not a React app, not a Vite app, and not a client-side SPA. There is no client-side router. Pages are separate documents under `public/` with either page-specific scripts or inline scripts.

## Current Stack

- Frontend: static HTML + global CSS + vanilla browser JavaScript
- Backend endpoints: Node/CommonJS handlers under `api/`
- Content pipeline: Node scripts under `bot/`
- Deployment/config:
  - `vercel.json` for serverless function configuration
  - GitHub Actions workflows for regeneration, publishing, history refresh, and email/report automation

## Main Runtime Boundaries

### `public/`

Responsible for user-facing pages and client-consumed static assets.

Examples:

- `public/index.html`
- `public/advanced-stats.html`
- `public/betting-history.html`
- `public/news.html`
- `public/report.html`
- `public/css/styles.css`
- `public/js/main.js`
- `public/js/advanced-stats.js`
- `public/js/site-header.js`

### `api/`

Responsible for thin serverless route handlers that return JSON.

Route files delegate most logic to `api/_lib/`.

Examples:

- `api/mlb/mets/next-game.js`
- `api/mlb/mets/live-game.js`
- `api/mlb/mets/odds.js`
- `api/mlb/mets/overview.js`
- `api/mlb/mets/recent-games.js`
- `api/mlb/mets/standings.js`

### `bot/`

Responsible for data aggregation, report generation, cache generation, publishing support, and scheduled automation.

Examples:

- `bot/generator.js`
- `bot/build-api-cache.js`
- `bot/build-advanced-stats-json.js`
- `bot/refresh-pick-history.js`
- `bot/check-and-send-report.js`

## Project Shape

The repo is organized first by runtime boundary, then by route/task/type inside each boundary.

This is not primarily folder-by-feature and not purely folder-by-file-type. It is a mixed structure with a strong runtime split:

- frontend assets in `public/`
- server handlers in `api/`
- offline/scheduled generation in `bot/`

## Bootstrapping and Entrypoints

Frontend bootstrapping starts from page HTML files in `public/`.

Key page/script relationships:

- `public/index.html` -> `public/js/main.js`
- `public/advanced-stats.html` -> `public/js/advanced-stats.js`
- `public/betting-history.html` -> inline script fetching `public/data/pick-history.json`
- `public/news.html` -> inline script fetching RSS feeds through a public proxy
- shared nav/header behavior -> `public/js/site-header.js`

Backend bootstrapping starts at each `api/mlb/mets/*.js` handler, which delegates into `api/_lib/mlb-data.js` and helpers.

Pipeline bootstrapping starts from Node scripts in `bot/`, especially `bot/generator.js`.

## Routing and Navigation

Frontend navigation is document-based:

- links point directly to `/`, `/report.html`, `/advanced-stats.html`, `/betting-history.html`, and `/news.html`
- `public/js/site-header.js` injects the shared header/nav

There is no frontend route table and no SPA navigation layer.

Backend routing is file-based under `api/`, consistent with Vercel-style serverless routes.

## Where Logic Lives

### Frontend logic

- homepage/game-day rendering: `public/js/main.js`
- stats page rendering: `public/js/advanced-stats.js`
- shared nav: `public/js/site-header.js`
- team logo helpers: `public/js/team-logo-helper.js`

### Server-side endpoint logic

- handler entrypoints: `api/mlb/mets/*.js`
- shared API logic: `api/_lib/*.js`

### Shared non-runtime-specific logic

- team identity mapping: `lib/mlb-team-identity.js`

### Generation and publishing logic

- report/data generation: `bot/generator.js`
- API cache generation: `bot/build-api-cache.js`
- pick history generation: `bot/refresh-pick-history.js`
- send/report automation: `bot/check-and-send-report.js`

## Styling

Most styling lives in `public/css/styles.css`.

Some pages also include page-local `<style>` blocks inside their HTML. This means styling is mostly centralized, but not fully centralized.

## Data Sources and Data Access

The current codebase uses a mix of:

- static generated JSON in `public/data/*`
- generated API cache files in `public/api/*`
- live serverless JSON endpoints under `api/*`
- third-party APIs queried by server or bot code
- RSS feeds queried directly by browser code on the news page

## Generated Artifacts

Generated outputs are part of the current architecture and are consumed by the frontend directly.

Important generated outputs include:

- `public/report.html`
- `public/data/sample-game.json`
- `public/data/pick-history.json`
- `public/api/mlb/mets/*`
- `public/api/mlb/mets/*.json`

These are documented in `docs/generated-files.md`.

## Known Risks

Oversized mixed-responsibility files:

- `bot/generator.js`
- `public/js/main.js`
- `public/js/advanced-stats.js`

These files currently combine bootstrapping, transformation, fallback logic, rendering, and output behavior. They should be treated carefully even when making small changes.

## Unclear Areas

- Exact production host precedence between static `public/api/*` files and live `api/*` handlers is unclear from the repository alone.
- The repo clearly supports both GitHub Pages publishing and Vercel-style serverless configuration, but exact live deployment topology should be treated as partially uncertain unless confirmed.
