from collections import defaultdict
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from app.domain.contributions import StudyInterval, aggregate_daily_minutes, intensity_level
from app.schemas import (
    ContributionDay,
    PlanCreate,
    PlanUpdate,
    StudySessionCreate,
    TaskCreate,
    TaskUpdate,
)


class SessionOverlapError(ValueError):
    pass


class DemoStore:
    """Process-local store used until Supabase credentials are configured."""

    def __init__(
        self,
        timezone_name: str = "Asia/Shanghai",
        now_factory: Callable[[], datetime] | None = None,
    ) -> None:
        self.timezone = ZoneInfo(timezone_name)
        self.now = now_factory or (lambda: datetime.now(UTC))
        self.tasks: dict[UUID, dict] = {}
        self.sessions: dict[UUID, dict] = {}
        self.plans: dict[UUID, dict] = {}

    def list_plans(self, level: str | None = None) -> list[dict]:
        plans = [item for item in self.plans.values() if level is None or item["level"] == level]
        return sorted(plans, key=lambda item: (item["starts_on"], item["created_at"]))

    def create_plan(self, payload: PlanCreate) -> dict:
        if payload.parent_id:
            parent = self.plans.get(payload.parent_id)
            expected_level = "stage" if payload.level == "week" else "week"
            if not parent:
                raise ValueError("parent plan not found")
            if parent["level"] != expected_level:
                raise ValueError(f"{payload.level} plan requires a {expected_level} parent")
            if payload.starts_on < parent["starts_on"] or payload.ends_on > parent["ends_on"]:
                raise ValueError("child plan dates must stay within parent plan dates")
        now = self.now()
        item = {
            "id": uuid4(),
            **payload.model_dump(),
            "created_at": now,
            "updated_at": now,
        }
        self.plans[item["id"]] = item
        return item

    def update_plan(self, plan_id: UUID, payload: PlanUpdate) -> dict | None:
        item = self.plans.get(plan_id)
        if not item:
            return None
        changes = payload.model_dump(exclude_unset=True)
        starts_on = changes.get("starts_on", item["starts_on"])
        ends_on = changes.get("ends_on", item["ends_on"])
        if ends_on < starts_on:
            raise ValueError("ends_on must not be earlier than starts_on")
        if item["parent_id"]:
            parent = self.plans[item["parent_id"]]
            if starts_on < parent["starts_on"] or ends_on > parent["ends_on"]:
                raise ValueError("child plan dates must stay within parent plan dates")
        children = [plan for plan in self.plans.values() if plan["parent_id"] == plan_id]
        if any(child["starts_on"] < starts_on or child["ends_on"] > ends_on for child in children):
            raise ValueError("parent plan dates must include all child plans")
        item.update(changes)
        item["updated_at"] = self.now()
        return item

    def delete_plan(self, plan_id: UUID) -> bool:
        if plan_id not in self.plans:
            return False
        pending = [plan_id]
        while pending:
            current = pending.pop()
            pending.extend(
                plan["id"] for plan in self.plans.values() if plan["parent_id"] == current
            )
            self.plans.pop(current, None)
        return True

    def list_tasks(self) -> list[dict]:
        return sorted(self.tasks.values(), key=lambda item: item["created_at"])

    def create_task(self, payload: TaskCreate) -> dict:
        now = self.now()
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
            changes["completed_at"] = self.now() if changes["completed"] else None
        item.update(changes)
        item["updated_at"] = self.now()
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
        now = self.now()
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
            end_day = (
                (item["ended_at"] - timedelta(microseconds=1)).astimezone(self.timezone).date()
            )
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
