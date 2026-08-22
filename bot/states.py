from aiogram.fsm.state import State, StatesGroup


class AddTournament(StatesGroup):
    title = State()
    subtitle = State()
    date = State()
    time = State()
    seats_total = State()
    description = State()
    rules = State()
    photo = State()
    special = State()
    confirm = State()
    announce_text = State()
    announce_confirm = State()


class EditTournament(StatesGroup):
    choose_tournament = State()
    choose_field = State()
    new_value = State()
    new_photo = State()


class DeleteTournament(StatesGroup):
    choose_tournament = State()
    confirm = State()


class UploadResults(StatesGroup):
    choose_tournament = State()
    awaiting_file = State()
    confirm = State()


class AddPlayer(StatesGroup):
    nickname = State()
    telegram_id = State()


class RenamePlayer(StatesGroup):
    choose_player = State()
    new_nickname = State()


class NewSeason(StatesGroup):
    name = State()
    starts_on = State()


class PostNews(StatesGroup):
    photo = State()
    text = State()
    confirm = State()
