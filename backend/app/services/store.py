from collections import defaultdict
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from app.domain.contributions import StudyInterval, aggregate_daily_minutes, intensity_level
from app.schemas import (
    CareerItemCreate,
    CareerItemUpdate,
    ContributionDay,
    MistakeCardCreate,
    MistakeReviewCreate,
    PlanCreate,
    PlanUpdate,
    SchoolOptionCreate,
    SchoolOptionUpdate,
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
        self.mistake_cards: dict[UUID, dict] = {}
        self.review_events: dict[UUID, dict] = {}
        self.school_options: dict[UUID, dict] = {}
        self.career_items: dict[UUID, dict] = {}

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

    def plan_progress(self, plan_id: UUID) -> dict | None:
        plan = self.plans.get(plan_id)
        if not plan:
            return None
        plan_ids = {plan_id}
        previous_size = 0
        while previous_size != len(plan_ids):
            previous_size = len(plan_ids)
            plan_ids.update(
                item["id"] for item in self.plans.values() if item["parent_id"] in plan_ids
            )
        tasks = [item for item in self.tasks.values() if item.get("plan_id") in plan_ids]
        completed_tasks = sum(item["completed_at"] is not None for item in tasks)
        actual_minutes = sum(
            day.effective_minutes
            for day in self.contributions(plan["starts_on"], plan["ends_on"], "all")
        )
        return {
            "plan_id": plan_id,
            "task_count": len(tasks),
            "completed_tasks": completed_tasks,
            "completion_rate": round(completed_tasks / len(tasks) * 100) if tasks else 0,
            "actual_minutes": actual_minutes,
        }

    def list_tasks(self) -> list[dict]:
        return sorted(self.tasks.values(), key=lambda item: item["created_at"])

    def create_task(self, payload: TaskCreate) -> dict:
        self._validate_task_plan(payload.plan_id)
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
        if "plan_id" in changes:
            self._validate_task_plan(changes["plan_id"])
        if "completed" in changes:
            changes["completed_at"] = self.now() if changes["completed"] else None
        item.update(changes)
        item["updated_at"] = self.now()
        return item

    def delete_task(self, task_id: UUID) -> bool:
        if task_id not in self.tasks:
            return False
        self.tasks.pop(task_id)
        return True

    def _validate_task_plan(self, plan_id: UUID | None) -> None:
        if plan_id is None:
            return
        plan = self.plans.get(plan_id)
        if not plan or plan["level"] != "day":
            raise ValueError("task plan must be an owned day plan")

    def list_sessions(self) -> list[dict]:
        return sorted(self.sessions.values(), key=lambda item: item["started_at"])

    def create_session(self, payload: StudySessionCreate) -> dict:
        if payload.task_id is not None:
            task = self.tasks.get(payload.task_id)
            if not task or task["subject"] != payload.subject:
                raise ValueError(
                    "study session task must be an owned task with the same subject"
                )
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

    def delete_session(self, session_id: UUID) -> bool:
        if session_id not in self.sessions:
            return False
        self.sessions.pop(session_id)
        return True

    def list_mistakes(self, due_only: bool = False) -> list[dict]:
        now = self.now()
        cards = list(self.mistake_cards.values())
        if due_only:
            cards = [card for card in cards if card["next_review_at"] <= now]
        return sorted(cards, key=lambda card: (card["next_review_at"], card["created_at"]))

    def create_mistake(self, payload: MistakeCardCreate) -> dict:
        now = self.now()
        card = {
            "id": uuid4(),
            **payload.model_dump(),
            "mastery": 1,
            "next_review_at": now,
            "review_count": 0,
            "created_at": now,
            "updated_at": now,
        }
        self.mistake_cards[card["id"]] = card
        return card

    def review_mistake(self, card_id: UUID, payload: MistakeReviewCreate) -> dict | None:
        card = self.mistake_cards.get(card_id)
        if not card:
            return None
        result_settings = {
            "again": (-1, 1),
            "hard": (0, 3),
            "good": (1, 7),
            "easy": (2, 14),
        }
        mastery_delta, interval_days = result_settings[payload.result]
        mastery_before = card["mastery"]
        mastery_after = max(1, min(5, mastery_before + mastery_delta))
        now = self.now()
        event = {
            "id": uuid4(),
            "mistake_card_id": card_id,
            "result": payload.result,
            "mastery_before": mastery_before,
            "mastery_after": mastery_after,
            "reviewed_at": now,
            "created_at": now,
        }
        self.review_events[event["id"]] = event
        card.update(
            mastery=mastery_after,
            review_count=card["review_count"] + 1,
            next_review_at=now + timedelta(days=interval_days),
            updated_at=now,
        )
        return card

    def list_school_options(
        self, tier: str | None = None, exam_year: int | None = None
    ) -> list[dict]:
        options = [
            item
            for item in self.school_options.values()
            if (tier is None or item["tier"] == tier)
            and (exam_year is None or item["exam_year"] == exam_year)
        ]
        return sorted(
            options,
            key=lambda item: (item["exam_year"], item["tier"], item["university"]),
        )

    def create_school_option(self, payload: SchoolOptionCreate) -> dict:
        duplicate = any(
            item["college"] == payload.college
            and item["major_code"] == payload.major_code
            and item["exam_year"] == payload.exam_year
            for item in self.school_options.values()
        )
        if duplicate:
            raise ValueError("school option already exists for this college, major and year")
        now = self.now()
        item = {
            "id": uuid4(),
            **payload.model_dump(mode="json"),
            "source_checked_at": now,
            "created_at": now,
            "updated_at": now,
        }
        self.school_options[item["id"]] = item
        return item

    def update_school_option(
        self, option_id: UUID, payload: SchoolOptionUpdate
    ) -> dict | None:
        item = self.school_options.get(option_id)
        if not item:
            return None
        changes = payload.model_dump(mode="json", exclude_unset=True)
        college = changes.get("college", item["college"])
        major_code = changes.get("major_code", item["major_code"])
        exam_year = changes.get("exam_year", item["exam_year"])
        duplicate = any(
            current["id"] != option_id
            and current["college"] == college
            and current["major_code"] == major_code
            and current["exam_year"] == exam_year
            for current in self.school_options.values()
        )
        if duplicate:
            raise ValueError("school option already exists for this college, major and year")
        if "source_url" in changes:
            changes["source_checked_at"] = self.now()
        item.update(changes)
        item["updated_at"] = self.now()
        return item

    def delete_school_option(self, option_id: UUID) -> bool:
        return self.school_options.pop(option_id, None) is not None

    def list_career_items(
        self, item_type: str | None = None, status: str | None = None
    ) -> list[dict]:
        items = [
            item
            for item in self.career_items.values()
            if (item_type is None or item["item_type"] == item_type)
            and (status is None or item["status"] == status)
        ]
        return sorted(
            items,
            key=lambda item: (item["occurred_on"] is None, item["occurred_on"] or date.max),
        )

    def create_career_item(self, payload: CareerItemCreate) -> dict:
        now = self.now()
        item = {
            "id": uuid4(),
            **payload.model_dump(),
            "created_at": now,
            "updated_at": now,
        }
        self.career_items[item["id"]] = item
        return item

    def update_career_item(
        self, item_id: UUID, payload: CareerItemUpdate
    ) -> dict | None:
        item = self.career_items.get(item_id)
        if not item:
            return None
        item.update(payload.model_dump(exclude_unset=True))
        item["updated_at"] = self.now()
        return item

    def delete_career_item(self, item_id: UUID) -> bool:
        return self.career_items.pop(item_id, None) is not None

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

        target_tasks: dict[date, int] = defaultdict(int)
        completed_target_tasks: dict[date, int] = defaultdict(int)
        for item in self.tasks.values():
            if scope != "all" and item["subject"] != scope:
                continue
            plan = self.plans.get(item.get("plan_id")) if item.get("plan_id") else None
            target_day = plan["starts_on"] if plan and plan.get("level") == "day" else None
            if target_day is None and item.get("due_at"):
                target_day = item["due_at"].astimezone(self.timezone).date()
            if target_day is None:
                target_day = item["created_at"].astimezone(self.timezone).date()
            target_tasks[target_day] += 1
            if item.get("completed_at"):
                completed_target_tasks[target_day] += 1

        mistake_counts: dict[date, int] = defaultdict(int)
        for item in self.mistake_cards.values():
            mistake_counts[item["created_at"].astimezone(self.timezone).date()] += 1

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
                    target_tasks=target_tasks[cursor],
                    completed_target_tasks=completed_target_tasks[cursor],
                    task_completion_rate=(
                        round(completed_target_tasks[cursor] / target_tasks[cursor] * 100)
                        if target_tasks[cursor]
                        else 0
                    ),
                    mistake_count=mistake_counts[cursor],
                    subject_minutes=subject_minutes,
                )
            )
            cursor = date.fromordinal(cursor.toordinal() + 1)
        return result
