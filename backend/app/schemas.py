from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator

Subject = Literal["math", "english", "politics", "cs408", "career"]
PlanLevel = Literal["stage", "week", "day"]
PlanStatus = Literal["draft", "active", "completed", "archived"]


class StrictRequestModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ContributionDay(BaseModel):
    date: date
    scope: str
    effective_minutes: int = 0
    intensity_level: int = Field(ge=0, le=4)
    session_count: int = 0
    completed_tasks: int = 0
    mistake_count: int = 0
    subject_minutes: dict[str, int] = Field(default_factory=dict)


class StudySessionCreate(StrictRequestModel):
    subject: Subject
    started_at: datetime
    ended_at: datetime
    paused_seconds: int = Field(default=0, ge=0)
    source: Literal["timer", "manual"] = "timer"
    note: str = ""

    @field_validator("started_at", "ended_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("study session timestamps must include a timezone")
        return value


class TaskCreate(StrictRequestModel):
    title: str = Field(min_length=1, max_length=160)
    subject: Subject
    planned_minutes: int = Field(default=30, ge=1, le=1440)
    due_at: datetime | None = None
    plan_id: UUID | None = None


class TaskUpdate(StrictRequestModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    completed: bool | None = None
    planned_minutes: int | None = Field(default=None, ge=1, le=1440)
    due_at: datetime | None = None
    plan_id: UUID | None = None


class PlanCreate(StrictRequestModel):
    parent_id: UUID | None = None
    level: PlanLevel
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=2000)
    starts_on: date
    ends_on: date
    status: PlanStatus = "active"

    @model_validator(mode="after")
    def validate_hierarchy_shape(self) -> "PlanCreate":
        if self.ends_on < self.starts_on:
            raise ValueError("ends_on must not be earlier than starts_on")
        if self.level == "stage" and self.parent_id is not None:
            raise ValueError("stage plan cannot have a parent")
        if self.level != "stage" and self.parent_id is None:
            raise ValueError("week and day plans require a parent")
        return self


class PlanUpdate(StrictRequestModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=2000)
    starts_on: date | None = None
    ends_on: date | None = None
    status: PlanStatus | None = None

    @model_validator(mode="after")
    def require_changes(self) -> "PlanUpdate":
        if not self.model_fields_set:
            raise ValueError("at least one plan field must be provided")
        return self


class PlanProgress(BaseModel):
    plan_id: UUID
    task_count: int = 0
    completed_tasks: int = 0
    completion_rate: int = Field(default=0, ge=0, le=100)
    actual_minutes: int = 0


class WebSearchRequest(StrictRequestModel):
    query: str = Field(min_length=2, max_length=500)
    include_domains: list[str] = Field(default_factory=list)
    recency_days: int | None = Field(default=None, ge=1, le=3650)


class SearchSource(BaseModel):
    title: str
    url: HttpUrl
    snippet: str
    accessed_at: datetime
    source_type: Literal["web", "private"] = "web"


class ImportPreviewRequest(StrictRequestModel):
    url: HttpUrl


class ImportProposal(BaseModel):
    id: UUID
    url: HttpUrl
    title: str
    summary: str
    content_type: str
    estimated_bytes: int | None = None
    status: Literal["pending", "approved", "rejected"] = "pending"


class AgentRunRequest(StrictRequestModel):
    message: str = Field(min_length=1, max_length=4000)
    thread_id: str | None = None


class ActionProposal(BaseModel):
    id: UUID
    agent: Literal["coach", "tutor"]
    action: str
    payload: dict[str, Any]
    summary: str
    idempotency_key: str
    status: Literal["pending", "approved", "edited", "rejected", "applied", "failed"] = "pending"
