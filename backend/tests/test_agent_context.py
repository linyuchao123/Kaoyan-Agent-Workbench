from datetime import UTC, datetime, timedelta
from unittest import IsolatedAsyncioTestCase
from uuid import UUID

from app.agents.context import build_agent_context
from app.auth import AuthUser
from app.schemas import MistakeCardCreate, PlanCreate, StudySessionCreate, TaskCreate
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
