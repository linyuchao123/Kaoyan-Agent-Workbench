import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Literal, Protocol

from app.schemas import PrivateKnowledgeSource

RetrievalMode = Literal["private", "web", "hybrid"]


@dataclass(frozen=True)
class RetrievedSource:
    source_type: Literal["private", "web"]
    title: str
    locator: str
    content: str
    score: float


class PrivateKnowledgeRetriever(Protocol):
    async def search(self, query: str, user_id: str, limit: int = 8) -> list[RetrievedSource]: ...


def choose_retrieval_mode(message: str) -> RetrievalMode:
    lowered = message.lower()
    current_markers = (
        "最新",
        "今年",
        "当前",
        "现在",
        "招生简章",
        "官网",
        "联网",
        "today",
        "latest",
    )
    private_markers = ("我的资料", "讲义", "笔记", "我上传", "根据资料", "错题")
    wants_web = any(marker in lowered for marker in current_markers)
    wants_private = any(marker in lowered for marker in private_markers)
    if wants_web and wants_private:
        return "hybrid"
    if wants_web:
        return "web"
    return "private"


def private_search_terms(query: str, content: str) -> list[str]:
    """Return a small ordered set of exact terms that explain a search hit."""
    normalized_query = re.sub(r"\s+", " ", query).strip()
    normalized_content = re.sub(r"\s+", " ", content)
    candidates = [normalized_query]
    candidates.extend(
        term
        for term in re.split(r"[\s,，。；;：:、/]+", normalized_query)
        if len(term) >= 2
    )
    if not any(candidate in normalized_content for candidate in candidates):
        match = SequenceMatcher(
            None,
            normalized_query.casefold(),
            normalized_content.casefold(),
            autojunk=False,
        ).find_longest_match()
        if match.size >= 2:
            candidates.append(normalized_query[match.a : match.a + match.size])

    matched: list[str] = []
    lowered_content = normalized_content.casefold()
    for candidate in candidates:
        cleaned = candidate.strip()
        if (
            len(cleaned) >= 2
            and cleaned.casefold() in lowered_content
            and cleaned not in matched
        ):
            matched.append(cleaned)
    return matched[:6]


def private_search_snippet(
    content: str, matched_terms: list[str], *, max_chars: int = 360
) -> str:
    """Create a readable excerpt centered on the first exact matching term."""
    normalized = re.sub(r"[ \t]+", " ", content).strip()
    if len(normalized) <= max_chars:
        return normalized

    lowered = normalized.casefold()
    positions = [
        lowered.find(term.casefold())
        for term in matched_terms
        if lowered.find(term.casefold()) >= 0
    ]
    center = min(positions) if positions else 0
    start = max(0, center - max_chars // 3)
    end = min(len(normalized), start + max_chars)
    start = max(0, end - max_chars)

    if start > 0:
        preceding = max(normalized.rfind(mark, max(0, start - 60), start) for mark in "\n。；")
        if preceding >= 0:
            start = preceding + 1
    if end < len(normalized):
        following = [
            normalized.find(mark, end, min(len(normalized), end + 60))
            for mark in "\n。；"
        ]
        following = [position for position in following if position >= 0]
        if following:
            end = min(following) + 1

    excerpt = normalized[start:end].strip()
    return f"{'…' if start else ''}{excerpt}{'…' if end < len(normalized) else ''}"


def enrich_private_source(
    source: PrivateKnowledgeSource,
    query: str,
    retrieval_mode: Literal["keyword", "hybrid"],
) -> PrivateKnowledgeSource:
    matched_terms = private_search_terms(query, source.content)
    return source.model_copy(
        update={
            "snippet": private_search_snippet(source.content, matched_terms),
            "matched_terms": matched_terms,
            "retrieval_mode": retrieval_mode,
        }
    )


def reciprocal_rank_fusion(
    groups: list[list[RetrievedSource]], limit: int = 8
) -> list[RetrievedSource]:
    scores: dict[tuple[str, str], float] = {}
    values: dict[tuple[str, str], RetrievedSource] = {}
    for group in groups:
        for rank, source in enumerate(group, start=1):
            key = (source.source_type, source.locator)
            scores[key] = scores.get(key, 0.0) + 1.0 / (60 + rank)
            values[key] = source
    ordered = sorted(scores, key=scores.get, reverse=True)
    return [values[key] for key in ordered[:limit]]
