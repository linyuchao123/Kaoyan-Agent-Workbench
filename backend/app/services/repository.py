from collections.abc import Callable, Mapping
from datetime import UTC, date, datetime
from typing import Any, Protocol, cast
from urllib.parse import quote
from uuid import UUID, uuid4

import httpx

from app.auth import AuthUser
from app.config import Settings
from app.domain.contributions import Scope, intensity_level
from app.schemas import (
    ActionProposal,
    AgentCitation,
    AgentMessage,
    AgentThreadHistory,
    AgentThreadSummary,
    CareerItemCreate,
    CareerItemUpdate,
    ContributionDay,
    ImportProposal,
    MistakeCardCreate,
    MistakeReviewCreate,
    PlanCreate,
    PlanProgress,
    PlanUpdate,
    PrivateKnowledgeSource,
    SchoolOptionCreate,
    SchoolOptionUpdate,
    SearchSource,
    StudySessionCreate,
    TaskCreate,
    TaskUpdate,
    WebSearchRecord,
)
from app.services.ingestion import TextChunk
from app.services.store import DemoStore


class RepositoryError(RuntimeError):
    pass


class RepositoryConflictError(RepositoryError):
    pass


class RepositoryValidationError(RepositoryError):
    pass


class StudyRepository(Protocol):
    mode: str

    async def list_plans(self, user: AuthUser, level: str | None = None) -> list[dict]: ...

    async def create_plan(self, user: AuthUser, payload: PlanCreate) -> dict: ...

    async def update_plan(
        self, user: AuthUser, plan_id: UUID, payload: PlanUpdate
    ) -> dict | None: ...

    async def delete_plan(self, user: AuthUser, plan_id: UUID) -> bool: ...

    async def plan_progress(self, user: AuthUser, plan_id: UUID) -> PlanProgress | None: ...

    async def list_tasks(self, user: AuthUser) -> list[dict]: ...

    async def create_task(self, user: AuthUser, payload: TaskCreate) -> dict: ...

    async def update_task(
        self, user: AuthUser, task_id: UUID, payload: TaskUpdate
    ) -> dict | None: ...

    async def list_sessions(self, user: AuthUser) -> list[dict]: ...

    async def create_session(self, user: AuthUser, payload: StudySessionCreate) -> dict: ...

    async def contributions(
        self, user: AuthUser, from_date: date, to_date: date, scope: str
    ) -> list[ContributionDay]: ...

    async def list_mistakes(self, user: AuthUser, due_only: bool = False) -> list[dict]: ...

    async def create_mistake(self, user: AuthUser, payload: MistakeCardCreate) -> dict: ...

    async def review_mistake(
        self, user: AuthUser, card_id: UUID, payload: MistakeReviewCreate
    ) -> dict | None: ...

    async def list_school_options(
        self, user: AuthUser, tier: str | None = None, exam_year: int | None = None
    ) -> list[dict]: ...

    async def create_school_option(self, user: AuthUser, payload: SchoolOptionCreate) -> dict: ...

    async def update_school_option(
        self, user: AuthUser, option_id: UUID, payload: SchoolOptionUpdate
    ) -> dict | None: ...

    async def delete_school_option(self, user: AuthUser, option_id: UUID) -> bool: ...

    async def list_career_items(
        self, user: AuthUser, item_type: str | None = None, status: str | None = None
    ) -> list[dict]: ...

    async def create_career_item(self, user: AuthUser, payload: CareerItemCreate) -> dict: ...

    async def update_career_item(
        self, user: AuthUser, item_id: UUID, payload: CareerItemUpdate
    ) -> dict | None: ...

    async def delete_career_item(self, user: AuthUser, item_id: UUID) -> bool: ...

    async def persist_document(
        self,
        user: AuthUser,
        *,
        document_id: UUID,
        filename: str,
        content_type: str,
        content: bytes,
        digest: str,
        ingestion_status: str,
        chunks: list[TextChunk],
        source_url: str | None = None,
        title: str | None = None,
    ) -> tuple[dict, bool]: ...

    async def list_documents(self, user: AuthUser) -> list[dict]: ...

    async def get_document(self, user: AuthUser, document_id: UUID) -> dict | None: ...

    async def create_import_proposal(
        self, user: AuthUser, proposal: ImportProposal
    ) -> ImportProposal: ...

    async def get_import_proposal(
        self, user: AuthUser, proposal_id: UUID
    ) -> ImportProposal | None: ...

    async def approve_import_proposal(
        self, user: AuthUser, proposal_id: UUID
    ) -> ImportProposal | None: ...

    async def search_private_knowledge(
        self,
        user: AuthUser,
        query: str,
        limit: int = 8,
        document_ids: list[UUID] | None = None,
    ) -> list[PrivateKnowledgeSource]: ...

    async def record_web_search(
        self,
        user: AuthUser,
        *,
        query: str,
        provider: str,
        results: list[SearchSource],
    ) -> WebSearchRecord: ...

    async def list_web_search_records(
        self, user: AuthUser, limit: int = 20
    ) -> list[WebSearchRecord]: ...

    async def create_agent_proposal(
        self,
        user: AuthUser,
        *,
        thread_id: UUID | None,
        mode: str,
        proposal: ActionProposal,
    ) -> tuple[UUID, ActionProposal]: ...

    async def ensure_agent_thread(
        self,
        user: AuthUser,
        *,
        thread_id: UUID | None,
        mode: str,
        title: str,
    ) -> UUID: ...

    async def append_agent_exchange(
        self,
        user: AuthUser,
        *,
        thread_id: UUID,
        user_message: str,
        agent_message: str,
        sources: list[AgentCitation],
        metadata: dict[str, Any],
    ) -> None: ...

    async def latest_agent_thread(self, user: AuthUser) -> AgentThreadHistory | None: ...

    async def list_agent_threads(
        self, user: AuthUser, limit: int = 20
    ) -> list[AgentThreadSummary]: ...

    async def get_agent_thread(
        self, user: AuthUser, thread_id: UUID
    ) -> AgentThreadHistory | None: ...

    async def list_pending_agent_proposals(
        self, user: AuthUser, limit: int = 10
    ) -> list[ActionProposal]: ...

    async def decide_agent_proposal(
        self,
        user: AuthUser,
        proposal_id: UUID,
        decision: str,
        edited_payload: dict[str, Any] | None = None,
    ) -> ActionProposal | None: ...


class DemoRepository:
    """User-isolated in-memory repository for tests and offline API development."""

    mode = "demo"

    def __init__(
        self,
        timezone_name: str = "Asia/Shanghai",
        now_factory: Callable[[], datetime] | None = None,
    ) -> None:
        self.timezone_name = timezone_name
        self.now_factory = now_factory
        self.stores: dict[UUID, DemoStore] = {}
        self.documents: dict[tuple[UUID, UUID], dict] = {}
        self.document_ids_by_hash: dict[tuple[UUID, str], UUID] = {}
        self.document_chunks: dict[tuple[UUID, UUID], list[TextChunk]] = {}
        self.import_proposals: dict[tuple[UUID, UUID], ImportProposal] = {}
        self.web_search_records: dict[tuple[UUID, UUID], WebSearchRecord] = {}
        self.agent_threads: dict[tuple[UUID, UUID], dict[str, Any]] = {}
        self.agent_messages: dict[tuple[UUID, UUID], list[AgentMessage]] = {}
        self.action_proposals: dict[tuple[UUID, UUID], ActionProposal] = {}
        self.proposal_ids_by_key: dict[tuple[UUID, str], UUID] = {}
        self.audit_logs: list[dict[str, Any]] = []

    def clear(self) -> None:
        self.stores.clear()
        self.documents.clear()
        self.document_ids_by_hash.clear()
        self.document_chunks.clear()
        self.import_proposals.clear()
        self.web_search_records.clear()
        self.agent_threads.clear()
        self.agent_messages.clear()
        self.action_proposals.clear()
        self.proposal_ids_by_key.clear()
        self.audit_logs.clear()

    def _store(self, user: AuthUser) -> DemoStore:
        return self.stores.setdefault(user.id, DemoStore(self.timezone_name, self.now_factory))

    async def list_plans(self, user: AuthUser, level: str | None = None) -> list[dict]:
        return self._store(user).list_plans(level)

    async def create_plan(self, user: AuthUser, payload: PlanCreate) -> dict:
        try:
            return self._store(user).create_plan(payload)
        except ValueError as error:
            raise RepositoryValidationError(str(error)) from error

    async def update_plan(self, user: AuthUser, plan_id: UUID, payload: PlanUpdate) -> dict | None:
        try:
            return self._store(user).update_plan(plan_id, payload)
        except ValueError as error:
            raise RepositoryValidationError(str(error)) from error

    async def delete_plan(self, user: AuthUser, plan_id: UUID) -> bool:
        return self._store(user).delete_plan(plan_id)

    async def plan_progress(self, user: AuthUser, plan_id: UUID) -> PlanProgress | None:
        progress = self._store(user).plan_progress(plan_id)
        return PlanProgress.model_validate(progress) if progress else None

    async def list_tasks(self, user: AuthUser) -> list[dict]:
        return self._store(user).list_tasks()

    async def create_task(self, user: AuthUser, payload: TaskCreate) -> dict:
        try:
            return self._store(user).create_task(payload)
        except ValueError as error:
            raise RepositoryValidationError(str(error)) from error

    async def update_task(self, user: AuthUser, task_id: UUID, payload: TaskUpdate) -> dict | None:
        try:
            return self._store(user).update_task(task_id, payload)
        except ValueError as error:
            raise RepositoryValidationError(str(error)) from error

    async def list_sessions(self, user: AuthUser) -> list[dict]:
        return self._store(user).list_sessions()

    async def create_session(self, user: AuthUser, payload: StudySessionCreate) -> dict:
        return self._store(user).create_session(payload)

    async def contributions(
        self, user: AuthUser, from_date: date, to_date: date, scope: str
    ) -> list[ContributionDay]:
        return self._store(user).contributions(from_date, to_date, scope)

    async def list_mistakes(self, user: AuthUser, due_only: bool = False) -> list[dict]:
        return self._store(user).list_mistakes(due_only)

    async def create_mistake(self, user: AuthUser, payload: MistakeCardCreate) -> dict:
        return self._store(user).create_mistake(payload)

    async def review_mistake(
        self, user: AuthUser, card_id: UUID, payload: MistakeReviewCreate
    ) -> dict | None:
        return self._store(user).review_mistake(card_id, payload)

    async def list_school_options(
        self, user: AuthUser, tier: str | None = None, exam_year: int | None = None
    ) -> list[dict]:
        return self._store(user).list_school_options(tier, exam_year)

    async def create_school_option(self, user: AuthUser, payload: SchoolOptionCreate) -> dict:
        try:
            return self._store(user).create_school_option(payload)
        except ValueError as error:
            raise RepositoryConflictError(str(error)) from error

    async def update_school_option(
        self, user: AuthUser, option_id: UUID, payload: SchoolOptionUpdate
    ) -> dict | None:
        try:
            return self._store(user).update_school_option(option_id, payload)
        except ValueError as error:
            raise RepositoryConflictError(str(error)) from error

    async def delete_school_option(self, user: AuthUser, option_id: UUID) -> bool:
        return self._store(user).delete_school_option(option_id)

    async def list_career_items(
        self, user: AuthUser, item_type: str | None = None, status: str | None = None
    ) -> list[dict]:
        return self._store(user).list_career_items(item_type, status)

    async def create_career_item(self, user: AuthUser, payload: CareerItemCreate) -> dict:
        return self._store(user).create_career_item(payload)

    async def update_career_item(
        self, user: AuthUser, item_id: UUID, payload: CareerItemUpdate
    ) -> dict | None:
        return self._store(user).update_career_item(item_id, payload)

    async def delete_career_item(self, user: AuthUser, item_id: UUID) -> bool:
        return self._store(user).delete_career_item(item_id)

    async def persist_document(
        self,
        user: AuthUser,
        *,
        document_id: UUID,
        filename: str,
        content_type: str,
        content: bytes,
        digest: str,
        ingestion_status: str,
        chunks: list[TextChunk],
        source_url: str | None = None,
        title: str | None = None,
    ) -> tuple[dict, bool]:
        existing_id = self.document_ids_by_hash.get((user.id, digest))
        if existing_id:
            return self.documents[(user.id, existing_id)], True
        item = {
            "id": document_id,
            "source_type": "web" if source_url else "upload",
            "source_url": source_url,
            "title": title or filename.rsplit(".", 1)[0],
            "original_filename": filename,
            "content_type": content_type,
            "byte_size": len(content),
            "sha256": digest,
            "storage_path": None,
            "ingestion_status": ingestion_status,
            "chunk_count": len(chunks),
            "flagged_chunk_count": sum(chunk.flagged_untrusted_instruction for chunk in chunks),
        }
        self.documents[(user.id, document_id)] = item
        self.document_ids_by_hash[(user.id, digest)] = document_id
        self.document_chunks[(user.id, document_id)] = chunks
        return item, False

    async def list_documents(self, user: AuthUser) -> list[dict]:
        return [
            item
            for (owner_id, _), item in self.documents.items()
            if owner_id == user.id
        ]

    async def get_document(self, user: AuthUser, document_id: UUID) -> dict | None:
        return self.documents.get((user.id, document_id))

    async def create_import_proposal(
        self, user: AuthUser, proposal: ImportProposal
    ) -> ImportProposal:
        self.import_proposals[(user.id, proposal.id)] = proposal
        return proposal

    async def get_import_proposal(
        self, user: AuthUser, proposal_id: UUID
    ) -> ImportProposal | None:
        return self.import_proposals.get((user.id, proposal_id))

    async def approve_import_proposal(
        self, user: AuthUser, proposal_id: UUID
    ) -> ImportProposal | None:
        proposal = self.import_proposals.get((user.id, proposal_id))
        if not proposal:
            return None
        approved = proposal.model_copy(update={"status": "approved"})
        self.import_proposals[(user.id, proposal_id)] = approved
        return approved

    async def search_private_knowledge(
        self,
        user: AuthUser,
        query: str,
        limit: int = 8,
        document_ids: list[UUID] | None = None,
    ) -> list[PrivateKnowledgeSource]:
        normalized = query.casefold().strip()
        allowed = set(document_ids) if document_ids else None
        matches: list[PrivateKnowledgeSource] = []
        chunk_id = 0
        for (owner_id, document_id), chunks in self.document_chunks.items():
            if owner_id != user.id or (allowed is not None and document_id not in allowed):
                continue
            document = self.documents[(owner_id, document_id)]
            for chunk in chunks:
                chunk_id += 1
                if chunk.flagged_untrusted_instruction:
                    continue
                occurrences = chunk.content.casefold().count(normalized)
                if occurrences == 0:
                    continue
                matches.append(
                    PrivateKnowledgeSource(
                        chunk_id=chunk_id,
                        document_id=document_id,
                        title=str(document["title"]),
                        heading=chunk.heading,
                        page_number=chunk.page_number,
                        locator=chunk.locator,
                        content=chunk.content,
                        score=float(1 + occurrences),
                    )
                )
        matches.sort(key=lambda item: item.score, reverse=True)
        return matches[:limit]

    async def record_web_search(
        self,
        user: AuthUser,
        *,
        query: str,
        provider: str,
        results: list[SearchSource],
    ) -> WebSearchRecord:
        record = WebSearchRecord(
            id=uuid4(),
            query=query,
            provider=provider,
            results=results,
            searched_at=datetime.now(UTC),
        )
        self.web_search_records[(user.id, record.id)] = record
        return record

    async def list_web_search_records(
        self, user: AuthUser, limit: int = 20
    ) -> list[WebSearchRecord]:
        records = [
            record
            for (owner_id, _), record in reversed(self.web_search_records.items())
            if owner_id == user.id
        ]
        return records[:limit]

    async def create_agent_proposal(
        self,
        user: AuthUser,
        *,
        thread_id: UUID | None,
        mode: str,
        proposal: ActionProposal,
    ) -> tuple[UUID, ActionProposal]:
        if thread_id is None:
            thread_id = UUID(int=len(self.agent_threads) + 1)
            self.agent_threads[(user.id, thread_id)] = {
                "mode": mode,
                "title": proposal.summary,
                "updated_at": datetime.now(UTC),
            }
        elif (user.id, thread_id) not in self.agent_threads:
            raise RepositoryValidationError("agent thread not found")
        existing_id = self.proposal_ids_by_key.get((user.id, proposal.idempotency_key))
        if existing_id:
            return thread_id, self.action_proposals[(user.id, existing_id)]
        self.action_proposals[(user.id, proposal.id)] = proposal
        self.proposal_ids_by_key[(user.id, proposal.idempotency_key)] = proposal.id
        self.audit_logs.append(
            {"user_id": user.id, "proposal_id": proposal.id, "event_type": "proposal_created"}
        )
        return thread_id, proposal

    async def ensure_agent_thread(
        self,
        user: AuthUser,
        *,
        thread_id: UUID | None,
        mode: str,
        title: str,
    ) -> UUID:
        if thread_id is None:
            thread_id = uuid4()
            self.agent_threads[(user.id, thread_id)] = {
                "mode": mode,
                "title": title,
                "updated_at": datetime.now(UTC),
            }
        elif (user.id, thread_id) not in self.agent_threads:
            raise RepositoryValidationError("agent thread not found")
        return thread_id

    async def append_agent_exchange(
        self,
        user: AuthUser,
        *,
        thread_id: UUID,
        user_message: str,
        agent_message: str,
        sources: list[AgentCitation],
        metadata: dict[str, Any],
    ) -> None:
        thread = self.agent_threads.get((user.id, thread_id))
        if not thread:
            raise RepositoryValidationError("agent thread not found")
        now = datetime.now(UTC)
        messages = self.agent_messages.setdefault((user.id, thread_id), [])
        messages.extend(
            [
                AgentMessage(
                    id=uuid4(), role="user", content=user_message, created_at=now
                ),
                AgentMessage(
                    id=uuid4(),
                    role="agent",
                    content=agent_message,
                    sources=sources,
                    metadata=metadata,
                    created_at=now,
                ),
            ]
        )
        thread["updated_at"] = now

    async def latest_agent_thread(self, user: AuthUser) -> AgentThreadHistory | None:
        owned = [
            (thread_id, thread)
            for (owner_id, thread_id), thread in self.agent_threads.items()
            if owner_id == user.id
        ]
        if not owned:
            return None
        thread_id, thread = max(
            owned,
            key=lambda item: item[1].get("updated_at", datetime.min.replace(tzinfo=UTC)),
        )
        return AgentThreadHistory(
            id=thread_id,
            mode=thread["mode"],
            title=thread["title"],
            messages=self.agent_messages.get((user.id, thread_id), []),
        )

    async def list_agent_threads(
        self, user: AuthUser, limit: int = 20
    ) -> list[AgentThreadSummary]:
        owned = [
            AgentThreadSummary(
                id=thread_id,
                mode=thread["mode"],
                title=thread["title"],
                updated_at=thread.get("updated_at", datetime.now(UTC)),
            )
            for (owner_id, thread_id), thread in self.agent_threads.items()
            if owner_id == user.id
        ]
        return sorted(owned, key=lambda thread: thread.updated_at, reverse=True)[:limit]

    async def get_agent_thread(
        self, user: AuthUser, thread_id: UUID
    ) -> AgentThreadHistory | None:
        thread = self.agent_threads.get((user.id, thread_id))
        if not thread:
            return None
        return AgentThreadHistory(
            id=thread_id,
            mode=thread["mode"],
            title=thread["title"],
            messages=self.agent_messages.get((user.id, thread_id), []),
        )

    async def list_pending_agent_proposals(
        self, user: AuthUser, limit: int = 10
    ) -> list[ActionProposal]:
        proposals = [
            proposal
            for (owner_id, _), proposal in reversed(self.action_proposals.items())
            if owner_id == user.id and proposal.status in {"pending", "edited"}
        ]
        return proposals[:limit]

    async def decide_agent_proposal(
        self,
        user: AuthUser,
        proposal_id: UUID,
        decision: str,
        edited_payload: dict[str, Any] | None = None,
    ) -> ActionProposal | None:
        proposal = self.action_proposals.get((user.id, proposal_id))
        if not proposal:
            return None
        if decision == "approve" and proposal.status == "applied":
            self.audit_logs.append(
                {
                    "user_id": user.id,
                    "proposal_id": proposal.id,
                    "event_type": "proposal_approval_replayed",
                }
            )
            return proposal
        if proposal.status not in {"pending", "edited"}:
            return proposal
        if decision == "approve":
            if proposal.action != "create_review_task":
                raise RepositoryValidationError("unsupported proposal action")
            await self.create_task(
                user,
                TaskCreate(
                    title=str(proposal.payload.get("title", "Agent 复习任务")),
                    subject=str(proposal.payload.get("subject", "cs408")),
                    planned_minutes=int(proposal.payload.get("planned_minutes", 45)),
                ),
            )
            status = "applied"
        elif decision == "edit":
            status = "edited"
        else:
            status = "rejected"
        updated = proposal.model_copy(
            update={"status": status, "payload": edited_payload or proposal.payload}
        )
        self.action_proposals[(user.id, proposal_id)] = updated
        self.audit_logs.append(
            {
                "user_id": user.id,
                "proposal_id": proposal.id,
                "event_type": f"proposal_{decision}",
            }
        )
        return updated


class SupabaseRepository:
    """PostgREST repository that executes queries with the user's JWT so RLS applies."""

    mode = "supabase"

    def __init__(
        self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        if not settings.supabase_url or not settings.supabase_anon_key:
            raise RuntimeError("SUPABASE_URL and SUPABASE_ANON_KEY are required")
        self.rest_url = f"{settings.supabase_url.rstrip('/')}/rest/v1"
        self.storage_url = f"{settings.supabase_url.rstrip('/')}/storage/v1"
        self.anon_key = settings.supabase_anon_key
        self.transport = transport

    async def _request(
        self,
        user: AuthUser,
        method: str,
        path: str,
        *,
        params: Mapping[str, str] | None = None,
        json: Any = None,
        prefer: str | None = None,
    ) -> Any:
        headers = {
            "apikey": self.anon_key,
            "Authorization": f"Bearer {user.access_token}",
        }
        if prefer:
            headers["Prefer"] = prefer
        try:
            async with httpx.AsyncClient(timeout=15, transport=self.transport) as client:
                response = await client.request(
                    method,
                    f"{self.rest_url}/{path}",
                    params=params,
                    json=json,
                    headers=headers,
                )
        except httpx.HTTPError as error:
            raise RepositoryError("Supabase database is unavailable") from error

        if response.status_code >= 400:
            try:
                error_payload = response.json()
            except ValueError:
                error_payload = {"message": response.text}
            if error_payload.get("code") == "23P01":
                raise RepositoryConflictError("study session overlaps an existing session")
            if error_payload.get("code") == "23505":
                raise RepositoryConflictError(str(error_payload.get("message") or "duplicate row"))
            message = error_payload.get("message") or "Supabase database request failed"
            if error_payload.get("code") == "23514":
                raise RepositoryValidationError(str(message))
            raise RepositoryError(str(message))
        if response.status_code == 204 or not response.content:
            return None
        return response.json()

    async def _storage_request(
        self,
        user: AuthUser,
        method: str,
        path: str,
        *,
        content: bytes,
        content_type: str,
    ) -> None:
        headers = {
            "apikey": self.anon_key,
            "Authorization": f"Bearer {user.access_token}",
            "Content-Type": content_type,
            "x-upsert": "false",
        }
        try:
            async with httpx.AsyncClient(timeout=30, transport=self.transport) as client:
                response = await client.request(
                    method,
                    f"{self.storage_url}/{path}",
                    content=content,
                    headers=headers,
                )
        except httpx.HTTPError as error:
            raise RepositoryError("Supabase Storage is unavailable") from error
        if response.status_code >= 400:
            try:
                message = response.json().get("message")
            except ValueError:
                message = response.text
            raise RepositoryError(str(message or "Supabase Storage request failed"))

    @staticmethod
    def _task(row: Mapping[str, Any]) -> dict:
        return {**row, "completed": row.get("completed_at") is not None}

    async def list_plans(self, user: AuthUser, level: str | None = None) -> list[dict]:
        params = {
            "select": "id,parent_id,level,title,description,starts_on,ends_on,status,created_at,updated_at",
            "user_id": f"eq.{user.id}",
            "order": "starts_on.asc,created_at.asc",
        }
        if level:
            params["level"] = f"eq.{level}"
        return await self._request(user, "GET", "plans", params=params)

    async def _validate_plan_dates(
        self,
        user: AuthUser,
        *,
        plan_id: UUID | None,
        level: str,
        parent_id: UUID | str | None,
        starts_on: date,
        ends_on: date,
    ) -> None:
        if parent_id:
            parents = await self._request(
                user,
                "GET",
                "plans",
                params={
                    "select": "id,level,starts_on,ends_on",
                    "id": f"eq.{parent_id}",
                    "user_id": f"eq.{user.id}",
                },
            )
            expected_level = "stage" if level == "week" else "week"
            if not parents:
                raise RepositoryValidationError("parent plan not found")
            if parents[0]["level"] != expected_level:
                raise RepositoryValidationError(f"{level} plan requires a {expected_level} parent")
            parent_starts_on = date.fromisoformat(parents[0]["starts_on"])
            parent_ends_on = date.fromisoformat(parents[0]["ends_on"])
            if starts_on < parent_starts_on or ends_on > parent_ends_on:
                raise RepositoryValidationError(
                    "child plan dates must stay within parent plan dates"
                )
        if plan_id:
            children = await self._request(
                user,
                "GET",
                "plans",
                params={
                    "select": "id,starts_on,ends_on",
                    "parent_id": f"eq.{plan_id}",
                    "user_id": f"eq.{user.id}",
                },
            )
            if any(
                date.fromisoformat(child["starts_on"]) < starts_on
                or date.fromisoformat(child["ends_on"]) > ends_on
                for child in children
            ):
                raise RepositoryValidationError("parent plan dates must include all child plans")

    async def create_plan(self, user: AuthUser, payload: PlanCreate) -> dict:
        await self._validate_plan_dates(
            user,
            plan_id=None,
            level=payload.level,
            parent_id=payload.parent_id,
            starts_on=payload.starts_on,
            ends_on=payload.ends_on,
        )
        body = payload.model_dump(mode="json")
        body["user_id"] = str(user.id)
        rows = await self._request(
            user,
            "POST",
            "plans",
            json=body,
            prefer="return=representation",
        )
        return rows[0]

    async def update_plan(self, user: AuthUser, plan_id: UUID, payload: PlanUpdate) -> dict | None:
        current = await self._request(
            user,
            "GET",
            "plans",
            params={
                "select": "id,parent_id,level,title,description,starts_on,ends_on,status",
                "id": f"eq.{plan_id}",
                "user_id": f"eq.{user.id}",
            },
        )
        if not current:
            return None
        changes = payload.model_dump(mode="json", exclude_unset=True)
        starts_on = date.fromisoformat(changes.get("starts_on", current[0]["starts_on"]))
        ends_on = date.fromisoformat(changes.get("ends_on", current[0]["ends_on"]))
        if ends_on < starts_on:
            raise RepositoryValidationError("ends_on must not be earlier than starts_on")
        await self._validate_plan_dates(
            user,
            plan_id=plan_id,
            level=current[0]["level"],
            parent_id=current[0]["parent_id"],
            starts_on=starts_on,
            ends_on=ends_on,
        )
        rows = await self._request(
            user,
            "PATCH",
            "plans",
            params={"id": f"eq.{plan_id}", "user_id": f"eq.{user.id}"},
            json=changes,
            prefer="return=representation",
        )
        return rows[0] if rows else None

    async def delete_plan(self, user: AuthUser, plan_id: UUID) -> bool:
        rows = await self._request(
            user,
            "DELETE",
            "plans",
            params={"id": f"eq.{plan_id}", "user_id": f"eq.{user.id}"},
            prefer="return=representation",
        )
        return bool(rows)

    async def plan_progress(self, user: AuthUser, plan_id: UUID) -> PlanProgress | None:
        plans = await self.list_plans(user)
        root = next((plan for plan in plans if plan["id"] == str(plan_id)), None)
        if not root:
            return None
        plan_ids = {str(plan_id)}
        previous_size = 0
        while previous_size != len(plan_ids):
            previous_size = len(plan_ids)
            plan_ids.update(
                str(plan["id"])
                for plan in plans
                if plan.get("parent_id") in plan_ids
            )
        task_rows = await self._request(
            user,
            "GET",
            "tasks",
            params={
                "select": "id,completed_at",
                "user_id": f"eq.{user.id}",
                "plan_id": f"in.({','.join(sorted(plan_ids))})",
            },
        )
        contribution_rows = await self._request(
            user,
            "GET",
            "daily_study_contributions",
            params={
                "select": "effective_minutes",
                "user_id": f"eq.{user.id}",
                "study_date": f"gte.{root['starts_on']}",
                "and": f"(study_date.lte.{root['ends_on']})",
            },
        )
        completed_tasks = sum(row.get("completed_at") is not None for row in task_rows)
        return PlanProgress(
            plan_id=plan_id,
            task_count=len(task_rows),
            completed_tasks=completed_tasks,
            completion_rate=(round(completed_tasks / len(task_rows) * 100) if task_rows else 0),
            actual_minutes=sum(int(row.get("effective_minutes", 0)) for row in contribution_rows),
        )

    async def list_tasks(self, user: AuthUser) -> list[dict]:
        rows = await self._request(
            user,
            "GET",
            "tasks",
            params={
                "select": "id,plan_id,title,subject,planned_minutes,due_at,completed_at,created_at,updated_at",
                "user_id": f"eq.{user.id}",
                "order": "created_at.asc",
            },
        )
        return [self._task(row) for row in rows]

    async def _validate_task_plan(self, user: AuthUser, plan_id: UUID | None) -> None:
        if plan_id is None:
            return
        plans = await self._request(
            user,
            "GET",
            "plans",
            params={
                "select": "id",
                "id": f"eq.{plan_id}",
                "user_id": f"eq.{user.id}",
                "level": "eq.day",
            },
        )
        if not plans:
            raise RepositoryValidationError("task plan must be an owned day plan")

    async def create_task(self, user: AuthUser, payload: TaskCreate) -> dict:
        await self._validate_task_plan(user, payload.plan_id)
        body = payload.model_dump(mode="json")
        body["user_id"] = str(user.id)
        rows = await self._request(
            user,
            "POST",
            "tasks",
            json=body,
            prefer="return=representation",
        )
        return self._task(rows[0])

    async def update_task(self, user: AuthUser, task_id: UUID, payload: TaskUpdate) -> dict | None:
        changes = payload.model_dump(mode="json", exclude_unset=True)
        if "plan_id" in changes:
            await self._validate_task_plan(user, payload.plan_id)
        completed = changes.pop("completed", None)
        if completed is not None:
            changes["completed_at"] = datetime.now(UTC).isoformat() if completed else None
        if not changes:
            current = await self._request(
                user,
                "GET",
                "tasks",
                params={
                    "select": "id,plan_id,title,subject,planned_minutes,due_at,completed_at,created_at,updated_at",
                    "id": f"eq.{task_id}",
                    "user_id": f"eq.{user.id}",
                },
            )
            return self._task(current[0]) if current else None
        rows = await self._request(
            user,
            "PATCH",
            "tasks",
            params={"id": f"eq.{task_id}", "user_id": f"eq.{user.id}"},
            json=changes,
            prefer="return=representation",
        )
        return self._task(rows[0]) if rows else None

    async def list_sessions(self, user: AuthUser) -> list[dict]:
        return await self._request(
            user,
            "GET",
            "study_sessions",
            params={
                "select": "id,task_id,subject,started_at,ended_at,paused_seconds,source,note,created_at,updated_at",
                "user_id": f"eq.{user.id}",
                "order": "started_at.asc",
            },
        )

    async def create_session(self, user: AuthUser, payload: StudySessionCreate) -> dict:
        body = payload.model_dump(mode="json")
        body["user_id"] = str(user.id)
        rows = await self._request(
            user,
            "POST",
            "study_sessions",
            json=body,
            prefer="return=representation",
        )
        return rows[0]

    async def list_mistakes(self, user: AuthUser, due_only: bool = False) -> list[dict]:
        params = {
            "select": "id,subject,title,question,answer,error_reason,mastery,next_review_at,review_count,created_at,updated_at",
            "user_id": f"eq.{user.id}",
            "order": "next_review_at.asc,created_at.asc",
        }
        if due_only:
            params["next_review_at"] = f"lte.{datetime.now(UTC).isoformat()}"
        return await self._request(user, "GET", "mistake_cards", params=params)

    async def create_mistake(self, user: AuthUser, payload: MistakeCardCreate) -> dict:
        body = payload.model_dump(mode="json")
        body.update(user_id=str(user.id), next_review_at=datetime.now(UTC).isoformat())
        rows = await self._request(
            user,
            "POST",
            "mistake_cards",
            json=body,
            prefer="return=representation",
        )
        return rows[0]

    async def review_mistake(
        self, user: AuthUser, card_id: UUID, payload: MistakeReviewCreate
    ) -> dict | None:
        owned = await self._request(
            user,
            "GET",
            "mistake_cards",
            params={
                "select": "id",
                "id": f"eq.{card_id}",
                "user_id": f"eq.{user.id}",
            },
        )
        if not owned:
            return None
        rows = await self._request(
            user,
            "POST",
            "rpc/review_mistake_card",
            json={"p_card_id": str(card_id), "p_result": payload.result},
        )
        return rows[0] if rows else None

    async def list_school_options(
        self, user: AuthUser, tier: str | None = None, exam_year: int | None = None
    ) -> list[dict]:
        params = {
            "select": (
                "id,tier,university,college,major_code,major_name,degree_type,exam_year,"
                "exam_subjects,tuition_total,duration_years,location,source_url,"
                "source_checked_at,notes,created_at,updated_at"
            ),
            "user_id": f"eq.{user.id}",
            "order": "exam_year.asc,tier.asc,university.asc",
        }
        if tier:
            params["tier"] = f"eq.{tier}"
        if exam_year:
            params["exam_year"] = f"eq.{exam_year}"
        return await self._request(user, "GET", "school_options", params=params)

    async def create_school_option(self, user: AuthUser, payload: SchoolOptionCreate) -> dict:
        body = payload.model_dump(mode="json")
        body["user_id"] = str(user.id)
        rows = await self._request(
            user,
            "POST",
            "school_options",
            json=body,
            prefer="return=representation",
        )
        return rows[0]

    async def update_school_option(
        self, user: AuthUser, option_id: UUID, payload: SchoolOptionUpdate
    ) -> dict | None:
        changes = payload.model_dump(mode="json", exclude_unset=True)
        if "source_url" in changes:
            changes["source_checked_at"] = datetime.now(UTC).isoformat()
        rows = await self._request(
            user,
            "PATCH",
            "school_options",
            params={"id": f"eq.{option_id}", "user_id": f"eq.{user.id}"},
            json=changes,
            prefer="return=representation",
        )
        return rows[0] if rows else None

    async def delete_school_option(self, user: AuthUser, option_id: UUID) -> bool:
        rows = await self._request(
            user,
            "DELETE",
            "school_options",
            params={"id": f"eq.{option_id}", "user_id": f"eq.{user.id}"},
            prefer="return=representation",
        )
        return bool(rows)

    async def list_career_items(
        self, user: AuthUser, item_type: str | None = None, status: str | None = None
    ) -> list[dict]:
        params = {
            "select": "id,item_type,title,company,status,occurred_on,notes,created_at,updated_at",
            "user_id": f"eq.{user.id}",
            "order": "occurred_on.asc.nullslast,created_at.asc",
        }
        if item_type:
            params["item_type"] = f"eq.{item_type}"
        if status:
            params["status"] = f"eq.{status}"
        return await self._request(user, "GET", "career_items", params=params)

    async def create_career_item(self, user: AuthUser, payload: CareerItemCreate) -> dict:
        body = payload.model_dump(mode="json")
        body["user_id"] = str(user.id)
        rows = await self._request(
            user,
            "POST",
            "career_items",
            json=body,
            prefer="return=representation",
        )
        return rows[0]

    async def update_career_item(
        self, user: AuthUser, item_id: UUID, payload: CareerItemUpdate
    ) -> dict | None:
        rows = await self._request(
            user,
            "PATCH",
            "career_items",
            params={"id": f"eq.{item_id}", "user_id": f"eq.{user.id}"},
            json=payload.model_dump(mode="json", exclude_unset=True),
            prefer="return=representation",
        )
        return rows[0] if rows else None

    async def delete_career_item(self, user: AuthUser, item_id: UUID) -> bool:
        rows = await self._request(
            user,
            "DELETE",
            "career_items",
            params={"id": f"eq.{item_id}", "user_id": f"eq.{user.id}"},
            prefer="return=representation",
        )
        return bool(rows)

    async def persist_document(
        self,
        user: AuthUser,
        *,
        document_id: UUID,
        filename: str,
        content_type: str,
        content: bytes,
        digest: str,
        ingestion_status: str,
        chunks: list[TextChunk],
        source_url: str | None = None,
        title: str | None = None,
    ) -> tuple[dict, bool]:
        existing = await self._request(
            user,
            "GET",
            "documents",
            params={
                "select": (
                    "id,title,original_filename,content_type,byte_size,sha256,storage_path,"
                    "ingestion_status"
                ),
                "user_id": f"eq.{user.id}",
                "sha256": f"eq.{digest}",
                "limit": "1",
            },
        )
        if existing:
            existing_chunks = await self._request(
                user,
                "GET",
                "document_chunks",
                params={
                    "select": "id,flagged_untrusted_instruction",
                    "document_id": f"eq.{existing[0]['id']}",
                    "user_id": f"eq.{user.id}",
                },
            )
            return {
                **existing[0],
                "chunk_count": len(existing_chunks),
                "flagged_chunk_count": sum(
                    bool(chunk.get("flagged_untrusted_instruction"))
                    for chunk in existing_chunks
                ),
            }, True

        if source_url:
            same_url = await self._request(
                user,
                "GET",
                "documents",
                params={
                    "select": (
                        "id,title,original_filename,source_type,source_url,content_type,"
                        "byte_size,sha256,storage_path,ingestion_status"
                    ),
                    "user_id": f"eq.{user.id}",
                    "source_url": f"eq.{source_url}",
                    "limit": "1",
                },
            )
            if same_url:
                return {**same_url[0], "chunk_count": 0, "flagged_chunk_count": 0}, True

        storage_path = f"{user.id}/{document_id}/{filename}"
        encoded_path = "/".join(quote(part, safe="") for part in storage_path.split("/"))
        await self._storage_request(
            user,
            "POST",
            f"object/study-materials/{encoded_path}",
            content=content,
            content_type=content_type,
        )
        document_rows = await self._request(
            user,
            "POST",
            "documents",
            json={
                "id": str(document_id),
                "user_id": str(user.id),
                "source_type": "web" if source_url else "upload",
                "source_url": source_url,
                "title": title or filename.rsplit(".", 1)[0],
                "original_filename": filename,
                "storage_path": storage_path,
                "content_type": content_type,
                "byte_size": len(content),
                "sha256": digest,
                "ingestion_status": ingestion_status,
            },
            prefer="return=representation",
        )
        if chunks:
            await self._request(
                user,
                "POST",
                "document_chunks",
                json=[
                    {
                        "document_id": str(document_id),
                        "user_id": str(user.id),
                        "chunk_index": chunk.index,
                        "heading": chunk.heading,
                        "page_number": chunk.page_number,
                        "locator": chunk.locator,
                        "content": chunk.content,
                        "flagged_untrusted_instruction": chunk.flagged_untrusted_instruction,
                    }
                    for chunk in chunks
                ],
                prefer="return=minimal",
            )
        return {
            **document_rows[0],
            "chunk_count": len(chunks),
            "flagged_chunk_count": sum(
                chunk.flagged_untrusted_instruction for chunk in chunks
            ),
        }, False

    async def list_documents(self, user: AuthUser) -> list[dict]:
        return await self._request(
            user,
            "GET",
            "documents",
            params={
                "select": (
                    "id,title,original_filename,source_type,source_url,content_type,byte_size,"
                    "sha256,storage_path,version,ingestion_status,ingestion_error,created_at,updated_at"
                ),
                "user_id": f"eq.{user.id}",
                "order": "created_at.desc",
            },
        )

    async def get_document(self, user: AuthUser, document_id: UUID) -> dict | None:
        rows = await self._request(
            user,
            "GET",
            "documents",
            params={
                "select": (
                    "id,title,original_filename,source_type,source_url,content_type,byte_size,"
                    "sha256,storage_path,version,ingestion_status,ingestion_error,created_at,updated_at"
                ),
                "id": f"eq.{document_id}",
                "user_id": f"eq.{user.id}",
            },
        )
        return rows[0] if rows else None

    @staticmethod
    def _import_proposal(row: Mapping[str, Any]) -> ImportProposal:
        return ImportProposal(
            id=row["id"],
            url=row["source_url"],
            title=row["title"],
            summary=row["summary"],
            content_type=row.get("content_type") or "text/html",
            estimated_bytes=row.get("estimated_bytes"),
            status=row["status"],
        )

    async def create_import_proposal(
        self, user: AuthUser, proposal: ImportProposal
    ) -> ImportProposal:
        rows = await self._request(
            user,
            "POST",
            "import_proposals",
            json={
                "id": str(proposal.id),
                "user_id": str(user.id),
                "source_url": str(proposal.url),
                "title": proposal.title,
                "summary": proposal.summary,
                "content_type": proposal.content_type,
                "estimated_bytes": proposal.estimated_bytes,
                "status": proposal.status,
            },
            prefer="return=representation",
        )
        return self._import_proposal(rows[0])

    async def get_import_proposal(
        self, user: AuthUser, proposal_id: UUID
    ) -> ImportProposal | None:
        rows = await self._request(
            user,
            "GET",
            "import_proposals",
            params={
                "select": "*",
                "id": f"eq.{proposal_id}",
                "user_id": f"eq.{user.id}",
            },
        )
        return self._import_proposal(rows[0]) if rows else None

    async def approve_import_proposal(
        self, user: AuthUser, proposal_id: UUID
    ) -> ImportProposal | None:
        rows = await self._request(
            user,
            "PATCH",
            "import_proposals",
            params={"id": f"eq.{proposal_id}", "user_id": f"eq.{user.id}"},
            json={"status": "approved", "decided_at": datetime.now(UTC).isoformat()},
            prefer="return=representation",
        )
        return self._import_proposal(rows[0]) if rows else None

    async def search_private_knowledge(
        self,
        user: AuthUser,
        query: str,
        limit: int = 8,
        document_ids: list[UUID] | None = None,
    ) -> list[PrivateKnowledgeSource]:
        rows = await self._request(
            user,
            "POST",
            "rpc/search_private_document_chunks",
            json={
                "query_text": query,
                "match_count": limit,
                "filter_document_ids": (
                    [str(document_id) for document_id in document_ids]
                    if document_ids
                    else None
                ),
            },
        )
        return [PrivateKnowledgeSource.model_validate(row) for row in rows]

    async def record_web_search(
        self,
        user: AuthUser,
        *,
        query: str,
        provider: str,
        results: list[SearchSource],
    ) -> WebSearchRecord:
        rows = await self._request(
            user,
            "POST",
            "web_search_records",
            json={
                "user_id": str(user.id),
                "query": query,
                "provider": provider,
                "results": [result.model_dump(mode="json") for result in results],
            },
            prefer="return=representation",
        )
        return WebSearchRecord.model_validate(rows[0])

    async def list_web_search_records(
        self, user: AuthUser, limit: int = 20
    ) -> list[WebSearchRecord]:
        rows = await self._request(
            user,
            "GET",
            "web_search_records",
            params={
                "select": "id,query,provider,results,searched_at",
                "user_id": f"eq.{user.id}",
                "order": "searched_at.desc",
                "limit": str(limit),
            },
        )
        return [WebSearchRecord.model_validate(row) for row in rows]

    async def create_agent_proposal(
        self,
        user: AuthUser,
        *,
        thread_id: UUID | None,
        mode: str,
        proposal: ActionProposal,
    ) -> tuple[UUID, ActionProposal]:
        rows = await self._request(
            user,
            "POST",
            "rpc/create_agent_proposal",
            json={
                "requested_thread_id": str(thread_id) if thread_id else None,
                "requested_mode": mode,
                "requested_agent": proposal.agent,
                "requested_action": proposal.action,
                "requested_payload": proposal.payload,
                "requested_summary": proposal.summary,
                "requested_idempotency_key": proposal.idempotency_key,
            },
        )
        if not rows:
            raise RepositoryError("Agent proposal was not persisted")
        row = rows[0]
        return UUID(str(row["thread_id"])), ActionProposal.model_validate(row["proposal"])

    async def ensure_agent_thread(
        self,
        user: AuthUser,
        *,
        thread_id: UUID | None,
        mode: str,
        title: str,
    ) -> UUID:
        row = await self._request(
            user,
            "POST",
            "rpc/ensure_agent_thread",
            json={
                "requested_thread_id": str(thread_id) if thread_id else None,
                "requested_mode": mode,
                "requested_title": title,
            },
        )
        value = row[0] if isinstance(row, list) else row
        if not value:
            raise RepositoryError("Agent thread was not persisted")
        return UUID(str(value))

    async def append_agent_exchange(
        self,
        user: AuthUser,
        *,
        thread_id: UUID,
        user_message: str,
        agent_message: str,
        sources: list[AgentCitation],
        metadata: dict[str, Any],
    ) -> None:
        await self._request(
            user,
            "POST",
            "rpc/append_agent_exchange",
            json={
                "requested_thread_id": str(thread_id),
                "user_content": user_message,
                "agent_content": agent_message,
                "agent_sources": [source.model_dump(mode="json") for source in sources],
                "agent_metadata": metadata,
            },
        )

    async def latest_agent_thread(self, user: AuthUser) -> AgentThreadHistory | None:
        threads = await self._request(
            user,
            "GET",
            "agent_threads",
            params={
                "select": "id,mode,title",
                "user_id": f"eq.{user.id}",
                "order": "updated_at.desc",
                "limit": "1",
            },
        )
        if not threads:
            return None
        thread = threads[0]
        messages = await self._request(
            user,
            "GET",
            "agent_messages",
            params={
                "select": "id,role,content,sources,metadata,created_at",
                "user_id": f"eq.{user.id}",
                "thread_id": f"eq.{thread['id']}",
                "order": "created_at.asc,id.asc",
            },
        )
        return AgentThreadHistory(
            **thread,
            messages=[AgentMessage.model_validate(message) for message in messages],
        )

    async def list_agent_threads(
        self, user: AuthUser, limit: int = 20
    ) -> list[AgentThreadSummary]:
        rows = await self._request(
            user,
            "GET",
            "agent_threads",
            params={
                "select": "id,mode,title,updated_at",
                "user_id": f"eq.{user.id}",
                "order": "updated_at.desc",
                "limit": str(limit),
            },
        )
        return [AgentThreadSummary.model_validate(row) for row in rows]

    async def get_agent_thread(
        self, user: AuthUser, thread_id: UUID
    ) -> AgentThreadHistory | None:
        threads = await self._request(
            user,
            "GET",
            "agent_threads",
            params={
                "select": "id,mode,title",
                "user_id": f"eq.{user.id}",
                "id": f"eq.{thread_id}",
                "limit": "1",
            },
        )
        if not threads:
            return None
        messages = await self._request(
            user,
            "GET",
            "agent_messages",
            params={
                "select": "id,role,content,sources,metadata,created_at",
                "user_id": f"eq.{user.id}",
                "thread_id": f"eq.{thread_id}",
                "order": "created_at.asc,id.asc",
            },
        )
        return AgentThreadHistory(
            **threads[0],
            messages=[AgentMessage.model_validate(message) for message in messages],
        )

    async def list_pending_agent_proposals(
        self, user: AuthUser, limit: int = 10
    ) -> list[ActionProposal]:
        rows = await self._request(
            user,
            "GET",
            "action_proposals",
            params={
                "select": "id,agent,action,payload,summary,idempotency_key,status",
                "user_id": f"eq.{user.id}",
                "status": "in.(pending,edited)",
                "order": "created_at.desc",
                "limit": str(limit),
            },
        )
        return [ActionProposal.model_validate(row) for row in rows]

    async def decide_agent_proposal(
        self,
        user: AuthUser,
        proposal_id: UUID,
        decision: str,
        edited_payload: dict[str, Any] | None = None,
    ) -> ActionProposal | None:
        row = await self._request(
            user,
            "POST",
            "rpc/decide_agent_proposal",
            json={
                "requested_proposal_id": str(proposal_id),
                "requested_decision": decision,
                "edited_payload": edited_payload,
            },
        )
        if not row:
            return None
        payload = row[0] if isinstance(row, list) else row
        return ActionProposal.model_validate(payload)

    async def contributions(
        self, user: AuthUser, from_date: date, to_date: date, scope: str
    ) -> list[ContributionDay]:
        rows = await self._request(
            user,
            "GET",
            "daily_study_contributions",
            params={
                "select": "study_date,effective_minutes,session_count,completed_tasks,mistake_count,subject_minutes",
                "user_id": f"eq.{user.id}",
                "and": (
                    f"(study_date.gte.{from_date.isoformat()},study_date.lte.{to_date.isoformat()})"
                ),
                "order": "study_date.asc",
            },
        )
        by_day = {date.fromisoformat(row["study_date"]): row for row in rows}
        result: list[ContributionDay] = []
        cursor = from_date
        while cursor <= to_date:
            row = by_day.get(cursor, {})
            subject_minutes = dict(row.get("subject_minutes") or {})
            minutes = (
                int(row.get("effective_minutes", 0))
                if scope == "all"
                else int(subject_minutes.get(scope, 0))
            )
            result.append(
                ContributionDay(
                    date=cursor,
                    scope=scope,
                    effective_minutes=minutes,
                    intensity_level=intensity_level(minutes, cast(Scope, scope)),
                    session_count=int(row.get("session_count", 0)),
                    completed_tasks=int(row.get("completed_tasks", 0)),
                    mistake_count=int(row.get("mistake_count", 0)),
                    subject_minutes=subject_minutes,
                )
            )
            cursor = date.fromordinal(cursor.toordinal() + 1)
        return result


def build_repository(settings: Settings) -> StudyRepository:
    if settings.demo_mode:
        return DemoRepository()
    return SupabaseRepository(settings)
