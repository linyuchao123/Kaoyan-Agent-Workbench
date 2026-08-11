import json
from datetime import UTC, date, datetime, timedelta
from unittest import IsolatedAsyncioTestCase
from uuid import UUID

import httpx

from app.auth import AuthUser
from app.config import Settings
from app.schemas import PlanCreate, PlanUpdate, StudySessionCreate, TaskCreate
from app.services.repository import (
    DemoRepository,
    RepositoryConflictError,
    RepositoryValidationError,
    SupabaseRepository,
)


class RepositoryTests(IsolatedAsyncioTestCase):
    def setUp(self):
        self.user = AuthUser(
            id=UUID("11111111-1111-1111-1111-111111111111"),
            email="one@example.com",
            access_token="signed-user-jwt",
        )

    async def test_demo_repository_isolates_users(self):
        repository = DemoRepository()
        await repository.create_task(
            self.user, TaskCreate(title="线性表", subject="cs408", planned_minutes=45)
        )
        other = AuthUser(
            id=UUID("22222222-2222-2222-2222-222222222222"),
            email="two@example.com",
            access_token="other-jwt",
        )
        self.assertEqual(await repository.list_tasks(other), [])
        self.assertEqual(len(await repository.list_tasks(self.user)), 1)

    async def test_supabase_repository_forwards_user_jwt_and_owner_id(self):
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(
                201,
                json=[
                    {
                        "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                        "title": "线性表",
                        "subject": "cs408",
                        "planned_minutes": 45,
                        "due_at": None,
                        "completed_at": None,
                    }
                ],
            )

        settings = Settings(
            supabase_url="https://project.supabase.co",
            supabase_anon_key="public-anon-key",
            demo_mode=False,
        )
        repository = SupabaseRepository(settings, httpx.MockTransport(handler))
        task = await repository.create_task(
            self.user, TaskCreate(title="线性表", subject="cs408", planned_minutes=45)
        )
        self.assertFalse(task["completed"])
        self.assertEqual(requests[0].headers["authorization"], "Bearer signed-user-jwt")
        self.assertEqual(requests[0].headers["apikey"], "public-anon-key")
        self.assertIn(str(self.user.id), requests[0].content.decode())

    async def test_supabase_contributions_fill_empty_days(self):
        def handler(_: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json=[
                    {
                        "study_date": "2026-08-10",
                        "effective_minutes": 80,
                        "session_count": 1,
                        "completed_tasks": 1,
                        "mistake_count": 0,
                        "subject_minutes": {"math": 80},
                    }
                ],
            )

        settings = Settings(
            supabase_url="https://project.supabase.co",
            supabase_anon_key="public-anon-key",
            demo_mode=False,
        )
        repository = SupabaseRepository(settings, httpx.MockTransport(handler))
        days = await repository.contributions(
            self.user, date(2026, 8, 10), date(2026, 8, 11), "math"
        )
        self.assertEqual([day.effective_minutes for day in days], [80, 0])
        self.assertEqual([day.intensity_level for day in days], [3, 0])

    async def test_supabase_reads_are_scoped_to_the_authenticated_user(self):
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(200, json=[])

        settings = Settings(
            supabase_url="https://project.supabase.co",
            supabase_anon_key="public-anon-key",
            demo_mode=False,
        )
        repository = SupabaseRepository(settings, httpx.MockTransport(handler))

        await repository.list_tasks(self.user)
        await repository.list_sessions(self.user)

        self.assertEqual(len(requests), 2)
        for request in requests:
            self.assertEqual(request.headers["authorization"], "Bearer signed-user-jwt")
            self.assertEqual(request.url.params["user_id"], f"eq.{self.user.id}")

    async def test_supabase_plan_reads_and_writes_use_current_user(self):
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            if request.method == "GET":
                return httpx.Response(200, json=[])
            return httpx.Response(
                201,
                json=[
                    {
                        "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                        "parent_id": None,
                        "level": "stage",
                        "title": "基础阶段",
                        "description": "完成第一轮基础",
                        "starts_on": "2026-09-01",
                        "ends_on": "2027-02-28",
                        "status": "active",
                    }
                ],
            )

        settings = Settings(
            supabase_url="https://project.supabase.co",
            supabase_anon_key="public-anon-key",
            demo_mode=False,
        )
        repository = SupabaseRepository(settings, httpx.MockTransport(handler))
        await repository.list_plans(self.user, "stage")
        await repository.create_plan(
            self.user,
            PlanCreate(
                level="stage",
                title="基础阶段",
                description="完成第一轮基础",
                starts_on=date(2026, 9, 1),
                ends_on=date(2027, 2, 28),
            ),
        )

        self.assertEqual(requests[0].url.params["user_id"], f"eq.{self.user.id}")
        self.assertEqual(requests[0].url.params["level"], "eq.stage")
        payload = json.loads(requests[1].content)
        self.assertEqual(payload["user_id"], str(self.user.id))
        self.assertNotIn("access_token", payload)

    async def test_supabase_child_plan_must_stay_inside_parent_dates(self):
        def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual(request.method, "GET")
            return httpx.Response(
                200,
                json=[
                    {
                        "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                        "level": "stage",
                        "starts_on": "2026-09-01",
                        "ends_on": "2027-02-28",
                    }
                ],
            )

    async def test_supabase_plan_update_and_delete_are_scoped_to_current_user(self):
        requests: list[httpx.Request] = []
        plan_id = UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            if request.method == "GET" and request.url.params.get("id"):
                return httpx.Response(
                    200,
                    json=[
                        {
                            "id": str(plan_id),
                            "parent_id": None,
                            "level": "stage",
                            "title": "基础阶段",
                            "description": "",
                            "starts_on": "2026-09-01",
                            "ends_on": "2027-02-28",
                            "status": "active",
                        }
                    ],
                )
            if request.method == "GET":
                return httpx.Response(200, json=[])
            if request.method == "PATCH":
                return httpx.Response(
                    200,
                    json=[
                        {
                            "id": str(plan_id),
                            "parent_id": None,
                            "level": "stage",
                            "title": "基础阶段（已调整）",
                            "description": "",
                            "starts_on": "2026-09-01",
                            "ends_on": "2027-02-28",
                            "status": "completed",
                        }
                    ],
                )
            return httpx.Response(200, json=[{"id": str(plan_id)}])

        settings = Settings(
            supabase_url="https://project.supabase.co",
            supabase_anon_key="public-anon-key",
            demo_mode=False,
        )
        repository = SupabaseRepository(settings, httpx.MockTransport(handler))
        updated = await repository.update_plan(
            self.user,
            plan_id,
            PlanUpdate(title="基础阶段（已调整）", status="completed"),
        )
        deleted = await repository.delete_plan(self.user, plan_id)

        self.assertEqual(updated["title"], "基础阶段（已调整）")
        self.assertEqual(updated["status"], "completed")
        self.assertTrue(deleted)
        for request in requests:
            self.assertEqual(request.url.params["user_id"], f"eq.{self.user.id}")

        settings = Settings(
            supabase_url="https://project.supabase.co",
            supabase_anon_key="public-anon-key",
            demo_mode=False,
        )
        repository = SupabaseRepository(settings, httpx.MockTransport(handler))

        with self.assertRaisesRegex(
            RepositoryValidationError,
            "child plan dates must stay within parent plan dates",
        ):
            await repository.create_plan(
                self.user,
                PlanCreate(
                    parent_id=UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
                    level="week",
                    title="超出阶段范围的周计划",
                    starts_on=date(2027, 2, 27),
                    ends_on=date(2027, 3, 5),
                ),
            )

    async def test_supabase_session_write_uses_current_user_identity(self):
        requests: list[httpx.Request] = []
        started_at = datetime(2026, 8, 11, 1, tzinfo=UTC)

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(
                201,
                json=[
                    {
                        "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                        "subject": "math",
                        "started_at": started_at.isoformat(),
                        "ended_at": (started_at + timedelta(hours=1)).isoformat(),
                        "paused_seconds": 300,
                        "source": "timer",
                        "note": "极限练习",
                    }
                ],
            )

        settings = Settings(
            supabase_url="https://project.supabase.co",
            supabase_anon_key="public-anon-key",
            demo_mode=False,
        )
        repository = SupabaseRepository(settings, httpx.MockTransport(handler))
        await repository.create_session(
            self.user,
            StudySessionCreate(
                subject="math",
                started_at=started_at,
                ended_at=started_at + timedelta(hours=1),
                paused_seconds=300,
                source="timer",
                note="极限练习",
            ),
        )

        payload = json.loads(requests[0].content)
        self.assertEqual(requests[0].headers["authorization"], "Bearer signed-user-jwt")
        self.assertEqual(payload["user_id"], str(self.user.id))
        self.assertNotIn("access_token", payload)

    async def test_supabase_overlap_constraint_becomes_repository_conflict(self):
        def handler(_: httpx.Request) -> httpx.Response:
            return httpx.Response(
                409,
                json={
                    "code": "23P01",
                    "message": "conflicting key value violates exclusion constraint",
                },
            )

        settings = Settings(
            supabase_url="https://project.supabase.co",
            supabase_anon_key="public-anon-key",
            demo_mode=False,
        )
        repository = SupabaseRepository(settings, httpx.MockTransport(handler))
        started_at = datetime(2026, 8, 11, 1, tzinfo=UTC)

        with self.assertRaisesRegex(
            RepositoryConflictError, "study session overlaps an existing session"
        ):
            await repository.create_session(
                self.user,
                StudySessionCreate(
                    subject="math",
                    started_at=started_at,
                    ended_at=started_at + timedelta(hours=1),
                ),
            )
