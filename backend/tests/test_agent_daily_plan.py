from unittest import TestCase

from app.domain.agent_daily_plan import (
    MAX_DAILY_PLAN_MINUTES,
    MAX_DAILY_PLAN_TASKS,
    build_daily_plan_tasks,
    is_daily_plan_request,
)


class AgentDailyPlanTests(TestCase):
    def test_recognizes_today_plan_intent_without_matching_tomorrow(self):
        self.assertTrue(is_daily_plan_request("请生成今天的学习计划"))
        self.assertTrue(is_daily_plan_request("帮我安排今天要做的事"))
        self.assertFalse(is_daily_plan_request("安排明天的 408 复习"))

    def test_prioritizes_two_due_mistakes_then_pending_tasks(self):
        plan = build_daily_plan_tasks(
            {
                "due_mistakes": [
                    {"title": "洛必达条件", "subject": "math"},
                    {"title": "阅读主旨题", "subject": "english"},
                    {"title": "进程调度", "subject": "cs408"},
                ],
                "pending_tasks": [
                    {"title": "概率论练习", "subject": "math", "planned_minutes": 60}
                ],
            }
        )

        self.assertEqual(
            [task["title"] for task in plan],
            ["洛必达条件复习", "阅读主旨题复习", "概率论练习", "进程调度复习"],
        )
        self.assertEqual(plan[2]["planned_minutes"], 60)

    def test_deduplicates_same_subject_and_source_title(self):
        plan = build_daily_plan_tasks(
            {
                "due_mistakes": [{"title": "极限计算", "subject": "math"}],
                "pending_tasks": [
                    {"title": "极限计算", "subject": "math", "planned_minutes": 90}
                ],
            }
        )

        self.assertEqual(len(plan), 1)
        self.assertEqual(plan[0]["title"], "极限计算复习")

    def test_limits_task_count_and_total_minutes(self):
        plan = build_daily_plan_tasks(
            {
                "pending_tasks": [
                    {
                        "title": f"任务 {index}",
                        "subject": "math",
                        "planned_minutes": 120,
                    }
                    for index in range(6)
                ]
            }
        )

        self.assertLessEqual(len(plan), MAX_DAILY_PLAN_TASKS)
        self.assertLessEqual(
            sum(task["planned_minutes"] for task in plan), MAX_DAILY_PLAN_MINUTES
        )

    def test_uses_safe_fallback_for_empty_context(self):
        self.assertEqual(
            build_daily_plan_tasks({}),
            [
                {
                    "title": "建立今日学习任务",
                    "subject": "cs408",
                    "planned_minutes": 45,
                }
            ],
        )
