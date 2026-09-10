import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.webhook.aiohttp_server import SimpleRequestHandler, setup_application
from aiohttp import web

import config
import db
from handlers import news, players, registrations, results, start, tournaments
from middlewares.admin_only import AdminOnlyMiddleware

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_REMINDER_CHECK_INTERVAL = 3600  # seconds


def build_dispatcher() -> Dispatcher:
    dp = Dispatcher(storage=MemoryStorage())

    # Open to everyone — this is what auto-registers a new player on /start,
    # and lets any player tap "Записаться на игру" on a tournament announcement.
    dp.include_router(start.router)
    dp.include_router(registrations.router)

    # Everything else is admin-only.
    for r in (tournaments.router, results.router, players.router, news.router):
        # Inner middleware on purpose: it only runs once a handler's filters
        # already matched (a real admin command/callback/FSM step), so a
        # non-admin's unrelated messages fall through silently instead of
        # getting an "admins only" reply for every random thing they send.
        # outer_middleware would run before filtering for every message that
        # reaches this router at all, rejecting ordinary chit-chat too.
        r.message.middleware(AdminOnlyMiddleware())
        r.callback_query.middleware(AdminOnlyMiddleware())
        dp.include_router(r)

    return dp


async def remind_registered_players(bot: Bot) -> None:
    # Runs for the lifetime of the process, checking hourly for tournaments
    # starting in ~24h. Render's free plan spins the whole process down after
    # 15 minutes with no incoming HTTP traffic, which pauses this loop along
    # with everything else — a reminder due during a quiet stretch only goes
    # out once something (a player, an admin) wakes the service back up.
    while True:
        try:
            due = db.get_pending_reminders()
            reminded_ids = []
            for r in due:
                player = r.get("players") or {}
                tournament = r.get("tournaments") or {}
                chat_id = player.get("telegram_user_id")
                if not chat_id:
                    continue
                try:
                    await bot.send_message(
                        chat_id,
                        f"⏰ Напоминание: завтра турнир «{tournament.get('title')}» — не забудьте прийти!",
                    )
                except Exception:
                    logger.warning("Reminder failed for chat_id=%s", chat_id, exc_info=True)
                reminded_ids.append(r["id"])
            db.mark_reminded(reminded_ids)
        except Exception:
            logger.exception("Reminder check failed")
        await asyncio.sleep(_REMINDER_CHECK_INTERVAL)


async def on_startup(bot: Bot) -> None:
    asyncio.create_task(remind_registered_players(bot))
    if not config.WEBHOOK_BASE_URL:
        logger.warning("WEBHOOK_BASE_URL/RENDER_EXTERNAL_URL is not set — webhook was not registered.")
        return
    url = config.WEBHOOK_BASE_URL.rstrip("/") + config.WEBHOOK_PATH
    await bot.set_webhook(url, secret_token=config.WEBHOOK_SECRET, drop_pending_updates=True)
    logger.info("Webhook set to %s", url)


async def healthz(request: web.Request) -> web.Response:
    return web.Response(text="ok")


def main() -> None:
    # No default parse_mode: tournament descriptions/rules and player nicknames are
    # free-form user input, and HTML parse mode would break on stray '<'/'&' in them.
    bot = Bot(token=config.BOT_TOKEN)
    dp = build_dispatcher()
    dp.startup.register(on_startup)

    app = web.Application()
    app.router.add_get("/healthz", healthz)
    SimpleRequestHandler(dispatcher=dp, bot=bot, secret_token=config.WEBHOOK_SECRET).register(app, path=config.WEBHOOK_PATH)
    setup_application(app, dp, bot=bot)

    web.run_app(app, host="0.0.0.0", port=config.PORT)


if __name__ == "__main__":
    main()
