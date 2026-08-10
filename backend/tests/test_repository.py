from datetime import date
from unittest import IsolatedAsyncioTestCase
from uuid import UUID

import httpx

from app.auth import AuthUser
from app.config import Settings
from app.schemas import TaskCreate
from app.services.repository import DemoRepository, SupabaseRepository


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
