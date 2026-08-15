import json
from datetime import UTC, date, datetime, timedelta
from unittest import IsolatedAsyncioTestCase
from uuid import UUID

import httpx

from app.auth import AuthUser
from app.config import Settings
from app.schemas import (
    ActionProposal,
    CareerItemCreate,
    PlanCreate,
    PlanUpdate,
    SchoolOptionCreate,
    SearchSource,
    StudySessionCreate,
    TaskCreate,
)
from app.services.embeddings import EmbeddingDescriptor
from app.services.ingestion import TextChunk
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

    async def test_supabase_school_reads_and_writes_use_current_user(self):
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
                        "tier": "match",
                        "university": "苏州大学",
                        "college": "计算机科学与技术学院",
                        "major_code": "083500",
                        "major_name": "软件工程",
                        "degree_type": "academic",
                        "exam_year": 2028,
                        "exam_subjects": ["101 政治", "201 英语一", "301 数学一", "408"],
                        "source_url": "https://example.edu.cn/admissions/2028",
                    }
                ],
            )

        settings = Settings(
            supabase_url="https://project.supabase.co",
            supabase_anon_key="public-anon-key",
            demo_mode=False,
        )
        repository = SupabaseRepository(settings, httpx.MockTransport(handler))
        await repository.list_school_options(self.user, "match", 2028)
        await repository.create_school_option(
            self.user,
            SchoolOptionCreate(
                tier="match",
                university="苏州大学",
                college="计算机科学与技术学院",
                major_code="083500",
                major_name="软件工程",
                degree_type="academic",
                exam_year=2028,
                exam_subjects=["101 政治", "201 英语一", "301 数学一", "408"],
                source_url="https://example.edu.cn/admissions/2028",
            ),
        )

        self.assertEqual(requests[0].url.params["user_id"], f"eq.{self.user.id}")
        self.assertEqual(requests[0].url.params["tier"], "eq.match")
        self.assertEqual(requests[0].url.params["exam_year"], "eq.2028")
        payload = json.loads(requests[1].content)
        self.assertEqual(payload["user_id"], str(self.user.id))
        self.assertNotIn("access_token", payload)

    async def test_supabase_career_reads_and_writes_use_current_user(self):
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
                        "item_type": "application",
                        "title": "投递 AI 应用开发实习",
                        "company": "示例科技",
                        "status": "planned",
                        "occurred_on": "2027-01-10",
                        "notes": "",
                    }
                ],
            )

        settings = Settings(
            supabase_url="https://project.supabase.co",
            supabase_anon_key="public-anon-key",
            demo_mode=False,
        )
        repository = SupabaseRepository(settings, httpx.MockTransport(handler))
        await repository.list_career_items(self.user, "application", "planned")
        await repository.create_career_item(
            self.user,
            CareerItemCreate(
                item_type="application",
                title="投递 AI 应用开发实习",
                company="示例科技",
                status="planned",
                occurred_on=date(2027, 1, 10),
            ),
        )

        self.assertEqual(requests[0].url.params["user_id"], f"eq.{self.user.id}")
        self.assertEqual(requests[0].url.params["item_type"], "eq.application")
        self.assertEqual(requests[0].url.params["status"], "eq.planned")
        payload = json.loads(requests[1].content)
        self.assertEqual(payload["user_id"], str(self.user.id))
        self.assertNotIn("access_token", payload)
        self.assertNotIn("access_token", payload)

    async def test_supabase_document_upload_uses_private_user_path_and_persists_chunks(self):
        requests: list[httpx.Request] = []
        document_id = UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            if request.method == "GET":
                return httpx.Response(200, json=[])
            if "/storage/v1/object/" in str(request.url):
                return httpx.Response(200, json={"Key": "stored"})
            if request.url.path.endswith("/rest/v1/documents"):
                payload = json.loads(request.content)
                return httpx.Response(201, json=[payload])
            return httpx.Response(201, json=[])

        settings = Settings(
            supabase_url="https://project.supabase.co",
            supabase_anon_key="public-anon-key",
            demo_mode=False,
        )
        repository = SupabaseRepository(settings, httpx.MockTransport(handler))
        content = b"# Limits\nDefinition and examples"
        chunks = [
            TextChunk(
                index=0,
                heading="Limits",
                locator="Limits · 片段 1",
                content="Definition and examples",
                page_number=None,
                flagged_untrusted_instruction=False,
                embedding=[0.1, 0.2, 0.3],
            )
        ]
        document, duplicate = await repository.persist_document(
            self.user,
            document_id=document_id,
            filename="limits.md",
            content_type="text/markdown",
            content=content,
            digest="abc123",
            ingestion_status="ready",
            chunks=chunks,
            embedding_metadata=EmbeddingDescriptor(
                provider="qwen",
                model="text-embedding-v4",
                dimensions=1536,
                version="1",
            ),
        )

        self.assertFalse(duplicate)
        self.assertEqual(document["storage_path"], f"{self.user.id}/{document_id}/limits.md")
        storage_request = requests[1]
        self.assertIn(
            f"/storage/v1/object/study-materials/{self.user.id}/{document_id}/limits.md",
            str(storage_request.url),
        )
        self.assertEqual(storage_request.headers["authorization"], "Bearer signed-user-jwt")
        document_payload = json.loads(requests[2].content)
        self.assertEqual(document_payload["user_id"], str(self.user.id))
        self.assertEqual(document_payload["embedding_provider"], "qwen")
        self.assertEqual(document_payload["embedding_model"], "text-embedding-v4")
        self.assertEqual(document_payload["embedding_dimensions"], 1536)
        self.assertEqual(document_payload["embedding_version"], "1")
        self.assertNotIn("access_token", document_payload)
        chunk_payload = json.loads(requests[3].content)[0]
        self.assertEqual(chunk_payload["document_id"], str(document_id))
        self.assertEqual(chunk_payload["user_id"], str(self.user.id))
        self.assertIsNone(chunk_payload["page_number"])
        self.assertEqual(chunk_payload["embedding"], [0.1, 0.2, 0.3])

    async def test_supabase_document_upload_reuses_existing_hash(self):
        requests: list[httpx.Request] = []
        document_id = UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            if request.url.path.endswith("/rest/v1/documents"):
                return httpx.Response(
                    200,
                    json=[
                        {
                            "id": str(document_id),
                            "title": "limits",
                            "original_filename": "limits.md",
                            "content_type": "text/markdown",
                            "byte_size": 20,
                            "sha256": "abc123",
                            "storage_path": f"{self.user.id}/{document_id}/limits.md",
                            "ingestion_status": "ready",
                        }
                    ],
                )
            return httpx.Response(
                200,
                json=[{"id": 1, "flagged_untrusted_instruction": False}],
            )

        settings = Settings(
            supabase_url="https://project.supabase.co",
            supabase_anon_key="public-anon-key",
            demo_mode=False,
        )
        repository = SupabaseRepository(settings, httpx.MockTransport(handler))
        document, duplicate = await repository.persist_document(
            self.user,
            document_id=UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
            filename="limits.md",
            content_type="text/markdown",
            content=b"duplicate",
            digest="abc123",
            ingestion_status="ready",
            chunks=[],
        )

        self.assertTrue(duplicate)
        self.assertEqual(document["id"], str(document_id))
        self.assertEqual(document["chunk_count"], 1)
        self.assertEqual(len(requests), 2)
        self.assertFalse(any("/storage/v1/" in str(request.url) for request in requests))

    async def test_supabase_ocr_queue_uses_owned_rpc_and_read_filter(self):
        requests: list[httpx.Request] = []
        document_id = UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
        job = {
            "id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            "document_id": str(document_id),
            "status": "queued",
            "attempts": 0,
            "max_attempts": 3,
            "available_at": "2026-08-14T10:00:00Z",
            "last_error": None,
            "created_at": "2026-08-14T10:00:00Z",
            "updated_at": "2026-08-14T10:00:00Z",
        }

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(200, json=[job])

        repository = SupabaseRepository(
            Settings(
                supabase_url="https://project.supabase.co",
                supabase_anon_key="public-anon-key",
                demo_mode=False,
            ),
            httpx.MockTransport(handler),
        )

        queued = await repository.enqueue_document_ocr(self.user, document_id)
        loaded = await repository.get_document_ocr_job(self.user, document_id)

        self.assertEqual(queued.status, "queued")
        self.assertEqual(loaded.id, queued.id)
        self.assertTrue(requests[0].url.path.endswith("/rpc/enqueue_document_ocr"))
        self.assertEqual(json.loads(requests[0].content)["requested_document_id"], str(document_id))
        self.assertTrue(requests[1].url.path.endswith("/rest/v1/ocr_jobs"))
        self.assertIn(f"user_id=eq.{self.user.id}", str(requests[1].url))

    async def test_supabase_private_search_calls_user_scoped_rpc(self):
        requests: list[httpx.Request] = []
        document_id = UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(
                200,
                json=[
                    {
                        "chunk_id": 9,
                        "document_id": str(document_id),
                        "title": "数据结构笔记",
                        "heading": "线性表",
                        "page_number": None,
                        "locator": "线性表 · 片段 1",
                        "content": "顺序表支持按下标随机访问。",
                        "score": 1.0,
                    }
                ],
            )

        settings = Settings(
            supabase_url="https://project.supabase.co",
            supabase_anon_key="public-anon-key",
            demo_mode=False,
        )
        repository = SupabaseRepository(settings, httpx.MockTransport(handler))
        sources = await repository.search_private_knowledge(
            self.user,
            "顺序表",
            limit=5,
            document_ids=[document_id],
        )

        self.assertEqual(len(sources), 1)
        self.assertEqual(sources[0].locator, "线性表 · 片段 1")
        self.assertTrue(requests[0].url.path.endswith("/rpc/search_private_document_chunks"))
        self.assertEqual(requests[0].headers["authorization"], "Bearer signed-user-jwt")
        payload = json.loads(requests[0].content)
        self.assertEqual(payload["query_text"], "顺序表")
        self.assertEqual(payload["match_count"], 5)
        self.assertEqual(payload["filter_document_ids"], [str(document_id)])
        self.assertNotIn("user_id", payload)

    async def test_supabase_private_search_uses_hybrid_rpc_with_query_embedding(self):
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(200, json=[])

        repository = SupabaseRepository(
            Settings(
                supabase_url="https://project.supabase.co",
                supabase_anon_key="public-anon-key",
                demo_mode=False,
            ),
            httpx.MockTransport(handler),
        )

        await repository.search_private_knowledge(
            self.user,
            "极限定义",
            limit=4,
            query_embedding=[0.1, 0.2, 0.3],
        )

        self.assertTrue(
            requests[0].url.path.endswith("/rpc/hybrid_search_private_document_chunks")
        )
        payload = json.loads(requests[0].content)
        self.assertEqual(payload["query_embedding"], [0.1, 0.2, 0.3])

    async def test_supabase_records_agent_model_usage_without_prompt_or_secret(self):
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(204)

        repository = SupabaseRepository(
            Settings(
                supabase_url="https://project.supabase.co",
                supabase_anon_key="public-anon-key",
                demo_mode=False,
            ),
            httpx.MockTransport(handler),
        )
        thread_id = UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")

        await repository.record_agent_model_usage(
            self.user,
            thread_id=thread_id,
            model_profile="flash",
            provider="qwen",
            model="qwen3.5-flash-2026-02-23",
            fallback_used=True,
            status="success",
            latency_ms=850,
            input_tokens=120,
            output_tokens=40,
        )

        self.assertTrue(requests[0].url.path.endswith("/rpc/record_agent_model_usage"))
        payload = json.loads(requests[0].content)
        self.assertEqual(payload["requested_thread_id"], str(thread_id))
        self.assertEqual(payload["requested_input_tokens"], 120)
        self.assertTrue(payload["requested_fallback_used"])
        serialized = requests[0].content.decode().lower()
        self.assertNotIn("prompt", serialized)
        self.assertNotIn("api_key", serialized)
        self.assertNotIn("user_id", payload)

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

    async def test_supabase_agent_proposal_uses_authenticated_rpc_without_owner_input(self):
        requests: list[httpx.Request] = []
        thread_id = UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
        proposal_id = UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
        proposal = ActionProposal(
            id=proposal_id,
            agent="coach",
            action="create_review_task",
            payload={"title": "数据结构错题回顾", "subject": "cs408", "planned_minutes": 45},
            summary="创建一个 45 分钟的数据结构错题复习任务",
            idempotency_key="agent-idempotency-key",
        )

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(
                200,
                json=[
                    {
                        "thread_id": str(thread_id),
                        "proposal": proposal.model_dump(mode="json"),
                    }
                ],
            )

        repository = SupabaseRepository(
            Settings(
                supabase_url="https://project.supabase.co",
                supabase_anon_key="public-anon-key",
                demo_mode=False,
            ),
            httpx.MockTransport(handler),
        )
        saved_thread_id, saved_proposal = await repository.create_agent_proposal(
            self.user,
            thread_id=None,
            mode="coach",
            proposal=proposal,
        )

        self.assertEqual(saved_thread_id, thread_id)
        self.assertEqual(saved_proposal.id, proposal_id)
        self.assertTrue(requests[0].url.path.endswith("/rpc/create_agent_proposal"))
        self.assertEqual(requests[0].headers["authorization"], "Bearer signed-user-jwt")
        payload = json.loads(requests[0].content)
        self.assertIsNone(payload["requested_thread_id"])
        self.assertEqual(payload["requested_mode"], "coach")
        self.assertNotIn("user_id", payload)

    async def test_supabase_agent_decision_uses_atomic_rpc(self):
        requests: list[httpx.Request] = []
        proposal_id = UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
        response_proposal = ActionProposal(
            id=proposal_id,
            agent="coach",
            action="create_review_task",
            payload={"title": "数据结构错题回顾", "subject": "cs408", "planned_minutes": 45},
            summary="创建一个 45 分钟的数据结构错题复习任务",
            idempotency_key="agent-idempotency-key",
            status="applied",
        )

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(200, json=response_proposal.model_dump(mode="json"))

        repository = SupabaseRepository(
            Settings(
                supabase_url="https://project.supabase.co",
                supabase_anon_key="public-anon-key",
                demo_mode=False,
            ),
            httpx.MockTransport(handler),
        )
        edited_payload = {
            "title": "数据结构二刷",
            "subject": "cs408",
            "planned_minutes": 60,
        }
        saved = await repository.decide_agent_proposal(
            self.user, proposal_id, "edit", edited_payload
        )

        self.assertIsNotNone(saved)
        self.assertEqual(saved.status, "applied")
        self.assertTrue(requests[0].url.path.endswith("/rpc/decide_agent_proposal"))
        payload = json.loads(requests[0].content)
        self.assertEqual(payload["requested_proposal_id"], str(proposal_id))
        self.assertEqual(payload["requested_decision"], "edit")
        self.assertEqual(payload["edited_payload"], edited_payload)
        self.assertNotIn("user_id", payload)

    async def test_supabase_read_only_agent_run_persists_thread_without_owner_input(self):
        requests: list[httpx.Request] = []
        thread_id = UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(200, json=str(thread_id))

        repository = SupabaseRepository(
            Settings(
                supabase_url="https://project.supabase.co",
                supabase_anon_key="public-anon-key",
                demo_mode=False,
            ),
            httpx.MockTransport(handler),
        )
        saved = await repository.ensure_agent_thread(
            self.user,
            thread_id=None,
            mode="tutor",
            title="解释顺序表",
        )
        await repository.set_agent_thread_model_profile(
            self.user,
            thread_id=saved,
            model_profile="pro",
        )

        self.assertEqual(saved, thread_id)
        self.assertTrue(requests[0].url.path.endswith("/rpc/ensure_agent_thread"))
        payload = json.loads(requests[0].content)
        self.assertEqual(payload["requested_mode"], "tutor")
        self.assertEqual(payload["requested_title"], "解释顺序表")
        self.assertNotIn("user_id", payload)
        profile_payload = json.loads(requests[1].content)
        self.assertTrue(
            requests[1].url.path.endswith("/rpc/set_agent_thread_model_profile")
        )
        self.assertEqual(profile_payload["requested_model_profile"], "pro")

    async def test_supabase_agent_exchange_uses_controlled_rpc_and_restores_owned_thread(self):
        requests: list[httpx.Request] = []
        thread_id = UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
        message_id = UUID("dddddddd-dddd-dddd-dddd-dddddddddddd")

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            if request.url.path.endswith("/rpc/append_agent_exchange"):
                return httpx.Response(204)
            if request.url.path.endswith("/agent_threads"):
                return httpx.Response(
                    200,
                    json=[
                        {
                            "id": str(thread_id),
                            "mode": "tutor",
                            "title": "解释顺序表",
                            "model_profile": "pro",
                            "last_provider": "deepseek",
                            "last_model": "deepseek-v4-pro",
                        }
                    ],
                )
            return httpx.Response(
                200,
                json=[
                    {
                        "id": str(message_id),
                        "role": "user",
                        "content": "解释顺序表",
                        "sources": [],
                        "metadata": {},
                        "created_at": "2026-08-13T09:00:00Z",
                    }
                ],
            )

        repository = SupabaseRepository(
            Settings(
                supabase_url="https://project.supabase.co",
                supabase_anon_key="public-anon-key",
                demo_mode=False,
            ),
            httpx.MockTransport(handler),
        )
        await repository.append_agent_exchange(
            self.user,
            thread_id=thread_id,
            user_message="解释顺序表",
            agent_message="顺序表使用连续存储空间。",
            sources=[],
            metadata={"route": "tutor"},
        )
        history = await repository.latest_agent_thread(self.user)

        self.assertEqual(history.id, thread_id)
        self.assertEqual(history.model_profile, "pro")
        self.assertEqual(history.last_model, "deepseek-v4-pro")
        self.assertEqual(history.messages[0].content, "解释顺序表")
        rpc_payload = json.loads(requests[0].content)
        self.assertEqual(rpc_payload["requested_thread_id"], str(thread_id))
        self.assertNotIn("user_id", rpc_payload)
        self.assertEqual(requests[0].headers["authorization"], "Bearer signed-user-jwt")
        self.assertIn(f"user_id=eq.{self.user.id}", str(requests[1].url))
        self.assertIn(f"thread_id=eq.{thread_id}", str(requests[2].url))

    async def test_supabase_pending_proposals_are_read_with_user_jwt(self):
        requests: list[httpx.Request] = []
        proposal = ActionProposal(
            id=UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
            agent="coach",
            action="create_review_task",
            payload={"title": "408 复习", "subject": "cs408", "planned_minutes": 45},
            summary="创建复习任务",
            idempotency_key="pending-proposal-key",
        )

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(200, json=[proposal.model_dump(mode="json")])

        repository = SupabaseRepository(
            Settings(
                supabase_url="https://project.supabase.co",
                supabase_anon_key="public-anon-key",
                demo_mode=False,
            ),
            httpx.MockTransport(handler),
        )
        restored = await repository.list_pending_agent_proposals(self.user)

        self.assertEqual(restored[0].id, proposal.id)
        self.assertEqual(requests[0].headers["authorization"], "Bearer signed-user-jwt")
        self.assertIn("status=in.%28pending%2Cedited%29", str(requests[0].url))
        self.assertIn(f"user_id=eq.{self.user.id}", str(requests[0].url))

    async def test_supabase_web_search_history_uses_user_jwt_and_owner_filter(self):
        requests: list[httpx.Request] = []
        record_id = UUID("cccccccc-cccc-cccc-cccc-cccccccccccc")
        source = SearchSource(
            title="官方招生网",
            url="https://example.edu/admission",
            snippet="招生简章",
            accessed_at=datetime(2026, 8, 13, 9, tzinfo=UTC),
        )

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            row = {
                "id": str(record_id),
                "query": "2028 招生简章",
                "provider": "tavily",
                "results": [source.model_dump(mode="json")],
                "searched_at": "2026-08-13T09:00:00Z",
            }
            return httpx.Response(201 if request.method == "POST" else 200, json=[row])

        repository = SupabaseRepository(
            Settings(
                supabase_url="https://project.supabase.co",
                supabase_anon_key="public-anon-key",
                demo_mode=False,
            ),
            httpx.MockTransport(handler),
        )
        saved = await repository.record_web_search(
            self.user,
            query="2028 招生简章",
            provider="tavily",
            results=[source],
        )
        history = await repository.list_web_search_records(self.user, limit=5)

        self.assertEqual(saved.id, record_id)
        self.assertEqual(history[0].results[0].title, "官方招生网")
        insert_payload = json.loads(requests[0].content)
        self.assertEqual(insert_payload["user_id"], str(self.user.id))
        self.assertEqual(requests[0].headers["authorization"], "Bearer signed-user-jwt")
        self.assertIn(f"user_id=eq.{self.user.id}", str(requests[1].url))
        self.assertIn("limit=5", str(requests[1].url))
