import logging

from aiogram import Bot, Dispatcher
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.webhook.aiohttp_server import SimpleRequestHandler, setup_application
from aiohttp import web

import config
from handlers import news, players, results, start, tournaments
from middlewares.admin_only import AdminOnlyMiddleware

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def build_dispatcher() -> Dispatcher:
    dp = Dispatcher(storage=MemoryStorage())

    # Open to everyone — this is what auto-registers a new player on /start.
    dp.include_router(start.router)

    # Everything else is admin-only.
    for r in (tournaments.router, results.router, players.router, news.router):
        # outer_middleware runs before filter/state matching, so it blocks
        # non-admins unconditionally rather than only when some handler's
        # filters happen to match.
        r.message.outer_middleware(AdminOnlyMiddleware())
        r.callback_query.outer_middleware(AdminOnlyMiddleware())
        dp.include_router(r)

    return dp


async def on_startup(bot: Bot) -> None:
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
