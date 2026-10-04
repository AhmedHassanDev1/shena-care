"""Tests for AI recommendation validation."""

import pytest

from app.contracts.guidance import (
    GuidanceRecommendationResult,
    RoutineProposal,
    RoutineStepProposal,
)
from app.services.validation import RecommendationValidator, ValidationError


@pytest.fixture
def validator() -> RecommendationValidator:
    return RecommendationValidator()


@pytest.fixture
def valid_result() -> GuidanceRecommendationResult:
    return GuidanceRecommendationResult(
        schemaVersion="1",
        message="Here is your recommended routine.",
        proposal=RoutineProposal(
            title="Morning Routine",
            description="A simple morning routine",
            careArea="skin",
            steps=[
                RoutineStepProposal(
                    title="Cleanse",
                    instructions="Wash your face",
                    timing="am",
                    isOptional=False,
                    productQuery="Gentle Cleanser",
                )
            ],
        ),
    )


def test_valid_result_passes(validator: RecommendationValidator, valid_result: GuidanceRecommendationResult):
    # Should not raise
    validator.validate_result(valid_result)


def test_empty_message_fails(validator: RecommendationValidator, valid_result: GuidanceRecommendationResult):
    valid_result.message = ""
    with pytest.raises(ValidationError, match="Message cannot be empty"):
        validator.validate_result(valid_result)


def test_whitespace_message_fails(validator: RecommendationValidator, valid_result: GuidanceRecommendationResult):
    valid_result.message = "   "
    with pytest.raises(ValidationError, match="Message cannot be empty"):
        validator.validate_result(valid_result)


def test_unsupported_schema_version_fails(validator: RecommendationValidator, valid_result: GuidanceRecommendationResult):
    valid_result.schemaVersion = "2"
    with pytest.raises(ValidationError, match="Unsupported schema version: 2"):
        validator.validate_result(valid_result)


def test_result_without_proposal_passes(validator: RecommendationValidator):
    result = GuidanceRecommendationResult(
        schemaVersion="1",
        message="Tell me more about your concerns.",
        proposal=None,
    )
    # Should not raise
    validator.validate_result(result)


def test_empty_proposal_title_fails(validator: RecommendationValidator, valid_result: GuidanceRecommendationResult):
    valid_result.proposal.title = ""
    with pytest.raises(ValidationError, match="Proposal title cannot be empty"):
        validator.validate_result(valid_result)


def test_invalid_care_area_fails(validator: RecommendationValidator, valid_result: GuidanceRecommendationResult):
    valid_result.proposal.careArea = "nails"
    with pytest.raises(ValidationError, match="Invalid careArea: nails"):
        validator.validate_result(valid_result)


def test_proposal_without_steps_fails(validator: RecommendationValidator, valid_result: GuidanceRecommendationResult):
    valid_result.proposal.steps = []
    with pytest.raises(ValidationError, match="Proposal must have at least one step"):
        validator.validate_result(valid_result)


def test_proposal_with_too_many_steps_fails(validator: RecommendationValidator, valid_result: GuidanceRecommendationResult):
    valid_result.proposal.steps = [
        RoutineStepProposal(
            title=f"Step {i}",
            timing="am",
            isOptional=False,
        )
        for i in range(21)
    ]
    with pytest.raises(ValidationError, match="Proposal cannot have more than 20 steps"):
        validator.validate_result(valid_result)


def test_empty_step_title_fails(validator: RecommendationValidator, valid_result: GuidanceRecommendationResult):
    valid_result.proposal.steps[0].title = ""
    with pytest.raises(ValidationError, match="Step 0 title cannot be empty"):
        validator.validate_result(valid_result)


def test_invalid_step_timing_fails(validator: RecommendationValidator, valid_result: GuidanceRecommendationResult):
    valid_result.proposal.steps[0].timing = "noon"
    with pytest.raises(ValidationError, match="Step 0 has invalid timing: noon"):
        validator.validate_result(valid_result)


def test_too_short_product_query_fails(validator: RecommendationValidator, valid_result: GuidanceRecommendationResult):
    valid_result.proposal.steps[0].productQuery = "a"
    with pytest.raises(ValidationError, match="Step 0 productQuery too short"):
        validator.validate_result(valid_result)


def test_too_long_product_query_fails(validator: RecommendationValidator, valid_result: GuidanceRecommendationResult):
    valid_result.proposal.steps[0].productQuery = "x" * 201
    with pytest.raises(ValidationError, match="Step 0 productQuery too long"):
        validator.validate_result(valid_result)


def test_missing_product_query_passes(validator: RecommendationValidator, valid_result: GuidanceRecommendationResult):
    valid_result.proposal.steps[0].productQuery = None
    # Should not raise
    validator.validate_result(valid_result)


def test_valid_timing_values_pass(validator: RecommendationValidator, valid_result: GuidanceRecommendationResult):
    for timing in ["am", "pm", "both", "as_needed"]:
        valid_result.proposal.steps[0].timing = timing
        validator.validate_result(valid_result)
