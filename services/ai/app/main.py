from app.api.routes import router
from app.core.config import get_settings
from app.core.logging import logger  # noqa: F401 — ensures logging is configured
from app.providers.base import ProviderError, ProviderUnavailableError


def create_app():
    from fastapi import FastAPI
    from fastapi.responses import JSONResponse

    settings = get_settings()
    app = FastAPI(title="Shena Care AI", version="0.2.0")
    app.include_router(router)

    # A provider that is missing its key or failing must surface as "AI unavailable", never as a 500:
    # the ShenaCare API turns 503/502 into its deterministic fallback so shopping is unaffected.
    @app.exception_handler(ProviderUnavailableError)
    async def provider_unavailable(_request, exc: ProviderUnavailableError):
        logger.warning("provider unavailable: %s", exc)
        return JSONResponse(status_code=503, content={"detail": "AI provider unavailable"})

    @app.exception_handler(ProviderError)
    async def provider_error(_request, exc: ProviderError):
        logger.warning("provider error: %s", exc)
        return JSONResponse(status_code=502, content={"detail": "AI provider returned an invalid response"})

    logger.info("shenacare-ai starting with provider '%s'", settings.provider)
    if not settings.service_token and not settings.allow_unauthenticated:
        logger.warning("AI_SERVICE_TOKEN is not set: /v1 routes will refuse every request")
    if settings.provider == "openrouter" and not settings.openrouter_api_key:
        logger.warning("OPENROUTER_API_KEY is not set: AI routes will answer 503 until it is configured")
    return app


app = create_app()
