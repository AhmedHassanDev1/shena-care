from app.api.routes import router
from app.core.config import get_settings
from app.core.logging import logger  # noqa: F401 — ensures logging is configured


def create_app():
    from fastapi import FastAPI

    settings = get_settings()
    app = FastAPI(title="Shena Care AI", version="0.1.0")
    app.include_router(router)
    logger.info("shenacare-ai starting with provider '%s'", settings.provider)
    return app


app = create_app()
