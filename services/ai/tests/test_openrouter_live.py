"""Opt-in: real authenticated OpenRouter calls. Costs a fraction of a cent per run.

  RUN_LIVE_AI=1 OPENROUTER_API_KEY=sk-or-... python -m pytest tests/test_openrouter_live.py -s

Skipped by default so the normal suite never needs network or a key.
"""

import os

import pytest

from app.contracts.consult import RespondRequest, UnderstandRequest
from app.core.config import get_settings
from app.llm import model_config
from app.llm.usage import ledger

pytestmark = pytest.mark.skipif(os.getenv("RUN_LIVE_AI") != "1", reason="live OpenRouter test is opt-in (RUN_LIVE_AI=1)")

VOCAB = [
    {"slug": "acne", "name": "حب الشباب", "careArea": "skin"},
    {"slug": "dryness", "name": "الجفاف والترطيب", "careArea": "skin"},
    {"slug": "sun-protection", "name": "الحماية من الشمس", "careArea": "skin"},
    {"slug": "hair-loss", "name": "تساقط الشعر", "careArea": "hair"},
]


@pytest.fixture
def live():
    get_settings.cache_clear()
    model_config.reset_model_config_cache()
    ledger.reset()
    from app.providers.openrouter_provider import OpenRouterProvider
    from app.services.consult_service import ConsultService
    yield ConsultService(OpenRouterProvider())
    print("\nusage:", ledger.snapshot())


async def test_live_understand_reads_an_egyptian_arabic_request(live):
    request = UnderstandRequest(
        subject="live-test", locale="ar",
        messages=[{"role": "user", "content": "بشرتي دهنية وبيطلعلي حبوب كتير في الدقن، وأنا حامل في الشهر الرابع. عايزة غسول كويس"}],
        concernVocabulary=VOCAB, productTypeVocabulary=["cleanser", "moisturizer", "serum", "sunscreen", "shampoo"],
    )
    result = await live.understand(request, correlation_id="live")
    print("\nunderstand:", result.model_dump())
    assert result.language == "ar"
    assert result.context.careArea == "skin"
    assert result.context.skinType == "oily"
    assert "acne" in result.context.concerns
    assert result.context.safety.pregnant == "YES"
    assert "cleanser" in result.context.productTypes
    assert result.providerMetadata["provider"] == "openrouter" and result.providerMetadata["promptTokens"] > 0


async def test_live_respond_stays_inside_the_grounding(live):
    request = RespondRequest(
        subject="live-test", locale="ar", intent="recommend_products",
        messages=[{"role": "user", "content": "بشرتي دهنية وعايزة غسول يومي وواقي شمس"}],
        context={"careArea": "skin", "skinType": "oily", "productTypes": ["cleanser", "sunscreen"]},
        candidates=[
            {"ref": "P1", "name": "Test Purifying Gel Cleanser", "brand": "TestBrand", "productType": "cleanser", "size": "200 ml",
             "price": "180 EGP", "reasons": [{"code": "SKIN_TYPE", "text": "الشركة المصنّعة بتذكر إنه للبشرة الدهنية", "basis": "VERIFIED"}],
             "usage": "Massage onto wet face, rinse. Morning and evening.", "unknowns": ["قائمة المكونات الكاملة غير موثّقة"]},
            {"ref": "P2", "name": "Test Invisible Fluid SPF 50", "brand": "TestBrand", "productType": "sunscreen", "size": "50 ml",
             "price": "320 EGP", "reasons": [{"code": "SPF", "text": "SPF 50 مذكور على العبوة", "basis": "VERIFIED"},
                                             {"code": "AM_LAST", "text": "واقي الشمس آخر خطوة في روتين الصبح", "basis": "RULE"}]},
        ],
        knowledge=[{"ref": "K1", "subject": "sunscreen", "topic": "USAGE",
                    "statement": "Apply sunscreen to all skin not covered by clothing and reapply every two hours outdoors.",
                    "evidenceClass": "EVIDENCE_SUPPORTED", "source": "American Academy of Dermatology"}],
    )
    result = await live.respond(request, correlation_id="live")
    print("\nrespond:", result.model_dump())
    assert {r.ref for r in result.recommendations} <= {"P1", "P2"} and result.recommendations
    assert set(result.citations) <= {"K1"}
    assert any("؀" <= ch <= "ۿ" for ch in result.message)  # answered in Arabic
    assert result.providerMetadata["costUsd"] >= 0


async def test_live_escalation_is_worded_not_overruled(live):
    request = RespondRequest(
        subject="live-test", locale="ar", intent="recommend_products",
        messages=[{"role": "user", "content": "عندي حبوب كبيرة مؤلمة تحت الجلد وفيها صديد ومنتشرة في وشي كله"}],
        context={"careArea": "skin", "concerns": ["acne"]},
        candidates=[], escalation=["SEVERE_OR_PAINFUL", "INFECTION_SIGNS"],
    )
    result = await live.respond(request, correlation_id="live")
    print("\nescalation:", result.model_dump())
    assert result.recommendations == [] and result.routine is None and result.followUpQuestion is None
    assert any(word in result.message for word in ("دكتور", "طبيب", "جلدية"))
