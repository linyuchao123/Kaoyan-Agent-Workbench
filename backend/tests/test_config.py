from unittest import TestCase

from pydantic import ValidationError

from app.config import Settings


class ProviderSettingsTests(TestCase):
    def test_provider_specific_settings_take_precedence(self):
        settings = Settings(
            _env_file=None,
            openai_api_key="legacy-key",
            openai_base_url="https://legacy.example/v1",
            chat_api_key="chat-key",
            chat_base_url="https://chat.example/v1",
            embedding_api_key="embedding-key",
            embedding_base_url="https://embedding.example/v1",
            ocr_api_key="ocr-key",
            ocr_base_url="https://ocr.example/v1",
        )

        self.assertEqual(settings.resolved_chat_api_key, "chat-key")
        self.assertEqual(settings.resolved_chat_base_url, "https://chat.example/v1")
        self.assertEqual(settings.resolved_embedding_api_key, "embedding-key")
        self.assertEqual(
            settings.resolved_embedding_base_url,
            "https://embedding.example/v1",
        )
        self.assertEqual(settings.resolved_ocr_api_key, "ocr-key")
        self.assertEqual(settings.resolved_ocr_base_url, "https://ocr.example/v1")
        self.assertEqual(settings.embedding_provider, "qwen")
        self.assertEqual(settings.embedding_model, "text-embedding-v4")
        self.assertEqual(settings.embedding_dimensions, 1536)
        self.assertEqual(settings.ocr_provider, "qwen")
        self.assertEqual(settings.ocr_model, "qwen3.5-ocr")
        self.assertEqual(settings.ocr_fallback_model, "qwen3.5-plus")
        self.assertEqual(settings.resolved_chat_model("flash"), "deepseek-v4-flash")
        self.assertEqual(settings.resolved_chat_model("pro"), "deepseek-v4-pro")
        self.assertEqual(
            settings.resolved_chat_fallback_model("flash"),
            "qwen3.5-flash-2026-02-23",
        )
        self.assertEqual(settings.resolved_chat_fallback_model("pro"), "qwen3.7-plus")

    def test_legacy_openai_settings_remain_a_fallback(self):
        settings = Settings(
            _env_file=None,
            openai_api_key="legacy-key",
            openai_base_url="https://legacy.example/v1",
        )

        self.assertEqual(settings.resolved_chat_api_key, "legacy-key")
        self.assertEqual(settings.resolved_embedding_api_key, "legacy-key")
        self.assertEqual(settings.resolved_ocr_api_key, "legacy-key")
        self.assertEqual(settings.resolved_chat_base_url, "https://legacy.example/v1")
        self.assertEqual(
            settings.resolved_embedding_base_url,
            "https://legacy.example/v1",
        )
        self.assertEqual(settings.resolved_ocr_base_url, "https://legacy.example/v1")

    def test_embedding_dimensions_cannot_drift_from_pgvector_schema(self):
        with self.assertRaises(ValidationError):
            Settings(_env_file=None, embedding_dimensions=1024)

    def test_chat_token_prices_are_optional_and_profile_specific(self):
        settings = Settings(
            _env_file=None,
            deepseek_flash_input_price_per_million=1.0,
            deepseek_flash_output_price_per_million=2.0,
            qwen_fallback_pro_input_price_per_million=3.0,
            qwen_fallback_pro_output_price_per_million=4.0,
        )

        self.assertEqual(settings.chat_token_prices("deepseek", "flash"), (1.0, 2.0))
        self.assertEqual(settings.chat_token_prices("qwen", "pro"), (3.0, 4.0))
        self.assertIsNone(settings.chat_token_prices("deepseek", "pro"))
        self.assertIsNone(settings.chat_token_prices("unknown", "flash"))

        with self.assertRaises(ValidationError):
            Settings(_env_file=None, deepseek_flash_input_price_per_million=-1)
