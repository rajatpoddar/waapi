"""Runtime configuration, read from environment variables / the .env file."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- authentication ---
    api_key: str = "change-me"
    jwt_secret: str | None = None

    # --- engine ---
    baileys_url: str = "http://baileys:3000"

    # --- admin dashboard ---
    # Where the local webhook receiver lives (used by /admin-api/webhooks).
    webhook_receiver_url: str = "http://localhost:9001"

    # --- api behaviour ---
    cors_origins: str = "*"
    rate_limit: str = "60/minute"
    log_level: str = "INFO"
    log_dir: str = "logs"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
