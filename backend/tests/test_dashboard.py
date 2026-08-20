from datetime import UTC, date, datetime, timedelta
from unittest import TestCase
from uuid import UUID

from app.domain.dashboard import (
    active_stage_title,
    attach_task_actual_minutes,
    build_dashboard_metrics,
    select_today_tasks,
)
from app.schemas import ContributionDay


def contribution(day: date, minutes: int) -> ContributionDay:
    return ContributionDay(
        date=day,
        scope="all",
        effective_minutes=minutes,
        intensity_level=1 if minutes else 0,
    )


class DashboardMetricsTests(TestCase):
    def test_attaches_effective_minutes_to_each_linked_task(self):
        tasks = [{"id": "math"}, {"id": "english"}]
        sessions = [
            {
                "task_id": "math",
                "started_at": "2026-08-19T08:00:00+08:00",
                "ended_at": "2026-08-19T09:30:00+08:00",
                "paused_seconds": 600,
            },
            {
                "task_id": "math",
                "started_at": datetime(2026, 8, 19, 10, tzinfo=UTC),
                "ended_at": datetime(2026, 8, 19, 10, 30, tzinfo=UTC),
                "paused_seconds": 0,
            },
            {
                "task_id": None,
                "started_at": "2026-08-19T11:00:00+08:00",
                "ended_at": "2026-08-19T12:00:00+08:00",
                "paused_seconds": 0,
            },
        ]

        enriched = attach_task_actual_minutes(tasks=tasks, sessions=sessions)

        self.assertEqual(enriched[0]["actual_minutes"], 110)
        self.assertEqual(enriched[1]["actual_minutes"], 0)

    def test_selects_today_tasks_and_carries_only_unfinished_backlog(self):
        today = date(2026, 8, 19)
        today_plan_id = UUID("11111111-1111-1111-1111-111111111111")
        future_plan_id = UUID("22222222-2222-2222-2222-222222222222")
        tasks = [
            {"id": "today", "plan_id": today_plan_id, "completed": False},
            {"id": "future", "plan_id": future_plan_id, "completed": False},
            {
                "id": "backlog",
                "plan_id": None,
                "created_at": "2026-08-18T09:00:00+08:00",
                "completed": False,
            },
            {
                "id": "old-completed",
                "plan_id": None,
                "created_at": "2026-08-18T09:00:00+08:00",
                "completed": True,
            },
        ]

        selected = select_today_tasks(
            today=today,
            tasks=tasks,
            day_plans=[
                {"id": today_plan_id, "starts_on": today},
                {"id": future_plan_id, "starts_on": today + timedelta(days=1)},
            ],
        )

        self.assertEqual([task["id"] for task in selected], ["today", "backlog"])

    def test_finds_active_stage_and_uses_today_task_minutes_as_goal(self):
        today = date(2026, 8, 19)
        stage = active_stage_title(
            today=today,
            plans=[
                {
                    "level": "stage",
                    "title": "基础阶段",
                    "starts_on": "2026-08-01",
                    "ends_on": "2026-12-31",
                    "status": "active",
                }
            ],
        )
        metrics = build_dashboard_metrics(
            today=today,
            day_plans=[],
            tasks=[],
            today_tasks=[
                {"planned_minutes": 60},
                {"planned_minutes": 90},
            ],
            contributions=[],
            stage_title=stage,
        )

        self.assertEqual(metrics.today_task_count, 2)
        self.assertEqual(metrics.today_planned_minutes, 150)
        self.assertEqual(metrics.active_stage_title, "基础阶段")

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
