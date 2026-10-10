from typing import Literal

from pydantic import BaseModel, Field

class GeneratedContent(BaseModel):
    titleEn: str = Field(max_length=255)
    titleAr: str = Field(max_length=255)
    descriptionEn: str = Field(max_length=5000)
    descriptionAr: str = Field(max_length=5000)
    shortDescriptionEn: str = Field(max_length=500)
    shortDescriptionAr: str = Field(max_length=500)
    benefitsEn: list[str] = Field(default_factory=list, max_length=20)
    benefitsAr: list[str] = Field(default_factory=list, max_length=20)
    usageInstructionsEn: list[str] | None = Field(default_factory=list)
    usageInstructionsAr: list[str] | None = Field(default_factory=list)
    routineStepEn: str | None = None
    routineStepAr: str | None = None
    keywords: list[str] = Field(default_factory=list, max_length=50)
    seoTitleEn: str | None = None
    seoTitleAr: str | None = None
    seoDescriptionEn: str | None = None
    seoDescriptionAr: str | None = None

class ProductContentGenerationRequest(BaseModel):
    candidateId: str = Field(min_length=1, max_length=64)
    facts: dict = Field(default_factory=dict)
    researchEvidence: dict | list | None = None
    
class ProductContentGenerationResult(BaseModel):
    schemaVersion: Literal["1"]
    content: GeneratedContent
    providerMetadata: dict[str, str] = Field(default_factory=dict)
