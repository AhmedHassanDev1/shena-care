import os

from functools import lru_cache


class Settings:
    provider: str
    log_level: str
    groq_api_key: str | None

    def __init__(self) -> None:
        self.provider = os.getenv("AI_PROVIDER", "groq")
        self.log_level = os.getenv("AI_LOG_LEVEL", "INFO")
        self.groq_api_key = os.getenv("GROQ_API_KEY")


@lru_cache
def get_settings() -> Settings:
    return Settings()
