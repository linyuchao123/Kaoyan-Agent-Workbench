from unittest import IsolatedAsyncioTestCase, TestCase
from uuid import UUID

from app.config import Settings
from app.services.embeddings import EmbeddingDescriptor, OpenAICompatibleEmbeddingProvider
from app.services.ingestion import TextChunk
from app.workers.ocr import OcrWorker, OcrWorkItem, SupabaseOcrQueue


class FakeQueue:
    def __init__(self, item: OcrWorkItem | None) -> None:
        self.item = item
        self.completed: list[TextChunk] | None = None
        self.embedding_metadata: EmbeddingDescriptor | None = None
        self.failure: str | None = None

    async def claim(self) -> OcrWorkItem | None:
        item, self.item = self.item, None
        return item

    async def download(self, item: OcrWorkItem) -> bytes:
        return b"fake-pdf"

    async def complete(
        self,
        item: OcrWorkItem,
        chunks: list[TextChunk],
        embedding_metadata: EmbeddingDescriptor | None,
    ) -> None:
        self.completed = chunks
        self.embedding_metadata = embedding_metadata

    async def fail(self, item: OcrWorkItem, message: str) -> None:
        self.failure = message


class FakeOcrProvider:
    def __init__(self, pages: list[str] | Exception, configured: bool = True) -> None:
        self.pages = pages
        self.configured = configured

    async def extract_pages(self, pdf: bytes) -> list[str]:
        if isinstance(self.pages, Exception):
            raise self.pages
        return self.pages


class FakeEmbeddingProvider:
    configured = True
    dimensions = 3
    descriptor = EmbeddingDescriptor("qwen", "text-embedding-v4", 1536, "1")

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [[0.1, 0.2, 0.3] for _ in texts]

    async def embed_query(self, text: str) -> list[float]:
        return [0.1, 0.2, 0.3]


class SupabaseOcrQueueAuthTests(TestCase):
    def test_new_secret_key_is_only_sent_as_api_key(self):
        queue = SupabaseOcrQueue(
            Settings(
                supabase_url="https://example.supabase.co",
                supabase_service_role_key="sb_secret_example",
            )
        )

        self.assertEqual(queue.headers, {"apikey": "sb_secret_example"})

    def test_legacy_service_role_jwt_keeps_bearer_header(self):
        queue = SupabaseOcrQueue(
            Settings(
                supabase_url="https://example.supabase.co",
                supabase_service_role_key="legacy-service-role-jwt",
            )
        )

        self.assertEqual(queue.headers["apikey"], "legacy-service-role-jwt")
        self.assertEqual(
            queue.headers["Authorization"],
            "Bearer legacy-service-role-jwt",
        )


class OcrWorkerTests(IsolatedAsyncioTestCase):
    def setUp(self):
        self.item = OcrWorkItem(
            id=UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
            user_id=UUID("11111111-1111-1111-1111-111111111111"),
            document_id=UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
            storage_path="user/document/scan.pdf",
            attempts=1,
            max_attempts=3,
        )

    async def test_successful_job_chunks_embeds_and_completes(self):
        queue = FakeQueue(self.item)
        worker = OcrWorker(
            queue,
            FakeOcrProvider(["# 极限定义\n函数在点附近无限接近。"]),
            FakeEmbeddingProvider(),
        )

        handled = await worker.run_once()

        self.assertTrue(handled)
        self.assertIsNone(queue.failure)
        self.assertEqual(queue.completed[0].page_number, 1)
        self.assertEqual(queue.completed[0].embedding, [0.1, 0.2, 0.3])
        self.assertEqual(queue.embedding_metadata.provider, "qwen")
        self.assertEqual(queue.embedding_metadata.model, "text-embedding-v4")

    async def test_failed_job_is_reported_for_queue_retry(self):
        queue = FakeQueue(self.item)
        worker = OcrWorker(
            queue,
            FakeOcrProvider(RuntimeError("vision provider unavailable")),
            OpenAICompatibleEmbeddingProvider(Settings(openai_api_key="")),
        )

        handled = await worker.run_once()

        self.assertTrue(handled)
        self.assertIsNone(queue.completed)
        self.assertEqual(queue.failure, "vision provider unavailable")

    async def test_empty_queue_does_not_call_provider(self):
        queue = FakeQueue(None)
        worker = OcrWorker(
            queue,
            FakeOcrProvider(RuntimeError("must not run")),
            OpenAICompatibleEmbeddingProvider(Settings(openai_api_key="")),
        )

        self.assertFalse(await worker.run_once())
        self.assertIsNone(queue.failure)
