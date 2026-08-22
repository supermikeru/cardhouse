from __future__ import annotations

import asyncio
import logging

from aiogram import Bot
from aiogram.types import InlineKeyboardMarkup

import db

logger = logging.getLogger(__name__)

# Telegram allows roughly 30 msgs/sec across a bot; a small delay keeps a ~70-member
# broadcast well under that without needing a real rate limiter.
_BROADCAST_DELAY = 0.05


async def broadcast(
    bot: Bot,
    caption: str,
    photo_url: str | None = None,
    reply_markup: InlineKeyboardMarkup | None = None,
) -> tuple[int, int]:
    """Sends caption (+ optional photo/button) to every player who has started the
    bot. Returns (sent, failed)."""
    players = db.list_players_with_telegram()
    sent = failed = 0
    for p in players:
        chat_id = p["telegram_user_id"]
        try:
            if photo_url:
                await bot.send_photo(chat_id, photo_url, caption=caption, reply_markup=reply_markup)
            else:
                await bot.send_message(chat_id, caption, reply_markup=reply_markup)
            sent += 1
        except Exception:
            logger.warning("Broadcast failed for chat_id=%s", chat_id, exc_info=True)
            failed += 1
        await asyncio.sleep(_BROADCAST_DELAY)
    return sent, failed


async def notify_results(bot: Bot, tournament_title: str, tournament_id: int) -> tuple[int, int]:
    """Sends each matched, not-yet-notified player their personal result for this
    tournament. Players without a telegram_user_id are skipped (can't be reached)."""
    results = db.get_unnotified_results(tournament_id)
    sent = failed = 0
    notified_ids: list[int] = []
    for r in results:
        player = r.get("players") or {}
        chat_id = player.get("telegram_user_id")
        if not chat_id:
            continue
        text = f"🏆 Результаты турнира «{tournament_title}»\n\nМесто: {r['place']}\nОчки: +{r['points']}"
        if r.get("bounty"):
            text += f"\nБаунти: {r['bounty']}"
        try:
            await bot.send_message(chat_id, text)
            sent += 1
        except Exception:
            logger.warning("Result notify failed for chat_id=%s", chat_id, exc_info=True)
            failed += 1
        notified_ids.append(r["id"])
        await asyncio.sleep(_BROADCAST_DELAY)
    db.mark_results_notified(notified_ids)
    return sent, failed
