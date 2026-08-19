from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator

Subject = Literal["math", "english", "politics", "cs408", "career"]
AcademicSubject = Literal["math", "english", "politics", "cs408"]
PlanLevel = Literal["stage", "week", "day"]
PlanStatus = Literal["draft", "active", "completed", "archived"]
SchoolTier = Literal["stretch", "match", "safety"]
DegreeType = Literal["academic", "professional"]
CareerItemType = Literal["milestone", "resume", "application", "interview"]
CareerStatus = Literal[
    "planned",
    "in_progress",
    "submitted",
    "interviewing",
    "offer",
    "rejected",
    "completed",
    "archived",
]


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


class DashboardMetrics(BaseModel):
    week_start: date
    week_end: date
    weekly_task_count: int = 0
    weekly_completed_tasks: int = 0
    weekly_completion_rate: int = Field(default=0, ge=0, le=100)
    today_effective_minutes: int = 0
    today_task_count: int = 0
    today_planned_minutes: int = 0
    active_stage_title: str | None = None
    current_streak_days: int = 0
    longest_streak_days: int = 0


class SubjectWeakPoint(BaseModel):
    id: UUID
    title: str
    mastery: int = Field(default=0, ge=0, le=5)
    review_count: int = 0
    next_review_at: datetime


class SubjectSummary(BaseModel):
    subject: AcademicSubject
    weekly_minutes: int = 0
    total_minutes: int = 0
    task_count: int = 0
    completed_tasks: int = 0
    task_completion_rate: int = Field(default=0, ge=0, le=100)
    mistake_count: int = 0
    due_mistake_count: int = 0
    review_count: int = 0
    weak_points: list[SubjectWeakPoint] = Field(default_factory=list)


class AgentModelUsageBreakdown(BaseModel):
    provider: str
    model: str
    model_profile: Literal["flash", "pro"]
    request_count: int = 0
    degraded_count: int = 0
    error_count: int = 0
    fallback_count: int = 0
    average_latency_ms: int = 0
    input_tokens: int = 0
    output_tokens: int = 0


class AgentModelUsageSummary(BaseModel):
    days: int
    total_requests: int = 0
    successful_requests: int = 0
    degraded_requests: int = 0
    error_requests: int = 0
    fallback_requests: int = 0
    success_rate: float = Field(default=0, ge=0, le=1)
    error_rate: float = Field(default=0, ge=0, le=1)
    average_latency_ms: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    estimated_cost: float | None = None
    cost_note: str = "未配置动态单价，Token 已记录，可按供应商账单价格核算"
    breakdown: list[AgentModelUsageBreakdown] = Field(default_factory=list)


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
    subject: Subject | None = None
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


class MistakeCardCreate(StrictRequestModel):
    subject: AcademicSubject
    title: str = Field(min_length=1, max_length=160)
    question: str = Field(min_length=1, max_length=10000)
    answer: str = Field(default="", max_length=10000)
    error_reason: str = Field(default="", max_length=10000)


class MistakeReviewCreate(StrictRequestModel):
    result: Literal["again", "hard", "good", "easy"]


class SchoolOptionCreate(StrictRequestModel):
    tier: SchoolTier
    university: str = Field(min_length=1, max_length=120)
    college: str = Field(min_length=1, max_length=160)
    major_code: str = Field(min_length=2, max_length=20)
    major_name: str = Field(min_length=1, max_length=160)
    degree_type: DegreeType
    exam_year: int = Field(ge=2026, le=2100)
    exam_subjects: list[str] = Field(default_factory=list, max_length=12)
    tuition_total: int | None = Field(default=None, ge=0, le=10_000_000)
    duration_years: float | None = Field(default=None, ge=0.5, le=10)
    location: str | None = Field(default=None, max_length=160)
    source_url: HttpUrl
    notes: str = Field(default="", max_length=5000)


class SchoolOptionUpdate(StrictRequestModel):
    tier: SchoolTier | None = None
    university: str | None = Field(default=None, min_length=1, max_length=120)
    college: str | None = Field(default=None, min_length=1, max_length=160)
    major_code: str | None = Field(default=None, min_length=2, max_length=20)
    major_name: str | None = Field(default=None, min_length=1, max_length=160)
    degree_type: DegreeType | None = None
    exam_year: int | None = Field(default=None, ge=2026, le=2100)
    exam_subjects: list[str] | None = Field(default=None, max_length=12)
    tuition_total: int | None = Field(default=None, ge=0, le=10_000_000)
    duration_years: float | None = Field(default=None, ge=0.5, le=10)
    location: str | None = Field(default=None, max_length=160)
    source_url: HttpUrl | None = None
    notes: str | None = Field(default=None, max_length=5000)

    @model_validator(mode="after")
    def require_changes(self) -> "SchoolOptionUpdate":
        if not self.model_fields_set:
            raise ValueError("at least one school option field must be provided")
        return self


class CareerItemCreate(StrictRequestModel):
    item_type: CareerItemType
    title: str = Field(min_length=1, max_length=160)
    company: str | None = Field(default=None, max_length=160)
    status: CareerStatus = "planned"
    occurred_on: date | None = None
    notes: str = Field(default="", max_length=10000)


class CareerItemUpdate(StrictRequestModel):
    item_type: CareerItemType | None = None
    title: str | None = Field(default=None, min_length=1, max_length=160)
    company: str | None = Field(default=None, max_length=160)
    status: CareerStatus | None = None
    occurred_on: date | None = None
    notes: str | None = Field(default=None, max_length=10000)

    @model_validator(mode="after")
    def require_changes(self) -> "CareerItemUpdate":
        if not self.model_fields_set:
            raise ValueError("at least one career item field must be provided")
        return self


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


class WebSearchRecord(BaseModel):
    id: UUID
    query: str
    provider: str
    results: list[SearchSource]
    searched_at: datetime


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


class PrivateKnowledgeSource(BaseModel):
    chunk_id: int
    document_id: UUID
    title: str
    heading: str | None = None
    page_number: int | None = None
    locator: str
    content: str
    snippet: str = ""
    matched_terms: list[str] = Field(default_factory=list)
    retrieval_mode: Literal["keyword", "hybrid"] = "keyword"
    score: float = Field(ge=0)


class OcrJob(BaseModel):
    id: UUID
    document_id: UUID
    status: Literal["queued", "processing", "completed", "failed"]
    attempts: int = Field(ge=0)
    max_attempts: int = Field(ge=1)
    available_at: datetime
    last_error: str | None = None
    created_at: datetime
    updated_at: datetime


class AgentRunRequest(StrictRequestModel):
    message: str = Field(min_length=1, max_length=4000)
    thread_id: UUID | None = None
    model_profile: Literal["flash", "pro"] = "flash"


class AgentCitation(BaseModel):
    source_type: Literal["private", "web"]
    title: str
    locator: str
    url: HttpUrl | None = None
    accessed_at: datetime | None = None


class AgentMessage(BaseModel):
    id: UUID
    role: Literal["user", "agent"]
    content: str
    sources: list[AgentCitation] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class AgentThreadHistory(BaseModel):
    id: UUID
    mode: Literal["coach", "tutor", "combined"]
    title: str
    model_profile: Literal["flash", "pro"] = "flash"
    last_provider: str | None = None
    last_model: str | None = None
    messages: list[AgentMessage]


class AgentThreadSummary(BaseModel):
    id: UUID
    mode: Literal["coach", "tutor", "combined"]
    title: str
    model_profile: Literal["flash", "pro"] = "flash"
    last_provider: str | None = None
    last_model: str | None = None
    updated_at: datetime


class ActionProposal(BaseModel):
    id: UUID
    agent: Literal["coach", "tutor"]
    action: str
    payload: dict[str, Any]
    summary: str
    idempotency_key: str
    status: Literal["pending", "approved", "edited", "rejected", "applied", "failed"] = "pending"


class AgentProposalEditRequest(StrictRequestModel):
    title: str = Field(min_length=1, max_length=160)
    subject: Subject
    planned_minutes: int = Field(ge=1, le=1440)
