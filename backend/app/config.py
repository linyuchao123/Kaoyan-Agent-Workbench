from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


class Settings(BaseSettings):
    app_env: str = "development"
    app_origins: str = "http://localhost:3000"
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    database_url: str = ""
    # Legacy OpenAI-compatible defaults. Provider-specific settings below take
    # precedence, while these values remain as a backwards-compatible fallback.
    openai_api_key: str = ""
    openai_base_url: str = ""
    chat_api_key: str = ""
    chat_base_url: str = ""
    chat_provider: str = "deepseek"
    chat_default_profile: Literal["flash", "pro"] = "flash"
    chat_model: str = "gpt-5-mini"
    chat_flash_model: str = "deepseek-v4-flash"
    chat_pro_model: str = "deepseek-v4-pro"
    chat_fallback_provider: str = "qwen"
    chat_fallback_api_key: str = ""
    chat_fallback_base_url: str = ""
    chat_fallback_flash_model: str = "qwen3.5-flash-2026-02-23"
    chat_fallback_pro_model: str = "qwen3.7-plus"
    embedding_provider: str = "qwen"
    embedding_api_key: str = ""
    embedding_base_url: str = ""
    embedding_model: str = "text-embedding-v4"
    embedding_dimensions: int = 1536
    embedding_version: str = "1"
    ocr_provider: str = "qwen"
    ocr_api_key: str = ""
    ocr_base_url: str = ""
    ocr_model: str = "qwen3.5-ocr"
    ocr_max_pages: int = 100
    ocr_poll_seconds: float = 5.0
    pdftoppm_path: str = "pdftoppm"
    tavily_api_key: str = ""
    demo_mode: bool = True

    model_config = SettingsConfigDict(env_file=BACKEND_ENV_FILE, extra="ignore")

    @field_validator("embedding_dimensions")
    @classmethod
    def validate_embedding_dimensions(cls, value: int) -> int:
        if value != 1536:
            raise ValueError("EMBEDDING_DIMENSIONS must remain 1536 for pgvector compatibility")
        return value

    @property
    def origins(self) -> list[str]:
        return [origin.strip() for origin in self.app_origins.split(",") if origin.strip()]

    @property
    def resolved_chat_api_key(self) -> str:
        return self.chat_api_key or self.openai_api_key

    @property
    def resolved_chat_base_url(self) -> str:
        return self.chat_base_url or self.openai_base_url

    def resolved_chat_model(self, profile: Literal["flash", "pro"]) -> str:
        if profile == "pro":
            return self.chat_pro_model or self.chat_model
        return self.chat_flash_model or self.chat_model

    def resolved_chat_fallback_model(self, profile: Literal["flash", "pro"]) -> str:
        if profile == "pro":
            return self.chat_fallback_pro_model
        return self.chat_fallback_flash_model

    @property
    def resolved_embedding_api_key(self) -> str:
        return self.embedding_api_key or self.openai_api_key

    @property
    def resolved_embedding_base_url(self) -> str:
        return self.embedding_base_url or self.openai_base_url

    @property
    def resolved_ocr_api_key(self) -> str:
        return self.ocr_api_key or self.openai_api_key

    @property
    def resolved_ocr_base_url(self) -> str:
        return self.ocr_base_url or self.openai_base_url


@lru_cache
def get_settings() -> Settings:
    return Settings()
