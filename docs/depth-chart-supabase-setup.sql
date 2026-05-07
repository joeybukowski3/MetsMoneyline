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

drop index if exists public.depth_chart_votes_one_per_position_day;
create unique index if not exists depth_chart_votes_one_per_player_day
on public.depth_chart_votes (position, player_id, voter_hash, vote_day);

create index if not exists depth_chart_votes_position_idx
on public.depth_chart_votes (position);

create index if not exists depth_chart_votes_player_idx
on public.depth_chart_votes (player_id);

create index if not exists depth_chart_votes_voter_hash_idx
on public.depth_chart_votes (voter_hash);

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
using (false);

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

create or replace function public.depth_chart_toggle_vote(
  p_position text,
  p_player_id text,
  p_vote_value integer,
  p_voter_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_vote public.depth_chart_votes%rowtype;
  normalized_position text := upper(trim(coalesce(p_position, '')));
  normalized_player_id text := trim(coalesce(p_player_id, ''));
  normalized_voter_hash text := trim(coalesce(p_voter_hash, ''));
begin
  if p_vote_value not in (-1, 1) then
    raise exception 'Invalid vote value';
  end if;

  if length(normalized_position) < 1 or length(normalized_position) > 20 then
    raise exception 'Invalid position';
  end if;

  if length(normalized_player_id) < 1 or length(normalized_player_id) > 120 then
    raise exception 'Invalid player id';
  end if;

  if length(normalized_voter_hash) < 20 or length(normalized_voter_hash) > 200 then
    raise exception 'Invalid voter hash';
  end if;

  select *
  into existing_vote
  from public.depth_chart_votes
  where position = normalized_position
    and player_id = normalized_player_id
    and voter_hash = normalized_voter_hash
    and vote_day = current_date
  limit 1;

  if found then
    if existing_vote.vote_value = p_vote_value then
      delete from public.depth_chart_votes
      where id = existing_vote.id;

      return jsonb_build_object(
        'action', 'removed',
        'position', normalized_position,
        'player_id', normalized_player_id,
        'vote_value', null
      );
    end if;

    update public.depth_chart_votes
    set vote_value = p_vote_value
    where id = existing_vote.id;

    return jsonb_build_object(
      'action', 'changed',
      'position', normalized_position,
      'player_id', normalized_player_id,
      'vote_value', p_vote_value
    );
  end if;

  insert into public.depth_chart_votes (position, player_id, vote_value, voter_hash)
  values (normalized_position, normalized_player_id, p_vote_value, normalized_voter_hash);

  return jsonb_build_object(
    'action', 'added',
    'position', normalized_position,
    'player_id', normalized_player_id,
    'vote_value', p_vote_value
  );
end;
$$;

drop function if exists public.depth_chart_get_voter_votes(text, date);
-- Use vote_position instead of position in the RPC return shape to avoid
-- parser/keyword conflicts in Supabase SQL Editor function declarations.
create or replace function public.depth_chart_get_voter_votes(
  p_voter_hash text,
  p_vote_day date default current_date
)
returns table (
  vote_position text,
  player_id text,
  vote_value integer,
  vote_day date
)
language sql
security definer
set search_path = public
as $$
  select
    v.position as vote_position,
    v.player_id,
    v.vote_value,
    v.vote_day
  from public.depth_chart_votes v
  where v.voter_hash = trim(coalesce(p_voter_hash, ''))
    and v.vote_day = coalesce(p_vote_day, current_date);
$$;

grant usage on schema public to anon;
grant select on public.depth_chart_vote_totals to anon;
grant insert, select on public.depth_chart_write_ins to anon;
grant execute on function public.depth_chart_toggle_vote(text, text, integer, text) to anon;
grant execute on function public.depth_chart_get_voter_votes(text, date) to anon;
