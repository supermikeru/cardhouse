from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()


def _split_ids(raw: str) -> set[int]:
    return {int(x.strip()) for x in raw.split(",") if x.strip()}


BOT_TOKEN = os.environ["BOT_TOKEN"]
ADMIN_CHAT_IDS = _split_ids(os.environ["ADMIN_CHAT_IDS"])

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

WEBHOOK_SECRET = os.environ["WEBHOOK_SECRET"]
# Render injects RENDER_EXTERNAL_URL automatically; WEBHOOK_BASE_URL lets local/other
# hosts override it explicitly.
WEBHOOK_BASE_URL = os.environ.get("WEBHOOK_BASE_URL") or os.environ.get("RENDER_EXTERNAL_URL", "")
WEBHOOK_PATH = f"/webhook/{WEBHOOK_SECRET}"

PORT = int(os.environ.get("PORT", "10000"))

TOURNAMENT_IMAGES_BUCKET = "tournament-images"
PLAYER_AVATARS_BUCKET = "player-avatars"
