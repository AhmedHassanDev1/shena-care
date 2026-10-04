"""Tests for guidance service with validation."""

import pytest
from fastapi import HTTPException

from app.contracts.guidance import (
    GuidanceRecommendationRequest,
    GuidanceRecommendationResult,
    RoutineProposal,
    RoutineStepProposal,
    UserProfileContext,
)
from app.providers.base import ProviderUnavailableError
from app.services.guidance_service import GuidanceService


class MockGuidanceProviderForTests:
    """Mock provider for testing validation flow."""

    name = "test-mock"

    def __init__(self, result: GuidanceRecommendationResult | Exception):
        self.result = result

    async def recommend(self, request: GuidanceRecommendationRequest) -> GuidanceRecommendationResult:
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


@pytest.fixture
def valid_request() -> GuidanceRecommendationRequest:
    return GuidanceRecommendationRequest(
        customerId="cust-123",
        profile=UserProfileContext(skinType="oily", concerns=["acne"]),
        chatHistory=[],
    )


@pytest.fixture
def valid_result() -> GuidanceRecommendationResult:
    return GuidanceRecommendationResult(
        schemaVersion="1",
        message="Here is your routine.",
        proposal=RoutineProposal(
            title="Acne Care Routine",
            careArea="skin",
            steps=[
                RoutineStepProposal(
                    title="Cleanse",
                    timing="both",
                    isOptional=False,
                    productQuery="Salicylic Acid Cleanser",
                )
            ],
        ),
    )


@pytest.mark.asyncio
async def test_valid_recommendation_passes(valid_request: GuidanceRecommendationRequest, valid_result: GuidanceRecommendationResult):
    provider = MockGuidanceProviderForTests(valid_result)
    service = GuidanceService(provider)

    result = await service.recommend(valid_request, correlation_id="test-corr-1")
    assert result.schemaVersion == "1"
    assert result.message == "Here is your routine."
    assert result.proposal is not None


@pytest.mark.asyncio
async def test_provider_unavailable_returns_503(valid_request: GuidanceRecommendationRequest):
    provider = MockGuidanceProviderForTests(ProviderUnavailableError("LLM down"))
    service = GuidanceService(provider)

    with pytest.raises(HTTPException) as exc_info:
        await service.recommend(valid_request, correlation_id="test-corr-2")
    assert exc_info.value.status_code == 503
    assert "AI provider unavailable" in exc_info.value.detail


@pytest.mark.asyncio
async def test_malformed_ai_output_returns_502(valid_request: GuidanceRecommendationRequest):
    # AI returns result with empty message
    bad_result = GuidanceRecommendationResult(
        schemaVersion="1",
        message="",
        proposal=None,
    )
    provider = MockGuidanceProviderForTests(bad_result)
    service = GuidanceService(provider)

    with pytest.raises(HTTPException) as exc_info:
        await service.recommend(valid_request, correlation_id="test-corr-3")
    assert exc_info.value.status_code == 502
    assert "invalid structured output" in exc_info.value.detail
    assert "Message cannot be empty" in exc_info.value.detail


@pytest.mark.asyncio
async def test_invalid_proposal_structure_returns_502(valid_request: GuidanceRecommendationRequest):
    # AI returns proposal with no steps
    bad_result = GuidanceRecommendationResult(
        schemaVersion="1",
        message="Here is your routine.",
        proposal=RoutineProposal(
            title="Empty Routine",
            careArea="skin",
            steps=[],
        ),
    )
    provider = MockGuidanceProviderForTests(bad_result)
    service = GuidanceService(provider)

    with pytest.raises(HTTPException) as exc_info:
        await service.recommend(valid_request, correlation_id="test-corr-4")
    assert exc_info.value.status_code == 502
    assert "invalid structured output" in exc_info.value.detail
    assert "must have at least one step" in exc_info.value.detail


@pytest.mark.asyncio
async def test_invalid_care_area_returns_502(valid_request: GuidanceRecommendationRequest, valid_result: GuidanceRecommendationResult):
    valid_result.proposal.careArea = "teeth"
    provider = MockGuidanceProviderForTests(valid_result)
    service = GuidanceService(provider)

    with pytest.raises(HTTPException) as exc_info:
        await service.recommend(valid_request, correlation_id="test-corr-5")
    assert exc_info.value.status_code == 502
    assert "Invalid careArea" in exc_info.value.detail
