from collections.abc import Callable, Mapping
from datetime import UTC, date, datetime
from typing import Any, Protocol, cast
from uuid import UUID

import httpx

from app.auth import AuthUser
from app.config import Settings
from app.domain.contributions import Scope, intensity_level
from app.schemas import ContributionDay, PlanCreate, StudySessionCreate, TaskCreate, TaskUpdate
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

    def clear(self) -> None:
        self.stores.clear()

    def _store(self, user: AuthUser) -> DemoStore:
        return self.stores.setdefault(user.id, DemoStore(self.timezone_name, self.now_factory))

    async def list_plans(self, user: AuthUser, level: str | None = None) -> list[dict]:
        return self._store(user).list_plans(level)

    async def create_plan(self, user: AuthUser, payload: PlanCreate) -> dict:
        try:
            return self._store(user).create_plan(payload)
        except ValueError as error:
            raise RepositoryValidationError(str(error)) from error

    async def list_tasks(self, user: AuthUser) -> list[dict]:
        return self._store(user).list_tasks()

    async def create_task(self, user: AuthUser, payload: TaskCreate) -> dict:
        return self._store(user).create_task(payload)

    async def update_task(self, user: AuthUser, task_id: UUID, payload: TaskUpdate) -> dict | None:
        return self._store(user).update_task(task_id, payload)

    async def list_sessions(self, user: AuthUser) -> list[dict]:
        return self._store(user).list_sessions()

    async def create_session(self, user: AuthUser, payload: StudySessionCreate) -> dict:
        return self._store(user).create_session(payload)

    async def contributions(
        self, user: AuthUser, from_date: date, to_date: date, scope: str
    ) -> list[ContributionDay]:
        return self._store(user).contributions(from_date, to_date, scope)


class SupabaseRepository:
    """PostgREST repository that executes queries with the user's JWT so RLS applies."""

    mode = "supabase"

    def __init__(
        self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        if not settings.supabase_url or not settings.supabase_anon_key:
            raise RuntimeError("SUPABASE_URL and SUPABASE_ANON_KEY are required")
        self.rest_url = f"{settings.supabase_url.rstrip('/')}/rest/v1"
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
            message = error_payload.get("message") or "Supabase database request failed"
            raise RepositoryError(str(message))
        if response.status_code == 204 or not response.content:
            return None
        return response.json()

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

    async def create_plan(self, user: AuthUser, payload: PlanCreate) -> dict:
        if payload.parent_id:
            parents = await self._request(
                user,
                "GET",
                "plans",
                params={
                    "select": "id,level,starts_on,ends_on",
                    "id": f"eq.{payload.parent_id}",
                    "user_id": f"eq.{user.id}",
                },
            )
            expected_level = "stage" if payload.level == "week" else "week"
            if not parents:
                raise RepositoryValidationError("parent plan not found")
            if parents[0]["level"] != expected_level:
                raise RepositoryValidationError(
                    f"{payload.level} plan requires a {expected_level} parent"
                )
            parent_starts_on = date.fromisoformat(parents[0]["starts_on"])
            parent_ends_on = date.fromisoformat(parents[0]["ends_on"])
            if payload.starts_on < parent_starts_on or payload.ends_on > parent_ends_on:
                raise RepositoryValidationError(
                    "child plan dates must stay within parent plan dates"
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

    async def list_tasks(self, user: AuthUser) -> list[dict]:
        rows = await self._request(
            user,
            "GET",
            "tasks",
            params={
                "select": "id,title,subject,planned_minutes,due_at,completed_at,created_at,updated_at",
                "user_id": f"eq.{user.id}",
                "order": "created_at.asc",
            },
        )
        return [self._task(row) for row in rows]

    async def create_task(self, user: AuthUser, payload: TaskCreate) -> dict:
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
        completed = changes.pop("completed", None)
        if completed is not None:
            changes["completed_at"] = datetime.now(UTC).isoformat() if completed else None
        if not changes:
            current = await self._request(
                user,
                "GET",
                "tasks",
                params={
                    "select": "id,title,subject,planned_minutes,due_at,completed_at,created_at,updated_at",
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
