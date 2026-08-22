from datetime import datetime

from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message
from aiogram.utils.keyboard import InlineKeyboardBuilder

import db
import keyboards
from states import AddPlayer, NewSeason, RenamePlayer

router = Router(name="players")


def _players_menu_kb():
    b = InlineKeyboardBuilder()
    b.button(text="➕ Добавить игрока", callback_data="menu:add_player")
    for p in db.list_players():
        tag = "✅" if p.get("telegram_user_id") else "—"
        b.button(text=f"{tag} {p['nickname']}", callback_data=f"playerpick:{p['id']}")
    b.button(text="⬅️ Назад", callback_data="menu:back")
    b.adjust(1)
    return b.as_markup()


@router.callback_query(F.data == "menu:players")
async def players_menu(callback: CallbackQuery) -> None:
    await callback.message.edit_text("Игроки клуба (✅ — уже писал боту):", reply_markup=_players_menu_kb())
    await callback.answer()


@router.callback_query(F.data.startswith("playerpick:"))
async def player_actions(callback: CallbackQuery) -> None:
    player_id = callback.data.split(":", 1)[1]
    b = InlineKeyboardBuilder()
    b.button(text="Переименовать", callback_data=f"playerrename:{player_id}")
    b.button(text="Удалить", callback_data=f"playerdelete:{player_id}")
    b.button(text="⬅️ Назад", callback_data="menu:players")
    b.adjust(1)
    await callback.message.edit_text("Что сделать с игроком?", reply_markup=b.as_markup())
    await callback.answer()


@router.callback_query(F.data.startswith("playerrename:"))
async def player_rename_start(callback: CallbackQuery, state: FSMContext) -> None:
    player_id = callback.data.split(":", 1)[1]
    await state.update_data(player_id=player_id)
    await state.set_state(RenamePlayer.new_nickname)
    await callback.message.answer("Новый ник:")
    await callback.answer()


@router.message(RenamePlayer.new_nickname)
async def player_rename_apply(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    db.rename_player(data["player_id"], message.text.strip())
    await state.clear()
    await message.answer("Ник обновлён.")


@router.callback_query(F.data.startswith("playerdelete:"))
async def player_delete(callback: CallbackQuery) -> None:
    player_id = callback.data.split(":", 1)[1]
    db.delete_player(player_id)
    await callback.message.edit_text("Игрок удалён.", reply_markup=_players_menu_kb())
    await callback.answer()


# ---------- Add player manually (before they've written /start themselves) ----------

@router.callback_query(F.data == "menu:add_player")
async def add_player_start(callback: CallbackQuery, state: FSMContext) -> None:
    await state.set_state(AddPlayer.nickname)
    await callback.message.answer("Ник нового игрока:")
    await callback.answer()


@router.message(AddPlayer.nickname)
async def add_player_nickname(message: Message, state: FSMContext) -> None:
    await state.update_data(nickname=message.text.strip())
    await state.set_state(AddPlayer.telegram_id)
    await message.answer("Telegram ID игрока, если известен (или пропустите):", reply_markup=keyboards.skip_kb())


@router.callback_query(AddPlayer.telegram_id, F.data == "skip")
async def add_player_skip_id(callback: CallbackQuery, state: FSMContext) -> None:
    data = await state.get_data()
    db.create_player(data["nickname"])
    await state.clear()
    await callback.message.answer(f"Игрок «{data['nickname']}» добавлен.")
    await callback.answer()


@router.message(AddPlayer.telegram_id)
async def add_player_with_id(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    try:
        tg_id = int(message.text.strip())
    except ValueError:
        await message.answer("Нужно число (Telegram ID) или нажмите «Пропустить».")
        return
    db.create_player(data["nickname"], telegram_user_id=tg_id)
    await state.clear()
    await message.answer(f"Игрок «{data['nickname']}» добавлен.")


# ---------- New season ----------

@router.callback_query(F.data == "menu:new_season")
async def new_season_start(callback: CallbackQuery, state: FSMContext) -> None:
    await state.set_state(NewSeason.name)
    await callback.message.answer("Название нового сезона:")
    await callback.answer()


@router.message(NewSeason.name)
async def new_season_name(message: Message, state: FSMContext) -> None:
    await state.update_data(name=message.text.strip())
    await state.set_state(NewSeason.starts_on)
    await message.answer("Дата начала сезона (ДД.ММ.ГГГГ):")


@router.message(NewSeason.starts_on)
async def new_season_apply(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    try:
        starts_on = datetime.strptime(message.text.strip(), "%d.%m.%Y").strftime("%Y-%m-%d")
    except ValueError:
        await message.answer("Формат даты: ДД.ММ.ГГГГ, например 01.09.2026")
        return
    db.start_new_season(data["name"], starts_on)
    await state.clear()
    await message.answer(f"Новый сезон «{data['name']}» начат.")
