import json
import logging

from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.responses import StreamingResponse

from app.contracts.enrichment import (
    HealthResponse,
    ProductEnrichmentRequest,
    ProductEnrichmentResult,
)
from app.contracts.guidance import (
    GuidanceRecommendationRequest,
    GuidanceRecommendationResult,
)
from app.contracts.content import (
    ProductContentGenerationRequest,
    ProductContentGenerationResult,
)
from app.contracts.consult import RespondRequest, RespondResult, UnderstandRequest, UnderstandResult
from app.core.auth import require_service_token
from app.core.config import get_settings
from app.llm.model_config import all_task_configs
from app.llm.usage import ledger
from app.providers.base import ProviderUnavailableError
from app.providers.registry import get_provider, get_guidance_provider, get_content_provider, get_consult_provider
from app.services.consult_service import ConsultService
from app.services.enrichment_service import EnrichmentService
from app.services.guidance_service import GuidanceService
from app.services.content_service import ContentGenerationService

router = APIRouter()
logger = logging.getLogger("shenacare.ai.routes")


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    # Reports only this process's state; no claim about external AI provider health.
    return HealthResponse(status="ok", service="shenacare-ai", provider=get_settings().provider)


@router.post(
    "/v1/enrichment/product",
    response_model=ProductEnrichmentResult,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_service_token)],
)
async def enrich_product(
    request: ProductEnrichmentRequest,
    x_correlation_id: str | None = Header(default=None, alias="X-Correlation-ID"),
) -> ProductEnrichmentResult:
    service = EnrichmentService(get_provider(get_settings().provider))
    return await service.enrich(request, correlation_id=x_correlation_id)

@router.post(
    "/v1/guidance/recommend",
    response_model=GuidanceRecommendationResult,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_service_token)],
)
async def recommend_routine(
    request: GuidanceRecommendationRequest,
    x_correlation_id: str | None = Header(default=None, alias="X-Correlation-ID"),
) -> GuidanceRecommendationResult:
    service = GuidanceService(get_guidance_provider(get_settings().provider))
    return await service.recommend(request, correlation_id=x_correlation_id)

@router.post(
    "/v1/content/generate",
    response_model=ProductContentGenerationResult,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_service_token)],
)
async def generate_content(
    request: ProductContentGenerationRequest,
    x_correlation_id: str | None = Header(default=None, alias="X-Correlation-ID"),
) -> ProductContentGenerationResult:
    service = ContentGenerationService(get_content_provider(get_settings().provider))
    return await service.generate(request, correlation_id=x_correlation_id)


def _consult_service() -> ConsultService:
    try:
        return ConsultService(get_consult_provider(get_settings().provider))
    except ProviderUnavailableError as exc:
        # Missing key or unsupported provider: the API falls back to its deterministic answer.
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="AI provider unavailable") from exc


@router.post(
    "/v1/consult/understand",
    response_model=UnderstandResult,
    dependencies=[Depends(require_service_token)],
)
async def consult_understand(
    request: UnderstandRequest,
    x_correlation_id: str | None = Header(default=None, alias="X-Correlation-ID"),
) -> UnderstandResult:
    return await _consult_service().understand(request, correlation_id=x_correlation_id)


@router.post(
    "/v1/consult/respond",
    response_model=RespondResult,
    dependencies=[Depends(require_service_token)],
)
async def consult_respond(
    request: RespondRequest,
    x_correlation_id: str | None = Header(default=None, alias="X-Correlation-ID"),
) -> RespondResult:
    return await _consult_service().respond(request, correlation_id=x_correlation_id)


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/v1/consult/respond/stream", dependencies=[Depends(require_service_token)])
async def consult_respond_stream(
    request: RespondRequest,
    x_correlation_id: str | None = Header(default=None, alias="X-Correlation-ID"),
) -> StreamingResponse:
    """Server-sent events: `delta` {text} while the answer is written, `reset` when a retry discards shown text,
    then one `final` (the full RespondResult, grounded) or one `error` {status, detail}."""
    service = _consult_service()

    async def events():
        try:
            async for kind, payload in service.respond_stream(request, correlation_id=x_correlation_id):
                if kind == "delta":
                    yield _sse("delta", {"text": payload})
                elif kind == "reset":
                    yield _sse("reset", {})
                else:
                    yield _sse("final", payload.model_dump(mode="json"))
        except HTTPException as exc:
            yield _sse("error", {"status": exc.status_code, "detail": exc.detail})
        except Exception:  # noqa: BLE001 - the stream is already open, so report instead of raising
            logger.exception("consult respond stream crashed correlation=%s", x_correlation_id)
            yield _sse("error", {"status": 500, "detail": "AI stream failed"})

    return StreamingResponse(
        events(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/v1/ops/models", dependencies=[Depends(require_service_token)])
async def ops_models() -> dict:
    """Which models serve which task right now (operators change them through the environment)."""
    settings = get_settings()
    return {
        "provider": settings.provider,
        "openrouterConfigured": bool(settings.openrouter_api_key),
        "dataCollection": settings.openrouter_data_collection,
        "environment": settings.environment,
        "freeModelsOnly": settings.free_models_only,
        "tasks": [
            {"task": c.task, "tier": c.tier, "models": list(c.models), "maxTokens": c.max_tokens,
             "temperature": c.temperature, "timeoutSeconds": c.timeout_s}
            for c in all_task_configs()
        ],
        "limits": {
            "maxRequestsPerMinute": settings.max_requests_per_minute,
            "dailyCostLimitUsd": settings.daily_cost_limit_usd,
            "maxRetries": settings.llm_max_retries,
        },
    }


@router.get("/v1/ops/usage", dependencies=[Depends(require_service_token)])
async def ops_usage() -> dict:
    """Tokens, cost, latency, fallbacks and recent errors since this process started."""
    return ledger.snapshot()
