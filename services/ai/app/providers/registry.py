from app.providers.base import ProviderUnavailableError
from app.providers.mock_provider import MockProductEnrichmentProvider, MockGuidanceProvider, MockContentGenerationProvider
from app.providers.mock_consult import MockConsultProvider
from app.providers.groq_provider import GroqProvider
from app.providers.openrouter_provider import OpenRouterProvider


class RealProviderNotConfiguredError(ProviderUnavailableError):
    pass


def _unknown(provider_name: str, purpose: str) -> RealProviderNotConfiguredError:
    return RealProviderNotConfiguredError(
        f"Provider '{provider_name}' is not configured for {purpose}. Set AI_PROVIDER to openrouter, groq or mock."
    )


def get_provider(provider_name: str):
    """Product enrichment provider. 'openrouter' is the production gateway (models: app/llm/model_config.py)."""
    if provider_name == "mock":
        return MockProductEnrichmentProvider()
    if provider_name == "openrouter":
        return OpenRouterProvider()
    if provider_name == "groq":
        return GroqProvider()
    raise _unknown(provider_name, "enrichment")


def get_guidance_provider(provider_name: str):
    if provider_name == "mock":
        return MockGuidanceProvider()
    if provider_name == "openrouter":
        return OpenRouterProvider()
    if provider_name == "groq":
        return GroqProvider()
    raise _unknown(provider_name, "guidance")


def get_content_provider(provider_name: str):
    if provider_name == "mock":
        return MockContentGenerationProvider()
    if provider_name == "openrouter":
        return OpenRouterProvider()
    if provider_name == "groq":
        return GroqProvider()
    raise _unknown(provider_name, "content generation")


def get_consult_provider(provider_name: str):
    """The consultation runs on the OpenRouter gateway only (or the offline mock)."""
    if provider_name == "mock":
        return MockConsultProvider()
    if provider_name == "openrouter":
        return OpenRouterProvider()
    raise _unknown(provider_name, "consultation")
