-- Metroforge player stats. Run once in Supabase: SQL Editor → New query → paste → Run.
-- Players write only through report_city(); only the admin account can read.

create table if not exists public.cities (
  player_id   text not null,
  city_id     text not null,
  name        text not null default '',
  terrain     text not null default '',
  population  integer not null default 0,
  jobs        integer not null default 0,
  money       bigint not null default 0,
  game_day    double precision not null default 0,
  facilities  integer not null default 0,
  landmarks   integer not null default 0,
  lines       integer not null default 0,
  road_km     real not null default 0,
  happiness   integer not null default 0,
  play_seconds integer not null default 0,
  device      text not null default '',
  version     text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (player_id, city_id)
);

-- One row per report, for daily activity and growth over time
create table if not exists public.reports (
  id          bigint generated always as identity primary key,
  player_id   text not null,
  city_id     text not null,
  population  integer not null default 0,
  money       bigint not null default 0,
  at          timestamptz not null default now()
);
create index if not exists reports_at on public.reports (at);

alter table public.cities enable row level security;
alter table public.reports enable row level security;
revoke all on public.cities, public.reports from anon, authenticated;
grant select on public.cities, public.reports to authenticated;

-- Only signed-in accounts can read. Turn off sign-ups (Authentication → Sign In / Providers →
-- "Allow new users to sign up" off) and add your own account under Authentication → Users,
-- so you are the only one who can sign in.
drop policy if exists admin_read on public.cities;
create policy admin_read on public.cities for select to authenticated using (true);
drop policy if exists admin_read on public.reports;
create policy admin_read on public.reports for select to authenticated using (true);

-- The game calls this every few minutes; it can only write, never read other players' rows
create or replace function public.report_city(p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pid text := left(coalesce(p->>'player_id', ''), 64);
  cid text := left(coalesce(p->>'city_id', ''), 64);
begin
  if length(pid) < 8 or length(cid) < 4 then
    return;
  end if;
  insert into cities as c (player_id, city_id, name, terrain, population, jobs, money, game_day, facilities, landmarks,
                           lines, road_km, happiness, play_seconds, device, version, updated_at)
  values (pid, cid, left(coalesce(p->>'name', ''), 40), left(coalesce(p->>'terrain', ''), 20),
          least(greatest(coalesce((p->>'population')::integer, 0), 0), 100000000),
          least(greatest(coalesce((p->>'jobs')::integer, 0), 0), 100000000),
          least(greatest(coalesce((p->>'money')::bigint, 0), -1000000000000), 1000000000000),
          coalesce((p->>'game_day')::double precision, 0),
          least(coalesce((p->>'facilities')::integer, 0), 100000), least(coalesce((p->>'landmarks')::integer, 0), 100),
          least(coalesce((p->>'lines')::integer, 0), 100000), least(coalesce((p->>'road_km')::real, 0), 100000),
          least(greatest(coalesce((p->>'happiness')::integer, 0), 0), 100),
          least(coalesce((p->>'play_seconds')::integer, 0), 100000000),
          left(coalesce(p->>'device', ''), 10), left(coalesce(p->>'version', ''), 20), now())
  on conflict (player_id, city_id) do update set
    name = excluded.name, terrain = excluded.terrain, population = excluded.population, jobs = excluded.jobs,
    money = excluded.money, game_day = excluded.game_day, facilities = excluded.facilities, landmarks = excluded.landmarks,
    lines = excluded.lines, road_km = excluded.road_km, happiness = excluded.happiness,
    play_seconds = greatest(c.play_seconds, excluded.play_seconds), device = excluded.device,
    version = excluded.version, updated_at = now();
  insert into reports (player_id, city_id, population, money)
  values (pid, cid, (select population from cities where player_id = pid and city_id = cid),
          (select money from cities where player_id = pid and city_id = cid));
end;
$$;
revoke all on function public.report_city(jsonb) from public;
grant execute on function public.report_city(jsonb) to anon, authenticated;
