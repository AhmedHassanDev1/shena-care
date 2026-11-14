import logging

from fastapi import HTTPException, status

from app.contracts.consult import RespondRequest, RespondResult, UnderstandRequest, UnderstandResult
from app.llm.gateway import ProviderLimitError
from app.providers.base import ProviderError, ProviderResponseInvalidError, ProviderUnavailableError

logger = logging.getLogger("shenacare.ai.consult")


def _http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, ProviderLimitError):
        return HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=f"AI gateway limit: {exc.reason}")
    if isinstance(exc, ProviderUnavailableError):
        return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="AI provider unavailable")
    return HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="AI provider returned an invalid response")


class ConsultService:
    """Wraps the provider with the checks that do not depend on the model behaving."""

    def __init__(self, provider) -> None:
        self.provider = provider

    async def understand(self, request: UnderstandRequest, correlation_id: str | None) -> UnderstandResult:
        try:
            result = await self.provider.understand(request)
        except (ProviderError, ProviderResponseInvalidError) as exc:
            logger.warning("consult understand failed subject=%s correlation=%s kind=%s", request.subject, correlation_id, type(exc).__name__)
            raise _http_error(exc) from exc

        # The model may only use the vocabulary it was given; anything else is dropped, not trusted.
        concern_slugs = {c.slug for c in request.concernVocabulary}
        product_types = set(request.productTypeVocabulary)
        result.context.concerns = [c for c in dict.fromkeys(result.context.concerns) if c in concern_slugs]
        result.context.productTypes = [t for t in dict.fromkeys(result.context.productTypes) if t in product_types]
        if result.context.budgetMax is not None and result.context.budgetMax <= 0:
            result.context.budgetMax = None
        return result

    async def respond(self, request: RespondRequest, correlation_id: str | None) -> RespondResult:
        try:
            result = await self.provider.respond(request)
        except (ProviderError, ProviderResponseInvalidError) as exc:
            logger.warning("consult respond failed subject=%s correlation=%s kind=%s", request.subject, correlation_id, type(exc).__name__)
            raise _http_error(exc) from exc

        candidate_refs = {c.ref for c in request.candidates}
        knowledge_refs = {k.ref for k in request.knowledge}
        draft = {(s.ref, s.slot) for s in request.routineDraft}

        seen: set[str] = set()
        kept = []
        for rec in result.recommendations:
            if rec.ref in candidate_refs and rec.ref not in seen:
                seen.add(rec.ref)
                kept.append(rec)
        dropped = len(result.recommendations) - len(kept)
        result.recommendations = kept
        result.citations = [c for c in dict.fromkeys(result.citations) if c in knowledge_refs]

        if result.routine is not None:
            # A routine may only contain what the backend ordered and checked.
            result.routine.steps = [s for s in result.routine.steps if (s.ref, s.slot) in draft]
            if not result.routine.steps:
                result.routine = None

        if request.mustClarify or request.escalation:
            # The backend decided not to recommend on this turn; the model does not get to overrule it.
            result.recommendations = [] if request.mustClarify else result.recommendations
            result.routine = None
        if request.escalation:
            result.followUpQuestion = None
            result.quickReplies = []
        if dropped:
            logger.warning("consult respond dropped %s ungrounded recommendation(s) subject=%s", dropped, request.subject)
        return result
