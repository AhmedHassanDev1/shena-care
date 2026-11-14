"""OpenRouter-backed provider for every AI task of the service.

The legacy tasks (enrichment, content, the old guidance call) reuse the prompts of GroqProvider and only change
the transport; the consultation tasks use strict JSON schemas. Model choice lives in app.llm.model_config.
"""

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
            return UnderstandResult(**result.data, providerMetadata=result.metadata())
        except Exception as exc:  # pydantic ValidationError
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
            return RespondResult(**result.data, providerMetadata=result.metadata())
        except Exception as exc:
            raise ProviderResponseInvalidError(f"Response did not match the contract: {exc}") from exc
