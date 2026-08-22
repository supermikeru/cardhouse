-- Карточный Дом — схема Supabase для турниров/рейтинга.
-- Выполнить целиком в SQL Editor Supabase (один проект, один прогон).
-- После этого в Storage создать публичный (на чтение) бакет "tournament-images"
-- через дашборд Supabase (Storage -> New bucket -> Public bucket = on).

create extension if not exists pgcrypto;

create table players (
  id                uuid primary key default gen_random_uuid(),
  telegram_user_id  bigint unique,
  telegram_username text,
  nickname          text not null,
  created_at        timestamptz not null default now()
);

create table rank_tiers (
  id bigint generated always as identity primary key,
  name text not null unique,
  min_points int not null,
  sort_order int not null
);
insert into rank_tiers (name, min_points, sort_order) values
  ('Rookie', 0, 0),
  ('Fish', 1000, 1),
  ('Grinder', 5000, 2),
  ('Silver', 10000, 3);
-- Пороги ориентировочные (выведены из прежних моковых данных мини-аппа).
-- Правятся в любой момент прямым UPDATE этой таблицы — на рендер влияет сразу.

create table seasons (
  id bigint generated always as identity primary key,
  name text not null,
  starts_on date not null,
  ends_on date,
  is_current boolean not null default false
);
create unique index one_current_season on seasons (is_current) where is_current;

create table tournaments (
  id bigint generated always as identity primary key,
  status text not null check (status in ('upcoming','past')) default 'upcoming',
  season_id bigint references seasons(id),
  is_special boolean not null default false,
  title text not null,
  subtitle text,
  starts_at timestamptz not null,
  image_url text,
  description text not null default '',
  rules text[] not null default '{}',
  seats_total int not null default 60,
  seats_taken int not null default 0,
  announced boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tournaments_status_idx on tournaments (status);
create index tournaments_season_idx on tournaments (season_id);

create table tournament_results (
  id bigint generated always as identity primary key,
  tournament_id bigint not null references tournaments(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  place int not null,
  points int not null default 0,
  bounty int not null default 0,
  notified boolean not null default false,
  unique (tournament_id, player_id)
);
create index tournament_results_player_idx on tournament_results (player_id);

create function rank_for_points(pts int) returns text
language sql stable as $$
  select name from rank_tiers where min_points <= pts order by min_points desc limit 1
$$;

-- Рейтинг — вычисляемые view поверх tournament_results, чтобы не держать
-- отдельную таблицу "текущих очков", которая может разойтись с историей.

create view v_rating_all as
select
  p.id as player_id, p.telegram_user_id, p.nickname,
  coalesce(s.points, 0)::int as points,
  coalesce(s.bounty, 0)::int as bounty,
  rank_for_points(coalesce(s.points, 0)::int) as rank,
  row_number() over (order by coalesce(s.points, 0) desc, p.id) as pos
from players p
left join (
  select tr.player_id, sum(tr.points) as points, sum(tr.bounty) as bounty
  from tournament_results tr
  join tournaments t on t.id = tr.tournament_id and t.is_special = false
  group by tr.player_id
) s on s.player_id = p.id;

create view v_rating_season as
select
  p.id as player_id, p.telegram_user_id, p.nickname,
  coalesce(s.points, 0)::int as points,
  coalesce(s.bounty, 0)::int as bounty,
  rank_for_points(coalesce(s.points, 0)::int) as rank,
  row_number() over (order by coalesce(s.points, 0) desc, p.id) as pos
from players p
left join (
  select tr.player_id, sum(tr.points) as points, sum(tr.bounty) as bounty
  from tournament_results tr
  join tournaments t on t.id = tr.tournament_id
    and t.is_special = false
    and t.season_id = (select id from seasons where is_current limit 1)
  group by tr.player_id
) s on s.player_id = p.id;

create view v_rating_special as
select
  p.id as player_id, p.telegram_user_id, p.nickname,
  coalesce(s.points, 0)::int as points,
  coalesce(s.bounty, 0)::int as bounty,
  rank_for_points(coalesce(s.points, 0)::int) as rank,
  row_number() over (order by coalesce(s.points, 0) desc, p.id) as pos
from players p
left join (
  select tr.player_id, sum(tr.points) as points, sum(tr.bounty) as bounty
  from tournament_results tr
  join tournaments t on t.id = tr.tournament_id and t.is_special = true
  group by tr.player_id
) s on s.player_id = p.id;

-- RLS: чтение открыто всем (мини-апп читает anon-ключом), запись — только
-- через service_role бота (он обходит RLS по умолчанию, поэтому write-политик
-- для anon/authenticated нет вообще — без них Postgres запрещает запись).
alter table players enable row level security;
alter table tournaments enable row level security;
alter table tournament_results enable row level security;
alter table seasons enable row level security;
alter table rank_tiers enable row level security;

create policy select_all on players for select using (true);
create policy select_all on tournaments for select using (true);
create policy select_all on tournament_results for select using (true);
create policy select_all on seasons for select using (true);
create policy select_all on rank_tiers for select using (true);

-- Стартовый сезон, чтобы v_rating_season сразу работал.
insert into seasons (name, starts_on, is_current) values ('Сезон 1', current_date, true);
