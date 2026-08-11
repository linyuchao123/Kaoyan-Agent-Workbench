from datetime import UTC, datetime
from unittest import TestCase
from uuid import UUID

from fastapi.testclient import TestClient

from app import main
from app.auth import AuthUser, InvalidTokenError, get_current_user
from app.services.repository import DemoRepository


class ApiFlowTests(TestCase):
    def setUp(self):
        self.previous_repository = main.repository
        main.repository = DemoRepository(now_factory=lambda: datetime(2026, 8, 10, 8, tzinfo=UTC))
        self.user = AuthUser(
            id=UUID("11111111-1111-1111-1111-111111111111"),
            email="one@example.com",
            access_token="user-one-token",
        )
        self.current_user = self.user

        async def authenticated_user() -> AuthUser:
            return self.current_user

        main.app.dependency_overrides[get_current_user] = authenticated_user
        main.import_proposals.clear()
        main.action_proposals.clear()
        main.applied_proposals.clear()
        main.demo_documents.clear()
        main.document_ids_by_hash.clear()
        self.client = TestClient(main.app)

    def tearDown(self):
        main.app.dependency_overrides.clear()
        main.repository = self.previous_repository

    def task_count(self) -> int:
        return len(self.client.get("/api/v1/tasks").json())

    def test_study_loop_updates_contributions(self):
        task = self.client.post(
            "/api/v1/tasks",
            json={"title": "极限基础题", "subject": "math", "planned_minutes": 60},
        )
        self.assertEqual(task.status_code, 201)
        task_id = task.json()["id"]
        self.assertTrue(
            self.client.patch(f"/api/v1/tasks/{task_id}", json={"completed": True}).json()[
                "completed"
            ]
        )

        session = self.client.post(
            "/api/v1/sessions",
            json={
                "subject": "math",
                "started_at": "2026-08-10T01:00:00Z",
                "ended_at": "2026-08-10T02:30:00Z",
                "paused_seconds": 600,
                "source": "timer",
                "note": "API flow test",
            },
        )
        self.assertEqual(session.status_code, 201)
        contribution = self.client.get(
            "/api/v1/analytics/contributions?from=2026-08-10&to=2026-08-10&scope=all"
        ).json()[0]
        self.assertEqual(contribution["effective_minutes"], 80)
        self.assertEqual(contribution["completed_tasks"], 1)

    def test_agent_write_requires_approval_and_is_idempotent(self):
        run = self.client.post(
            "/api/v1/agents/combined/runs",
            json={"message": "根据我的讲义和当前进度安排明天的 408 复习"},
        )
        self.assertEqual(run.status_code, 200)
        body = run.json()
        self.assertEqual(body["route"], "combined")
        self.assertEqual(body["retrieval_mode"], "hybrid")
        self.assertEqual(self.task_count(), 0)

        proposal_id = body["proposal"]["id"]
        first = self.client.post(f"/api/v1/proposals/{proposal_id}/approve")
        second = self.client.post(f"/api/v1/proposals/{proposal_id}/approve")
        self.assertEqual(first.json()["status"], "applied")
        self.assertEqual(second.json()["status"], "applied")
        self.assertEqual(self.task_count(), 1)

    def test_separate_agent_runs_do_not_share_idempotency_key(self):
        payload = {"message": "安排明天的 408 复习"}
        first = self.client.post("/api/v1/agents/coach/runs", json=payload).json()
        second = self.client.post("/api/v1/agents/coach/runs", json=payload).json()
        self.assertNotEqual(
            first["proposal"]["idempotency_key"], second["proposal"]["idempotency_key"]
        )
        self.client.post(f"/api/v1/proposals/{first['proposal']['id']}/approve")
        self.client.post(f"/api/v1/proposals/{second['proposal']['id']}/approve")
        self.assertEqual(self.task_count(), 2)

    def test_users_cannot_read_or_modify_each_others_tasks(self):
        first = self.client.post(
            "/api/v1/tasks",
            json={"title": "用户一任务", "subject": "math", "planned_minutes": 30},
        ).json()
        self.current_user = AuthUser(
            id=UUID("22222222-2222-2222-2222-222222222222"),
            email="two@example.com",
            access_token="user-two-token",
        )
        self.assertEqual(self.client.get("/api/v1/tasks").json(), [])
        self.assertEqual(
            self.client.patch(f"/api/v1/tasks/{first['id']}", json={"completed": True}).status_code,
            404,
        )
        self.current_user = self.user
        self.assertEqual(self.task_count(), 1)

    def test_three_level_plans_are_created_and_isolated_by_user(self):
        stage = self.client.post(
            "/api/v1/plans",
            json={
                "level": "stage",
                "title": "基础阶段",
                "description": "完成数学、英语和 408 第一轮基础",
                "starts_on": "2026-09-01",
                "ends_on": "2027-02-28",
            },
        )
        self.assertEqual(stage.status_code, 201)
        week = self.client.post(
            "/api/v1/plans",
            json={
                "parent_id": stage.json()["id"],
                "level": "week",
                "title": "基础阶段第 1 周",
                "starts_on": "2026-09-01",
                "ends_on": "2026-09-06",
            },
        )
        self.assertEqual(week.status_code, 201)
        self.assertEqual(
            [item["title"] for item in self.client.get("/api/v1/plans?level=week").json()],
            ["基础阶段第 1 周"],
        )

        outside_week = self.client.post(
            "/api/v1/plans",
            json={
                "parent_id": stage.json()["id"],
                "level": "week",
                "title": "超出阶段范围的周计划",
                "starts_on": "2027-02-27",
                "ends_on": "2027-03-05",
            },
        )
        self.assertEqual(outside_week.status_code, 422)
        self.assertEqual(
            outside_week.json()["detail"],
            "child plan dates must stay within parent plan dates",
        )

        invalid_day = self.client.post(
            "/api/v1/plans",
            json={
                "parent_id": stage.json()["id"],
                "level": "day",
                "title": "层级错误的日计划",
                "starts_on": "2026-09-01",
                "ends_on": "2026-09-01",
            },
        )
        self.assertEqual(invalid_day.status_code, 422)

        self.current_user = AuthUser(
            id=UUID("22222222-2222-2222-2222-222222222222"),
            email="two@example.com",
            access_token="user-two-token",
        )
        self.assertEqual(self.client.get("/api/v1/plans").json(), [])

    def test_client_cannot_choose_the_task_owner(self):
        response = self.client.post(
            "/api/v1/tasks",
            json={
                "title": "伪造归属",
                "subject": "math",
                "planned_minutes": 30,
                "user_id": "22222222-2222-2222-2222-222222222222",
            },
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.task_count(), 0)

    def test_missing_and_invalid_tokens_return_401(self):
        main.app.dependency_overrides.clear()
        self.assertEqual(self.client.get("/api/v1/tasks").status_code, 401)

        class RejectVerifier:
            async def verify(self, access_token: str) -> AuthUser:
                raise InvalidTokenError("expired or invalid access token")

        from app import auth

        previous = auth.token_verifier
        auth.token_verifier = RejectVerifier()
        try:
            response = self.client.get(
                "/api/v1/tasks", headers={"Authorization": "Bearer expired-token"}
            )
        finally:
            auth.token_verifier = previous
        self.assertEqual(response.status_code, 401)

    def test_naive_session_timestamp_is_rejected(self):
        response = self.client.post(
            "/api/v1/sessions",
            json={
                "subject": "math",
                "started_at": "2026-08-10T09:00:00",
                "ended_at": "2026-08-10T10:00:00",
            },
        )
        self.assertEqual(response.status_code, 422)

    def test_document_upload_deduplicates_and_blocks_private_url(self):
        content = b"# Limits\nDefinition and examples"
        first = self.client.post(
            "/api/v1/documents/upload",
            files={"file": ("limits.md", content, "text/markdown")},
        )
        second = self.client.post(
            "/api/v1/documents/upload",
            files={"file": ("limits.md", content, "text/markdown")},
        )
        self.assertEqual(first.status_code, 201)
        self.assertFalse(first.json()["duplicate"])
        self.assertTrue(second.json()["duplicate"])

        blocked = self.client.post(
            "/api/v1/documents/import-preview",
            json={"url": "http://127.0.0.1/private"},
        )
        self.assertEqual(blocked.status_code, 422)
