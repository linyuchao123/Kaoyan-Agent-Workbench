import asyncio
from datetime import datetime
from typing import Any, Literal, TypedDict

from app.auth import AuthUser
from app.schemas import SearchSource
from app.services.repository import RepositoryError, StudyRepository
from app.services.search import WebSearchProvider


class AgentContext(TypedDict):
    active_plans: list[dict[str, Any]]
    pending_tasks: list[dict[str, Any]]
    recent_sessions: list[dict[str, Any]]
    due_mistakes: list[dict[str, Any]]
    private_sources: list[dict[str, Any]]
    web_sources: list[dict[str, Any]]
    web_search_status: Literal["not_requested", "unconfigured", "success", "failed"]
    recent_effective_minutes: int


def _effective_minutes(session: dict[str, Any]) -> int:
    started_at = session.get("started_at")
    ended_at = session.get("ended_at")
    if isinstance(started_at, str):
        started_at = datetime.fromisoformat(started_at)
    if isinstance(ended_at, str):
        ended_at = datetime.fromisoformat(ended_at)
    if not isinstance(started_at, datetime) or not isinstance(ended_at, datetime):
        return 0
    elapsed_seconds = max(0, int((ended_at - started_at).total_seconds()))
    paused_seconds = max(0, int(session.get("paused_seconds", 0)))
    return max(0, elapsed_seconds - paused_seconds) // 60


async def build_agent_context(
    repository: StudyRepository,
    user: AuthUser,
    *,
    message: str,
    route: Literal["coach", "tutor", "combined"],
    retrieval_mode: Literal["private", "web", "hybrid"],
    search_provider: WebSearchProvider | None = None,
    query_embedding: list[float] | None = None,
) -> AgentContext:
    """Build a small, read-only and user-isolated context for one Agent run."""

    plans_task = None
    tasks_task = None
    sessions_task = None
    mistakes_task = None
    sources_task = None
    web_task = None
    web_search_status: Literal["not_requested", "unconfigured", "success", "failed"] = (
        "not_requested"
    )

    if route in {"coach", "combined"}:
        plans_task = asyncio.create_task(repository.list_plans(user))
        tasks_task = asyncio.create_task(repository.list_tasks(user))
        sessions_task = asyncio.create_task(repository.list_sessions(user))
        mistakes_task = asyncio.create_task(repository.list_mistakes(user, due_only=True))
    if route in {"tutor", "combined"} and retrieval_mode in {"private", "hybrid"}:
        sources_task = asyncio.create_task(
            repository.search_private_knowledge(
                user,
                message,
                limit=4,
                query_embedding=query_embedding,
            )
        )
    if route in {"tutor", "combined"} and retrieval_mode in {"web", "hybrid"}:
        if search_provider and search_provider.configured:
            web_task = asyncio.create_task(search_provider.search(message))
        else:
            web_search_status = "unconfigured"

    plans = await plans_task if plans_task else []
    tasks = await tasks_task if tasks_task else []
    sessions = await sessions_task if sessions_task else []
    mistakes = await mistakes_task if mistakes_task else []
    sources = await sources_task if sources_task else []
    web_results = []
    if web_task:
        try:
            web_results = await web_task
            web_search_status = "success"
        except (OSError, RuntimeError, TimeoutError):
            web_search_status = "failed"
        else:
            try:
                await repository.record_web_search(
                    user,
                    query=message,
                    provider=search_provider.name,
                    results=[
                        SearchSource(
                            title=result.title,
                            url=result.url,
                            snippet=result.snippet,
                            accessed_at=result.accessed_at,
                        )
                        for result in web_results
                    ],
                )
            except RepositoryError:
                # Search answers remain usable when optional history persistence is unavailable.
                pass

    active_plans = [plan for plan in plans if plan.get("status") == "active"][:6]
    pending_tasks = [
        task for task in tasks if not task.get("completed", task.get("completed_at") is not None)
    ][:8]
    recent_sessions = list(reversed(sessions))[:8]
    due_mistakes = mistakes[:6]
    private_sources = [
        {
            "document_id": str(source.document_id),
            "title": source.title,
            "locator": source.locator,
            "content": source.content[:600],
            "score": source.score,
        }
        for source in sources[:4]
    ]
    web_sources = [
        {
            "title": result.title,
            "url": result.url,
            "snippet": result.snippet[:600],
            "accessed_at": result.accessed_at.isoformat(),
        }
        for result in web_results[:4]
    ]
    return {
        "active_plans": active_plans,
        "pending_tasks": pending_tasks,
        "recent_sessions": recent_sessions,
        "due_mistakes": due_mistakes,
        "private_sources": private_sources,
        "web_sources": web_sources,
        "web_search_status": web_search_status,
        "recent_effective_minutes": sum(_effective_minutes(session) for session in recent_sessions),
    }
