from collections import defaultdict
from datetime import UTC, date, datetime
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from app.domain.contributions import StudyInterval, aggregate_daily_minutes, intensity_level
from app.schemas import ContributionDay, StudySessionCreate, TaskCreate, TaskUpdate


class SessionOverlapError(ValueError):
    pass


class DemoStore:
    """Process-local store used until Supabase credentials are configured."""

    def __init__(self, timezone_name: str = "Asia/Shanghai") -> None:
        self.timezone = ZoneInfo(timezone_name)
        self.tasks: dict[UUID, dict] = {}
        self.sessions: dict[UUID, dict] = {}

    def list_tasks(self) -> list[dict]:
        return sorted(self.tasks.values(), key=lambda item: item["created_at"])

    def create_task(self, payload: TaskCreate) -> dict:
        now = datetime.now(UTC)
        item = {
            "id": uuid4(),
            **payload.model_dump(),
            "completed": False,
            "completed_at": None,
            "created_at": now,
            "updated_at": now,
        }
        self.tasks[item["id"]] = item
        return item

    def update_task(self, task_id: UUID, payload: TaskUpdate) -> dict | None:
        item = self.tasks.get(task_id)
        if not item:
            return None
        changes = payload.model_dump(exclude_unset=True)
        if "completed" in changes:
            changes["completed_at"] = datetime.now(UTC) if changes["completed"] else None
        item.update(changes)
        item["updated_at"] = datetime.now(UTC)
        return item

    def list_sessions(self) -> list[dict]:
        return sorted(self.sessions.values(), key=lambda item: item["started_at"])

    def create_session(self, payload: StudySessionCreate) -> dict:
        for current in self.sessions.values():
            if (
                payload.started_at < current["ended_at"]
                and payload.ended_at > current["started_at"]
            ):
                raise SessionOverlapError("study session overlaps an existing session")
        now = datetime.now(UTC)
        item = {"id": uuid4(), **payload.model_dump(), "created_at": now, "updated_at": now}
        self.sessions[item["id"]] = item
        return item

    def contributions(self, from_date: date, to_date: date, scope: str) -> list[ContributionDay]:
        sessions = self.list_sessions()
        by_subject: dict[str, dict[date, int]] = {}
        for subject in ("math", "english", "politics", "cs408", "career"):
            intervals = [
                StudyInterval(
                    item["started_at"].astimezone(self.timezone),
                    item["ended_at"].astimezone(self.timezone),
                    item["paused_seconds"],
                    item["subject"],
                )
                for item in sessions
                if item["subject"] == subject
            ]
            by_subject[subject] = aggregate_daily_minutes(intervals)

        session_days: dict[date, int] = defaultdict(int)
        for item in sessions:
            start_day = item["started_at"].astimezone(self.timezone).date()
            end_day = item["ended_at"].astimezone(self.timezone).date()
            cursor = start_day
            while cursor <= end_day:
                session_days[cursor] += 1
                cursor = date.fromordinal(cursor.toordinal() + 1)

        completed_tasks: dict[date, int] = defaultdict(int)
        for item in self.tasks.values():
            if item.get("completed_at"):
                completed_tasks[item["completed_at"].astimezone(self.timezone).date()] += 1

        result: list[ContributionDay] = []
        cursor = from_date
        while cursor <= to_date:
            subject_minutes = {
                subject: values.get(cursor, 0) for subject, values in by_subject.items()
            }
            minutes = (
                sum(subject_minutes.values()) if scope == "all" else subject_minutes.get(scope, 0)
            )
            result.append(
                ContributionDay(
                    date=cursor,
                    scope=scope,
                    effective_minutes=minutes,
                    intensity_level=intensity_level(
                        minutes, scope if scope in by_subject else "all"
                    ),
                    session_count=session_days[cursor],
                    completed_tasks=completed_tasks[cursor],
                    mistake_count=0,
                    subject_minutes=subject_minutes,
                )
            )
            cursor = date.fromordinal(cursor.toordinal() + 1)
        return result
