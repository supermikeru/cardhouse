from __future__ import annotations

import logging

from aiogram import Bot, F, Router
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

import db
import keyboards
import notify
import parsing
from states import UploadResults

logger = logging.getLogger(__name__)
router = Router(name="results")

TEMPLATE_HINT = (
    "Пришлите .csv или .xlsx файл со столбцами:\n"
    "nickname (или telegram_id), place, points, bounty (необязательно)\n\n"
    "Пример строки: Мияги, 3, 320, 0"
)


def _resolve_player(entry: dict) -> dict | None:
    if entry.get("telegram_id"):
        player = db.get_player_by_telegram_id(entry["telegram_id"])
        if player:
            return player
    if entry.get("nickname"):
        return db.find_player_by_nickname(entry["nickname"])
    return None


@router.callback_query(F.data == "menu:upload_results")
async def upload_start(callback: CallbackQuery, state: FSMContext) -> None:
    tournaments = db.list_tournaments()
    if not tournaments:
        await callback.answer("Турниров пока нет.", show_alert=True)
        return
    await state.set_state(UploadResults.choose_tournament)
    await callback.message.edit_text("Для какого турнира загружаем результаты?", reply_markup=keyboards.tournaments_list_kb(tournaments, "respick"))
    await callback.answer()


@router.callback_query(UploadResults.choose_tournament, F.data.startswith("respick:"))
async def upload_ask_file(callback: CallbackQuery, state: FSMContext) -> None:
    tournament_id = int(callback.data.split(":", 1)[1])
    await state.update_data(tournament_id=tournament_id)
    await state.set_state(UploadResults.awaiting_file)
    await callback.message.answer(TEMPLATE_HINT)
    await callback.answer()


@router.message(UploadResults.awaiting_file, F.document)
async def upload_parse_file(message: Message, state: FSMContext, bot: Bot) -> None:
    document = message.document
    file = await bot.get_file(document.file_id)
    buf = await bot.download_file(file.file_path)
    try:
        entries = parsing.parse_results_table(buf.read(), document.file_name or "")
    except parsing.ParseError as e:
        await message.answer(f"Не получилось разобрать файл: {e}\nПопробуйте снова.")
        return

    matched, to_create = [], []
    for entry in entries:
        player = _resolve_player(entry)
        if player:
            matched.append((player, entry))
        else:
            to_create.append(entry)

    await state.update_data(entries=entries)
    lines = [f"Строк: {len(entries)}, сопоставлено: {len(matched)}, новых игроков: {len(to_create)}."]
    if to_create:
        names = ", ".join(e.get("nickname") or f"id{e.get('telegram_id')}" for e in to_create)
        lines.append(f"Будут созданы: {names}")
    lines.append("Загрузить результаты?")
    await state.set_state(UploadResults.confirm)
    await message.answer("\n".join(lines), reply_markup=keyboards.yes_no_kb("resconfirm:yes", "resconfirm:no"))


@router.message(UploadResults.awaiting_file)
async def upload_wrong_type(message: Message) -> None:
    await message.answer("Нужен файл — пришлите .csv или .xlsx документом.")


@router.callback_query(UploadResults.confirm, F.data == "resconfirm:no")
async def upload_cancel(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await callback.message.edit_text("Загрузка отменена.")
    await callback.answer()


@router.callback_query(UploadResults.confirm, F.data == "resconfirm:yes")
async def upload_apply(callback: CallbackQuery, state: FSMContext, bot: Bot) -> None:
    data = await state.get_data()
    tournament_id = data["tournament_id"]
    rows = []
    for entry in data["entries"]:
        player = _resolve_player(entry)
        if not player:
            nickname = entry.get("nickname") or f"id{entry.get('telegram_id')}"
            player = db.create_player(nickname, telegram_user_id=entry.get("telegram_id"))
        rows.append({
            "player_id": player["id"], "place": entry["place"],
            "points": entry.get("points", 0), "bounty": entry.get("bounty", 0),
        })

    db.upsert_results(tournament_id, rows)
    db.mark_tournament_finished(tournament_id)
    tournament = db.get_tournament(tournament_id)
    sent, failed = await notify.notify_results(bot, tournament["title"], tournament_id)

    await state.clear()
    await callback.message.edit_text(f"Результаты загружены ({len(rows)}). Уведомлений отправлено: {sent}, ошибок: {failed}.")
    await callback.answer()
