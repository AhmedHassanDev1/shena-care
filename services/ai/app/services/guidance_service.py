import logging

from fastapi import HTTPException, status

from app.contracts.guidance import GuidanceRecommendationRequest, GuidanceRecommendationResult
from app.providers.base import (
    GuidanceProvider,
    ProviderResponseInvalidError,
    ProviderUnavailableError,
)
from app.services.validation import RecommendationValidator, ValidationError

logger = logging.getLogger("shenacare.ai.guidance")

class GuidanceService:
    def __init__(self, guidance_provider: GuidanceProvider) -> None:
        self.provider = guidance_provider
        self.validator = RecommendationValidator()

    async def recommend(
        self, request: GuidanceRecommendationRequest, correlation_id: str | None
    ) -> GuidanceRecommendationResult:
        logger.info(f"guidance recommendation attempt for {request.customerId} (correlation={correlation_id})")
        try:
            result = await self.provider.recommend(request)
        except ProviderUnavailableError as exc:
            logger.warning(f"guidance provider unavailable: {exc}")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="AI provider unavailable",
            ) from exc
        except ProviderResponseInvalidError as exc:
            logger.warning(f"guidance provider response invalid: {exc}")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="AI provider returned an invalid response",
            ) from exc

        # Validate structured output before returning
        try:
            self.validator.validate_result(result)
        except ValidationError as exc:
            logger.warning(f"AI output validation failed for {request.customerId}: {exc}")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"AI provider returned invalid structured output: {str(exc)}",
            ) from exc

        logger.info(f"guidance success for {request.customerId}")
        return result
