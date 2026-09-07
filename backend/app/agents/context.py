import asyncio
import re
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
    school_options: list[dict[str, Any]]
    career_items: list[dict[str, Any]]
    private_sources: list[dict[str, Any]]
    web_sources: list[dict[str, Any]]
    web_search_status: Literal["not_requested", "unconfigured", "success", "failed"]
    recent_effective_minutes: int


SCHOOL_CONTEXT_MARKERS = ("院校", "学校", "专业代码", "招生", "择校", "目标校", "复试")
CAREER_CONTEXT_MARKERS = ("实习", "求职", "简历", "投递", "面试", "项目经历")
PRIVATE_CONTEXT_MARKERS = (
    "资料",
    "原文",
    "文档",
    "pdf",
    "markdown",
    "讲义",
    "笔记",
    "教材",
    "我上传",
)


def requested_decision_context(message: str) -> tuple[bool, bool]:
    normalized = message.casefold()
    return (
        any(marker in normalized for marker in SCHOOL_CONTEXT_MARKERS),
        any(marker in normalized for marker in CAREER_CONTEXT_MARKERS),
    )


def should_search_private_context(message: str) -> bool:
    normalized = message.casefold()
    wants_school, wants_career = requested_decision_context(normalized)
    explicitly_requests_material = any(
        marker in normalized for marker in PRIVATE_CONTEXT_MARKERS
    )
    return explicitly_requests_material or not (wants_school or wants_career)


def requested_exam_year(message: str) -> int | None:
    for value in re.findall(r"(?<!\d)(20\d{2})(?!\d)", message):
        year = int(value)
        if 2026 <= year <= 2100:
            return year
    return None


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
    schools_task = None
    career_task = None
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
    wants_school, wants_career = requested_decision_context(message)
    if wants_school:
        schools_task = asyncio.create_task(
            repository.list_school_options(user, exam_year=requested_exam_year(message))
        )
    if wants_career:
        career_task = asyncio.create_task(repository.list_career_items(user))
    if (
        route in {"tutor", "combined"}
        and retrieval_mode in {"private", "hybrid"}
        and should_search_private_context(message)
    ):
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
    schools = await schools_task if schools_task else []
    career_items = await career_task if career_task else []
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
    school_options = [
        {
            "tier": school.get("tier"),
            "university": school.get("university"),
            "college": school.get("college"),
            "major_code": school.get("major_code"),
            "major_name": school.get("major_name"),
            "degree_type": school.get("degree_type"),
            "exam_year": school.get("exam_year"),
            "exam_subjects": school.get("exam_subjects"),
            "tuition_total": school.get("tuition_total"),
            "duration_years": school.get("duration_years"),
            "location": school.get("location"),
            "source_url": school.get("source_url"),
            "source_checked_at": school.get("source_checked_at"),
            "notes": str(school.get("notes") or "")[:800],
        }
        for school in schools[:8]
    ]
    career_context = [
        {
            "item_type": item.get("item_type"),
            "title": item.get("title"),
            "company": item.get("company"),
            "status": item.get("status"),
            "occurred_on": item.get("occurred_on"),
            "notes": str(item.get("notes") or "")[:800],
        }
        for item in career_items[:8]
    ]
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
        "school_options": school_options,
        "career_items": career_context,
        "private_sources": private_sources,
        "web_sources": web_sources,
        "web_search_status": web_search_status,
        "recent_effective_minutes": sum(_effective_minutes(session) for session in recent_sessions),
    }
