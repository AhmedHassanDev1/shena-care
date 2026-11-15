"""OpenRouter-backed provider for every AI task of the service.

The legacy tasks (enrichment, content, the old guidance call) reuse the prompts of GroqProvider and only change
the transport; the consultation tasks use strict JSON schemas. Model choice lives in app.llm.model_config.
"""

import logging
from collections.abc import AsyncIterator

import httpx

from app.contracts.consult import RespondRequest, RespondResult, UnderstandRequest, UnderstandResult
from app.llm.consult_prompts import (
    RESPOND_SCHEMA,
    RESPOND_SYSTEM,
    UNDERSTAND_SCHEMA,
    UNDERSTAND_SYSTEM,
    respond_user_prompt,
    understand_user_prompt,
)
from app.llm.gateway import LlmGateway
from app.providers.base import ProviderResponseInvalidError
from app.providers.groq_provider import GroqProvider

logger = logging.getLogger("shenacare.ai.openrouter")


def _clip(value, limit: int):
    return value[:limit] if isinstance(value, str) else value


def _clip_list(value, limit: int):
    return value[:limit] if isinstance(value, list) else value


def _fit_understanding(data: dict) -> dict:
    """Length limits are presentation limits: an over-long list is trimmed, never a reason to discard the reading."""
    data = dict(data)
    for key, limit in (("mentionedProducts", 6), ("mentionedIngredients", 8), ("redFlags", 6), ("missing", 5)):
        data[key] = _clip_list(data.get(key), limit)
    if isinstance(data.get("redFlags"), list):
        data["redFlags"] = [{**f, "evidence": _clip(f.get("evidence"), 200)} if isinstance(f, dict) else f for f in data["redFlags"]]
    ctx = data.get("context")
    if isinstance(ctx, dict):
        ctx = dict(ctx)
        for key, limit in (("concerns", 6), ("productTypes", 6), ("sensitivities", 8), ("ownedProducts", 8)):
            ctx[key] = _clip_list(ctx.get(key), limit)
        ctx["hairType"] = _clip(ctx.get("hairType"), 40)
        data["context"] = ctx
    return data


def _fit_response(data: dict) -> dict:
    data = dict(data)
    data["message"] = _clip(data.get("message"), 2400)
    data["followUpQuestion"] = _clip(data.get("followUpQuestion"), 300)
    data["quickReplies"] = [_clip(q, 60) for q in (_clip_list(data.get("quickReplies"), 4) or [])]
    data["citations"] = _clip_list(data.get("citations"), 8)
    recs = _clip_list(data.get("recommendations"), 6) or []
    data["recommendations"] = [{**r, "why": _clip(r.get("why"), 400)} if isinstance(r, dict) else r for r in recs]
    routine = data.get("routine")
    if isinstance(routine, dict):
        steps = _clip_list(routine.get("steps"), 12) or []
        data["routine"] = {
            **routine,
            "title": _clip(routine.get("title"), 120),
            "steps": [{**s, "why": _clip(s.get("why"), 300), "howToUse": _clip(s.get("howToUse"), 300)} if isinstance(s, dict) else s for s in steps],
        }
    return data


class OpenRouterProvider(GroqProvider):
    name = "openrouter"
    model = "openrouter"

    def __init__(self, transport: httpx.AsyncBaseTransport | None = None, sleep=None) -> None:  # noqa: D401
        # Deliberately not calling GroqProvider.__init__: this provider needs no Groq key.
        self.gateway = LlmGateway(transport=transport, **({"sleep": sleep} if sleep else {}))

    async def _call_chat_completions(self, system_prompt: str, user_prompt: str, temperature: float = 0.2, task: str = "") -> dict:
        result = await self.gateway.complete_json(task or "guidance.legacy", system=system_prompt, user=user_prompt)
        self.model = result.model
        return result.data

    async def understand(self, request: UnderstandRequest) -> UnderstandResult:
        result = await self.gateway.complete_json(
            "consult.understand",
            system=UNDERSTAND_SYSTEM,
            user=understand_user_prompt(request),
            schema=UNDERSTAND_SCHEMA,
            schema_name="consult_understanding",
        )
        try:
            return UnderstandResult(**_fit_understanding(result.data), providerMetadata=result.metadata())
        except Exception as exc:  # pydantic ValidationError
            logger.warning("understanding broke the contract model=%s: %s", result.model, str(exc)[:500])
            raise ProviderResponseInvalidError(f"Understanding did not match the contract: {exc}") from exc

    async def respond(self, request: RespondRequest) -> RespondResult:
        result = await self.gateway.complete_json(
            "consult.respond",
            system=RESPOND_SYSTEM,
            user=respond_user_prompt(request),
            schema=RESPOND_SCHEMA,
            schema_name="consult_response",
        )
        try:
            return RespondResult(**_fit_response(result.data), providerMetadata=result.metadata())
        except Exception as exc:
            logger.warning("response broke the contract model=%s: %s", result.model, str(exc)[:500])
            raise ProviderResponseInvalidError(f"Response did not match the contract: {exc}") from exc

    async def respond_stream(self, request: RespondRequest) -> AsyncIterator[tuple[str, object]]:
        """Same call as respond(), streamed: ("delta", text) / ("reset", None) / ("final", RespondResult)."""
        async for kind, payload in self.gateway.stream_json(
            "consult.respond",
            system=RESPOND_SYSTEM,
            user=respond_user_prompt(request),
            schema=RESPOND_SCHEMA,
            schema_name="consult_response",
            text_field="message",
        ):
            if kind != "final":
                yield kind, payload
                continue
            try:
                yield "final", RespondResult(**_fit_response(payload.data), providerMetadata=payload.metadata())
            except Exception as exc:
                logger.warning("streamed response broke the contract model=%s: %s", payload.model, str(exc)[:500])
                raise ProviderResponseInvalidError(f"Response did not match the contract: {exc}") from exc
