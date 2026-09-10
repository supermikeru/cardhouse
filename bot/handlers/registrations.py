from aiogram import F, Router
from aiogram.types import CallbackQuery

import db
import keyboards

router = Router(name="registrations")


@router.callback_query(F.data.startswith("register:"))
async def register(callback: CallbackQuery) -> None:
    tournament_id = int(callback.data.split(":", 1)[1])
    player = db.get_player_by_telegram_id(callback.from_user.id)
    if not player:
        await callback.answer("Сначала напишите /start боту.", show_alert=True)
        return

    result = db.register_for_tournament(tournament_id, player["id"])
    if result in ("ok", "already_registered"):
        await callback.answer("Вы записаны на турнир!" if result == "ok" else "Вы уже записаны.")
        try:
            await callback.message.edit_reply_markup(reply_markup=keyboards.registered_button(tournament_id))
        except Exception:
            pass  # button state is cosmetic — the registration itself already succeeded
    elif result == "full":
        await callback.answer("Мест не осталось.", show_alert=True)
    else:
        await callback.answer("Не удалось записаться — турнир не найден.", show_alert=True)


@router.callback_query(F.data.startswith("unregister:"))
async def unregister(callback: CallbackQuery) -> None:
    tournament_id = int(callback.data.split(":", 1)[1])
    player = db.get_player_by_telegram_id(callback.from_user.id)
    if not player:
        await callback.answer("Сначала напишите /start боту.", show_alert=True)
        return

    result = db.unregister_from_tournament(tournament_id, player["id"])
    await callback.answer("Запись отменена." if result == "ok" else "Вы не были записаны.")
    try:
        await callback.message.edit_reply_markup(reply_markup=keyboards.registration_button(tournament_id))
    except Exception:
        pass
