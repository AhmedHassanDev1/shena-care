import os

from functools import lru_cache


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, "") or default)
    except ValueError:
        return default


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "") or default)
    except ValueError:
        return default


class Settings:
    provider: str
    log_level: str
    groq_api_key: str | None
    service_token: str | None
    allow_unauthenticated: bool

    def __init__(self) -> None:
        # 'openrouter' is the production gateway; 'groq' is the legacy single-model provider; 'mock' is offline.
        self.provider = os.getenv("AI_PROVIDER", "openrouter")
        self.log_level = os.getenv("AI_LOG_LEVEL", "INFO")
        self.groq_api_key = os.getenv("GROQ_API_KEY")
        # Shared secret the ShenaCare API sends as "Authorization: Bearer <token>" on every /v1 call.
        self.service_token = os.getenv("AI_SERVICE_TOKEN") or None
        # Local development only: lets /v1 run without a token. Never set it on staging or production.
        self.allow_unauthenticated_requested = os.getenv("AI_ALLOW_UNAUTHENTICATED", "false").lower() == "true"

        # --- OpenRouter gateway (server-side only; the key never leaves this service) ---
        self.openrouter_api_key = os.getenv("OPENROUTER_API_KEY") or os.getenv("OPEN_ROUTER_API_KEY") or None
        self.openrouter_base_url = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/")
        # Sent as HTTP-Referer / X-Title so the account's activity log names this app. No customer data.
        self.openrouter_app_url = os.getenv("OPENROUTER_APP_URL", "https://shinacare.com")
        self.openrouter_app_title = os.getenv("OPENROUTER_APP_TITLE", "ShinaCare")
        # 'deny' routes only to providers that do not store or train on prompts.
        self.openrouter_data_collection = os.getenv("OPENROUTER_DATA_COLLECTION", "deny")
        # Bounded retries per call (transport errors, 429, 5xx). Total attempts = 1 + retries.
        self.llm_max_retries = max(0, min(_int("AI_LLM_MAX_RETRIES", 2), 4))
        # Process-wide safety nets. Per-customer limits live in the ShenaCare API, which knows the customer.
        self.max_requests_per_minute = max(1, _int("AI_MAX_REQUESTS_PER_MINUTE", 120))
        self.daily_cost_limit_usd = max(0.0, _float("AI_DAILY_COST_LIMIT_USD", 10.0))

        # --- Development-only free-model mode ---
        # AI_FREE_MODELS_ONLY=true routes every task to OpenRouter's free router with no paid fallback, but only when
        # AI_ENVIRONMENT=development. Anywhere else (including when AI_ENVIRONMENT is unset) it is ignored, so a stray
        # flag can never change production routing.
        self.environment = (os.getenv("AI_ENVIRONMENT", "production") or "production").strip().lower()
        requested = os.getenv("AI_FREE_MODELS_ONLY", "false").strip().lower() == "true"
        self.free_models_only = requested and self.environment == "development"
        self.free_models_ignored = requested and not self.free_models_only
        # The unauthenticated switch is honoured only in development: anywhere else the service token is mandatory,
        # so a stray AI_ALLOW_UNAUTHENTICATED can never open the /v1 routes on a deployed service.
        self.allow_unauthenticated = self.allow_unauthenticated_requested and self.environment == "development"


@lru_cache
def get_settings() -> Settings:
    return Settings()
