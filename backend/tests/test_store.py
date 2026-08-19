from datetime import UTC, date, datetime, timedelta
from unittest import TestCase

from app.schemas import PlanCreate, StudySessionCreate, TaskCreate, TaskUpdate
from app.services.store import DemoStore, SessionOverlapError


class DemoStoreTests(TestCase):
    def setUp(self):
        self.store = DemoStore(
            "Asia/Shanghai",
            now_factory=lambda: datetime(2026, 8, 10, 8, tzinfo=UTC),
        )
        self.start = datetime(2026, 8, 10, 1, tzinfo=UTC)

    def test_task_completion_is_counted(self):
        task = self.store.create_task(TaskCreate(title="线性表复习", subject="cs408"))
        updated = self.store.update_task(task["id"], TaskUpdate(completed=True))
        self.assertIsNotNone(updated)
        contribution = self.store.contributions(date(2026, 8, 10), date(2026, 8, 10), "all")[0]
        self.assertEqual(contribution.completed_tasks, 1)

    def test_task_can_be_edited_and_deleted(self):
        task = self.store.create_task(TaskCreate(title="线性表复习", subject="cs408"))
        updated = self.store.update_task(
            task["id"],
            TaskUpdate(title="线性表错题复盘", subject="math", planned_minutes=60),
        )

        self.assertIsNotNone(updated)
        self.assertEqual(updated["title"], "线性表错题复盘")
        self.assertEqual(updated["subject"], "math")
        self.assertEqual(updated["planned_minutes"], 60)
        self.assertTrue(self.store.delete_task(task["id"]))
        self.assertFalse(self.store.delete_task(task["id"]))
        self.assertEqual(self.store.list_tasks(), [])

    def test_task_plan_must_be_a_day_plan(self):
        stage = self.store.create_plan(
            PlanCreate(
                level="stage",
                title="基础阶段",
                starts_on=date(2026, 9, 1),
                ends_on=date(2027, 2, 28),
            )
        )
        week = self.store.create_plan(
            PlanCreate(
                parent_id=stage["id"],
                level="week",
                title="基础阶段第 1 周",
                starts_on=date(2026, 9, 1),
                ends_on=date(2026, 9, 7),
            )
        )
        day = self.store.create_plan(
            PlanCreate(
                parent_id=week["id"],
                level="day",
                title="9 月 1 日计划",
                starts_on=date(2026, 9, 1),
                ends_on=date(2026, 9, 1),
            )
        )
        task = self.store.create_task(
            TaskCreate(title="极限基础题", subject="math", plan_id=day["id"])
        )
        self.assertEqual(task["plan_id"], day["id"])
        with self.assertRaisesRegex(ValueError, "owned day plan"):
            self.store.create_task(
                TaskCreate(title="错误关联", subject="math", plan_id=stage["id"])
            )

    def test_session_contributes_to_subject_and_total(self):
        self.store.create_session(
            StudySessionCreate(
                subject="math",
                started_at=self.start,
                ended_at=self.start + timedelta(minutes=90),
                paused_seconds=600,
            )
        )
        overall = self.store.contributions(date(2026, 8, 10), date(2026, 8, 10), "all")[0]
        math = self.store.contributions(date(2026, 8, 10), date(2026, 8, 10), "math")[0]
        self.assertEqual(overall.effective_minutes, 80)
        self.assertEqual(math.effective_minutes, 80)
        self.assertEqual(overall.subject_minutes["math"], 80)

    def test_overlapping_sessions_are_rejected(self):
        self.store.create_session(
            StudySessionCreate(
                subject="math",
                started_at=self.start,
                ended_at=self.start + timedelta(hours=2),
            )
        )
        with self.assertRaises(SessionOverlapError):
            self.store.create_session(
                StudySessionCreate(
                    subject="english",
                    started_at=self.start + timedelta(hours=1),
                    ended_at=self.start + timedelta(hours=3),
                )
            )

    def test_session_ending_at_midnight_is_not_counted_on_next_day(self):
        self.store.create_session(
            StudySessionCreate(
                subject="math",
                started_at=datetime(2026, 8, 10, 14, tzinfo=UTC),
                ended_at=datetime(2026, 8, 10, 16, tzinfo=UTC),
            )
        )
        next_day = self.store.contributions(date(2026, 8, 11), date(2026, 8, 11), "all")[0]
        self.assertEqual(next_day.session_count, 0)

    def test_session_can_be_deleted(self):
        session = self.store.create_session(
            StudySessionCreate(
                subject="math",
                started_at=self.start,
                ended_at=self.start + timedelta(hours=1),
            )
        )

        self.assertTrue(self.store.delete_session(session["id"]))
        self.assertFalse(self.store.delete_session(session["id"]))
        self.assertEqual(self.store.list_sessions(), [])
