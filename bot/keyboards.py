from __future__ import annotations

from aiogram.types import InlineKeyboardMarkup
from aiogram.utils.keyboard import InlineKeyboardBuilder

import config


def main_menu_kb() -> InlineKeyboardMarkup:
    b = InlineKeyboardBuilder()
    b.button(text="➕ Добавить турнир", callback_data="menu:add_tournament")
    b.button(text="✏️ Редактировать турнир", callback_data="menu:edit_tournament")
    b.button(text="🗑 Удалить турнир", callback_data="menu:delete_tournament")
    b.button(text="📊 Загрузить результаты", callback_data="menu:upload_results")
    b.button(text="📰 Опубликовать новость", callback_data="menu:post_news")
    b.button(text="👥 Игроки", callback_data="menu:players")
    b.button(text="🗓 Новый сезон", callback_data="menu:new_season")
    b.adjust(1)
    return b.as_markup()


def yes_no_kb(yes_data: str, no_data: str, yes_text: str = "Да", no_text: str = "Нет") -> InlineKeyboardMarkup:
    b = InlineKeyboardBuilder()
    b.button(text=yes_text, callback_data=yes_data)
    b.button(text=no_text, callback_data=no_data)
    b.adjust(2)
    return b.as_markup()


def skip_kb(callback_data: str = "skip") -> InlineKeyboardMarkup:
    b = InlineKeyboardBuilder()
    b.button(text="Пропустить →", callback_data=callback_data)
    return b.as_markup()


def tournaments_list_kb(tournaments: list[dict], prefix: str) -> InlineKeyboardMarkup:
    b = InlineKeyboardBuilder()
    for t in tournaments:
        label = f"{t['title']} — {t['starts_at'][:10]}"
        b.button(text=label, callback_data=f"{prefix}:{t['id']}")
    b.adjust(1)
    return b.as_markup()


def edit_field_kb() -> InlineKeyboardMarkup:
    fields = [
        ("Название", "title"), ("Подзаголовок", "subtitle"), ("Дата/время", "starts_at"),
        ("Мест всего", "seats_total"), ("Описание", "description"), ("Правила", "rules"),
        ("Фото", "photo"),
    ]
    b = InlineKeyboardBuilder()
    for label, field in fields:
        b.button(text=label, callback_data=f"editfield:{field}")
    b.adjust(2)
    return b.as_markup()


def registration_button(tournament_id: int) -> InlineKeyboardMarkup:
    url = f"https://t.me/{config.BOT_USERNAME}/{config.MINIAPP_SHORT_NAME}?startapp=t_{tournament_id}"
    b = InlineKeyboardBuilder()
    b.button(text="🃏 Записаться на игру", url=url)
    return b.as_markup()


def players_list_kb(players: list[dict], prefix: str) -> InlineKeyboardMarkup:
    b = InlineKeyboardBuilder()
    for p in players:
        tag = "✅" if p.get("telegram_user_id") else "—"
        b.button(text=f"{tag} {p['nickname']}", callback_data=f"{prefix}:{p['id']}")
    b.adjust(1)
    return b.as_markup()


def cancel_kb() -> InlineKeyboardMarkup:
    b = InlineKeyboardBuilder()
    b.button(text="Отмена", callback_data="cancel")
    return b.as_markup()
