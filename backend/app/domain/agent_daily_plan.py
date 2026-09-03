from typing import Any, TypedDict

from app.schemas import Subject

MAX_DAILY_PLAN_TASKS = 4
MAX_DAILY_PLAN_MINUTES = 240
MAX_PRIORITY_MISTAKES = 2
DEFAULT_TASK_MINUTES = 45


class DailyPlanTask(TypedDict):
    title: str
    subject: Subject
    planned_minutes: int


def _subject(value: Any) -> Subject:
    return value if value in {"math", "english", "politics", "cs408"} else "cs408"


def _title(value: Any, *, review: bool = False) -> str:
    title = str(value or "").strip() or "未命名学习内容"
    if review and not title.endswith("复习"):
        title = f"{title}复习"
    return title[:160]


def _minutes(value: Any, *, default: int = DEFAULT_TASK_MINUTES) -> int:
    try:
        minutes = int(value)
    except (TypeError, ValueError):
        return default
    return min(max(minutes, 1), 120)


def build_daily_plan_tasks(context: dict[str, Any]) -> list[DailyPlanTask]:
    """Build a small deterministic proposal from user-owned learning context."""

    mistakes = list(context.get("due_mistakes") or [])
    pending_tasks = list(context.get("pending_tasks") or [])
    ordered_candidates = [
        *((mistake, True) for mistake in mistakes[:MAX_PRIORITY_MISTAKES]),
        *((task, False) for task in pending_tasks),
        *((mistake, True) for mistake in mistakes[MAX_PRIORITY_MISTAKES:]),
    ]
    result: list[DailyPlanTask] = []
    seen: set[tuple[Subject, str]] = set()
    remaining_minutes = MAX_DAILY_PLAN_MINUTES

    for candidate, is_mistake in ordered_candidates:
        subject = _subject(candidate.get("subject"))
        source_title = _title(candidate.get("title"))
        identity = (subject, source_title.removesuffix("复习"))
        if identity in seen:
            continue

        planned_minutes = _minutes(
            candidate.get("planned_minutes"),
            default=DEFAULT_TASK_MINUTES,
        )
        planned_minutes = min(planned_minutes, remaining_minutes)
        if planned_minutes < 1:
            break
        result.append(
            {
                "title": _title(source_title, review=is_mistake),
                "subject": subject,
                "planned_minutes": planned_minutes,
            }
        )
        seen.add(identity)
        remaining_minutes -= planned_minutes
        if len(result) >= MAX_DAILY_PLAN_TASKS or remaining_minutes == 0:
            break

    if not result:
        result.append(
            {
                "title": "建立今日学习任务",
                "subject": "cs408",
                "planned_minutes": DEFAULT_TASK_MINUTES,
            }
        )
    return result
