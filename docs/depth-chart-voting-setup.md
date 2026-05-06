# Depth Chart Voting Setup

## Overview

The Mets depth chart page loads its base player list from:

- `public/data/depth-chart.json`

Shared online voting is powered by Supabase from the browser with:

- `public/js/depth-chart-config.js`
- `public/js/depth-chart-live-voting.js`

No secret key or `service_role` key is used in the frontend.

## Supabase setup

1. Open your Supabase project.
2. Go to the SQL editor.
3. Run the SQL in:
   - `docs/depth-chart-supabase-setup.sql`
4. Confirm these objects exist:
   - `public.depth_chart_votes`
   - `public.depth_chart_write_ins`
   - `public.depth_chart_vote_totals`

## Public frontend config

The public browser config lives in:

- `public/js/depth-chart-config.js`

It must expose only:

- Project URL
- Publishable/Anon key

Do not put any of these in the repo or browser:

- `service_role`
- database password
- secret API keys

## Project URL note

If your copied Supabase URL includes `/rest/v1/`, that is okay. The depth chart page normalizes it before creating the client.

## How to test voting

1. Serve the site locally:
   ```powershell
   python -m http.server 8123 --directory public
   ```
2. Open:
   - `http://127.0.0.1:8123/depth-chart.html`
3. Confirm the page loads normally.
4. Click an upvote or downvote on one position.
5. Confirm the table updates and the success message appears.
6. Try to vote again on the same position from the same browser on the same day.
7. Confirm the page shows:
   - `You already voted for this position today.`

## How to test shared totals

1. Vote from browser/device A.
2. Open the same page from browser/device B.
3. Confirm the net/up/down totals reflect the first vote after refresh.

## How write-ins work

- Write-ins are inserted into `public.depth_chart_write_ins` with `approved = false`.
- Unapproved write-ins are not shown publicly.
- The page shows:
  - `Write-in submitted for review.`

## How to approve write-ins

1. Open Supabase Table Editor.
2. Open `depth_chart_write_ins`.
3. Find the row you want to approve.
4. Set:
   - `approved = true`
5. Refresh the public page.
6. The approved write-in can now appear in rankings for that position.

## How to confirm vote totals

In Supabase:

1. Open Table Editor or SQL editor.
2. Query:
   ```sql
   select * from public.depth_chart_vote_totals order by position, net_votes desc, player_id asc;
   ```
3. Confirm rows exist for voted players.

## Troubleshooting

### Missing config

If `public/js/depth-chart-config.js` is missing or invalid:

- the page still loads the base depth chart
- voting buttons are disabled
- write-ins are disabled
- the page shows:
  - `Live voting is temporarily unavailable. You can still view the depth chart.`

### RLS errors

If inserts/selects fail with RLS-related errors:

1. Re-run `docs/depth-chart-supabase-setup.sql`
2. Confirm RLS is enabled on both tables
3. Confirm the anon policies and grants exist

### Duplicate vote errors

The unique index on:

- `(position, voter_hash, vote_day)`

allows one vote per position per browser hash per day.

The page converts duplicate insert failures into:

- `You already voted for this position today.`

### Duplicate write-in errors

The unique index on:

- `(position, player_id)`

prevents repeated submissions of the same write-in for the same position.

The page converts duplicate insert failures into:

- `This write-in has already been submitted.`

### Supabase unavailable

If Supabase is down or unreachable:

- the page still loads the base player list from `public/data/depth-chart.json`
- live vote totals fall back to the base order
- voting and write-ins are disabled
- no fake shared totals are shown

## Rebuilds

The weekly source rebuild still comes from:

- `bot/depth-chart-source.json`
- `bot/update-depth-chart.js`

That workflow updates the static player list and generated timestamp. Shared vote totals stay in Supabase and are not overwritten by the weekly JSON rebuild.
