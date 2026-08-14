from unittest import TestCase

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
