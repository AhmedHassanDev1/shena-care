import logging

from fastapi import HTTPException, status

from app.contracts.enrichment import ProductEnrichmentRequest, ProductEnrichmentResult
from app.core.logging import correlation_log_context
from app.providers.base import (
    ProductEnrichmentProvider,
    ProviderResponseInvalidError,
    ProviderUnavailableError,
)

logger = logging.getLogger("shenacare.ai.enrichment")


class EnrichmentService:
    def __init__(self, enrichment_provider: ProductEnrichmentProvider) -> None:
        self.provider = enrichment_provider

    async def enrich(
        self, request: ProductEnrichmentRequest, correlation_id: str | None
    ) -> ProductEnrichmentResult:
        log_ctx = correlation_log_context(correlation_id, request.candidateRef)

        logger.info("enrichment attempt %s", log_ctx)
        try:
            result = await self.provider.enrich(request)
        except ProviderUnavailableError as exc:
            logger.warning("enrichment provider unavailable %s: %s", log_ctx, exc)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="AI provider unavailable",
            ) from exc
        except ProviderResponseInvalidError as exc:
            logger.warning("enrichment provider response invalid %s: %s", log_ctx, exc)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="AI provider returned an invalid response",
            ) from exc

        logger.info("enrichment success %s", log_ctx)
        return result
