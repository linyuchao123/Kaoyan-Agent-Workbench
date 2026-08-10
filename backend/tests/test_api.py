from unittest import TestCase

from fastapi.testclient import TestClient

from app import main


class ApiFlowTests(TestCase):
    def setUp(self):
        main.store.tasks.clear()
        main.store.sessions.clear()
        main.action_proposals.clear()
        main.applied_proposals.clear()
        main.demo_documents.clear()
        main.document_ids_by_hash.clear()
        self.client = TestClient(main.app)

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
        self.assertEqual(len(main.store.tasks), 0)

        proposal_id = body["proposal"]["id"]
        first = self.client.post(f"/api/v1/proposals/{proposal_id}/approve")
        second = self.client.post(f"/api/v1/proposals/{proposal_id}/approve")
        self.assertEqual(first.json()["status"], "applied")
        self.assertEqual(second.json()["status"], "applied")
        self.assertEqual(len(main.store.tasks), 1)

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
