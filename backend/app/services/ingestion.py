import re
from dataclasses import dataclass, replace
from hashlib import sha256

from app.services.embeddings import EmbeddingProvider
from app.services.security import contains_prompt_injection

CHUNKING_VERSION = 2
DEFAULT_TARGET_CHARS = 1100
DEFAULT_MAX_CHARS = 1600
DEFAULT_OVERLAP_CHARS = 160

_STRUCTURAL_BOUNDARY = re.compile(
    r"\n{2,}"
    r"|(?=\n#{1,6}\s+)"
    r"|(?=\n第(?:[一二三四五六七八九十百]+|\d+)[章节部分篇])"
    r"|(?=\n[一二三四五六七八九十]+[、.．])"
    r"|(?=\n\d+(?:\.\d+)*[、.．\s])"
    r"|[。！？；!?;](?:\s|$)"
)

_HEADING_PATTERNS = (
    re.compile(r"^#{1,6}\s+(.+)$"),
    re.compile(r"^(第(?:[一二三四五六七八九十百]+|\d+)[章节部分篇].*)$"),
    re.compile(r"^([一二三四五六七八九十]+[、.．].+)$"),
    re.compile(r"^(\d+(?:\.\d+)*[、.．\s].+)$"),
)


@dataclass(frozen=True)
class TextChunk:
    index: int
    heading: str
    locator: str
    content: str
    page_number: int | None
    flagged_untrusted_instruction: bool
    embedding: list[float] | None = None


async def embed_safe_chunks(
    chunks: list[TextChunk], provider: EmbeddingProvider
) -> list[TextChunk]:
    """Embed retrievable chunks while leaving unsafe or failed items keyword-only."""
    safe_positions = [
        position
        for position, chunk in enumerate(chunks)
        if not chunk.flagged_untrusted_instruction and chunk.content.strip()
    ]
    if not safe_positions:
        return chunks
    vectors = await provider.embed_documents(
        [chunks[position].content for position in safe_positions]
    )
    if vectors is None:
        return chunks
    indexed = list(chunks)
    for position, vector in zip(safe_positions, vectors, strict=True):
        indexed[position] = replace(chunks[position], embedding=vector)
    return indexed


def document_hash(content: bytes) -> str:
    return sha256(content).hexdigest()


def _semantic_parts(
    text: str,
    *,
    target_chars: int,
    max_chars: int,
    overlap_chars: int,
) -> list[str]:
    """Split text near structural boundaries without producing oversized chunks."""
    if (
        target_chars < 400
        or max_chars < target_chars
        or overlap_chars < 0
        or overlap_chars >= target_chars
    ):
        raise ValueError("invalid chunk sizing")

    normalized = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized:
        return []

    parts: list[str] = []
    start = 0
    text_length = len(normalized)
    while start < text_length:
        hard_end = min(text_length, start + max_chars)
        if hard_end == text_length:
            end = text_length
        else:
            desired_end = min(text_length, start + target_chars)
            minimum_end = min(desired_end, start + max(320, target_chars // 2))
            boundaries = [
                match.end()
                for match in _STRUCTURAL_BOUNDARY.finditer(
                    normalized, minimum_end, hard_end
                )
            ]
            end = min(boundaries, key=lambda value: abs(value - desired_end)) if boundaries else hard_end

        part = normalized[start:end].strip()
        if part:
            parts.append(part)
        if end >= text_length:
            break
        start = max(end - overlap_chars, start + 1)
    return parts


def _heading_in(part: str, fallback: str) -> str:
    heading = fallback
    for line in part.splitlines():
        candidate = line.strip()
        for pattern in _HEADING_PATTERNS:
            match = pattern.match(candidate)
            if match:
                heading = match.group(1).strip()
    return heading


def chunk_markdown(
    text: str,
    *,
    target_chars: int = DEFAULT_TARGET_CHARS,
    overlap_chars: int = DEFAULT_OVERLAP_CHARS,
    max_chars: int = DEFAULT_MAX_CHARS,
) -> list[TextChunk]:
    """Split Markdown on headings, paragraphs and sentence boundaries."""
    chunks: list[TextChunk] = []
    current_heading = "文档正文"
    parts = _semantic_parts(
        text,
        target_chars=target_chars,
        max_chars=max_chars,
        overlap_chars=overlap_chars,
    )
    for part in parts:
        current_heading = _heading_in(part, current_heading)
        chunks.append(
            TextChunk(
                index=len(chunks),
                heading=current_heading,
                locator=f"{current_heading} · 片段 {len(chunks) + 1}",
                content=part,
                page_number=None,
                flagged_untrusted_instruction=contains_prompt_injection(part),
            )
        )
    return chunks


def chunk_pages(
    pages: list[str],
    *,
    target_chars: int = DEFAULT_TARGET_CHARS,
    overlap_chars: int = DEFAULT_OVERLAP_CHARS,
    max_chars: int = DEFAULT_MAX_CHARS,
) -> list[TextChunk]:
    chunks: list[TextChunk] = []
    for page_number, page in enumerate(pages, start=1):
        page_heading = f"第 {page_number} 页"
        parts = _semantic_parts(
            page,
            target_chars=target_chars,
            max_chars=max_chars,
            overlap_chars=overlap_chars,
        )
        current_heading = page_heading
        for part in parts:
            detected_heading = _heading_in(part, current_heading)
            if detected_heading != page_heading:
                current_heading = detected_heading
            locator_heading = (
                f"{page_heading} · {current_heading}"
                if current_heading != page_heading
                else page_heading
            )
            chunks.append(
                TextChunk(
                    index=len(chunks),
                    heading=current_heading,
                    locator=f"{locator_heading} · 片段 {len(chunks) + 1}",
                    content=part,
                    page_number=page_number,
                    flagged_untrusted_instruction=contains_prompt_injection(part),
                )
            )
    return chunks
