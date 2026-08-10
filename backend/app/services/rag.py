from dataclasses import dataclass
from typing import Literal, Protocol

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
