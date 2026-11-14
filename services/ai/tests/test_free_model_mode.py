"""Development free-model mode: every task goes to openrouter/free only; production routing is untouched."""

import json

import httpx
import pytest

from app.core.config import get_settings
from app.llm import model_config
from app.llm.gateway import LlmGateway, ProviderLimitError
from app.llm.usage import ledger


def _reload():
    get_settings.cache_clear()
    model_config.reset_model_config_cache()
    ledger.reset()


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in ("AI_ENVIRONMENT", "AI_FREE_MODELS_ONLY", "AI_MODEL_CONFIG_JSON", "AI_MODELS_ECONOMY", "AI_MODELS_STRONG"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
    _reload()
    yield
    _reload()


def _enable(monkeypatch, environment="development", flag="true"):
    monkeypatch.setenv("AI_ENVIRONMENT", environment)
    monkeypatch.setenv("AI_FREE_MODELS_ONLY", flag)
    _reload()


def test_development_routes_every_task_to_free_router_only(monkeypatch):
    monkeypatch.setenv("AI_MODELS_STRONG", "anthropic/claude-sonnet-5.5")  # overrides must not leak through
    _enable(monkeypatch)
    configs = model_config.all_task_configs()
    assert configs
    for cfg in configs:
        assert cfg.models == ("openrouter/free",)


def test_free_mode_raises_budgets_keeps_timeouts(monkeypatch):
    _enable(monkeypatch)
    cfg = model_config.task_config("consult.respond")
    assert (cfg.max_tokens, cfg.timeout_s) == (3200 * model_config.FREE_MODE_TOKEN_FACTOR, 50.0)


def test_production_default_is_unchanged():
    assert not get_settings().free_models_only
    assert model_config.task_config("consult.respond").models == model_config.DEFAULT_TIERS["strong"]


@pytest.mark.parametrize("environment", ["production", "staging", ""])
def test_flag_is_ignored_outside_development(monkeypatch, environment):
    _enable(monkeypatch, environment=environment)
    assert not get_settings().free_models_only
    assert get_settings().free_models_ignored or environment == ""
    assert model_config.task_config("consult.understand").models == model_config.DEFAULT_TIERS["economy"]


def test_development_without_flag_stays_paid(monkeypatch):
    _enable(monkeypatch, flag="false")
    assert model_config.task_config("consult.respond").models == model_config.DEFAULT_TIERS["strong"]


def test_is_free_model():
    assert model_config.is_free_model("openrouter/free")
    assert model_config.is_free_model("dots-studio/dots-3-note-preview:free")
    assert not model_config.is_free_model("anthropic/claude-sonnet-5.5")


async def test_gateway_sends_only_the_free_router(monkeypatch):
    _enable(monkeypatch)
    seen = {}

    def handler(request: httpx.Request):
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={
            "model": "some/model:free",
            "choices": [{"message": {"role": "assistant", "content": "{\"ok\": true}"}}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1, "cost": 0},
        })

    async def no_sleep(_):
        return None

    gw = LlmGateway(transport=httpx.MockTransport(handler), sleep=no_sleep)
    result = await gw.complete_json("consult.respond", system="s", user="u", schema={"type": "object"}, schema_name="x")
    assert seen["body"]["models"] == ["openrouter/free"]
    assert seen["body"]["provider"]["data_collection"] == "deny"
    assert seen["body"]["provider"]["require_parameters"] is True
    assert result.usage.cost_usd == 0


async def test_gateway_refuses_paid_model_in_free_mode(monkeypatch):
    _enable(monkeypatch)
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(500)

    paid = model_config.TaskConfig("consult.respond", "x", ("anthropic/claude-sonnet-5.5",), 100, None, 5.0)
    monkeypatch.setattr("app.llm.gateway.task_config", lambda _task: paid)
    gw = LlmGateway(transport=httpx.MockTransport(handler))
    with pytest.raises(ProviderLimitError):
        await gw.complete_json("consult.respond", system="s", user="u")
    assert calls == []


def test_production_token_budgets_are_unchanged():
    assert model_config.task_config("consult.understand").max_tokens == 900
    assert model_config.task_config("consult.respond").max_tokens == 3200
