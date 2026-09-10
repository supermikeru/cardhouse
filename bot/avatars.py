from __future__ import annotations

import logging

from aiogram import Bot

import db

logger = logging.getLogger(__name__)


async def fetch_and_store_avatar(bot: Bot, telegram_user_id: int, player_id: str) -> bool:
    """Fetch the user's current Telegram profile photo, if any and if their
    privacy settings let bots see it, and re-host it in Supabase Storage.

    Storing the raw api.telegram.org file URL instead would leak the bot
    token (it's embedded in that URL path) to every viewer of the mini app.

    Returns True if an avatar was fetched and stored.
    """
    try:
        photos = await bot.get_user_profile_photos(telegram_user_id, limit=1)
        if not photos.photos:
            return False
        largest = photos.photos[0][-1]  # last size in the list is the biggest
        file = await bot.get_file(largest.file_id)
        buf = await bot.download_file(file.file_path)
        avatar_url = db.upload_player_avatar(buf.read())
        db.set_player_avatar(player_id, avatar_url)
        return True
    except Exception:
        logger.warning("Could not fetch avatar for telegram_user_id=%s", telegram_user_id, exc_info=True)
        return False
