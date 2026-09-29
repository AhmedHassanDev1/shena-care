import os

from functools import lru_cache


class Settings:
    provider: str
    log_level: str

    def __init__(self) -> None:
        self.provider = os.getenv("AI_PROVIDER", "mock")
        self.log_level = os.getenv("AI_LOG_LEVEL", "INFO")


@lru_cache
def get_settings() -> Settings:
    return Settings()
