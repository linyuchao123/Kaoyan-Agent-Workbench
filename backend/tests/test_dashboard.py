from datetime import UTC, date, datetime, timedelta
from unittest import TestCase
from uuid import UUID

from app.domain.dashboard import build_dashboard_metrics
from app.schemas import ContributionDay


def contribution(day: date, minutes: int) -> ContributionDay:
    return ContributionDay(
        date=day,
        scope="all",
        effective_minutes=minutes,
        intensity_level=1 if minutes else 0,
    )


class DashboardMetricsTests(TestCase):
    def test_builds_weekly_completion_from_day_plans_and_unlinked_tasks(self):
        today = date(2026, 8, 19)
        weekly_plan_id = UUID("11111111-1111-1111-1111-111111111111")
        metrics = build_dashboard_metrics(
            today=today,
            day_plans=[
                {
                    "id": weekly_plan_id,
                    "starts_on": date(2026, 8, 20),
                }
            ],
            tasks=[
                {"plan_id": weekly_plan_id, "completed": True},
                {
                    "plan_id": None,
                    "due_at": None,
                    "created_at": datetime(2026, 8, 18, 12, tzinfo=UTC),
                    "completed": False,
                },
                {
                    "plan_id": None,
                    "due_at": "2026-08-10T12:00:00+08:00",
                    "created_at": "2026-08-10T12:00:00+08:00",
                    "completed": True,
                },
            ],
            contributions=[],
        )

        self.assertEqual(metrics.week_start, date(2026, 8, 17))
        self.assertEqual(metrics.weekly_task_count, 2)
        self.assertEqual(metrics.weekly_completed_tasks, 1)
        self.assertEqual(metrics.weekly_completion_rate, 50)

    def test_current_streak_accepts_yesterday_and_longest_uses_recent_year(self):
        today = date(2026, 8, 19)
        days = [
            contribution(today - timedelta(days=offset), 30 if offset in {1, 2, 3, 8, 9} else 0)
            for offset in range(10)
        ]

        metrics = build_dashboard_metrics(
            today=today,
            day_plans=[],
            tasks=[],
            contributions=days,
        )

        self.assertEqual(metrics.today_effective_minutes, 0)
        self.assertEqual(metrics.current_streak_days, 3)
        self.assertEqual(metrics.longest_streak_days, 3)

    def test_streak_resets_after_a_full_missed_day(self):
        today = date(2026, 8, 19)
        metrics = build_dashboard_metrics(
            today=today,
            day_plans=[],
            tasks=[],
            contributions=[contribution(today - timedelta(days=2), 60)],
        )

        self.assertEqual(metrics.current_streak_days, 0)
        self.assertEqual(metrics.longest_streak_days, 1)
