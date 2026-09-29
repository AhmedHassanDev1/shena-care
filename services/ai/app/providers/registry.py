from app.providers.base import ProviderUnavailableError
from app.providers.mock_provider import MockProductEnrichmentProvider


class RealProviderNotConfiguredError(ProviderUnavailableError):
    pass


def get_provider(provider_name: str):
    """Extension point for a real LLM provider.

    To add one, implement ProductEnrichmentProvider (see app/providers/base.py)
    and register it here under a new name, e.g. "openai".
    """
    if provider_name == "mock":
        return MockProductEnrichmentProvider()
    raise RealProviderNotConfiguredError(
        f"Provider '{provider_name}' is not configured. Set AI_PROVIDER to an implemented provider."
    )
