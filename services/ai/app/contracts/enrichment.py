from typing import Literal

from pydantic import BaseModel, Field

SizeUnit = Literal["ml", "l", "g", "kg", "oz", "unit"]


class SizeSuggestion(BaseModel):
    value: float = Field(gt=0, le=100000)
    unit: SizeUnit


class ProductEnrichmentSuggestions(BaseModel):
    normalizedTitle: str | None = Field(default=None, max_length=255)
    brand: str | None = Field(default=None, max_length=255)
    description: str | None = Field(default=None, max_length=5000)
    size: SizeSuggestion | None = None
    barcode: str | None = Field(default=None, min_length=8, max_length=14)
    ingredients: list[str] = Field(default_factory=list, max_length=200)
    benefits: list[str] = Field(default_factory=list, max_length=50)
    usage: list[str] = Field(default_factory=list, max_length=50)
    warnings: list[str] = Field(default_factory=list, max_length=50)


class ProductEnrichmentRequest(BaseModel):
    candidateRef: str = Field(min_length=1, max_length=64)
    sourceType: str = Field(min_length=1, max_length=32)
    rawTitle: str = Field(min_length=1, max_length=512)
    brand: str | None = Field(default=None, max_length=255)
    barcode: str | None = Field(default=None, min_length=8, max_length=14)
    packageText: str | None = Field(default=None, max_length=2000)
    description: str | None = Field(default=None, max_length=5000)
    sourceUrl: str | None = Field(default=None, max_length=2048)
    existingFields: dict[str, str] = Field(default_factory=dict)
    imageRefs: list[str] = Field(default_factory=list, max_length=20)


class ProductEnrichmentResult(BaseModel):
    schemaVersion: Literal["1"]
    suggestions: ProductEnrichmentSuggestions
    confidence: dict[str, float] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list, max_length=50)
    providerMetadata: dict[str, str] = Field(default_factory=dict)


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str
    provider: str
