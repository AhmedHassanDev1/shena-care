import json

import httpx
import pytest

from app.contracts.enrichment import ProductEnrichmentRequest
from app.core.config import get_settings
from app.providers.groq_provider import GroqProvider
from app.services.enrichment_service import EnrichmentService


@pytest.mark.asyncio
async def test_groq_provider_enriches_through_service_contract(monkeypatch):
    """A real provider response must pass through the same method the route invokes."""
    monkeypatch.setenv("GROQ_API_KEY", "local-test-key")
    get_settings.cache_clear()
    requests = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps({
            "normalizedTitle": "CeraVe Lotion 236ml",
            "brand": "CeraVe",
            "ingredients": ["Glycerin"],
            "confidenceScore": 0.8,
        })}}]})

    transport = httpx.MockTransport(respond)
    real_client = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: real_client(transport=transport, **kwargs))
    try:
        provider = GroqProvider()
        result = await EnrichmentService(provider).enrich(ProductEnrichmentRequest(
            candidateRef="candidate-1", sourceType="supplier_item",
            rawTitle="CeraVe Lotion 236ml", brand="CeraVe",
        ), correlation_id="local-test")
    finally:
        get_settings.cache_clear()

    assert len(requests) == 1
    assert requests[0].url.path == "/openai/v1/chat/completions"
    assert result.suggestions.normalizedTitle == "CeraVe Lotion 236ml"
    assert result.suggestions.ingredients == ["Glycerin"]
    assert result.confidence == {"overall": 0.8}
    assert result.providerMetadata["provider"] == "groq"
