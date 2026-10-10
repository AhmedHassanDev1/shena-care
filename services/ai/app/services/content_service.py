from app.contracts.content import ProductContentGenerationRequest, ProductContentGenerationResult
from app.providers.base import ContentGenerationProvider

class ContentGenerationService:
    def __init__(self, provider: ContentGenerationProvider):
        self.provider = provider

    async def generate(self, request: ProductContentGenerationRequest, correlation_id: str | None = None) -> ProductContentGenerationResult:
        # In a real app we might validate or audit log the correlation id.
        return await self.provider.generate_content(request)
