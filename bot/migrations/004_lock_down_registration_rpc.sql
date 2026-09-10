-- Closes a real gap in migration 003: Postgres grants EXECUTE on newly
-- created functions to PUBLIC by default, which — via PostgREST's
-- /rest/v1/rpc/<fn> endpoint — let the mini app's public anon key call
-- register_for_tournament/unregister_from_tournament directly with any
-- tournament_id/player_id, bypassing the bot's Telegram-verified callback
-- entirely. Confirmed live: the anon key could invoke both functions
-- (HTTP 200); the anon role's missing UPDATE grant on tournaments happened
-- to make the row lock fail every time, but that's incidental, not a real
-- protection — a future privilege change could quietly remove it.
--
-- Run once in the Supabase SQL Editor, same as the earlier migrations.

revoke execute on function register_for_tournament(bigint, uuid) from public, anon, authenticated;
revoke execute on function unregister_from_tournament(bigint, uuid) from public, anon, authenticated;
grant execute on function register_for_tournament(bigint, uuid) to service_role;
grant execute on function unregister_from_tournament(bigint, uuid) to service_role;
