create extension if not exists pgcrypto;

create table if not exists public.depth_chart_votes (
  id uuid primary key default gen_random_uuid(),
  position text not null,
  player_id text not null,
  vote_value integer not null check (vote_value in (-1, 1)),
  voter_hash text not null,
  vote_day date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.depth_chart_write_ins (
  id uuid primary key default gen_random_uuid(),
  position text not null,
  player_name text not null,
  player_id text not null,
  submitted_by_hash text,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists depth_chart_votes_one_per_position_day
on public.depth_chart_votes (position, voter_hash, vote_day);

create index if not exists depth_chart_votes_position_idx
on public.depth_chart_votes (position);

create index if not exists depth_chart_votes_player_idx
on public.depth_chart_votes (player_id);

create index if not exists depth_chart_write_ins_position_idx
on public.depth_chart_write_ins (position);

create index if not exists depth_chart_write_ins_approved_idx
on public.depth_chart_write_ins (approved);

create unique index if not exists depth_chart_write_ins_unique_position_player
on public.depth_chart_write_ins (position, player_id);

create or replace view public.depth_chart_vote_totals as
select
  position,
  player_id,
  coalesce(sum(case when vote_value = 1 then 1 else 0 end), 0)::integer as upvotes,
  coalesce(sum(case when vote_value = -1 then 1 else 0 end), 0)::integer as downvotes,
  coalesce(sum(vote_value), 0)::integer as net_votes
from public.depth_chart_votes
group by position, player_id;

alter table public.depth_chart_votes enable row level security;
alter table public.depth_chart_write_ins enable row level security;

drop policy if exists "Public can insert depth chart votes" on public.depth_chart_votes;
create policy "Public can insert depth chart votes"
on public.depth_chart_votes
for insert
to anon
with check (
  vote_value in (-1, 1)
  and length(position) between 1 and 20
  and length(player_id) between 1 and 120
  and length(voter_hash) between 20 and 200
);

drop policy if exists "Public can read depth chart votes" on public.depth_chart_votes;
create policy "Public can read depth chart votes"
on public.depth_chart_votes
for select
to anon
using (true);

drop policy if exists "Public can insert depth chart write ins" on public.depth_chart_write_ins;
create policy "Public can insert depth chart write ins"
on public.depth_chart_write_ins
for insert
to anon
with check (
  approved = false
  and length(position) between 1 and 20
  and length(player_name) between 2 and 80
  and length(player_id) between 2 and 120
);

drop policy if exists "Public can read approved depth chart write ins" on public.depth_chart_write_ins;
create policy "Public can read approved depth chart write ins"
on public.depth_chart_write_ins
for select
to anon
using (approved = true);

grant usage on schema public to anon;
grant select, insert on public.depth_chart_votes to anon;
grant select, insert on public.depth_chart_write_ins to anon;
grant select on public.depth_chart_vote_totals to anon;
