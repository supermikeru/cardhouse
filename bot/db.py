from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from supabase import Client, create_client

import config

_client: Optional[Client] = None


def client() -> Client:
    global _client
    if _client is None:
        _client = create_client(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY)
    return _client


# ---------- players ----------

def get_player_by_telegram_id(telegram_user_id: int) -> Optional[dict]:
    res = client().table("players").select("*").eq("telegram_user_id", telegram_user_id).execute()
    return res.data[0] if res.data else None


def find_player_by_nickname(nickname: str) -> Optional[dict]:
    res = client().table("players").select("*").ilike("nickname", nickname).execute()
    return res.data[0] if res.data else None


def get_or_create_player(telegram_user_id: int, telegram_username: str | None, display_name: str) -> dict:
    existing = get_player_by_telegram_id(telegram_user_id)
    if existing:
        return existing
    res = (
        client()
        .table("players")
        .insert({
            "telegram_user_id": telegram_user_id,
            "telegram_username": telegram_username,
            "nickname": display_name,
        })
        .execute()
    )
    return res.data[0]


def create_player(nickname: str, telegram_user_id: int | None = None, telegram_username: str | None = None) -> dict:
    res = (
        client()
        .table("players")
        .insert({
            "nickname": nickname,
            "telegram_user_id": telegram_user_id,
            "telegram_username": telegram_username,
        })
        .execute()
    )
    return res.data[0]


def list_players() -> list[dict]:
    res = client().table("players").select("*").order("nickname").execute()
    return res.data


def rename_player(player_id: str, new_nickname: str) -> None:
    client().table("players").update({"nickname": new_nickname}).eq("id", player_id).execute()


def delete_player(player_id: str) -> None:
    client().table("players").delete().eq("id", player_id).execute()


def list_players_with_telegram() -> list[dict]:
    """Players who can actually receive a bot DM (used for broadcasts)."""
    res = client().table("players").select("*").not_.is_("telegram_user_id", "null").execute()
    return res.data


def set_player_avatar(player_id: str, avatar_url: str) -> None:
    client().table("players").update({"avatar_url": avatar_url}).eq("id", player_id).execute()


def upload_player_avatar(file_bytes: bytes, content_type: str = "image/jpeg") -> str:
    path = f"{uuid.uuid4().hex}.jpg"
    client().storage.from_(config.PLAYER_AVATARS_BUCKET).upload(
        path, file_bytes, {"content-type": content_type}
    )
    return client().storage.from_(config.PLAYER_AVATARS_BUCKET).get_public_url(path)


# ---------- seasons ----------

def get_current_season() -> Optional[dict]:
    res = client().table("seasons").select("*").eq("is_current", True).execute()
    return res.data[0] if res.data else None


def start_new_season(name: str, starts_on: str) -> dict:
    client().table("seasons").update({"is_current": False}).eq("is_current", True).execute()
    res = client().table("seasons").insert({"name": name, "starts_on": starts_on, "is_current": True}).execute()
    return res.data[0]


# ---------- tournaments ----------

def list_tournaments(status: str | None = None) -> list[dict]:
    q = client().table("tournaments").select("*").order("starts_at")
    if status:
        q = q.eq("status", status)
    return q.execute().data


def get_tournament(tournament_id: int) -> Optional[dict]:
    res = client().table("tournaments").select("*").eq("id", tournament_id).execute()
    return res.data[0] if res.data else None


def create_tournament(fields: dict) -> dict:
    res = client().table("tournaments").insert(fields).execute()
    return res.data[0]


def update_tournament(tournament_id: int, fields: dict) -> None:
    client().table("tournaments").update(fields).eq("id", tournament_id).execute()


def delete_tournament(tournament_id: int) -> None:
    client().table("tournaments").delete().eq("id", tournament_id).execute()


def mark_tournament_finished(tournament_id: int) -> None:
    client().table("tournaments").update({"status": "past"}).eq("id", tournament_id).execute()


def mark_tournament_announced(tournament_id: int) -> None:
    client().table("tournaments").update({"announced": True}).eq("id", tournament_id).execute()


# ---------- storage (tournament images) ----------

def upload_tournament_image(file_bytes: bytes, content_type: str = "image/jpeg") -> str:
    path = f"{uuid.uuid4().hex}.jpg"
    client().storage.from_(config.TOURNAMENT_IMAGES_BUCKET).upload(
        path, file_bytes, {"content-type": content_type}
    )
    return client().storage.from_(config.TOURNAMENT_IMAGES_BUCKET).get_public_url(path)


# ---------- tournament results ----------

def upsert_results(tournament_id: int, rows: list[dict]) -> None:
    """rows: [{player_id, place, points, bounty}, ...]"""
    payload = [
        {
            "tournament_id": tournament_id,
            "player_id": r["player_id"],
            "place": r["place"],
            "points": r.get("points", 0),
            "bounty": r.get("bounty", 0),
        }
        for r in rows
    ]
    if payload:
        client().table("tournament_results").upsert(payload, on_conflict="tournament_id,player_id").execute()


def get_unnotified_results(tournament_id: int) -> list[dict]:
    res = (
        client()
        .table("tournament_results")
        .select("*, players(*)")
        .eq("tournament_id", tournament_id)
        .eq("notified", False)
        .execute()
    )
    return res.data


# ---------- tournament registrations ----------
# Writes go through register_for_tournament/unregister_from_tournament, two
# Postgres functions (migration 003) that lock the tournament row for the
# duration of the check-then-insert-then-increment — bot/handlers/registrations.py
# is the only caller (a real Telegram callback tells us exactly who tapped
# the button), and without that lock two people tapping "Записаться" on the
# last seat at the same moment could both get seated.

def register_for_tournament(tournament_id: int, player_id: str) -> str:
    res = client().rpc("register_for_tournament", {"p_tournament_id": tournament_id, "p_player_id": player_id}).execute()
    return res.data


def unregister_from_tournament(tournament_id: int, player_id: str) -> str:
    res = client().rpc("unregister_from_tournament", {"p_tournament_id": tournament_id, "p_player_id": player_id}).execute()
    return res.data


def get_pending_reminders() -> list[dict]:
    """Registrations for still-upcoming tournaments starting in ~24h that
    haven't been reminded yet. The window filter runs in Python, not SQL —
    at this club's scale a full scan of not-yet-reminded rows is cheap, and
    it avoids relational filtering on embedded tournament fields."""
    res = (
        client()
        .table("tournament_registrations")
        .select("id, players(telegram_user_id, nickname), tournaments(title, starts_at, status)")
        .eq("reminded", False)
        .execute()
    )
    now = datetime.now(timezone.utc)
    window_start, window_end = now + timedelta(hours=23), now + timedelta(hours=25)
    due = []
    for r in res.data:
        t = r.get("tournaments") or {}
        if t.get("status") != "upcoming" or not t.get("starts_at"):
            continue
        starts_at = datetime.fromisoformat(t["starts_at"])
        if window_start <= starts_at <= window_end:
            due.append(r)
    return due


def mark_reminded(registration_ids: list[int]) -> None:
    if registration_ids:
        client().table("tournament_registrations").update({"reminded": True}).in_("id", registration_ids).execute()


def mark_results_notified(result_ids: list[int]) -> None:
    if result_ids:
        client().table("tournament_results").update({"notified": True}).in_("id", result_ids).execute()
