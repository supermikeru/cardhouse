from aiogram import F, Router
from aiogram.filters import CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

import config
import db
import keyboards

router = Router(name="start")

_MAX_NICKNAME_LEN = 40


def _sanitize_nickname(raw: str) -> str:
    # Telegram first_name is free-form Unicode with no length practical limit
    # enforced client-side here; the frontend HTML-escapes nicknames before
    # rendering, but stripping control/formatting characters and capping
    # length at the source keeps the stored data itself sane too.
    cleaned = "".join(ch for ch in raw if ch.isprintable()).strip()
    return cleaned[:_MAX_NICKNAME_LEN] or "player"


@router.message(CommandStart())
async def cmd_start(message: Message) -> None:
    user = message.from_user
    display_name = _sanitize_nickname(user.username or user.first_name or f"player_{user.id}")
    player = db.get_or_create_player(user.id, user.username, display_name)

    if user.id in config.ADMIN_CHAT_IDS:
        await message.answer(
            f"С возвращением, {player['nickname']}! Вы админ клуба «Карточный Дом».",
            reply_markup=keyboards.main_menu_kb(),
        )
    else:
        await message.answer(
            f"Привет, {player['nickname']}! Вы добавлены в рейтинг клуба «Карточный Дом» — "
            "здесь будут анонсы турниров и уведомления о результатах."
        )


@router.callback_query(F.data == "cancel")
async def cancel_any(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await callback.message.edit_text("Отменено.")
    await callback.answer()
