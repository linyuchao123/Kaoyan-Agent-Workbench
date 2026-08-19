from datetime import date, datetime, timedelta
from typing import Any

from app.schemas import ContributionDay, SubjectSummary, SubjectWeakPoint

ACADEMIC_SUBJECTS = ("math", "english", "politics", "cs408")


def _as_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None
    return None


def _is_due(value: Any, now: datetime) -> bool:
    next_review_at = _as_datetime(value)
    if next_review_at is None:
        return False
    if next_review_at.tzinfo is None and now.tzinfo is not None:
        next_review_at = next_review_at.replace(tzinfo=now.tzinfo)
    return next_review_at <= now


def build_subject_summaries(
    *,
    today: date,
    tasks: list[dict],
    mistakes: list[dict],
    contributions: list[ContributionDay],
    now: datetime,
) -> list[SubjectSummary]:
    week_start = today - timedelta(days=today.weekday())
    summaries: list[SubjectSummary] = []

    for subject in ACADEMIC_SUBJECTS:
        subject_tasks = [task for task in tasks if task.get("subject") == subject]
        completed_tasks = sum(
            bool(task.get("completed") or task.get("completed_at")) for task in subject_tasks
        )
        subject_mistakes = [
            mistake for mistake in mistakes if mistake.get("subject") == subject
        ]
        due_mistakes = sum(
            _is_due(mistake.get("next_review_at"), now)
            for mistake in subject_mistakes
        )
        recent_weak_points = sorted(
            subject_mistakes,
            key=lambda mistake: (
                int(mistake.get("mastery", 0)),
                _as_datetime(mistake.get("next_review_at")) or now,
            ),
        )[:3]
        weekly_minutes = sum(
            item.subject_minutes.get(subject, 0)
            for item in contributions
            if item.date >= week_start
        )
        total_minutes = sum(
            item.subject_minutes.get(subject, 0) for item in contributions
        )
        task_count = len(subject_tasks)
        summaries.append(
            SubjectSummary(
                subject=subject,
                weekly_minutes=weekly_minutes,
                total_minutes=total_minutes,
                task_count=task_count,
                completed_tasks=completed_tasks,
                task_completion_rate=round(completed_tasks / task_count * 100)
                if task_count
                else 0,
                mistake_count=len(subject_mistakes),
                due_mistake_count=due_mistakes,
                review_count=sum(
                    int(mistake.get("review_count", 0)) for mistake in subject_mistakes
                ),
                weak_points=[
                    SubjectWeakPoint(
                        id=mistake["id"],
                        title=mistake["title"],
                        mastery=int(mistake.get("mastery", 0)),
                        review_count=int(mistake.get("review_count", 0)),
                        next_review_at=mistake["next_review_at"],
                    )
                    for mistake in recent_weak_points
                ],
            )
        )
    return summaries
