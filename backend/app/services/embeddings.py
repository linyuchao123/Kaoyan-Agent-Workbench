import logging
import math
from typing import Protocol

from langchain_openai import OpenAIEmbeddings
from openai import OpenAIError

from app.config import Settings

logger = logging.getLogger(__name__)


class EmbeddingProvider(Protocol):
    @property
    def configured(self) -> bool: ...

    @property
    def dimensions(self) -> int: ...

    async def embed_documents(self, texts: list[str]) -> list[list[float]] | None: ...

    async def embed_query(self, text: str) -> list[float] | None: ...


class OpenAICompatibleEmbeddingProvider:
    """Optional embedding adapter with strict vector validation and safe fallback."""

    def __init__(self, settings: Settings) -> None:
        self._dimensions = settings.embedding_dimensions
        api_key = settings.resolved_embedding_api_key
        base_url = settings.resolved_embedding_base_url
        self._configured = bool(
            api_key
            and settings.embedding_model
            and self._dimensions > 0
        )
        self.client = (
            OpenAIEmbeddings(
                model=settings.embedding_model,
                dimensions=self._dimensions,
                api_key=api_key,
                base_url=base_url or None,
                timeout=30,
                max_retries=1,
            )
            if self._configured
            else None
        )

    @property
    def configured(self) -> bool:
        return self._configured

    @property
    def dimensions(self) -> int:
        return self._dimensions

    def _valid_vector(self, vector: list[float]) -> bool:
        return len(vector) == self._dimensions and all(math.isfinite(value) for value in vector)

    async def embed_documents(self, texts: list[str]) -> list[list[float]] | None:
        if not texts:
            return []
        if self.client is None:
            return None
        try:
            vectors = await self.client.aembed_documents(texts)
        except (OpenAIError, OSError, RuntimeError, TimeoutError, ValueError) as error:
            logger.warning("Embedding document request failed; keeping keyword fallback: %s", error)
            return None
        if len(vectors) != len(texts) or not all(self._valid_vector(vector) for vector in vectors):
            logger.warning("Embedding provider returned invalid document vectors")
            return None
        return vectors

    async def embed_query(self, text: str) -> list[float] | None:
        if not text.strip() or self.client is None:
            return None
        try:
            vector = await self.client.aembed_query(text)
        except (OpenAIError, OSError, RuntimeError, TimeoutError, ValueError) as error:
            logger.warning("Embedding query request failed; keeping keyword fallback: %s", error)
            return None
        if not self._valid_vector(vector):
            logger.warning("Embedding provider returned an invalid query vector")
            return None
        return vector
