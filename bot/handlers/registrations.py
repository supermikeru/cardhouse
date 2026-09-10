import logging

from aiogram import F, Router
from aiogram.types import CallbackQuery

import db
import keyboards

logger = logging.getLogger(__name__)
router = Router(name="registrations")


async def _safe_answer(callback: CallbackQuery, text: str, show_alert: bool = False) -> None:
    # callback.answer() itself can raise (e.g. TelegramBadRequest if Telegram
    # already considers the query too old) — letting that escape here would
    # leave the tap looking permanently stuck client-side with nothing in
    # the logs pointing at why, which is exactly the bug this guards against.
    try:
        await callback.answer(text, show_alert=show_alert)
    except Exception:
        logger.exception("Could not answer callback %s", callback.id)


@router.callback_query(F.data.startswith("register:"))
async def register(callback: CallbackQuery) -> None:
    try:
        tournament_id = int(callback.data.split(":", 1)[1])
        player = db.get_player_by_telegram_id(callback.from_user.id)
        if not player:
            await _safe_answer(callback, "Сначала напишите /start боту.", show_alert=True)
            return

        result = db.register_for_tournament(tournament_id, player["id"])
    except Exception:
        logger.exception("register_for_tournament failed for user_id=%s data=%s", callback.from_user.id, callback.data)
        await _safe_answer(callback, "Что-то пошло не так, попробуйте ещё раз.", show_alert=True)
        return

    if result in ("ok", "already_registered"):
        await _safe_answer(callback, "Вы записаны на турнир!" if result == "ok" else "Вы уже записаны.")
        try:
            await callback.message.edit_reply_markup(reply_markup=keyboards.registered_button(tournament_id))
        except Exception:
            logger.warning("Could not update button after registering", exc_info=True)  # cosmetic — registration already succeeded
    elif result == "full":
        await _safe_answer(callback, "Мест не осталось.", show_alert=True)
    else:
        await _safe_answer(callback, "Не удалось записаться — турнир не найден.", show_alert=True)


@router.callback_query(F.data.startswith("unregister:"))
async def unregister(callback: CallbackQuery) -> None:
    try:
        tournament_id = int(callback.data.split(":", 1)[1])
        player = db.get_player_by_telegram_id(callback.from_user.id)
        if not player:
            await _safe_answer(callback, "Сначала напишите /start боту.", show_alert=True)
            return

        result = db.unregister_from_tournament(tournament_id, player["id"])
    except Exception:
        logger.exception("unregister_from_tournament failed for user_id=%s data=%s", callback.from_user.id, callback.data)
        await _safe_answer(callback, "Что-то пошло не так, попробуйте ещё раз.", show_alert=True)
        return

    await _safe_answer(callback, "Запись отменена." if result == "ok" else "Вы не были записаны.")
    try:
        await callback.message.edit_reply_markup(reply_markup=keyboards.registration_button(tournament_id))
    except Exception:
        logger.warning("Could not update button after unregistering", exc_info=True)
