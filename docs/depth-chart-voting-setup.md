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
   - `public.depth_chart_toggle_vote`
   - `public.depth_chart_get_voter_votes`
5. Note:
   - `depth_chart_get_voter_votes` returns `vote_position` instead of `position` to avoid SQL parser conflicts in Supabase.

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
4. Click an upvote on one player.
5. Confirm the score increases by 1 and the page shows:
   - `Vote added.`
6. Click the same upvote again.
7. Confirm the score drops back and the page shows:
   - `Vote removed.`
8. Click the downvote for the same player.
9. Confirm the score changes by -1 and the page shows:
   - `Vote changed.`
10. Vote for another player at the same position.
11. Confirm it is allowed.

## How to test shared totals

1. Vote from browser/device A.
2. Open the same page from browser/device B.
3. Confirm the net/up/down totals reflect the first vote after refresh.
4. Confirm the field leader and mock lineup update after vote totals change.

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
4. To inspect one browser hash for the current day:
   ```sql
   select * from public.depth_chart_get_voter_votes('YOUR_HASH_HERE', current_date);
   ```

## Troubleshooting

### Missing config

If `public/js/depth-chart-config.js` is missing or invalid:

- the page still loads the base depth chart
- voting buttons are disabled
- write-ins are disabled
- the page shows:
  - `Live voting is temporarily unavailable. You can still view the depth chart.`

### RLS errors or missing RPC functions

If vote toggles fail with RLS-related or RPC-related errors:

1. Re-run `docs/depth-chart-supabase-setup.sql`
2. Confirm RLS is enabled on both tables
3. Confirm these functions exist:
   - `public.depth_chart_toggle_vote`
   - `public.depth_chart_get_voter_votes`
4. Confirm the anon grants exist for those functions

### Duplicate vote behavior

The unique index on:

- `(position, player_id, voter_hash, vote_day)`

allows one vote per player per browser hash per day.

The toggle function uses that unique row to:
- add a vote
- change it from upvote to downvote or vice versa
- remove it when the same vote is clicked again

### Duplicate write-in errors

The unique index on:

- `(position, player_id)`

prevents repeated submissions of the same write-in for the same position.

The page converts duplicate insert failures into:

- `This write-in has already been submitted.`

### Supabase unavailable

If Supabase is down or unreachable:

- the page still loads the base player list from `public/data/depth-chart.json`
- live vote totals fall back to the seeded baseline order
- voting and write-ins are disabled
- no fake shared totals are shown
- the field graphic still shows the current #1 baseline leader at each position
- the mock lineup still renders from displayed baseline upvotes

## Rebuilds

The weekly source rebuild still comes from:

- `bot/depth-chart-source.json`
- `bot/update-depth-chart.js`

That workflow updates the static player list and generated timestamp. Shared vote totals stay in Supabase and are not overwritten by the weekly JSON rebuild.
