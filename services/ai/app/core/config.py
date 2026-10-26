import os

from functools import lru_cache


class Settings:
    provider: str
    log_level: str
    groq_api_key: str | None
    service_token: str | None
    allow_unauthenticated: bool

    def __init__(self) -> None:
        self.provider = os.getenv("AI_PROVIDER", "groq")
        self.log_level = os.getenv("AI_LOG_LEVEL", "INFO")
        self.groq_api_key = os.getenv("GROQ_API_KEY")
        # Shared secret the ShenaCare API sends as "Authorization: Bearer <token>" on every /v1 call.
        self.service_token = os.getenv("AI_SERVICE_TOKEN") or None
        # Local development only: lets /v1 run without a token. Never set it on staging or production.
        self.allow_unauthenticated = os.getenv("AI_ALLOW_UNAUTHENTICATED", "false").lower() == "true"


@lru_cache
def get_settings() -> Settings:
    return Settings()
