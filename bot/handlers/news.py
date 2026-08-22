from aiogram import Bot, F, Router
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

import keyboards
import notify
from states import PostNews

router = Router(name="news")


@router.callback_query(F.data == "menu:post_news")
async def news_start(callback: CallbackQuery, state: FSMContext) -> None:
    await state.set_state(PostNews.photo)
    await callback.message.edit_text("Фото к новости, если нужно (или пропустите):", reply_markup=keyboards.skip_kb())
    await callback.answer()


@router.callback_query(PostNews.photo, F.data == "skip")
async def news_skip_photo(callback: CallbackQuery, state: FSMContext) -> None:
    await state.update_data(photo_file_id=None)
    await state.set_state(PostNews.text)
    await callback.message.answer("Текст новости:")
    await callback.answer()


@router.message(PostNews.photo, F.photo)
async def news_photo(message: Message, state: FSMContext) -> None:
    await state.update_data(photo_file_id=message.photo[-1].file_id)
    await state.set_state(PostNews.text)
    await message.answer("Текст новости:")


@router.message(PostNews.photo)
async def news_photo_wrong(message: Message) -> None:
    await message.answer("Пришлите фото изображением или нажмите «Пропустить».")


@router.message(PostNews.text)
async def news_text(message: Message, state: FSMContext) -> None:
    await state.update_data(text=message.text)
    await state.set_state(PostNews.confirm)
    data = await state.get_data()
    if data.get("photo_file_id"):
        await message.answer_photo(data["photo_file_id"], caption=message.text)
    else:
        await message.answer(message.text)
    await message.answer("Разослать эту новость всем участникам?", reply_markup=keyboards.yes_no_kb("newsconfirm:yes", "newsconfirm:no"))


@router.callback_query(PostNews.confirm, F.data == "newsconfirm:no")
async def news_cancel(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await callback.message.answer("Публикация отменена.")
    await callback.answer()


@router.callback_query(PostNews.confirm, F.data == "newsconfirm:yes")
async def news_publish(callback: CallbackQuery, state: FSMContext, bot: Bot) -> None:
    data = await state.get_data()
    sent, failed = await notify.broadcast(bot, data["text"], photo_url=data.get("photo_file_id"))
    await state.clear()
    await callback.message.answer(f"Новость отправлена: {sent} участникам, ошибок: {failed}.")
    await callback.answer()
