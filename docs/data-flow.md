# Data Flow

## Summary

The current data flow is generator-first.

The site does not rely only on live API calls. A major part of the frontend experience depends on generated artifacts written into `public/` by scripts in `bot/`.

## Main Flow

1. External data sources are fetched by `bot/` scripts and `api/` server-side helpers.
2. `bot/` scripts normalize, combine, and render outputs.
3. Generated outputs are written into `public/data/*`, `public/api/*`, and `public/report.html`.
4. Frontend pages in `public/` fetch and render those outputs.
5. Some pages also fetch live or semi-live data from route-shaped endpoints under `api/*` or from static API cache files under `public/api/*`.

## Frontend Data Consumption

### Homepage

`public/index.html` boots `public/js/main.js`.

That script consumes:

- `public/data/sample-game.json`
- `/api/mlb/mets/next-game`
- `/api/mlb/mets/live-game`
- `/api/mlb/mets/standings`
- `/api/mlb/mets/recent-games`
- `/api/mlb/mets/odds`

It then merges static generated data with fresher endpoint data for rendering.

### Stats Page

`public/advanced-stats.html` boots `public/js/advanced-stats.js`.

That script consumes:

- `api/mlb/mets/standings` or `api/mlb/mets/standings.json`
- `api/mlb/mets/overview` or `api/mlb/mets/overview.json`
- `public/data/sample-game.json`
- live external MLB/ESPN data in some fallback paths

### Betting History Page

`public/betting-history.html` consumes:

- `public/data/pick-history.json`

### News Page

`public/news.html` consumes:

- RSS feeds via a public RSS-to-JSON proxy

This is more browser-direct than the other pages.

### Report Page

`public/report.html` is itself a generated artifact, written by the bot pipeline.

## Serverless Endpoint Flow

Route files under `api/mlb/mets/*.js` are thin wrappers.

Their general flow is:

1. receive request
2. call shared builder in `api/_lib/mlb-data.js`
3. normalize/shape payload
4. respond with JSON and cache headers

These handlers are not the main place where product logic is distributed; they mostly expose normalized data.

## Bot Generation Flow

### `bot/generator.js`

Primary flow:

1. fetches source data
2. builds game facts
3. generates or falls back to writeup content
4. writes `public/data/sample-game.json`
5. writes `public/report.html`
6. updates related supporting outputs such as pick history and feed/sitemap outputs

### `bot/build-api-cache.js`

Primary flow:

1. fetches live provider data
2. normalizes it
3. writes static cache artifacts into `public/api/mlb/mets/*`

### `bot/refresh-pick-history.js`

Primary flow:

1. reads existing generated/supporting data
2. fetches schedule/results
3. rebuilds pick-history entries
4. writes `public/data/pick-history.json`

## Source of Truth by Area

### Hand-authored source

- `public/*.html` except generated report output
- `public/js/*`
- `public/css/styles.css`
- `api/*`
- `bot/*`
- `lib/*`

### Generated outputs

- `public/report.html`
- `public/data/sample-game.json`
- `public/data/pick-history.json`
- `public/api/mlb/mets/*`
- `public/api/mlb/mets/*.json`

## Workflow-Driven Flow

GitHub workflows run scheduled automation that:

- build API cache
- generate fresh game data
- refresh pick history
- build advanced-stats cache JSON
- verify data
- publish/deploy
- send reports

This means the repository’s live behavior depends not only on app code but also on recurring automation.

## Important Implications

- If UI output looks wrong, the correct fix may be in `bot/`, not `public/`.
- If endpoint data looks wrong, the correct fix may be in `api/_lib/` or `bot/build-api-cache.js`, depending on which runtime is serving the payload.
- If a generated artifact is wrong, hand-editing the artifact is usually temporary and should not be the default fix.

## Unclear Areas

It is unclear from the repository alone which environment is authoritative in production when both of these exist:

- a live route under `api/*`
- a generated static cache file under `public/api/*`

Future changes should preserve that uncertainty unless deployment behavior is explicitly confirmed.
