import logging


logging.basicConfig(level="INFO", format="%(asctime)s %(levelname)s %(name)s %(message)s")

logger = logging.getLogger("shenacare.ai")


def correlation_log_context(correlation_id: str | None, candidate_ref: str | None) -> dict[str, str]:
    # Only opaque identifiers are logged, never request payloads.
    context: dict[str, str] = {}
    if correlation_id:
        context["correlationId"] = correlation_id
    if candidate_ref:
        context["candidateRef"] = candidate_ref
    return context
