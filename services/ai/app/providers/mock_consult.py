"""Offline consultation provider: deterministic keyword reading, for local development and tests only.

It keeps the same contract as the real provider so the ShenaCare API can be exercised end to end without
network access. It is not a substitute for the model: it understands only the few phrases below.
"""

import re

from app.contracts.consult import (
    Recommendation,
    RedFlag,
    RespondRequest,
    RespondResult,
    RoutineOut,
    RoutineStepOut,
    UnderstandRequest,
    UnderstandResult,
)
from app.providers.base import ProviderUnavailableError

_AR = re.compile(r"[؀-ۿ]")
_SKIN = {"dry": r"جاف|dry", "oily": r"دهني|oily", "combination": r"مختلط|combination", "sensitive": r"حساس|sensitive", "normal": r"عادي|normal skin"}
_HAIR = r"شعر|hair|shampoo|شامبو|قشرة|dandruff"
_RED = [
    ("SEVERE_OR_PAINFUL", r"شديد|مؤلم|severe|painful|cystic"),
    ("INFECTION_SIGNS", r"صديد|pus|infected|التهاب شديد"),
    ("SUDDEN_OR_PATCHY_HAIR_LOSS", r"فراغات|patchy|bald patch"),
    ("ALLERGIC_REACTION", r"تورم|swelling|hives"),
    ("PRESCRIPTION_OR_DIAGNOSIS_REQUEST", r"شخّص|diagnos|prescri|روشتة"),
]


class MockConsultProvider:
    name = "mock"

    async def understand(self, request: UnderstandRequest) -> UnderstandResult:
        last = request.messages[-1].content
        if "__UNAVAILABLE__" in last:
            raise ProviderUnavailableError("Mock provider simulated unavailability")
        text = " ".join(m.content for m in request.messages if m.role == "user").lower()
        ctx = request.knownContext.model_copy(deep=True)

        if re.search(_HAIR, text):
            ctx.careArea = "hair"
        elif ctx.careArea is None and re.search(r"بشر|skin|وش|وجه|face|حبوب|acne", text):
            ctx.careArea = "skin"
        for skin, pattern in _SKIN.items():
            if re.search(pattern, text):
                ctx.skinType = skin  # type: ignore[assignment]
        for concern in request.concernVocabulary:
            words = [concern.slug.replace("-", " "), concern.name.lower()]
            if any(w and w in text for w in words) and concern.slug not in ctx.concerns:
                ctx.concerns.append(concern.slug)
                ctx.careArea = ctx.careArea or concern.careArea
        if request.pageContext and request.pageContext.concernSlug and request.pageContext.concernSlug not in ctx.concerns:
            if any(c.slug == request.pageContext.concernSlug for c in request.concernVocabulary):
                ctx.concerns.append(request.pageContext.concernSlug)
        for product_type in request.productTypeVocabulary:
            if product_type.lower() in text and product_type not in ctx.productTypes:
                ctx.productTypes.append(product_type)
        if re.search(r"حامل|pregnan", text):
            ctx.safety.pregnant = "NO" if re.search(r"مش حامل|not pregnant", text) else "YES"
        if re.search(r"رواكتان|roaccutane|isotretinoin", text):
            ctx.safety.oralRetinoid = "YES"
        if re.search(r"بدون عطر|fragrance[- ]free", text):
            ctx.fragranceFree = True

        red_flags = [RedFlag(code=code, evidence=last[:120]) for code, pattern in _RED if re.search(pattern, last.lower())]  # type: ignore[arg-type]
        intent = "build_routine" if re.search(r"روتين|routine", text) else "recommend_products"
        if re.search(r"ignore (all|previous)|system prompt|تجاهل التعليمات", last.lower()):
            intent = "out_of_scope"
        missing = [name for name, absent in (("careArea", ctx.careArea is None), ("concern", not ctx.concerns and not ctx.productTypes)) if absent]
        return UnderstandResult(
            intent=intent,  # type: ignore[arg-type]
            language="ar" if _AR.search(last) else "en",
            context=ctx,
            redFlags=red_flags,
            missing=missing,
            needsClarification=bool(missing),
            providerMetadata={"provider": self.name, "model": "mock-consult-v1"},
        )

    async def respond(self, request: RespondRequest) -> RespondResult:
        arabic = request.locale == "ar"
        meta = {"provider": self.name, "model": "mock-consult-v1"}
        if request.escalation:
            return RespondResult(
                message=("الحالة دي محتاجة تتشاف من دكتور جلدية الأول." if arabic else "This needs to be seen by a dermatologist first."),
                providerMetadata=meta,
            )
        if request.mustClarify:
            return RespondResult(
                message=("محتاجة أعرف حاجة واحدة قبل ما أرشّح." if arabic else "I need one detail before recommending."),
                followUpQuestion=("بتدوّري على حاجة للبشرة ولا للشعر؟" if arabic else "Is this for skin or hair?"),
                quickReplies=(["البشرة", "الشعر"] if arabic else ["Skin", "Hair"]),
                providerMetadata=meta,
            )
        if not request.candidates:
            return RespondResult(
                message=("مفيش منتج في الكتالوج الحالي مناسب للطلب ده." if arabic else "Nothing in the current catalogue fits this request."),
                providerMetadata=meta,
            )
        by_ref = {c.ref: c for c in request.candidates}
        routine = None
        if request.routineDraft:
            routine = RoutineOut(
                title=("روتين مقترح" if arabic else "Suggested routine"),
                steps=[
                    RoutineStepOut(ref=s.ref, slot=s.slot, why=(by_ref[s.ref].reasons[0].text if by_ref[s.ref].reasons else by_ref[s.ref].name), howToUse=by_ref[s.ref].usage)
                    for s in request.routineDraft if s.ref in by_ref
                ],
            )
        return RespondResult(
            message=("دي أنسب اختيارات من الكتالوج لطلبك." if arabic else "These are the best catalogue matches for your request."),
            recommendations=[
                Recommendation(ref=c.ref, why=(c.reasons[0].text if c.reasons else c.name)) for c in request.candidates[:3]
            ],
            routine=routine,
            citations=[k.ref for k in request.knowledge[:2]],
            providerMetadata=meta,
        )
