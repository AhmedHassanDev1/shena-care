import json
import logging
import httpx

from app.contracts.enrichment import ProductEnrichmentRequest, ProductEnrichmentResult
from app.contracts.content import ProductContentGenerationRequest, ProductContentGenerationResult, GeneratedContent
from app.providers.base import ProviderError, ProviderUnavailableError
from app.core.config import get_settings

logger = logging.getLogger(__name__)

class GroqProvider:
    name = "groq"
    model = "openai/gpt-oss-120b"
    base_url = "https://api.groq.com/openai/v1"

    def __init__(self):
        settings = get_settings()
        if not settings.groq_api_key:
            raise ProviderUnavailableError("GROQ_API_KEY is not configured")
        self.api_key = settings.groq_api_key

    async def _call_chat_completions(self, system_prompt: str, user_prompt: str, temperature: float = 0.2) -> dict:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "response_format": {"type": "json_object"},
            "temperature": temperature,
            "max_tokens": 4000
        }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers=headers,
                    json=payload
                )
                
            if response.status_code == 429:
                raise ProviderUnavailableError("Groq rate limit exceeded")
            if response.status_code >= 500:
                raise ProviderUnavailableError(f"Groq API error: {response.status_code}")
            if response.status_code != 200:
                raise ProviderError(f"Groq API returned {response.status_code}: {response.text}")

            data = response.json()
            content = data["choices"][0]["message"]["content"]
            return json.loads(content)
        except httpx.RequestError as e:
            raise ProviderUnavailableError(f"Network error calling Groq: {str(e)}")
        except json.JSONDecodeError as e:
            raise ProviderError(f"Failed to parse Groq response as JSON: {str(e)}")

    async def enrich_product(self, request: ProductEnrichmentRequest) -> ProductEnrichmentResult:
        system_prompt = """
You are an expert product data extraction AI. Extract product facts strictly from the provided inputs without inventing data.
Return a JSON object with the following schema:
{
  "normalizedTitle": "string",
  "brand": "string",
  "description": "string",
  "barcode": "string or null",
  "ingredients": ["string"],
  "benefits": ["string"],
  "usage": ["string"],
  "warnings": ["string"],
  "confidenceScore": 0.5
}
"""
        user_prompt = f"Candidate Ref: {request.candidateRef}\nSource Type: {request.sourceType}\nTitle: {request.rawTitle}\nBrand: {request.brand}\nBarcode: {request.barcode}\nEvidence: {json.dumps(request.researchEvidence if hasattr(request, 'researchEvidence') else None)}"
        
        try:
            result_json = await self._call_chat_completions(system_prompt, user_prompt)
            from app.contracts.enrichment import ProductEnrichmentSuggestions
            
            suggestions = ProductEnrichmentSuggestions(
                normalizedTitle=result_json.get("normalizedTitle", request.rawTitle),
                brand=result_json.get("brand", request.brand),
                description=result_json.get("description"),
                barcode=result_json.get("barcode", request.barcode),
                ingredients=result_json.get("ingredients", []),
                benefits=result_json.get("benefits", []),
                usage=result_json.get("usage", []),
                warnings=result_json.get("warnings", [])
            )
            
            return ProductEnrichmentResult(
                schemaVersion="1",
                suggestions=suggestions,
                confidence={"overall": float(result_json.get("confidenceScore", 0.5))},
                warnings=result_json.get("warnings", []),
                providerMetadata={"provider": self.name, "model": self.model}
            )
        except Exception as e:
            if isinstance(e, (ProviderError, ProviderUnavailableError)):
                raise
            raise ProviderError(f"Groq enrichment failed: {str(e)}")

    async def recommend(self, request: "GuidanceRecommendationRequest") -> "GuidanceRecommendationResult":
        system_prompt = """
You are an expert dermatological and haircare AI assistant for ShenaCare. 
Respond in concise Egyptian Arabic. You must be nonmedical and evidence-aware. 
Do NOT invent prices, availability, ingredients, or product claims.
You MUST ONLY recommend products that are explicitly listed in the "Available Catalog Products" provided in the prompt. Do not recommend generic names if a matching product is in the catalog.

Based on the user profile and chat history, return a JSON response with the following schema:
{
  "type": "answer" | "clarification" | "shortlist" | "proposal",
  "message": "string (your textual response to the user in Egyptian Arabic)",
  "proposal": {
    "title": "string",
    "description": "string",
    "careArea": "skin or hair",
    "steps": [
      {
        "title": "string",
        "instructions": "string",
        "timing": "am, pm, both, or as_needed",
        "isOptional": boolean,
        "productQuery": "string (the generic product name or active ingredient)"
      }
    ]
  } // Include proposal only if type is "proposal"
}
"""
        try:
            profile_dict = request.profile.model_dump()
            history_list = [m.model_dump() for m in request.chatHistory]
            draft_dict = request.routineDraft if request.routineDraft else {}
        except AttributeError:
            profile_dict = request.profile.dict()
            history_list = [m.dict() for m in request.chatHistory]
            draft_dict = request.routineDraft if request.routineDraft else {}
            
        catalog_str = ", ".join(request.catalogProducts) if getattr(request, "catalogProducts", None) else "No products"
        logger.info(f"Available Catalog Products sent to Groq: {catalog_str}")
            
        user_prompt = f"Profile: {json.dumps(profile_dict)}\nDraft: {json.dumps(draft_dict)}\nAvailable Catalog Products: {catalog_str}\nHistory: {json.dumps(history_list)}"
        
        try:
            result_json = await self._call_chat_completions(system_prompt, user_prompt, temperature=0.5)
            from app.contracts.guidance import GuidanceRecommendationResult, RoutineProposal, RoutineStepProposal
            
            proposal_data = result_json.get("proposal")
            proposal = None
            if proposal_data:
                steps = [
                    RoutineStepProposal(
                        title=s.get("title", "Step"),
                        instructions=s.get("instructions"),
                        timing=s.get("timing", "both"),
                        isOptional=s.get("isOptional", False),
                        productQuery=s.get("productQuery")
                    ) for s in proposal_data.get("steps", [])
                ]
                proposal = RoutineProposal(
                    title=proposal_data.get("title", "Routine"),
                    description=proposal_data.get("description"),
                    careArea=proposal_data.get("careArea", "skin"),
                    steps=steps
                )
                
            return GuidanceRecommendationResult(
                schemaVersion="1",
                type=result_json.get("type", "answer"),
                message=result_json.get("message", "هنا الرد الخاص بك."),
                proposal=proposal
            )
        except Exception as e:
            if isinstance(e, (ProviderError, ProviderUnavailableError)):
                raise
            raise ProviderError(f"Groq guidance failed: {str(e)}")

    async def generate_content(self, request: ProductContentGenerationRequest) -> ProductContentGenerationResult:
        system_prompt = """
You are a bilingual (English and Arabic) product content generator for ShenaCare. 
Generate accurate, high-quality, customer-facing content using ONLY the verified facts provided.
DO NOT invent facts (e.g. SPF, ingredients, benefits) that are not supported by the evidence.
Return a JSON object with the following schema:
{
  "titleEn": "string",
  "titleAr": "string",
  "descriptionEn": "string",
  "descriptionAr": "string",
  "shortDescriptionEn": "string",
  "shortDescriptionAr": "string",
  "benefitsEn": ["string"],
  "benefitsAr": ["string"],
  "usageInstructionsEn": ["string"],
  "usageInstructionsAr": ["string"],
  "routineStepEn": "string",
  "routineStepAr": "string",
  "keywords": ["string"],
  "seoTitleEn": "string",
  "seoTitleAr": "string",
  "seoDescriptionEn": "string",
  "seoDescriptionAr": "string"
}
"""
        user_prompt = f"Facts: {json.dumps(request.facts)}\nResearch Evidence: {json.dumps(request.researchEvidence)}"
        
        try:
            result_json = await self._call_chat_completions(system_prompt, user_prompt, temperature=0.3)
            
            # Map back to GeneratedContent using defaults for missing fields
            content = GeneratedContent(
                titleEn=result_json.get("titleEn", ""),
                titleAr=result_json.get("titleAr", ""),
                descriptionEn=result_json.get("descriptionEn", ""),
                descriptionAr=result_json.get("descriptionAr", ""),
                shortDescriptionEn=result_json.get("shortDescriptionEn", ""),
                shortDescriptionAr=result_json.get("shortDescriptionAr", ""),
                benefitsEn=result_json.get("benefitsEn", []),
                benefitsAr=result_json.get("benefitsAr", []),
                usageInstructionsEn=result_json.get("usageInstructionsEn", []),
                usageInstructionsAr=result_json.get("usageInstructionsAr", []),
                routineStepEn=result_json.get("routineStepEn"),
                routineStepAr=result_json.get("routineStepAr"),
                keywords=result_json.get("keywords", []),
                seoTitleEn=result_json.get("seoTitleEn"),
                seoTitleAr=result_json.get("seoTitleAr"),
                seoDescriptionEn=result_json.get("seoDescriptionEn"),
                seoDescriptionAr=result_json.get("seoDescriptionAr")
            )
            
            return ProductContentGenerationResult(
                schemaVersion="1",
                content=content,
                providerMetadata={"provider": self.name, "model": self.model}
            )
        except Exception as e:
            if isinstance(e, (ProviderError, ProviderUnavailableError)):
                raise
            raise ProviderError(f"Groq content generation failed: {str(e)}")
