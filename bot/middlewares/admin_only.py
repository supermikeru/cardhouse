from __future__ import annotations

from typing import Any, Awaitable, Callable

from aiogram import BaseMiddleware
from aiogram.types import CallbackQuery, Message, TelegramObject

import config

_REJECTION = "Эта функция доступна только администраторам клуба."


class AdminOnlyMiddleware(BaseMiddleware):
    """Applied only to routers that hold admin-only handlers (tournaments, results,
    players, news). The /start router is registered separately and stays open to
    everyone, since it's what auto-registers a new player."""

    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        user = data.get("event_from_user")
        if user is None or user.id not in config.ADMIN_CHAT_IDS:
            if isinstance(event, Message):
                await event.answer(_REJECTION)
            elif isinstance(event, CallbackQuery):
                await event.answer(_REJECTION, show_alert=True)
            return None
        return await handler(event, data)
