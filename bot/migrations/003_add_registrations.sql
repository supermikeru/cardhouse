-- Tournament registrations, created when a player taps "Записаться на игру"
-- on the bot's own announcement message (bot/handlers/registrations.py) —
-- a normal Telegram callback query, which Telegram itself already tells us
-- came from that exact player, so no extra identity check is needed here.
-- Run once in the Supabase SQL Editor, same as 001_init.sql / 002_add_player_avatars.sql.

create table tournament_registrations (
  id bigint generated always as identity primary key,
  tournament_id bigint not null references tournaments(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  reminded boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tournament_id, player_id)
);
create index tournament_registrations_player_idx on tournament_registrations (player_id);

alter table tournament_registrations enable row level security;
-- Read-only for anon (the mini app shows "Активные" from this) — same
-- pattern as every other table; writes only ever go through the two
-- functions below, called by the bot with the service-role key.
create policy select_all on tournament_registrations for select using (true);

-- SELECT ... FOR UPDATE locks the tournament row for the duration of the
-- check-then-insert-then-increment, so two players tapping "Записаться" on
-- the last seat at the same moment can't both get seated.

create or replace function register_for_tournament(p_tournament_id bigint, p_player_id uuid)
returns text
language plpgsql
as $$
declare
  v_seats_total int;
  v_seats_taken int;
begin
  select seats_total, seats_taken into v_seats_total, v_seats_taken
  from tournaments where id = p_tournament_id for update;

  if not found then
    return 'not_found';
  end if;

  if exists (select 1 from tournament_registrations where tournament_id = p_tournament_id and player_id = p_player_id) then
    return 'already_registered';
  end if;

  if v_seats_taken >= v_seats_total then
    return 'full';
  end if;

  insert into tournament_registrations (tournament_id, player_id) values (p_tournament_id, p_player_id);
  update tournaments set seats_taken = seats_taken + 1 where id = p_tournament_id;
  return 'ok';
end;
$$;

create or replace function unregister_from_tournament(p_tournament_id bigint, p_player_id uuid)
returns text
language plpgsql
as $$
begin
  if not exists (select 1 from tournament_registrations where tournament_id = p_tournament_id and player_id = p_player_id) then
    return 'not_registered';
  end if;
  delete from tournament_registrations where tournament_id = p_tournament_id and player_id = p_player_id;
  update tournaments set seats_taken = greatest(0, seats_taken - 1) where id = p_tournament_id;
  return 'ok';
end;
$$;
