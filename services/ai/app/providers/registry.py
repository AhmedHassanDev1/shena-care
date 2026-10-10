from app.providers.base import ProviderUnavailableError
from app.providers.mock_provider import MockProductEnrichmentProvider, MockGuidanceProvider, MockContentGenerationProvider
from app.providers.groq_provider import GroqProvider


class RealProviderNotConfiguredError(ProviderUnavailableError):
    pass


def get_provider(provider_name: str):
    """Extension point for a real LLM provider.

    To add one, implement ProductEnrichmentProvider (see app/providers/base.py)
    and register it here under a new name, e.g. "openai".
    """
    if provider_name == "mock":
        return MockProductEnrichmentProvider()
    if provider_name == "groq":
        return GroqProvider()
    raise RealProviderNotConfiguredError(
        f"Provider '{provider_name}' is not configured. Set AI_PROVIDER to an implemented provider."
    )

def get_guidance_provider(provider_name: str):
    if provider_name == "mock":
        return MockGuidanceProvider()
    raise RealProviderNotConfiguredError(
        f"Provider '{provider_name}' is not configured for guidance."
    )

def get_content_provider(provider_name: str):
    if provider_name == "mock":
        return MockContentGenerationProvider()
    if provider_name == "groq":
        return GroqProvider()
    raise RealProviderNotConfiguredError(
        f"Provider '{provider_name}' is not configured for content generation."
    )
