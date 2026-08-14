from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


class Settings(BaseSettings):
    app_env: str = "development"
    app_origins: str = "http://localhost:3000"
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    database_url: str = ""
    openai_api_key: str = ""
    openai_base_url: str = ""
    chat_model: str = "gpt-5-mini"
    embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = 1536
    tavily_api_key: str = ""
    demo_mode: bool = True

    model_config = SettingsConfigDict(env_file=BACKEND_ENV_FILE, extra="ignore")

    @property
    def origins(self) -> list[str]:
        return [origin.strip() for origin in self.app_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
