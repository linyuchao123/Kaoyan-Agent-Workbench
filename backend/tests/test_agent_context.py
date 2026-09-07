from datetime import UTC, datetime, timedelta
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch
from uuid import UUID

from app.agents.context import build_agent_context
from app.agents.graph import tutor_fallback
from app.auth import AuthUser
from app.schemas import (
    CareerItemCreate,
    MistakeCardCreate,
    PlanCreate,
    SchoolOptionCreate,
    StudySessionCreate,
    TaskCreate,
)
from app.services.repository import DemoRepository
from app.services.search import WebResult


class FakeSearchProvider:
    name = "fake-search"
    configured = True

    async def search(self, query, include_domains=None):
        return [
            WebResult(
                title="某大学 2028 招生简章",
                url="https://example.edu/admission",
                snippet=f"查询 {query} 的官方招生信息",
                accessed_at=datetime(2026, 8, 13, 9, tzinfo=UTC),
            )
        ]

    async def extract(self, url):
        return url


class AgentContextTests(IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.now = datetime(2026, 8, 13, 8, tzinfo=UTC)
        self.repository = DemoRepository(now_factory=lambda: self.now)
        self.user = AuthUser(
            id=UUID("11111111-1111-1111-1111-111111111111"),
            email="one@example.com",
            access_token="token",
        )

    async def test_coach_context_uses_owned_learning_records(self):
        await self.repository.create_plan(
            self.user,
            PlanCreate(
                level="stage",
                title="数学基础阶段",
                starts_on=self.now.date(),
                ends_on=(self.now + timedelta(days=30)).date(),
            ),
        )
        await self.repository.create_task(
            self.user,
            TaskCreate(title="完成极限练习", subject="math", planned_minutes=60),
        )
        await self.repository.create_session(
            self.user,
            StudySessionCreate(
                subject="math",
                started_at=self.now - timedelta(hours=2),
                ended_at=self.now - timedelta(minutes=30),
                paused_seconds=600,
            ),
        )
        await self.repository.create_mistake(
            self.user,
            MistakeCardCreate(
                subject="math",
                title="洛必达使用条件",
                question="何时可以使用？",
            ),
        )

        context = await build_agent_context(
            self.repository,
            self.user,
            message="根据当前进度安排复习",
            route="coach",
            retrieval_mode="private",
        )

        self.assertEqual(context["active_plans"][0]["title"], "数学基础阶段")
        self.assertEqual(context["pending_tasks"][0]["title"], "完成极限练习")
        self.assertEqual(context["due_mistakes"][0]["title"], "洛必达使用条件")
        self.assertEqual(context["recent_effective_minutes"], 80)

    async def test_context_does_not_read_another_users_records(self):
        await self.repository.create_task(
            self.user,
            TaskCreate(title="用户一私有任务", subject="math", planned_minutes=30),
        )
        other = AuthUser(
            id=UUID("22222222-2222-2222-2222-222222222222"),
            email="two@example.com",
            access_token="other-token",
        )

        context = await build_agent_context(
            self.repository,
            other,
            message="安排今天的任务",
            route="coach",
            retrieval_mode="private",
        )

        self.assertEqual(context["pending_tasks"], [])

    async def test_tutor_context_reads_only_requested_school_and_career_records(self):
        await self.repository.create_school_option(
            self.user,
            SchoolOptionCreate(
                tier="match",
                university="苏州大学",
                college="计算机科学与技术学院",
                major_code="085405",
                major_name="软件工程",
                degree_type="professional",
                exam_year=2028,
                exam_subjects=["政治", "英语二", "数学二", "408"],
                source_url="https://example.edu/admission",
                notes="院校备注" * 500,
            ),
        )
        await self.repository.create_career_item(
            self.user,
            CareerItemCreate(
                item_type="application",
                title="投递 AI 应用开发实习",
                company="示例科技",
                notes="求职复盘" * 500,
            ),
        )

        context = await build_agent_context(
            self.repository,
            self.user,
            message="对比我的目标院校和实习投递",
            route="tutor",
            retrieval_mode="private",
        )

        self.assertEqual(context["school_options"][0]["university"], "苏州大学")
        self.assertEqual(context["career_items"][0]["company"], "示例科技")
        self.assertNotIn("id", context["school_options"][0])
        self.assertNotIn("id", context["career_items"][0])
        self.assertEqual(len(context["school_options"][0]["notes"]), 800)
        self.assertEqual(len(context["career_items"][0]["notes"]), 800)
        answer = tutor_fallback({"context": context, "retrieval_mode": "private"})
        self.assertIn("已保存院校档案（1）", answer)
        self.assertIn("已保存求职记录（1）", answer)

        other = AuthUser(
            id=UUID("22222222-2222-2222-2222-222222222222"),
            email="two@example.com",
            access_token="other-token",
        )
        other_context = await build_agent_context(
            self.repository,
            other,
            message="对比我的目标院校和实习投递",
            route="tutor",
            retrieval_mode="private",
        )
        self.assertEqual(other_context["school_options"], [])
        self.assertEqual(other_context["career_items"], [])

    async def test_school_context_uses_requested_exam_year(self):
        for year in (2027, 2028):
            await self.repository.create_school_option(
                self.user,
                SchoolOptionCreate(
                    tier="match",
                    university=f"{year} 示例大学",
                    college="计算机学院",
                    major_code="085405",
                    major_name="软件工程",
                    degree_type="professional",
                    exam_year=year,
                    source_url=f"https://example.edu/{year}",
                ),
            )

        context = await build_agent_context(
            self.repository,
            self.user,
            message="比较我保存的 2028 年目标院校",
            route="tutor",
            retrieval_mode="private",
        )

        self.assertEqual(
            [school["exam_year"] for school in context["school_options"]],
            [2028],
        )

    async def test_career_context_prioritizes_actionable_records(self):
        for index in range(8):
            await self.repository.create_career_item(
                self.user,
                CareerItemCreate(
                    item_type="application",
                    title=f"已归档投递 {index}",
                    status="archived",
                ),
            )
        await self.repository.create_career_item(
            self.user,
            CareerItemCreate(
                item_type="interview",
                title="明天技术面试",
                status="interviewing",
            ),
        )

        context = await build_agent_context(
            self.repository,
            self.user,
            message="分析我的求职和面试进展",
            route="tutor",
            retrieval_mode="private",
        )

        self.assertEqual(len(context["career_items"]), 8)
        self.assertEqual(context["career_items"][0]["title"], "明天技术面试")
        self.assertNotIn("已归档投递 7", [item["title"] for item in context["career_items"]])

    async def test_context_skips_unrequested_decision_records(self):
        context = await build_agent_context(
            self.repository,
            self.user,
            message="解释二叉树遍历",
            route="tutor",
            retrieval_mode="private",
        )

        self.assertEqual(context["school_options"], [])
        self.assertEqual(context["career_items"], [])

    async def test_structured_decision_context_skips_unrequested_private_search(self):
        with patch.object(
            self.repository,
            "search_private_knowledge",
            new=AsyncMock(return_value=[]),
        ) as private_search:
            await build_agent_context(
                self.repository,
                self.user,
                message="分析我的实习投递进展",
                route="tutor",
                retrieval_mode="private",
            )
            private_search.assert_not_awaited()

            await build_agent_context(
                self.repository,
                self.user,
                message="结合我的简历资料分析实习投递",
                route="tutor",
                retrieval_mode="private",
            )
            private_search.assert_awaited_once()

    async def test_web_context_keeps_traceable_sources(self):
        context = await build_agent_context(
            self.repository,
            self.user,
            message="最新招生简章",
            route="tutor",
            retrieval_mode="web",
            search_provider=FakeSearchProvider(),
        )

        self.assertEqual(context["web_search_status"], "success")
        self.assertEqual(context["web_sources"][0]["title"], "某大学 2028 招生简章")
        self.assertEqual(context["web_sources"][0]["url"], "https://example.edu/admission")
        history = await self.repository.list_web_search_records(self.user)
        self.assertEqual(history[0].provider, "fake-search")
        self.assertEqual(history[0].results[0].title, "某大学 2028 招生简章")

    def test_saved_school_does_not_hide_missing_live_evidence(self):
        school = {
            "university": "示例大学", "college": "计算机学院",
            "major_code": "085405", "major_name": "软件工程",
            "exam_year": 2028, "source_url": "https://example.edu/admission",
        }
        for mode in ("web", "hybrid"):
            for status, reason in (
                ("unconfigured", "尚未配置联网检索服务"),
                ("failed", "联网检索失败"),
                ("success", "联网检索未返回来源"),
            ):
                with self.subTest(mode=mode, status=status):
                    answer = tutor_fallback({
                        "retrieval_mode": mode,
                        "context": {"school_options": [school], "web_search_status": status},
                    })
                    self.assertIn("示例大学", answer)
                    self.assertIn(reason, answer)
                    self.assertIn("无法确认最新信息", answer)

    def test_live_evidence_is_not_reported_as_missing(self):
        answer = tutor_fallback({
            "retrieval_mode": "web",
            "context": {
                "web_search_status": "success",
                "web_sources": [{
                    "title": "招生公告", "url": "https://example.edu/admission",
                    "snippet": "公告正文", "accessed_at": "2026-09-07T00:00:00Z",
                }],
            },
        })
        self.assertIn("招生公告", answer)
        self.assertNotIn("没有取得", answer)
