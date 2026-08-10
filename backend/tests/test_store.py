from datetime import UTC, date, datetime, timedelta
from unittest import TestCase

from app.schemas import StudySessionCreate, TaskCreate, TaskUpdate
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
