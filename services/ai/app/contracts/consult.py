"""Contracts of the care consultation: two model tasks around a deterministic backend.

understand: read the conversation -> structured needs (what the customer wants, what is still unknown).
respond:    write the answer from what the backend retrieved (eligible catalog products, verified facts,
            sourced knowledge). The model refers to products and knowledge only by opaque refs (P1, K3);
            it never sees catalog ids and cannot introduce a product the backend did not supply.
"""

from typing import Literal

from pydantic import BaseModel, Field

TriState = Literal["YES", "NO", "UNKNOWN"]
Intent = Literal[
    "recommend_products",
    "build_routine",
    "product_question",
    "ingredient_question",
    "routine_question",
    "general_care",
    "smalltalk",
    "out_of_scope",
]
RedFlagCode = Literal[
    "SEVERE_OR_PAINFUL",
    "INFECTION_SIGNS",
    "BLEEDING_OR_OPEN_WOUND",
    "SUDDEN_OR_PATCHY_HAIR_LOSS",
    "ALLERGIC_REACTION",
    "CHANGING_MOLE_OR_LESION",
    "CHILD_UNDER_12",
    "PRESCRIPTION_OR_DIAGNOSIS_REQUEST",
    "OTHER_MEDICAL",
]
SkinType = Literal["normal", "dry", "oily", "combination", "sensitive"]


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class SafetyAnswers(BaseModel):
    pregnant: TriState = "UNKNOWN"
    breastfeeding: TriState = "UNKNOWN"
    prescriptionTopical: TriState = "UNKNOWN"
    oralRetinoid: TriState = "UNKNOWN"


class ConsultContext(BaseModel):
    """What the consultation knows about the customer's need so far. No name, phone, address or account id."""

    careArea: Literal["skin", "hair"] | None = None
    concerns: list[str] = Field(default_factory=list, max_length=6)
    productTypes: list[str] = Field(default_factory=list, max_length=6)
    skinType: SkinType | None = None
    hairType: str | None = Field(default=None, max_length=40)
    fragranceFree: bool | None = None
    budgetMax: float | None = None
    sensitivities: list[str] = Field(default_factory=list, max_length=8)
    ownedProducts: list[str] = Field(default_factory=list, max_length=8)
    safety: SafetyAnswers = Field(default_factory=SafetyAnswers)


class PageContext(BaseModel):
    kind: Literal["home", "corner", "category", "product", "routine", "cart", "other"] = "other"
    concernSlug: str | None = Field(default=None, max_length=80)
    categorySlug: str | None = Field(default=None, max_length=80)
    productName: str | None = Field(default=None, max_length=200)


class ConcernVocab(BaseModel):
    slug: str
    name: str
    careArea: Literal["skin", "hair"]


class UnderstandRequest(BaseModel):
    subject: str = Field(min_length=1, max_length=64)
    locale: Literal["ar", "en"] = "ar"
    messages: list[ChatTurn] = Field(min_length=1, max_length=24)
    knownContext: ConsultContext = Field(default_factory=ConsultContext)
    pageContext: PageContext | None = None
    concernVocabulary: list[ConcernVocab] = Field(default_factory=list, max_length=60)
    productTypeVocabulary: list[str] = Field(default_factory=list, max_length=60)


class RedFlag(BaseModel):
    code: RedFlagCode
    evidence: str = Field(max_length=200)


class UnderstandResult(BaseModel):
    schemaVersion: Literal["1"] = "1"
    intent: Intent
    language: Literal["ar", "en"]
    context: ConsultContext
    mentionedProducts: list[str] = Field(default_factory=list, max_length=6)
    mentionedIngredients: list[str] = Field(default_factory=list, max_length=8)
    redFlags: list[RedFlag] = Field(default_factory=list, max_length=6)
    # Facts the customer has not given that would change the advice (e.g. "skinType", "pregnancy").
    missing: list[str] = Field(default_factory=list, max_length=5)
    # True when recommending now would be guesswork; the backend then asks before it recommends.
    needsClarification: bool = False
    providerMetadata: dict = Field(default_factory=dict)


class CandidateReason(BaseModel):
    code: str
    text: str
    # VERIFIED: manufacturer/label fact. EVIDENCE: sourced ingredient guidance. RULE: system rule, not a product claim.
    basis: Literal["VERIFIED", "EVIDENCE", "RULE"]


class CandidateProduct(BaseModel):
    ref: str = Field(pattern=r"^P\d{1,2}$")
    name: str
    brand: str
    productType: str | None = None
    role: str | None = None
    size: str | None = None
    price: str | None = None
    period: str | None = None
    reasons: list[CandidateReason] = Field(default_factory=list)
    keyActives: list[str] = Field(default_factory=list)
    usage: str | None = None
    cautions: list[str] = Field(default_factory=list)
    unknowns: list[str] = Field(default_factory=list)


class KnowledgeItem(BaseModel):
    ref: str = Field(pattern=r"^K\d{1,2}$")
    subject: str
    topic: str
    statement: str
    # VERIFIED_FACT | EVIDENCE_SUPPORTED | INFERENCE | CONFLICT
    evidenceClass: str
    source: str
    professionallyReviewed: bool = False


class RoutineDraftStep(BaseModel):
    ref: str = Field(pattern=r"^P\d{1,2}$")
    slot: Literal["am", "pm", "as_needed"]
    role: str | None = None


class RespondRequest(BaseModel):
    subject: str = Field(min_length=1, max_length=64)
    locale: Literal["ar", "en"] = "ar"
    intent: Intent
    messages: list[ChatTurn] = Field(min_length=1, max_length=24)
    context: ConsultContext
    pageContext: PageContext | None = None
    candidates: list[CandidateProduct] = Field(default_factory=list, max_length=12)
    excluded: list[str] = Field(default_factory=list, max_length=8)
    knowledge: list[KnowledgeItem] = Field(default_factory=list, max_length=16)
    routineDraft: list[RoutineDraftStep] = Field(default_factory=list, max_length=12)
    routineIssues: list[str] = Field(default_factory=list, max_length=8)
    # The backend's decision; the model words it, it does not overrule it.
    escalation: list[str] = Field(default_factory=list, max_length=6)
    mustClarify: bool = False
    missing: list[str] = Field(default_factory=list, max_length=5)


class Recommendation(BaseModel):
    ref: str
    why: str = Field(max_length=400)


class RoutineStepOut(BaseModel):
    ref: str
    slot: Literal["am", "pm", "as_needed"]
    why: str = Field(max_length=300)
    howToUse: str | None = Field(default=None, max_length=300)


class RoutineOut(BaseModel):
    title: str = Field(max_length=120)
    steps: list[RoutineStepOut] = Field(default_factory=list, max_length=12)


class RespondResult(BaseModel):
    schemaVersion: Literal["1"] = "1"
    message: str = Field(min_length=1, max_length=2400)
    followUpQuestion: str | None = Field(default=None, max_length=300)
    quickReplies: list[str] = Field(default_factory=list, max_length=4)
    recommendations: list[Recommendation] = Field(default_factory=list, max_length=6)
    routine: RoutineOut | None = None
    citations: list[str] = Field(default_factory=list, max_length=8)
    providerMetadata: dict = Field(default_factory=dict)
