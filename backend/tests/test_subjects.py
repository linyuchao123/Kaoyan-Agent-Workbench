from datetime import UTC, date, datetime, timedelta
from unittest import TestCase
from uuid import UUID

from app.domain.subjects import build_subject_summaries
from app.schemas import ContributionDay


class SubjectSummaryTests(TestCase):
    def test_builds_real_task_time_and_mistake_metrics_for_each_subject(self):
        now = datetime(2026, 8, 19, 12, tzinfo=UTC)
        summaries = build_subject_summaries(
            today=date(2026, 8, 19),
            now=now,
            tasks=[
                {"subject": "math", "completed": True},
                {"subject": "math", "completed": False},
                {"subject": "career", "completed": True},
            ],
            mistakes=[
                {
                    "id": UUID("11111111-1111-1111-1111-111111111111"),
                    "subject": "math",
                    "title": "等价无穷小替换",
                    "mastery": 1,
                    "review_count": 2,
                    "next_review_at": now - timedelta(hours=1),
                },
                {
                    "id": UUID("22222222-2222-2222-2222-222222222222"),
                    "subject": "math",
                    "title": "函数连续性",
                    "mastery": 3,
                    "review_count": 1,
                    "next_review_at": now + timedelta(days=1),
                },
            ],
            contributions=[
                ContributionDay(
                    date=date(2026, 8, 18),
                    scope="all",
                    effective_minutes=90,
                    intensity_level=2,
                    subject_minutes={"math": 60, "english": 30},
                ),
                ContributionDay(
                    date=date(2026, 8, 10),
                    scope="all",
                    effective_minutes=45,
                    intensity_level=1,
                    subject_minutes={"math": 45},
                ),
            ],
        )

        self.assertEqual([item.subject for item in summaries], ["math", "english", "politics", "cs408"])
        math = summaries[0]
        self.assertEqual(math.weekly_minutes, 60)
        self.assertEqual(math.total_minutes, 105)
        self.assertEqual(math.task_count, 2)
        self.assertEqual(math.completed_tasks, 1)
        self.assertEqual(math.task_completion_rate, 50)
        self.assertEqual(math.mistake_count, 2)
        self.assertEqual(math.due_mistake_count, 1)
        self.assertEqual(math.review_count, 3)
        self.assertEqual([item.title for item in math.weak_points], ["等价无穷小替换", "函数连续性"])

    def test_accepts_iso_dates_without_timezone_for_due_mistakes(self):
        now = datetime(2026, 8, 19, 12, tzinfo=UTC)
        summaries = build_subject_summaries(
            today=date(2026, 8, 19),
            now=now,
            tasks=[],
            mistakes=[
                {
                    "id": UUID("33333333-3333-3333-3333-333333333333"),
                    "subject": "english",
                    "title": "同位语从句",
                    "mastery": 2,
                    "review_count": 0,
                    "next_review_at": "2026-08-19T11:00:00",
                }
            ],
            contributions=[],
        )

        self.assertEqual(summaries[1].due_mistake_count, 1)
