import re
from dataclasses import dataclass, replace
from hashlib import sha256

from app.services.embeddings import EmbeddingProvider
from app.services.security import contains_prompt_injection


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


def chunk_markdown(
    text: str,
    *,
    target_chars: int = 3000,
    overlap_chars: int = 400,
) -> list[TextChunk]:
    """Heading-aware chunking approximating 600–900 tokens per chunk."""
    if target_chars < 800 or overlap_chars < 0 or overlap_chars >= target_chars:
        raise ValueError("invalid chunk sizing")
    sections = re.split(r"(?=^#{1,6}\s+)", text.strip(), flags=re.MULTILINE)
    chunks: list[TextChunk] = []
    carry = ""
    current_heading = "文档正文"

    for section in sections:
        if not section.strip():
            continue
        heading_match = re.match(r"^(#{1,6})\s+(.+)$", section, flags=re.MULTILINE)
        if heading_match:
            current_heading = heading_match.group(2).strip()
        content = f"{carry}\n{section}".strip() if carry else section.strip()
        start = 0
        while start < len(content):
            end = min(len(content), start + target_chars)
            if end < len(content):
                boundary = content.rfind("\n", start + target_chars // 2, end)
                if boundary > start:
                    end = boundary
            part = content[start:end].strip()
            if part:
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
            if end >= len(content):
                break
            start = max(end - overlap_chars, start + 1)
        carry = content[-overlap_chars:] if overlap_chars else ""
    return chunks


def chunk_pages(
    pages: list[str], *, target_chars: int = 3000, overlap_chars: int = 400
) -> list[TextChunk]:
    chunks: list[TextChunk] = []
    for page_number, page in enumerate(pages, start=1):
        page_text = page.strip()
        if not page_text:
            continue
        start = 0
        while start < len(page_text):
            end = min(len(page_text), start + target_chars)
            part = page_text[start:end].strip()
            if part:
                chunks.append(
                    TextChunk(
                        index=len(chunks),
                        heading=f"第 {page_number} 页",
                        locator=f"第 {page_number} 页 · 片段 {len(chunks) + 1}",
                        content=part,
                        page_number=page_number,
                        flagged_untrusted_instruction=contains_prompt_injection(part),
                    )
                )
            if end >= len(page_text):
                break
            start = max(end - overlap_chars, start + 1)
    return chunks
