from typing import Literal

from pydantic import BaseModel, Field


class UserProfileContext(BaseModel):
    skinType: str | None = None
    sensitivities: str | None = None
    concerns: list[str] = Field(default_factory=list)


class GuidanceMessageContext(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


class GuidanceRecommendationRequest(BaseModel):
    customerId: str = Field(min_length=1, max_length=64)
    profile: UserProfileContext
    chatHistory: list[GuidanceMessageContext] = Field(default_factory=list)


class RoutineStepProposal(BaseModel):
    title: str
    instructions: str | None = None
    timing: Literal["am", "pm", "both", "as_needed"]
    isOptional: bool = False
    productQuery: str | None = None  # To let NestJS match the right product from catalog


class RoutineProposal(BaseModel):
    title: str
    description: str | None = None
    careArea: Literal["skin", "hair"]
    steps: list[RoutineStepProposal] = Field(default_factory=list)


class GuidanceRecommendationResult(BaseModel):
    schemaVersion: Literal["1"]
    message: str  # The AI's textual response back to the user
    proposal: RoutineProposal | None = None  # If the AI thinks a routine is ready, it populates this
