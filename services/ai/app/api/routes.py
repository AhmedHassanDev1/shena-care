from fastapi import APIRouter, Header, status

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
from app.core.config import get_settings
from app.providers.registry import get_provider, get_guidance_provider, get_content_provider
from app.services.enrichment_service import EnrichmentService
from app.services.guidance_service import GuidanceService
from app.services.content_service import ContentGenerationService

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    # Reports only this process's state; no claim about external AI provider health.
    provider = get_provider(get_settings().provider)
    return HealthResponse(status="ok", service="shenacare-ai", provider=provider.name)


@router.post(
    "/v1/enrichment/product",
    response_model=ProductEnrichmentResult,
    status_code=status.HTTP_200_OK,
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
)
async def generate_content(
    request: ProductContentGenerationRequest,
    x_correlation_id: str | None = Header(default=None, alias="X-Correlation-ID"),
) -> ProductContentGenerationResult:
    service = ContentGenerationService(get_content_provider(get_settings().provider))
    return await service.generate(request, correlation_id=x_correlation_id)
