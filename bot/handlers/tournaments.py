import logging
from datetime import datetime

from aiogram import Bot, F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

import db
import keyboards
import notify
from states import AddTournament, DeleteTournament, EditTournament

logger = logging.getLogger(__name__)
router = Router(name="tournaments")

MOSCOW_OFFSET = "+03:00"  # club has one venue in SPb; no per-user timezone conversion needed


def parse_datetime(text: str) -> str:
    dt = datetime.strptime(text.strip(), "%d.%m.%Y %H:%M")
    return dt.strftime(f"%Y-%m-%dT%H:%M:00{MOSCOW_OFFSET}")


def build_announce_draft(t: dict) -> str:
    dt = datetime.fromisoformat(t["starts_at"])
    lines = [
        t["title"] + (f" {t['subtitle']}" if t.get("subtitle") else ""),
        "",
        t.get("description", ""),
        "",
        f"📅 {dt.strftime('%d.%m.%Y')} в {dt.strftime('%H:%M')}",
        f"👥 Мест: {t['seats_total']}",
    ]
    return "\n".join(l for l in lines if l is not None)


# ---------- /menu ----------

@router.message(Command("menu"))
async def cmd_menu(message: Message) -> None:
    await message.answer("Меню администратора:", reply_markup=keyboards.main_menu_kb())


@router.callback_query(F.data == "menu:back")
async def cb_menu_back(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await callback.message.edit_text("Меню администратора:", reply_markup=keyboards.main_menu_kb())
    await callback.answer()


# ---------- Add tournament ----------

@router.callback_query(F.data == "menu:add_tournament")
async def add_start(callback: CallbackQuery, state: FSMContext) -> None:
    await state.set_state(AddTournament.title)
    await callback.message.edit_text("Название турнира:", reply_markup=keyboards.cancel_kb())
    await callback.answer()


@router.message(AddTournament.title)
async def add_title(message: Message, state: FSMContext) -> None:
    await state.update_data(title=message.text.strip())
    await state.set_state(AddTournament.subtitle)
    await message.answer("Подзаголовок (или пропустите):", reply_markup=keyboards.skip_kb())


async def _ask_date(target: Message) -> None:
    await target.answer("Дата и время начала в формате ДД.ММ.ГГГГ ЧЧ:ММ (например 25.08.2026 19:00):")


@router.message(AddTournament.subtitle)
async def add_subtitle(message: Message, state: FSMContext) -> None:
    await state.update_data(subtitle=message.text.strip())
    await state.set_state(AddTournament.date)
    await _ask_date(message)


@router.callback_query(AddTournament.subtitle, F.data == "skip")
async def add_subtitle_skip(callback: CallbackQuery, state: FSMContext) -> None:
    await state.update_data(subtitle=None)
    await state.set_state(AddTournament.date)
    await _ask_date(callback.message)
    await callback.answer()


@router.message(AddTournament.date)
async def add_date(message: Message, state: FSMContext) -> None:
    try:
        starts_at = parse_datetime(message.text)
    except ValueError:
        await message.answer("Не получилось разобрать дату. Формат: ДД.ММ.ГГГГ ЧЧ:ММ, например 25.08.2026 19:00")
        return
    await state.update_data(starts_at=starts_at)
    await state.set_state(AddTournament.seats_total)
    await message.answer("Сколько мест всего? (или пропустите — по умолчанию 60)", reply_markup=keyboards.skip_kb())


@router.callback_query(AddTournament.seats_total, F.data == "skip")
async def add_seats_skip(callback: CallbackQuery, state: FSMContext) -> None:
    await state.update_data(seats_total=60)
    await state.set_state(AddTournament.description)
    await callback.message.answer("Описание турнира:")
    await callback.answer()


@router.message(AddTournament.seats_total)
async def add_seats(message: Message, state: FSMContext) -> None:
    try:
        seats = int(message.text.strip())
    except ValueError:
        await message.answer("Введите число, например 60.")
        return
    await state.update_data(seats_total=seats)
    await state.set_state(AddTournament.description)
    await message.answer("Описание турнира:")


@router.message(AddTournament.description)
async def add_description(message: Message, state: FSMContext) -> None:
    await state.update_data(description=message.text.strip())
    await state.set_state(AddTournament.rules)
    await message.answer("Правила турнира — одним сообщением, каждое правило с новой строки:")


@router.message(AddTournament.rules)
async def add_rules(message: Message, state: FSMContext) -> None:
    rules = [line.strip() for line in message.text.split("\n") if line.strip()]
    await state.update_data(rules=rules)
    await state.set_state(AddTournament.photo)
    await message.answer("Пришлите фото турнира одним сообщением.")


@router.message(AddTournament.photo, F.photo)
async def add_photo(message: Message, state: FSMContext, bot: Bot) -> None:
    file = await bot.get_file(message.photo[-1].file_id)
    buf = await bot.download_file(file.file_path)
    image_url = db.upload_tournament_image(buf.read())
    await state.update_data(image_url=image_url)
    await state.set_state(AddTournament.special)
    await message.answer("Это специальный турнир (не входит в обычный сезонный зачёт)?", reply_markup=keyboards.yes_no_kb("special:yes", "special:no"))


@router.message(AddTournament.photo)
async def add_photo_wrong(message: Message) -> None:
    await message.answer("Нужно именно фото — пришлите его как изображение.")


@router.callback_query(AddTournament.special, F.data.startswith("special:"))
async def add_special(callback: CallbackQuery, state: FSMContext) -> None:
    is_special = callback.data == "special:yes"
    await state.update_data(is_special=is_special)
    data = await state.get_data()
    summary = (
        f"Проверьте турнир:\n\n"
        f"«{data['title']}»{' ' + data['subtitle'] if data.get('subtitle') else ''}\n"
        f"{data['starts_at']}\n"
        f"Мест: {data['seats_total']}\n"
        f"Спецтурнир: {'да' if is_special else 'нет'}\n\n"
        f"{data['description']}\n\n" + "\n".join("• " + r for r in data["rules"])
    )
    await state.set_state(AddTournament.confirm)
    await callback.message.answer_photo(data["image_url"], caption=summary, reply_markup=keyboards.yes_no_kb("addconfirm:yes", "addconfirm:no", "Создать", "Отмена"))
    await callback.answer()


@router.callback_query(AddTournament.confirm, F.data == "addconfirm:no")
async def add_confirm_no(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await callback.message.answer("Добавление отменено.")
    await callback.answer()


@router.callback_query(AddTournament.confirm, F.data == "addconfirm:yes")
async def add_confirm_yes(callback: CallbackQuery, state: FSMContext) -> None:
    data = await state.get_data()
    season = db.get_current_season()
    fields = {
        "title": data["title"], "subtitle": data.get("subtitle"),
        "starts_at": data["starts_at"], "seats_total": data["seats_total"],
        "description": data["description"], "rules": data["rules"],
        "image_url": data["image_url"], "is_special": data["is_special"],
        "season_id": None if data["is_special"] else (season["id"] if season else None),
    }
    tournament = db.create_tournament(fields)
    await state.update_data(tournament_id=tournament["id"])
    await state.set_state(AddTournament.announce_confirm)
    await callback.message.answer(
        "Турнир создан. Разослать анонс участникам?",
        reply_markup=keyboards.yes_no_kb("announce:yes", "announce:no"),
    )
    await callback.answer()


@router.callback_query(AddTournament.announce_confirm, F.data == "announce:no")
async def announce_no(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await callback.message.answer("Готово, анонс не отправлен.")
    await callback.answer()


@router.callback_query(AddTournament.announce_confirm, F.data == "announce:yes")
async def announce_yes(callback: CallbackQuery, state: FSMContext) -> None:
    data = await state.get_data()
    tournament = db.get_tournament(data["tournament_id"])
    draft = build_announce_draft(tournament)
    await state.update_data(announce_draft=draft)
    await state.set_state(AddTournament.announce_text)
    await callback.message.answer(
        f"Черновик анонса:\n\n{draft}\n\n"
        "Отправьте свой текст, чтобы заменить черновик, или пришлите «ок», чтобы разослать как есть."
    )
    await callback.answer()


@router.message(AddTournament.announce_text)
async def announce_text(message: Message, state: FSMContext, bot: Bot) -> None:
    data = await state.get_data()
    caption = data["announce_draft"] if message.text.strip().lower() in ("ок", "ok") else message.text
    tournament = db.get_tournament(data["tournament_id"])
    sent, failed = await notify.broadcast(
        bot, caption, photo_url=tournament["image_url"],
        reply_markup=keyboards.registration_button(tournament["id"]),
    )
    db.mark_tournament_announced(tournament["id"])
    await state.clear()
    await message.answer(f"Анонс отправлен: {sent} участникам, ошибок: {failed}.")


# ---------- Edit tournament ----------

@router.callback_query(F.data == "menu:edit_tournament")
async def edit_start(callback: CallbackQuery, state: FSMContext) -> None:
    tournaments = db.list_tournaments()
    if not tournaments:
        await callback.answer("Турниров пока нет.", show_alert=True)
        return
    await state.set_state(EditTournament.choose_tournament)
    await callback.message.edit_text("Какой турнир редактируем?", reply_markup=keyboards.tournaments_list_kb(tournaments, "editpick"))
    await callback.answer()


@router.callback_query(EditTournament.choose_tournament, F.data.startswith("editpick:"))
async def edit_choose_field(callback: CallbackQuery, state: FSMContext) -> None:
    tournament_id = int(callback.data.split(":", 1)[1])
    await state.update_data(tournament_id=tournament_id)
    await state.set_state(EditTournament.choose_field)
    await callback.message.edit_text("Что меняем?", reply_markup=keyboards.edit_field_kb())
    await callback.answer()


@router.callback_query(EditTournament.choose_field, F.data.startswith("editfield:"))
async def edit_ask_value(callback: CallbackQuery, state: FSMContext) -> None:
    field = callback.data.split(":", 1)[1]
    await state.update_data(field=field)
    if field == "photo":
        await state.set_state(EditTournament.new_photo)
        await callback.message.answer("Пришлите новое фото:")
    else:
        prompts = {
            "title": "Новое название:", "subtitle": "Новый подзаголовок:",
            "starts_at": "Новая дата/время (ДД.ММ.ГГГГ ЧЧ:ММ):",
            "seats_total": "Новое число мест:", "description": "Новое описание:",
            "rules": "Новые правила (каждое с новой строки):",
        }
        await state.set_state(EditTournament.new_value)
        await callback.message.answer(prompts.get(field, "Новое значение:"))
    await callback.answer()


@router.message(EditTournament.new_photo, F.photo)
async def edit_new_photo(message: Message, state: FSMContext, bot: Bot) -> None:
    data = await state.get_data()
    file = await bot.get_file(message.photo[-1].file_id)
    buf = await bot.download_file(file.file_path)
    image_url = db.upload_tournament_image(buf.read())
    db.update_tournament(data["tournament_id"], {"image_url": image_url})
    await state.clear()
    await message.answer("Фото обновлено.")


@router.message(EditTournament.new_value)
async def edit_apply_value(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    field = data["field"]
    raw = message.text.strip()
    try:
        if field == "starts_at":
            value = parse_datetime(raw)
        elif field == "seats_total":
            value = int(raw)
        elif field == "rules":
            value = [line.strip() for line in raw.split("\n") if line.strip()]
        else:
            value = raw
    except ValueError:
        await message.answer("Не получилось разобрать значение, попробуйте ещё раз.")
        return
    db.update_tournament(data["tournament_id"], {field: value})
    await state.clear()
    await message.answer("Обновлено.")


# ---------- Delete tournament ----------

@router.callback_query(F.data == "menu:delete_tournament")
async def delete_start(callback: CallbackQuery, state: FSMContext) -> None:
    tournaments = db.list_tournaments()
    if not tournaments:
        await callback.answer("Турниров пока нет.", show_alert=True)
        return
    await state.set_state(DeleteTournament.choose_tournament)
    await callback.message.edit_text("Какой турнир удаляем?", reply_markup=keyboards.tournaments_list_kb(tournaments, "delpick"))
    await callback.answer()


@router.callback_query(DeleteTournament.choose_tournament, F.data.startswith("delpick:"))
async def delete_confirm(callback: CallbackQuery, state: FSMContext) -> None:
    tournament_id = int(callback.data.split(":", 1)[1])
    await state.update_data(tournament_id=tournament_id)
    await state.set_state(DeleteTournament.confirm)
    await callback.message.edit_text(
        "Удалить турнир вместе со всеми его результатами? Это необратимо.",
        reply_markup=keyboards.yes_no_kb("delconfirm:yes", "delconfirm:no"),
    )
    await callback.answer()


@router.callback_query(DeleteTournament.confirm, F.data == "delconfirm:no")
async def delete_no(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await callback.message.edit_text("Удаление отменено.")
    await callback.answer()


@router.callback_query(DeleteTournament.confirm, F.data == "delconfirm:yes")
async def delete_yes(callback: CallbackQuery, state: FSMContext) -> None:
    data = await state.get_data()
    db.delete_tournament(data["tournament_id"])
    await state.clear()
    await callback.message.edit_text("Турнир удалён.")
    await callback.answer()
