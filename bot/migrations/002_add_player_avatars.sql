-- Player avatars, fetched once from Telegram at registration and re-hosted
-- in Supabase Storage (see bot/avatars.py — never store the raw
-- api.telegram.org file URL, it embeds the bot token).
-- Run once in the Supabase SQL Editor, same as 001_init.sql.
-- Also create a public-read Storage bucket named "player-avatars"
-- (Storage -> New bucket -> Public bucket = on), same as "tournament-images".

alter table players add column if not exists avatar_url text;

-- avatar_url is appended at the end of each SELECT, not inserted alongside
-- nickname — CREATE OR REPLACE VIEW only allows adding new columns after
-- all existing ones; it errors if an existing column's position/name shifts.

create or replace view v_rating_all as
select
  p.id as player_id, p.telegram_user_id, p.nickname,
  coalesce(s.points, 0)::int as points,
  coalesce(s.bounty, 0)::int as bounty,
  rank_for_points(coalesce(s.points, 0)::int) as rank,
  row_number() over (order by coalesce(s.points, 0) desc, p.id) as pos,
  p.avatar_url
from players p
left join (
  select tr.player_id, sum(tr.points) as points, sum(tr.bounty) as bounty
  from tournament_results tr
  join tournaments t on t.id = tr.tournament_id and t.is_special = false
  group by tr.player_id
) s on s.player_id = p.id;

create or replace view v_rating_season as
select
  p.id as player_id, p.telegram_user_id, p.nickname,
  coalesce(s.points, 0)::int as points,
  coalesce(s.bounty, 0)::int as bounty,
  rank_for_points(coalesce(s.points, 0)::int) as rank,
  row_number() over (order by coalesce(s.points, 0) desc, p.id) as pos,
  p.avatar_url
from players p
left join (
  select tr.player_id, sum(tr.points) as points, sum(tr.bounty) as bounty
  from tournament_results tr
  join tournaments t on t.id = tr.tournament_id
    and t.is_special = false
    and t.season_id = (select id from seasons where is_current limit 1)
  group by tr.player_id
) s on s.player_id = p.id;

create or replace view v_rating_special as
select
  p.id as player_id, p.telegram_user_id, p.nickname,
  coalesce(s.points, 0)::int as points,
  coalesce(s.bounty, 0)::int as bounty,
  rank_for_points(coalesce(s.points, 0)::int) as rank,
  row_number() over (order by coalesce(s.points, 0) desc, p.id) as pos,
  p.avatar_url
from players p
left join (
  select tr.player_id, sum(tr.points) as points, sum(tr.bounty) as bounty
  from tournament_results tr
  join tournaments t on t.id = tr.tournament_id and t.is_special = true
  group by tr.player_id
) s on s.player_id = p.id;
