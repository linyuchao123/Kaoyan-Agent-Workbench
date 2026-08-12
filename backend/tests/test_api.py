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

    def test_plan_edit_delete_and_child_date_validation(self):
        stage = self.client.post(
            "/api/v1/plans",
            json={
                "level": "stage",
                "title": "基础阶段",
                "starts_on": "2026-09-01",
                "ends_on": "2027-02-28",
            },
        ).json()
        week = self.client.post(
            "/api/v1/plans",
            json={
                "parent_id": stage["id"],
                "level": "week",
                "title": "基础阶段第 1 周",
                "starts_on": "2026-09-01",
                "ends_on": "2026-09-07",
            },
        ).json()

        edited = self.client.patch(
            f"/api/v1/plans/{week['id']}",
            json={"title": "基础阶段第一周", "description": "建立稳定节奏"},
        )
        self.assertEqual(edited.status_code, 200)
        self.assertEqual(edited.json()["title"], "基础阶段第一周")

        completed = self.client.patch(
            f"/api/v1/plans/{week['id']}",
            json={"status": "completed"},
        )
        self.assertEqual(completed.status_code, 200)
        self.assertEqual(completed.json()["status"], "completed")

        archived = self.client.patch(
            f"/api/v1/plans/{week['id']}",
            json={"status": "archived"},
        )
        self.assertEqual(archived.status_code, 200)
        self.assertEqual(archived.json()["status"], "archived")

        invalid_status = self.client.patch(
            f"/api/v1/plans/{week['id']}",
            json={"status": "paused"},
        )
        self.assertEqual(invalid_status.status_code, 422)

        invalid_parent_dates = self.client.patch(
            f"/api/v1/plans/{stage['id']}",
            json={"starts_on": "2026-09-03"},
        )
        self.assertEqual(invalid_parent_dates.status_code, 422)

        deleted = self.client.delete(f"/api/v1/plans/{stage['id']}")
        self.assertEqual(deleted.status_code, 204)
        self.assertEqual(self.client.get("/api/v1/plans").json(), [])

    def test_other_user_cannot_edit_or_delete_plan(self):
        plan = self.client.post(
            "/api/v1/plans",
            json={
                "level": "stage",
                "title": "用户一阶段",
                "starts_on": "2026-09-01",
                "ends_on": "2027-02-28",
            },
        ).json()
        self.current_user = AuthUser(
            id=UUID("22222222-2222-2222-2222-222222222222"),
            email="two@example.com",
            access_token="user-two-token",
        )
        self.assertEqual(
            self.client.patch(
                f"/api/v1/plans/{plan['id']}", json={"title": "越权修改"}
            ).status_code,
            404,
        )
        self.assertEqual(self.client.delete(f"/api/v1/plans/{plan['id']}").status_code, 404)

    def test_task_can_only_link_to_owned_day_plan(self):
        stage = self.client.post(
            "/api/v1/plans",
            json={
                "level": "stage",
                "title": "基础阶段",
                "starts_on": "2026-09-01",
                "ends_on": "2027-02-28",
            },
        ).json()
        week = self.client.post(
            "/api/v1/plans",
            json={
                "parent_id": stage["id"],
                "level": "week",
                "title": "基础阶段第 1 周",
                "starts_on": "2026-09-01",
                "ends_on": "2026-09-07",
            },
        ).json()
        day = self.client.post(
            "/api/v1/plans",
            json={
                "parent_id": week["id"],
                "level": "day",
                "title": "9 月 1 日计划",
                "starts_on": "2026-09-01",
                "ends_on": "2026-09-01",
            },
        ).json()

        linked = self.client.post(
            "/api/v1/tasks",
            json={"title": "极限基础题", "subject": "math", "plan_id": day["id"]},
        )
        self.assertEqual(linked.status_code, 201)
        self.assertEqual(linked.json()["plan_id"], day["id"])

        wrong_level = self.client.post(
            "/api/v1/tasks",
            json={"title": "错误关联", "subject": "math", "plan_id": stage["id"]},
        )
        self.assertEqual(wrong_level.status_code, 422)

        self.current_user = AuthUser(
            id=UUID("22222222-2222-2222-2222-222222222222"),
            email="two@example.com",
            access_token="user-two-token",
        )
        other_user = self.client.post(
            "/api/v1/tasks",
            json={"title": "越权关联", "subject": "math", "plan_id": day["id"]},
        )
        self.assertEqual(other_user.status_code, 422)

    def test_plan_progress_aggregates_descendant_tasks_and_actual_minutes(self):
        stage = self.client.post(
            "/api/v1/plans",
            json={
                "level": "stage",
                "title": "基础阶段",
                "starts_on": "2026-09-01",
                "ends_on": "2026-09-30",
            },
        ).json()
        week = self.client.post(
            "/api/v1/plans",
            json={
                "parent_id": stage["id"],
                "level": "week",
                "title": "基础阶段第 1 周",
                "starts_on": "2026-09-01",
                "ends_on": "2026-09-07",
            },
        ).json()
        day = self.client.post(
            "/api/v1/plans",
            json={
                "parent_id": week["id"],
                "level": "day",
                "title": "9 月 1 日计划",
                "starts_on": "2026-09-01",
                "ends_on": "2026-09-01",
            },
        ).json()
        first_task = self.client.post(
            "/api/v1/tasks",
            json={"title": "极限基础题", "subject": "math", "plan_id": day["id"]},
        ).json()
        self.client.post(
            "/api/v1/tasks",
            json={"title": "英语词汇", "subject": "english", "plan_id": day["id"]},
        )
        self.client.patch(f"/api/v1/tasks/{first_task['id']}", json={"completed": True})
        self.client.post(
            "/api/v1/sessions",
            json={
                "subject": "math",
                "started_at": "2026-09-01T01:00:00Z",
                "ended_at": "2026-09-01T02:30:00Z",
                "paused_seconds": 600,
                "source": "timer",
            },
        )

        progress = self.client.get(f"/api/v1/plans/{stage['id']}/progress")
        self.assertEqual(progress.status_code, 200)
        self.assertEqual(
            progress.json(),
            {
                "plan_id": stage["id"],
                "task_count": 2,
                "completed_tasks": 1,
                "completion_rate": 50,
                "actual_minutes": 80,
            },
        )

        self.current_user = AuthUser(
            id=UUID("22222222-2222-2222-2222-222222222222"),
            email="two@example.com",
            access_token="user-two-token",
        )
        self.assertEqual(
            self.client.get(f"/api/v1/plans/{stage['id']}/progress").status_code,
            404,
        )

    def test_mistake_card_review_loop_updates_mastery_and_due_list(self):
        created = self.client.post(
            "/api/v1/mistakes",
            json={
                "subject": "cs408",
                "title": "二叉树非递归遍历",
                "question": "写出中序遍历的栈实现",
                "answer": "先沿左链入栈，再访问并转向右子树",
                "error_reason": "忘记转向右子树",
            },
        )
        self.assertEqual(created.status_code, 201)
        card = created.json()
        self.assertEqual(card["mastery"], 1)
        self.assertEqual(card["review_count"], 0)
        self.assertEqual(len(self.client.get("/api/v1/mistakes?due_only=true").json()), 1)

        contribution = self.client.get(
            "/api/v1/analytics/contributions?from=2026-08-10&to=2026-08-10&scope=all"
        ).json()[0]
        self.assertEqual(contribution["mistake_count"], 1)

        reviewed = self.client.post(
            f"/api/v1/mistakes/{card['id']}/reviews",
            json={"result": "good"},
        )
        self.assertEqual(reviewed.status_code, 200)
        self.assertEqual(reviewed.json()["mastery"], 2)
        self.assertEqual(reviewed.json()["review_count"], 1)
        self.assertEqual(self.client.get("/api/v1/mistakes?due_only=true").json(), [])

        self.current_user = AuthUser(
            id=UUID("22222222-2222-2222-2222-222222222222"),
            email="two@example.com",
            access_token="user-two-token",
        )
        self.assertEqual(
            self.client.post(
                f"/api/v1/mistakes/{card['id']}/reviews",
                json={"result": "again"},
            ).status_code,
            404,
        )

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

    def test_school_options_support_filters_updates_and_deletion(self):
        base = {
            "college": "计算机科学与技术学院",
            "major_code": "083500",
            "major_name": "软件工程",
            "degree_type": "academic",
            "exam_subjects": ["101 政治", "201 英语一", "301 数学一", "408 计算机学科基础"],
            "source_url": "https://example.edu.cn/admissions/2028",
        }
        stretch = self.client.post(
            "/api/v1/schools",
            json={
                **base,
                "tier": "stretch",
                "university": "中国科学技术大学",
                "exam_year": 2028,
                "location": "合肥",
            },
        )
        match = self.client.post(
            "/api/v1/schools",
            json={
                **base,
                "tier": "match",
                "university": "苏州大学",
                "college": "计算机科学与技术学院（苏州大学）",
                "exam_year": 2028,
                "location": "苏州",
            },
        )
        self.assertEqual(stretch.status_code, 201)
        self.assertEqual(match.status_code, 201)

        filtered = self.client.get("/api/v1/schools?tier=stretch&exam_year=2028")
        self.assertEqual(filtered.status_code, 200)
        self.assertEqual([item["university"] for item in filtered.json()], ["中国科学技术大学"])

        edited = self.client.patch(
            f"/api/v1/schools/{match.json()['id']}",
            json={"tier": "safety", "notes": "根据 2028 招生目录继续核对"},
        )
        self.assertEqual(edited.status_code, 200)
        self.assertEqual(edited.json()["tier"], "safety")
        self.assertEqual(edited.json()["notes"], "根据 2028 招生目录继续核对")

        deleted = self.client.delete(f"/api/v1/schools/{stretch.json()['id']}")
        self.assertEqual(deleted.status_code, 204)
        self.assertEqual(len(self.client.get("/api/v1/schools").json()), 1)

    def test_school_options_are_isolated_and_reject_duplicate_records(self):
        payload = {
            "tier": "match",
            "university": "南京理工大学",
            "college": "计算机科学与工程学院",
            "major_code": "085405",
            "major_name": "软件工程",
            "degree_type": "professional",
            "exam_year": 2028,
            "exam_subjects": ["101 政治", "204 英语二", "302 数学二", "408 计算机学科基础"],
            "source_url": "https://example.edu.cn/admissions/2028",
        }
        created = self.client.post("/api/v1/schools", json=payload)
        self.assertEqual(created.status_code, 201)
        self.assertEqual(self.client.post("/api/v1/schools", json=payload).status_code, 409)

        self.current_user = AuthUser(
            id=UUID("22222222-2222-2222-2222-222222222222"),
            email="two@example.com",
            access_token="user-two-token",
        )
        self.assertEqual(self.client.get("/api/v1/schools").json(), [])
        self.assertEqual(
            self.client.patch(
                f"/api/v1/schools/{created.json()['id']}", json={"tier": "stretch"}
            ).status_code,
            404,
        )
        self.assertEqual(
            self.client.delete(f"/api/v1/schools/{created.json()['id']}").status_code,
            404,
        )

    def test_school_option_owner_is_derived_from_login(self):
        response = self.client.post(
            "/api/v1/schools",
            json={
                "tier": "match",
                "university": "苏州大学",
                "college": "计算机科学与技术学院",
                "major_code": "083500",
                "major_name": "软件工程",
                "degree_type": "academic",
                "exam_year": 2028,
                "source_url": "https://example.edu.cn/admissions/2028",
                "user_id": "22222222-2222-2222-2222-222222222222",
            },
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.client.get("/api/v1/schools").json(), [])

    def test_career_items_support_filters_updates_and_deletion(self):
        milestone = self.client.post(
            "/api/v1/career-items",
            json={
                "item_type": "milestone",
                "title": "完成 Agent 工作台 v0.5",
                "status": "in_progress",
                "occurred_on": "2026-09-30",
                "notes": "形成可展示的 AI 应用项目",
            },
        )
        application = self.client.post(
            "/api/v1/career-items",
            json={
                "item_type": "application",
                "title": "投递 AI 应用开发实习",
                "company": "示例科技",
                "status": "planned",
                "occurred_on": "2027-01-10",
            },
        )
        self.assertEqual(milestone.status_code, 201)
        self.assertEqual(application.status_code, 201)

        filtered = self.client.get("/api/v1/career-items?item_type=application&status=planned")
        self.assertEqual(filtered.status_code, 200)
        self.assertEqual([item["title"] for item in filtered.json()], ["投递 AI 应用开发实习"])

        updated = self.client.patch(
            f"/api/v1/career-items/{application.json()['id']}",
            json={"status": "submitted", "notes": "已投递，等待反馈"},
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["status"], "submitted")

        deleted = self.client.delete(f"/api/v1/career-items/{milestone.json()['id']}")
        self.assertEqual(deleted.status_code, 204)
        self.assertEqual(len(self.client.get("/api/v1/career-items").json()), 1)

    def test_career_items_are_isolated_and_owner_cannot_be_forged(self):
        created = self.client.post(
            "/api/v1/career-items",
            json={
                "item_type": "resume",
                "title": "AI 应用开发简历 v1",
                "status": "planned",
            },
        )
        self.assertEqual(created.status_code, 201)

        forged = self.client.post(
            "/api/v1/career-items",
            json={
                "item_type": "interview",
                "title": "伪造归属的面试记录",
                "user_id": "22222222-2222-2222-2222-222222222222",
            },
        )
        self.assertEqual(forged.status_code, 422)

        self.current_user = AuthUser(
            id=UUID("22222222-2222-2222-2222-222222222222"),
            email="two@example.com",
            access_token="user-two-token",
        )
        self.assertEqual(self.client.get("/api/v1/career-items").json(), [])
        self.assertEqual(
            self.client.patch(
                f"/api/v1/career-items/{created.json()['id']}", json={"status": "completed"}
            ).status_code,
            404,
        )
        self.assertEqual(
            self.client.delete(f"/api/v1/career-items/{created.json()['id']}").status_code,
            404,
        )

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
