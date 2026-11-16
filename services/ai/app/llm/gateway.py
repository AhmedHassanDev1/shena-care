"""OpenRouter gateway: the only code path that talks to a language model.

One call = one task. The task picks its models from model_config (primary + fallbacks), the gateway asks
OpenRouter for a JSON answer, retries transient failures a bounded number of times, records tokens, cost and
latency, and returns parsed JSON. Callers validate the JSON against their own contract.
"""

import asyncio
import json
import logging
import re
import ssl
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass

import httpx

from app.core.config import get_settings
from app.llm.model_config import TaskConfig, is_free_model, task_config
from app.llm.usage import CallUsage, ledger
from app.providers.base import ProviderError, ProviderResponseInvalidError, ProviderUnavailableError

logger = logging.getLogger("shenacare.ai.llm")

RETRYABLE_STATUS = {408, 409, 425, 429, 500, 502, 503, 504, 520, 522, 524, 529}


def _default_ssl_context() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    if hasattr(ctx, "load_default_certs"):
        try:
            ctx.load_default_certs()
        except Exception:
            pass
    return ctx


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


_SIMPLE_ESCAPES = {'"': '"', "\\": "\\", "/": "/", "b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t"}


class JsonStringFieldStream:
    """Incrementally decodes the string value of one key from a growing JSON text.

    feed() takes the next chunk of the model's raw output and returns only the newly decoded characters of that
    field's value (empty until the key appears, and again once its closing quote has been seen). Escapes split
    across chunks (a trailing backslash, half a unicode escape) are held back until they are complete.
    """

    def __init__(self, field: str) -> None:
        self._pattern = re.compile(r'"' + re.escape(field) + r'"\s*:\s*"')
        self._buf = ""
        self._pos: int | None = None
        self.done = False

    def feed(self, chunk: str) -> str:
        self._buf += chunk
        if self.done:
            return ""
        buf = self._buf
        if self._pos is None:
            match = self._pattern.search(buf)
            if not match:
                return ""
            self._pos = match.end()
        out: list[str] = []
        i = self._pos
        while i < len(buf):
            ch = buf[i]
            if ch == '"':
                self.done = True
                i += 1
                break
            if ch != "\\":
                out.append(ch)
                i += 1
                continue
            if i + 1 >= len(buf):
                break
            nxt = buf[i + 1]
            if nxt != "u":
                out.append(_SIMPLE_ESCAPES.get(nxt, nxt))
                i += 2
                continue
            if i + 6 > len(buf):
                break
            try:
                code = int(buf[i + 2 : i + 6], 16)
                if 0xD800 <= code < 0xDC00:
                    if i + 12 > len(buf):
                        break
                    if buf[i + 6 : i + 8] == "\\u":
                        low = int(buf[i + 8 : i + 12], 16)
                        out.append(chr(0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00)))
                        i += 12
                        continue
                out.append(chr(code))
            except ValueError:
                out.append(buf[i : i + 6])
            i += 6
        self._pos = i
        return "".join(out)


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
        # Dynamic routers may select endpoints with mandatory reasoning. Leave
        # model-specific reasoning controls unset instead of disabling them.
        if schema is not None:
            payload["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": schema_name, "strict": True, "schema": schema},
            }
            payload["provider"]["require_parameters"] = True
        else:
            payload["response_format"] = {"type": "json_object"}
        return payload

    def _guard_free_models(self, task: str, cfg: TaskConfig) -> None:
        if self._settings.free_models_only:
            # Hard guard for the development free-model mode: never put a paid model on the wire.
            paid = [m for m in cfg.models if not is_free_model(m)]
            if paid:
                msg = f"free-model mode refuses non-free models for {task}: {', '.join(paid)}"
                ledger.record_failure(task, "limit", msg)
                raise ProviderLimitError(msg)

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
        self._guard_free_models(task, cfg)
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
            client_options["verify"] = _default_ssl_context()
        async with httpx.AsyncClient(**client_options) as client:
            for attempt in range(1, max_attempts + 1):
                try:
                    # httpx's read timeout restarts whenever bytes arrive. Bound
                    # the whole non-streaming attempt, including a trickled body.
                    response = await asyncio.wait_for(client.post(
                        f"{self._settings.openrouter_base_url}/chat/completions",
                        headers=self._headers(),
                        json=self._payload(cfg, models, chat, schema, schema_name),
                    ), timeout=cfg.timeout_s)
                except (httpx.TimeoutException, TimeoutError) as exc:
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

    async def stream_json(
        self,
        task: str,
        *,
        system: str,
        user: str | None = None,
        messages: list[dict] | None = None,
        schema: dict | None = None,
        schema_name: str = "result",
        text_field: str = "message",
    ) -> AsyncIterator[tuple[str, object]]:
        """Like complete_json, but streams the model's output.

        Yields ("delta", text) as the `text_field` string grows, ("reset", None) when a retry or fallback model
        starts after text was already shown (the caller must discard it), and finally ("final", LlmResult) with the
        whole JSON parsed. Failures before any text retry exactly like complete_json; the same errors are raised.
        Closing or cancelling the iterator closes the upstream connection, which stops generation at OpenRouter.
        """
        cfg = task_config(task)
        self._guard_free_models(task, cfg)
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
        shown_text = False

        client_options: dict = {"timeout": cfg.timeout_s}
        if self._transport is not None:
            client_options["transport"] = self._transport
        else:
            client_options["verify"] = _default_ssl_context()

        try:
            async with httpx.AsyncClient(**client_options) as client:
                for attempt in range(1, max_attempts + 1):
                    if shown_text:
                        shown_text = False
                        yield ("reset", None)
                    payload = self._payload(cfg, models, chat, schema, schema_name)
                    payload["stream"] = True
                    payload["usage"] = {"include": True}  # cost and token counts arrive in the last chunk
                    parts: list[str] = []
                    streamer = JsonStringFieldStream(text_field)
                    model_name: str | None = None
                    raw_usage: object = None
                    finish: str | None = None
                    stream_error: str | None = None
                    # A model that has written nothing by then is stuck in hidden reasoning: replace it (half the task timeout).
                    first_content_deadline = time.monotonic() + cfg.timeout_s / 2
                    try:
                        async with client.stream(
                            "POST", f"{self._settings.openrouter_base_url}/chat/completions",
                            headers=self._headers(), json=payload,
                        ) as response:
                            if response.status_code != 200:
                                await response.aread()
                                last_error, retryable, drop_model = self._read(response, task, models, started, attempt)
                                if drop_model and len(models) > 1:
                                    models = models[1:]
                                elif not retryable:
                                    break
                                if attempt < max_attempts:
                                    await self._sleep(min(0.4 * (2 ** (attempt - 1)), 3.0))
                                continue
                            lines = response.aiter_lines().__aiter__()
                            while True:
                                # OpenRouter sends keep-alive comments while a model "thinks", which resets httpx's read
                                # timeout: without this deadline a model that never writes would hold the call forever.
                                # Once content flows there is no deadline here (the caller's idle timeout still applies).
                                wait = None if parts else max(0.05, first_content_deadline - time.monotonic())
                                try:
                                    line = await asyncio.wait_for(lines.__anext__(), wait)
                                except StopAsyncIteration:
                                    break
                                except asyncio.TimeoutError as exc:
                                    raise httpx.ReadTimeout("no content before the first-content deadline") from exc
                                if not line.startswith("data:"):
                                    continue  # SSE comments such as ": OPENROUTER PROCESSING" are keep-alives
                                data_text = line[5:].strip()
                                if data_text == "[DONE]":
                                    break
                                try:
                                    chunk = json.loads(data_text)
                                except ValueError:
                                    continue
                                if not isinstance(chunk, dict):
                                    continue
                                if chunk.get("error"):
                                    err = chunk["error"]
                                    stream_error = str(err.get("message", "stream error"))[:200] if isinstance(err, dict) else "stream error"
                                    break
                                model_name = chunk.get("model") or model_name
                                if chunk.get("usage"):
                                    raw_usage = chunk["usage"]
                                for choice in chunk.get("choices") or []:
                                    delta = choice.get("delta") or {}
                                    piece = delta.get("content")
                                    if isinstance(piece, str) and piece:
                                        parts.append(piece)
                                        text = streamer.feed(piece)
                                        if text:
                                            shown_text = True
                                            yield ("delta", text)
                                    if choice.get("finish_reason"):
                                        finish = choice["finish_reason"]
                    except httpx.TimeoutException:
                        last_error = ProviderUnavailableError(f"OpenRouter timed out after {cfg.timeout_s}s")
                        logger.warning("llm stream timeout task=%s model=%s attempt=%s", task, model_name, attempt)
                    except httpx.RequestError as exc:
                        last_error = ProviderUnavailableError(f"Network error calling OpenRouter: {type(exc).__name__}")
                        logger.warning("llm stream network error task=%s attempt=%s kind=%s", task, attempt, type(exc).__name__)
                    else:
                        if stream_error:
                            last_error = ProviderUnavailableError(f"OpenRouter stream error: {stream_error}")
                            logger.warning("llm stream error task=%s attempt=%s detail=%s", task, attempt, stream_error)
                        else:
                            try:
                                data = _extract_json("".join(parts))
                            except ProviderResponseInvalidError as exc:
                                logger.warning("llm invalid output task=%s model=%s attempt=%s finish_reason=%s", task, model_name, attempt, finish)
                                last_error = exc
                                if len(models) > 1:
                                    models = models[1:]
                            else:
                                yield ("final", self._record_success(task, str(model_name or models[0]), raw_usage, data, started, attempt))
                                return
                    if attempt < max_attempts:
                        await self._sleep(min(0.4 * (2 ** (attempt - 1)), 3.0))
        except asyncio.CancelledError:
            ledger.record_failure(task, "cancelled", "client closed the stream")
            logger.info("llm stream cancelled task=%s", task)
            raise

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
            # The free router answers 404 ("no endpoints found") whenever every free provider is busy for a moment; the
            # next attempt is routed again, so in free mode that is worth retrying even with a single model.
            free_flake = self._settings.free_models_only and status == 404
            return ProviderError(f"OpenRouter refused the request ({code}): {message}"), len(models) > 1 or free_flake, True

        try:
            choice = body["choices"][0]
            data = _extract_json(choice["message"].get("content"))
        except ProviderResponseInvalidError as exc:
            finish = (body.get("choices") or [{}])[0].get("finish_reason") if isinstance(body.get("choices"), list) else None
            logger.warning("llm invalid output task=%s model=%s attempt=%s finish_reason=%s", task, body.get("model"), attempt, finish)
            return exc, True, True
        except (KeyError, IndexError, TypeError, AttributeError):
            return ProviderResponseInvalidError("OpenRouter response had no message"), True, True

        return self._record_success(task, str(body.get("model") or models[0]), body.get("usage"), data, started, attempt)

    def _record_success(self, task: str, model: str, raw_usage: object, data: dict, started: float, attempt: int) -> LlmResult:
        raw_usage = raw_usage if isinstance(raw_usage, dict) else {}
        usage = CallUsage(
            prompt_tokens=int(raw_usage.get("prompt_tokens") or 0),
            completion_tokens=int(raw_usage.get("completion_tokens") or 0),
            cost_usd=float(raw_usage.get("cost") or 0.0),
        )
        configured_primary = task_config(task).models[0]
        used_fallback = model.split(":")[0] != configured_primary.split(":")[0] and not model.startswith(configured_primary)
        latency_ms = (time.monotonic() - started) * 1000
        if self._settings.free_models_only and usage.cost_usd > 0:
            logger.error("free-model mode but OpenRouter reported cost=%.6f task=%s model=%s", usage.cost_usd, task, model)
        ledger.record(task, model, usage, latency_ms, used_fallback=used_fallback)
        logger.info(
            "llm ok task=%s model=%s fallback=%s prompt=%s completion=%s cost=%.6f latency_ms=%.0f attempts=%s",
            task, model, used_fallback, usage.prompt_tokens, usage.completion_tokens, usage.cost_usd, latency_ms, attempt,
        )
        return LlmResult(data=data, model=model, used_fallback=used_fallback, usage=usage, latency_ms=latency_ms, attempts=attempt)
