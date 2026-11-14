"""OpenRouter gateway: the only code path that talks to a language model.

One call = one task. The task picks its models from model_config (primary + fallbacks), the gateway asks
OpenRouter for a JSON answer, retries transient failures a bounded number of times, records tokens, cost and
latency, and returns parsed JSON. Callers validate the JSON against their own contract.
"""

import asyncio
import json
import logging
import ssl
import time
from dataclasses import dataclass

import httpx

from app.core.config import get_settings
from app.llm.model_config import TaskConfig, task_config
from app.llm.usage import CallUsage, ledger
from app.providers.base import ProviderError, ProviderResponseInvalidError, ProviderUnavailableError

logger = logging.getLogger("shenacare.ai.llm")

RETRYABLE_STATUS = {408, 409, 425, 429, 500, 502, 503, 504, 520, 522, 524, 529}


class ProviderLimitError(ProviderUnavailableError):
    """The gateway refused the call locally (per-minute window or daily cost ceiling)."""

    def __init__(self, reason: str) -> None:
        super().__init__(f"AI gateway limit reached: {reason}")
        self.reason = reason


@dataclass
class LlmResult:
    data: dict
    model: str
    used_fallback: bool
    usage: CallUsage
    latency_ms: float
    attempts: int

    def metadata(self) -> dict:
        return {
            "provider": "openrouter",
            "model": self.model,
            "usedFallback": self.used_fallback,
            "promptTokens": self.usage.prompt_tokens,
            "completionTokens": self.usage.completion_tokens,
            "costUsd": round(self.usage.cost_usd, 6),
            "latencyMs": round(self.latency_ms, 1),
            "attempts": self.attempts,
        }


def _extract_json(content: object) -> dict:
    if isinstance(content, list):  # some providers return content parts
        content = "".join(part.get("text", "") for part in content if isinstance(part, dict))
    if not isinstance(content, str) or not content.strip():
        raise ProviderResponseInvalidError("Model returned an empty message")
    text = content.strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text[4:] if text.lower().startswith("json") else text
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise ProviderResponseInvalidError("Model did not return a JSON object")
    try:
        parsed = json.loads(text[start : end + 1])
    except json.JSONDecodeError as exc:
        raise ProviderResponseInvalidError(f"Model returned malformed JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise ProviderResponseInvalidError("Model JSON was not an object")
    return parsed


class LlmGateway:
    name = "openrouter"

    def __init__(self, transport: httpx.AsyncBaseTransport | None = None, sleep=asyncio.sleep) -> None:
        self._settings = get_settings()
        if not self._settings.openrouter_api_key:
            raise ProviderUnavailableError("OPENROUTER_API_KEY is not configured")
        self._transport = transport
        self._sleep = sleep

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self._settings.openrouter_api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": self._settings.openrouter_app_url,
            "X-Title": self._settings.openrouter_app_title,
        }

    def _payload(self, cfg: TaskConfig, models: tuple[str, ...], messages: list[dict], schema: dict | None, schema_name: str) -> dict:
        payload: dict = {
            # OpenRouter tries these in order when a model's providers are down, rate-limited or refuse.
            "models": list(models),
            "messages": messages,
            "max_tokens": cfg.max_tokens,
            "provider": {"data_collection": self._settings.openrouter_data_collection},
        }
        if cfg.temperature is not None:
            payload["temperature"] = cfg.temperature
        if schema is not None:
            payload["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": schema_name, "strict": True, "schema": schema},
            }
            payload["provider"]["require_parameters"] = True
        else:
            payload["response_format"] = {"type": "json_object"}
        return payload

    async def complete_json(
        self,
        task: str,
        *,
        system: str,
        user: str | None = None,
        messages: list[dict] | None = None,
        schema: dict | None = None,
        schema_name: str = "result",
    ) -> LlmResult:
        cfg = task_config(task)
        refusal = ledger.admit(self._settings.max_requests_per_minute, self._settings.daily_cost_limit_usd)
        if refusal:
            ledger.record_failure(task, "limit", refusal)
            raise ProviderLimitError(refusal)

        chat = [{"role": "system", "content": system}]
        chat.extend(messages or [])
        if user is not None:
            chat.append({"role": "user", "content": user})

        started = time.monotonic()
        max_attempts = 1 + self._settings.llm_max_retries
        models = cfg.models
        last_error: Exception | None = None

        # Verify TLS against the operating system's trust store (honours SSL_CERT_FILE), so the service works
        # behind a corporate or antivirus TLS proxy without ever disabling verification.
        client_options: dict = {"timeout": cfg.timeout_s}
        if self._transport is not None:
            client_options["transport"] = self._transport
        else:
            client_options["verify"] = ssl.create_default_context()
        async with httpx.AsyncClient(**client_options) as client:
            for attempt in range(1, max_attempts + 1):
                try:
                    response = await client.post(
                        f"{self._settings.openrouter_base_url}/chat/completions",
                        headers=self._headers(),
                        json=self._payload(cfg, models, chat, schema, schema_name),
                    )
                except httpx.TimeoutException as exc:
                    last_error = ProviderUnavailableError(f"OpenRouter timed out after {cfg.timeout_s}s")
                    logger.warning("llm timeout task=%s attempt=%s", task, attempt)
                except httpx.RequestError as exc:
                    last_error = ProviderUnavailableError(f"Network error calling OpenRouter: {type(exc).__name__}")
                    logger.warning("llm network error task=%s attempt=%s kind=%s", task, attempt, type(exc).__name__)
                else:
                    outcome = self._read(response, task, models, started, attempt)
                    if isinstance(outcome, LlmResult):
                        return outcome
                    last_error, retryable, drop_model = outcome
                    if drop_model and len(models) > 1:
                        # The primary answered but unusably (bad JSON / schema refused): go straight to the fallbacks.
                        models = models[1:]
                    elif not retryable:
                        break
                if attempt < max_attempts:
                    await self._sleep(min(0.4 * (2 ** (attempt - 1)), 3.0))

        kind = "invalid" if isinstance(last_error, ProviderResponseInvalidError) else "unavailable"
        ledger.record_failure(task, kind, str(last_error))
        raise last_error or ProviderUnavailableError("OpenRouter call failed")

    def _read(self, response: httpx.Response, task: str, models: tuple[str, ...], started: float, attempt: int):
        """Returns an LlmResult, or (error, retryable, drop_primary_model)."""
        status = response.status_code
        try:
            body = response.json()
        except ValueError:
            body = None

        error = body.get("error") if isinstance(body, dict) else None
        if status != 200 or error:
            code = (error or {}).get("code", status) if isinstance(error, dict) else status
            message = str((error or {}).get("message", ""))[:200] if isinstance(error, dict) else ""
            logger.warning("llm upstream error task=%s status=%s code=%s attempt=%s", task, status, code, attempt)
            if status in (401, 403):
                return ProviderUnavailableError("OpenRouter rejected the API key"), False, False
            if status == 402:
                return ProviderUnavailableError("OpenRouter account has insufficient credits"), False, False
            retryable = status in RETRYABLE_STATUS or (isinstance(code, int) and code in RETRYABLE_STATUS)
            if retryable:
                return ProviderUnavailableError(f"OpenRouter upstream error {code}"), True, False
            # 400/404/422: usually a model that is gone or rejects the request shape; a fallback may still work.
            return ProviderError(f"OpenRouter refused the request ({code}): {message}"), len(models) > 1, True

        try:
            choice = body["choices"][0]
            data = _extract_json(choice["message"].get("content"))
        except ProviderResponseInvalidError as exc:
            logger.warning("llm invalid output task=%s model=%s attempt=%s", task, body.get("model"), attempt)
            return exc, True, True
        except (KeyError, IndexError, TypeError, AttributeError):
            return ProviderResponseInvalidError("OpenRouter response had no message"), True, True

        raw_usage = body.get("usage") or {}
        usage = CallUsage(
            prompt_tokens=int(raw_usage.get("prompt_tokens") or 0),
            completion_tokens=int(raw_usage.get("completion_tokens") or 0),
            cost_usd=float(raw_usage.get("cost") or 0.0),
        )
        model = str(body.get("model") or models[0])
        configured_primary = task_config(task).models[0]
        used_fallback = model.split(":")[0] != configured_primary.split(":")[0] and not model.startswith(configured_primary)
        latency_ms = (time.monotonic() - started) * 1000
        ledger.record(task, model, usage, latency_ms, used_fallback=used_fallback)
        logger.info(
            "llm ok task=%s model=%s fallback=%s prompt=%s completion=%s cost=%.6f latency_ms=%.0f attempts=%s",
            task, model, used_fallback, usage.prompt_tokens, usage.completion_tokens, usage.cost_usd, latency_ms, attempt,
        )
        return LlmResult(data=data, model=model, used_fallback=used_fallback, usage=usage, latency_ms=latency_ms, attempts=attempt)
