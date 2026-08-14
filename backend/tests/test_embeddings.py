from unittest import IsolatedAsyncioTestCase

from app.config import Settings
from app.services.embeddings import OpenAICompatibleEmbeddingProvider


class FakeEmbeddingClient:
    def __init__(self, *, dimensions: int, fail: bool = False) -> None:
        self.dimensions = dimensions
        self.fail = fail
        self.document_inputs: list[str] | None = None
        self.query_input: str | None = None

    async def aembed_documents(self, texts: list[str]) -> list[list[float]]:
        if self.fail:
            raise RuntimeError("provider unavailable")
        self.document_inputs = texts
        return [[float(index)] * self.dimensions for index, _ in enumerate(texts, start=1)]

    async def aembed_query(self, text: str) -> list[float]:
        if self.fail:
            raise RuntimeError("provider unavailable")
        self.query_input = text
        return [0.5] * self.dimensions


class EmbeddingProviderTests(IsolatedAsyncioTestCase):
    async def test_unconfigured_provider_keeps_keyword_fallback(self):
        provider = OpenAICompatibleEmbeddingProvider(Settings(openai_api_key=""))

        self.assertFalse(provider.configured)
        self.assertIsNone(await provider.embed_query("极限定义"))
        self.assertIsNone(await provider.embed_documents(["第一段"]))

    async def test_configured_provider_embeds_documents_and_query(self):
        provider = OpenAICompatibleEmbeddingProvider(
            Settings(openai_api_key="test-key", embedding_dimensions=3)
        )
        fake = FakeEmbeddingClient(dimensions=3)
        provider.client = fake

        documents = await provider.embed_documents(["第一段", "第二段"])
        query = await provider.embed_query("极限定义")

        self.assertEqual(documents, [[1.0, 1.0, 1.0], [2.0, 2.0, 2.0]])
        self.assertEqual(query, [0.5, 0.5, 0.5])
        self.assertEqual(fake.document_inputs, ["第一段", "第二段"])
        self.assertEqual(fake.query_input, "极限定义")

    async def test_invalid_or_failed_vectors_are_rejected(self):
        provider = OpenAICompatibleEmbeddingProvider(
            Settings(openai_api_key="test-key", embedding_dimensions=3)
        )
        provider.client = FakeEmbeddingClient(dimensions=2)
        self.assertIsNone(await provider.embed_query("极限定义"))
        self.assertIsNone(await provider.embed_documents(["第一段"]))

        provider.client = FakeEmbeddingClient(dimensions=3, fail=True)
        self.assertIsNone(await provider.embed_query("极限定义"))
        self.assertIsNone(await provider.embed_documents(["第一段"]))
