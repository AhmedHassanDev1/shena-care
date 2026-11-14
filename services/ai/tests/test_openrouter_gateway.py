"""Gateway behaviour against a fake OpenRouter (httpx.MockTransport): no network, no key spent."""

import json

import httpx
import pytest

from app.core.config import get_settings
from app.llm import model_config
from app.llm.gateway import LlmGateway, ProviderLimitError
from app.llm.usage import ledger
from app.providers.base import ProviderError, ProviderResponseInvalidError, ProviderUnavailableError


@pytest.fixture(autouse=True)
def gateway_env(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
    monkeypatch.delenv("AI_MODEL_CONFIG_JSON", raising=False)
    monkeypatch.delenv("AI_MODELS_ECONOMY", raising=False)
    monkeypatch.delenv("AI_MODELS_STRONG", raising=False)
    get_settings.cache_clear()
    model_config.reset_model_config_cache()
    ledger.reset()
    yield
    get_settings.cache_clear()
    model_config.reset_model_config_cache()
    ledger.reset()


async def _no_sleep(_seconds):
    return None


def _ok(content: dict | str, model="anthropic/claude-haiku-5.5", cost=0.0004):
    text = content if isinstance(content, str) else json.dumps(content)
    return httpx.Response(200, json={
        "model": model,
        "choices": [{"message": {"role": "assistant", "content": text}}],
        "usage": {"prompt_tokens": 120, "completion_tokens": 30, "cost": cost},
    })


def _gateway(handler):
    return LlmGateway(transport=httpx.MockTransport(handler), sleep=_no_sleep)


async def test_sends_models_in_fallback_order_with_privacy_and_schema():
    seen = {}

    def handler(request: httpx.Request):
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        return _ok({"ok": True})

    result = await _gateway(handler).complete_json(
        "consult.understand", system="s", user="u", schema={"type": "object"}, schema_name="x")

    body = seen["body"]
    assert seen["auth"] == "Bearer sk-or-test"
    assert body["models"] == list(model_config.DEFAULT_TIERS["economy"])
    assert body["provider"] == {"data_collection": "deny", "require_parameters": True}
    assert body["response_format"]["type"] == "json_schema"
    assert body["response_format"]["json_schema"]["strict"] is True
    assert "temperature" not in body  # unsupported by the primary models; opt-in per task only
    assert body["max_tokens"] == 900
    assert result.data == {"ok": True}
    assert result.usage.prompt_tokens == 120 and result.usage.cost_usd == pytest.approx(0.0004)
    assert result.used_fallback is False


async def test_strong_task_uses_strong_tier_and_env_override(monkeypatch):
    monkeypatch.setenv("AI_MODELS_STRONG", "vendor/model-a, vendor/model-b")
    monkeypatch.setenv("AI_MODEL_CONFIG_JSON", json.dumps({"consult.understand": {"models": ["vendor/tiny"], "max_tokens": 111, "temperature": 0.2}}))
    model_config.reset_model_config_cache()
    bodies = []

    def handler(request: httpx.Request):
        bodies.append(json.loads(request.content))
        return _ok({"ok": True}, model="vendor/model-a")

    gateway = _gateway(handler)
    await gateway.complete_json("consult.respond", system="s", user="u")
    await gateway.complete_json("consult.understand", system="s", user="u")
    assert bodies[0]["models"] == ["vendor/model-a", "vendor/model-b"]
    assert bodies[1]["models"] == ["vendor/tiny"] and bodies[1]["max_tokens"] == 111 and bodies[1]["temperature"] == 0.2


async def test_reports_when_openrouter_answered_with_a_fallback_model():
    result = await _gateway(lambda r: _ok({"ok": True}, model="openai/gpt-6-luna")).complete_json(
        "consult.understand", system="s", user="u")
    assert result.used_fallback is True
    assert ledger.snapshot()["byTask"]["consult.understand"]["fallbacks"] == 1


async def test_retries_transient_errors_then_succeeds():
    calls = {"n": 0}

    def handler(_request):
        calls["n"] += 1
        if calls["n"] < 3:
            return httpx.Response(429, json={"error": {"code": 429, "message": "rate limited"}})
        return _ok({"ok": True})

    result = await _gateway(handler).complete_json("consult.understand", system="s", user="u")
    assert calls["n"] == 3 and result.attempts == 3


async def test_gives_up_after_bounded_retries():
    calls = {"n": 0}

    def handler(_request):
        calls["n"] += 1
        return httpx.Response(503, json={"error": {"code": 503, "message": "down"}})

    with pytest.raises(ProviderUnavailableError):
        await _gateway(handler).complete_json("consult.understand", system="s", user="u")
    assert calls["n"] == 3  # 1 + AI_LLM_MAX_RETRIES (2)
    assert ledger.snapshot()["byTask"]["consult.understand"]["failures"] == 1


async def test_timeout_is_reported_as_unavailable():
    def handler(_request):
        raise httpx.ReadTimeout("slow")

    with pytest.raises(ProviderUnavailableError):
        await _gateway(handler).complete_json("consult.understand", system="s", user="u")


async def test_bad_key_is_not_retried():
    calls = {"n": 0}

    def handler(_request):
        calls["n"] += 1
        return httpx.Response(401, json={"error": {"code": 401, "message": "No auth credentials found"}})

    with pytest.raises(ProviderUnavailableError):
        await _gateway(handler).complete_json("consult.understand", system="s", user="u")
    assert calls["n"] == 1


async def test_malformed_output_moves_on_to_the_fallback_models():
    bodies = []

    def handler(request: httpx.Request):
        bodies.append(json.loads(request.content))
        if len(bodies) == 1:
            return _ok("Sure! Here is my answer without JSON")
        return _ok({"ok": True}, model="openai/gpt-6-luna")

    result = await _gateway(handler).complete_json("consult.understand", system="s", user="u")
    assert result.data == {"ok": True}
    assert bodies[1]["models"] == list(model_config.DEFAULT_TIERS["economy"][1:])


async def test_malformed_output_everywhere_is_an_invalid_response():
    with pytest.raises(ProviderResponseInvalidError):
        await _gateway(lambda r: _ok("not json")).complete_json("consult.understand", system="s", user="u")


async def test_rejected_request_tries_fallbacks_then_fails_as_provider_error(monkeypatch):
    monkeypatch.setenv("AI_MODELS_ECONOMY", "vendor/only")
    model_config.reset_model_config_cache()
    with pytest.raises(ProviderError):
        await _gateway(lambda r: httpx.Response(400, json={"error": {"code": 400, "message": "bad model"}})).complete_json(
            "consult.understand", system="s", user="u")


async def test_accepts_json_wrapped_in_a_code_fence():
    result = await _gateway(lambda r: _ok('```json\n{"a": 1}\n```')).complete_json("consult.understand", system="s", user="u")
    assert result.data == {"a": 1}


async def test_per_minute_window_refuses_locally(monkeypatch):
    monkeypatch.setenv("AI_MAX_REQUESTS_PER_MINUTE", "2")
    get_settings.cache_clear()
    gateway = _gateway(lambda r: _ok({"ok": True}))
    await gateway.complete_json("consult.understand", system="s", user="u")
    await gateway.complete_json("consult.understand", system="s", user="u")
    with pytest.raises(ProviderLimitError) as info:
        await gateway.complete_json("consult.understand", system="s", user="u")
    assert info.value.reason == "rate_limited"


async def test_daily_cost_ceiling_refuses_locally(monkeypatch):
    monkeypatch.setenv("AI_DAILY_COST_LIMIT_USD", "0.001")
    get_settings.cache_clear()
    gateway = _gateway(lambda r: _ok({"ok": True}, cost=0.002))
    await gateway.complete_json("consult.understand", system="s", user="u")
    with pytest.raises(ProviderLimitError) as info:
        await gateway.complete_json("consult.understand", system="s", user="u")
    assert info.value.reason == "daily_cost_limit"
    assert ledger.snapshot()["dayCostUsd"] == pytest.approx(0.002)


def test_missing_key_means_unavailable(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.delenv("OPEN_ROUTER_API_KEY", raising=False)
    get_settings.cache_clear()
    with pytest.raises(ProviderUnavailableError):
        LlmGateway()


def test_unknown_task_and_bad_config_fail_loudly(monkeypatch):
    with pytest.raises(KeyError):
        model_config.task_config("nope")
    monkeypatch.setenv("AI_MODEL_CONFIG_JSON", json.dumps({"unknown.task": {"models": ["x"]}}))
    model_config.reset_model_config_cache()
    with pytest.raises(RuntimeError):
        model_config.task_config("consult.respond")
