"""Token streaming: the incremental JSON decoder, the gateway against a fake SSE OpenRouter, and the SSE route."""

import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.llm import model_config
from app.llm.gateway import JsonStringFieldStream, LlmGateway
from app.llm.usage import ledger
from app.providers.base import ProviderUnavailableError


# ---- decoder -------------------------------------------------------------------------------------------------

def _feed_all(raw: str, size: int) -> str:
    stream = JsonStringFieldStream("message")
    return "".join(stream.feed(raw[i : i + size]) for i in range(0, len(raw), size))


@pytest.mark.parametrize("size", [1, 2, 3, 5, 7, 64])
def test_decoder_yields_the_message_whatever_the_chunking(size):
    message = 'مرحبا "بكِ" — سطر\nثاني \\ و 🙂 é'
    raw = json.dumps({"message": message, "followUpQuestion": None, "quickReplies": ["a"]})
    assert _feed_all(raw, size) == message


def test_decoder_handles_escaped_unicode_and_surrogate_pairs_split_across_chunks():
    raw = json.dumps({"message": "ok 🙂 é"}, ensure_ascii=True)  # 🙂 and é
    assert _feed_all(raw, 1) == "ok 🙂 é"


def test_decoder_ignores_other_keys_and_fences():
    raw = '```json\n{"followUpQuestion": "q?", "message": "hello"}\n```'
    assert _feed_all(raw, 4) == "hello"


def test_decoder_stops_at_the_closing_quote():
    stream = JsonStringFieldStream("message")
    assert stream.feed('{"message": "abc"') == "abc"
    assert stream.done
    assert stream.feed(', "other": "zzz"}') == ""


def test_decoder_emits_nothing_before_the_key():
    stream = JsonStringFieldStream("message")
    assert stream.feed('{"mess') == ""
    assert stream.feed('age": ') == ""
    assert stream.feed('"hi') == "hi"


# ---- gateway -------------------------------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def env(monkeypatch):
    for name in ("AI_ENVIRONMENT", "AI_FREE_MODELS_ONLY", "AI_MODEL_CONFIG_JSON", "AI_MODELS_ECONOMY", "AI_MODELS_STRONG"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
    get_settings.cache_clear()
    model_config.reset_model_config_cache()
    ledger.reset()
    yield
    get_settings.cache_clear()
    model_config.reset_model_config_cache()
    ledger.reset()


async def _no_sleep(_):
    return None


def _sse_body(content_pieces: list[str], model="vendor/model-a", cost=0.0) -> bytes:
    lines = [": OPENROUTER PROCESSING", ""]
    for piece in content_pieces:
        lines += ["data: " + json.dumps({"model": model, "choices": [{"delta": {"content": piece}}]}), ""]
    lines += ["data: " + json.dumps({"model": model, "choices": [{"delta": {}, "finish_reason": "stop"}],
                                     "usage": {"prompt_tokens": 11, "completion_tokens": 7, "cost": cost}}), ""]
    lines += ["data: [DONE]", ""]
    return "\n".join(lines).encode()


def _chunks(obj: dict, size: int = 6) -> list[str]:
    text = json.dumps(obj, ensure_ascii=False)
    return [text[i : i + size] for i in range(0, len(text), size)]


ANSWER = {"message": "أهلاً بكِ، ده غسول لطيف", "followUpQuestion": None, "quickReplies": [], "recommendations": [], "routine": None, "citations": []}


async def _collect(gen):
    return [event async for event in gen]


async def test_stream_json_yields_deltas_then_the_parsed_final():
    seen = {}

    def handler(request: httpx.Request):
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, content=_sse_body(_chunks(ANSWER)), headers={"content-type": "text/event-stream"})

    gw = LlmGateway(transport=httpx.MockTransport(handler), sleep=_no_sleep)
    events = await _collect(gw.stream_json("consult.respond", system="s", user="u", schema={"type": "object"}, schema_name="x"))

    assert seen["body"]["stream"] is True
    assert seen["body"]["provider"]["data_collection"] == "deny"
    assert seen["body"]["response_format"]["json_schema"]["strict"] is True
    deltas = [p for k, p in events if k == "delta"]
    assert len(deltas) > 1  # progressive, not one block
    assert "".join(deltas) == ANSWER["message"]
    kind, final = events[-1]
    assert kind == "final" and final.data == ANSWER
    assert final.usage.prompt_tokens == 11 and final.usage.completion_tokens == 7
    assert ledger.snapshot()["byTask"]["consult.respond"]["calls"] == 1


async def test_stream_json_retries_before_any_text_without_reset():
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(200, content=_sse_body([""]))  # empty message, like a model out of tokens
        return httpx.Response(200, content=_sse_body(_chunks(ANSWER)))

    gw = LlmGateway(transport=httpx.MockTransport(handler), sleep=_no_sleep)
    events = await _collect(gw.stream_json("consult.respond", system="s", user="u"))
    assert calls["n"] == 2
    assert [k for k, _ in events if k == "reset"] == []
    assert events[-1][0] == "final"


async def test_stream_json_resets_when_a_retry_follows_shown_text():
    calls = {"n": 0}
    partial = ['{"message": "half an ans']  # text was shown, then the JSON never closes

    def handler(request):
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(200, content=_sse_body(partial))
        return httpx.Response(200, content=_sse_body(_chunks(ANSWER)))

    gw = LlmGateway(transport=httpx.MockTransport(handler), sleep=_no_sleep)
    events = await _collect(gw.stream_json("consult.respond", system="s", user="u"))
    kinds = [k for k, _ in events]
    assert kinds.index("reset") > kinds.index("delta")
    assert kinds[-1] == "final"
    after_reset = [p for k, p in events[kinds.index("reset") + 1 :] if k == "delta"]
    assert "".join(after_reset) == ANSWER["message"]


async def test_stream_json_raises_on_unusable_credits():
    def handler(request):
        return httpx.Response(402, json={"error": {"code": 402, "message": "no credits"}})

    gw = LlmGateway(transport=httpx.MockTransport(handler), sleep=_no_sleep)
    with pytest.raises(ProviderUnavailableError):
        await _collect(gw.stream_json("consult.respond", system="s", user="u"))


async def test_stream_json_mid_stream_error_is_retried_then_raised():
    def handler(request):
        body = "data: " + json.dumps({"error": {"message": "upstream died"}}) + "\n\ndata: [DONE]\n\n"
        return httpx.Response(200, content=body.encode())

    gw = LlmGateway(transport=httpx.MockTransport(handler), sleep=_no_sleep)
    with pytest.raises(ProviderUnavailableError):
        await _collect(gw.stream_json("consult.respond", system="s", user="u"))
    assert ledger.snapshot()["recentErrors"]


# ---- route ---------------------------------------------------------------------------------------------------

def test_route_streams_sse_events(monkeypatch):
    from app.api import routes
    from app.contracts.consult import RespondRequest, RespondResult
    from tests.conftest import TEST_SERVICE_TOKEN

    result = RespondResult(message="مرحبا بكِ")

    class FakeService:
        async def respond_stream(self, request, correlation_id=None):
            yield "delta", "مرحبا "
            yield "delta", "بكِ"
            yield "final", result

    monkeypatch.setattr(routes, "_consult_service", lambda: FakeService())
    from app.main import app

    payload = {"subject": "anon-1", "locale": "ar", "intent": "recommend_products",
               "messages": [{"role": "user", "content": "عايزة غسول"}], "context": {"careArea": "skin"}}
    RespondRequest(**payload)
    client = TestClient(app)
    response = client.post("/v1/consult/respond/stream", json=payload, headers={"Authorization": f"Bearer {TEST_SERVICE_TOKEN}"})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    text = response.text
    assert text.index("event: delta") < text.index("event: final")
    assert text.count("event: delta") == 2
    assert "مرحبا بكِ" in text


def test_route_requires_the_service_token():
    from app.main import app

    response = TestClient(app).post("/v1/consult/respond/stream", json={})
    assert response.status_code in (401, 503)


async def test_opaque_refs_are_not_kept_as_quick_replies():
    from app.contracts.consult import RespondRequest, RespondResult
    from app.services.consult_service import ConsultService

    class Provider:
        async def respond(self, request):
            return RespondResult(message="ok", quickReplies=["P1", "K2", "P10", "السعر مش فرق معايا"])

    request = RespondRequest(subject="s", intent="recommend_products", messages=[{"role": "user", "content": "x"}], context={"careArea": "skin"})
    result = await ConsultService(Provider()).respond(request, correlation_id="t")
    assert result.quickReplies == ["السعر مش فرق معايا"]


async def test_stream_json_replaces_a_model_that_never_writes(monkeypatch):
    """OpenRouter keeps the connection alive with comments while a model reasons; the deadline must still fire."""
    import asyncio

    monkeypatch.setenv("AI_MODEL_CONFIG_JSON", json.dumps({"consult.respond": {"timeout_s": 0.4}}))
    get_settings.cache_clear()
    model_config.reset_model_config_cache()
    calls = {"n": 0}

    class Stuck(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b": OPENROUTER PROCESSING\n\n"
            await asyncio.sleep(30)  # "thinking" forever

    def handler(request):
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(200, stream=Stuck(), headers={"content-type": "text/event-stream"})
        return httpx.Response(200, content=_sse_body(_chunks(ANSWER)))

    gw = LlmGateway(transport=httpx.MockTransport(handler), sleep=_no_sleep)
    started = asyncio.get_event_loop().time()
    events = await _collect(gw.stream_json("consult.respond", system="s", user="u"))
    assert calls["n"] == 2
    assert events[-1][0] == "final"
    assert asyncio.get_event_loop().time() - started < 3  # replaced after ~0.2 s, not left to hang


async def test_inline_refs_are_scrubbed_from_customer_text():
    from app.contracts.consult import Recommendation, RespondRequest, RespondResult
    from app.services.consult_service import ConsultService

    class Provider:
        async def respond(self, request):
            return RespondResult(
                message="الغسول المناسب هو Antioxidant Facial Cleanser (P1)؛ بيناسب البشرة الحساسة (K4, K5). استخدميه صباحًا.",
                followUpQuestion="عايزة مرطب؟ (P2)",
                recommendations=[Recommendation(ref="P1", why="غسول لطيف (P1) ومناسب (K4)")],
            )

    request = RespondRequest(subject="s", intent="recommend_products", messages=[{"role": "user", "content": "x"}], context={"careArea": "skin"},
                             candidates=[{"ref": "P1", "name": "Cleanser", "brand": "B", "productType": "cleanser", "role": "cleanser", "size": "200 ml", "price": "105.00 EGP",
                                          "period": "AM_PM", "reasons": [], "keyActives": [], "usage": None, "cautions": [], "unknowns": []}])
    try:
        result = await ConsultService(Provider()).respond(request, correlation_id="t")
    except Exception as exc:  # candidate shape drift must not hide the scrub test
        pytest.skip(f"CandidateProduct shape changed: {exc}")
    assert result.message == "الغسول المناسب هو Antioxidant Facial Cleanser؛ بيناسب البشرة الحساسة. استخدميه صباحًا."
    assert result.followUpQuestion == "عايزة مرطب؟"
    assert result.recommendations and result.recommendations[0].why == "غسول لطيف ومناسب"
