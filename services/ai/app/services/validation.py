"""
Validation service for AI-generated recommendations.

This module ensures that structured AI output conforms to expected contracts
and does NOT contain obviously malformed data. It does NOT validate business
rules like product existence, availability, or pricing — those are the backend's
responsibility.
"""

from app.contracts.guidance import GuidanceRecommendationResult, RoutineProposal


class ValidationError(Exception):
    """Raised when AI output fails validation."""
    pass


class RecommendationValidator:
    """Validates AI-generated recommendation structure and basic constraints."""

    def validate_result(self, result: GuidanceRecommendationResult) -> None:
        """
        Validate that the recommendation result conforms to expected structure.

        Raises:
            ValidationError: If the result is malformed or violates basic constraints.
        """
        if result.schemaVersion != "1":
            raise ValidationError(f"Unsupported schema version: {result.schemaVersion}")

        if not result.message or not result.message.strip():
            raise ValidationError("Message cannot be empty")

        if result.proposal:
            self._validate_proposal(result.proposal)

    def _validate_proposal(self, proposal: RoutineProposal) -> None:
        """Validate routine proposal structure."""
        if not proposal.title or not proposal.title.strip():
            raise ValidationError("Proposal title cannot be empty")

        if proposal.careArea not in {"skin", "hair"}:
            raise ValidationError(f"Invalid careArea: {proposal.careArea}")

        if not proposal.steps:
            raise ValidationError("Proposal must have at least one step")

        if len(proposal.steps) > 20:
            raise ValidationError("Proposal cannot have more than 20 steps")

        for idx, step in enumerate(proposal.steps):
            self._validate_step(step, idx)

    def _validate_step(self, step, idx: int) -> None:
        """Validate individual routine step."""
        if not step.title or not step.title.strip():
            raise ValidationError(f"Step {idx} title cannot be empty")

        if step.timing not in {"am", "pm", "both", "as_needed"}:
            raise ValidationError(f"Step {idx} has invalid timing: {step.timing}")

        # productQuery is optional, but if present should be reasonable
        if step.productQuery:
            query = step.productQuery.strip()
            if len(query) < 2:
                raise ValidationError(f"Step {idx} productQuery too short: '{query}'")
            if len(query) > 200:
                raise ValidationError(f"Step {idx} productQuery too long (max 200 chars)")
