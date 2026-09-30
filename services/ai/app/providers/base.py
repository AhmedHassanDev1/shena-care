from typing import Protocol, runtime_checkable

from app.contracts.enrichment import ProductEnrichmentRequest, ProductEnrichmentResult
from app.contracts.guidance import GuidanceRecommendationRequest, GuidanceRecommendationResult


@runtime_checkable
class ProductEnrichmentProvider(Protocol):
    name: str

    async def enrich(self, request: ProductEnrichmentRequest) -> ProductEnrichmentResult: ...

@runtime_checkable
class GuidanceProvider(Protocol):
    name: str

    async def recommend(self, request: 'GuidanceRecommendationRequest') -> 'GuidanceRecommendationResult': ...


class ProviderError(Exception):
    """Raised by providers when enrichment fails (network, upstream, quota...)."""


class ProviderUnavailableError(ProviderError):
    """The provider could not be reached or is not configured."""


class ProviderResponseInvalidError(ProviderError):
    """The provider answered but its output failed contract validation."""
