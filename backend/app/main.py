from datetime import UTC, date, datetime, timedelta
from uuid import UUID, uuid4

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.domain.contributions import intensity_level
from app.schemas import (
    ActionProposal,
    AgentRunRequest,
    ContributionDay,
    ImportPreviewRequest,
    ImportProposal,
    SearchSource,
    StudySessionCreate,
    TaskCreate,
    WebSearchRequest,
)
from app.services.search import get_search_provider

settings = get_settings()
app = FastAPI(title="研途 API", version="0.1.0", docs_url="/docs")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

demo_tasks: list[dict] = []
demo_sessions: list[dict] = []
import_proposals: dict[UUID, ImportProposal] = {}
action_proposals: dict[UUID, ActionProposal] = {}


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "mode": "demo" if settings.demo_mode else "cloud"}


@app.get("/api/v1/today")
async def today() -> dict:
    return {"date": date.today(), "tasks": demo_tasks, "sessions": demo_sessions}


@app.post("/api/v1/tasks", status_code=201)
async def create_task(payload: TaskCreate) -> dict:
    task = {"id": str(uuid4()), **payload.model_dump(), "completed": False}
    demo_tasks.append(task)
    return task


@app.post("/api/v1/sessions", status_code=201)
async def create_session(payload: StudySessionCreate) -> dict:
    if payload.ended_at <= payload.started_at:
        raise HTTPException(422, "ended_at must be later than started_at")
    item = {"id": str(uuid4()), **payload.model_dump()}
    demo_sessions.append(item)
    return item


@app.get("/api/v1/analytics/contributions", response_model=list[ContributionDay])
async def contributions(
    from_date: date = Query(alias="from"),
    to_date: date = Query(alias="to"),
    scope: str = "all",
) -> list[ContributionDay]:
    if to_date < from_date or (to_date - from_date).days > 370:
        raise HTTPException(422, "date range must be between 0 and 370 days")
    result = []
    cursor = from_date
    while cursor <= to_date:
        seed = cursor.toordinal()
        minutes = 0 if seed % 4 == 0 else (seed * 37) % (360 if scope == "all" else 150)
        result.append(ContributionDay(
            date=cursor,
            scope=scope,
            effective_minutes=minutes,
            intensity_level=intensity_level(minutes, scope if scope in {"all", "math", "english", "politics", "cs408", "career"} else "all"),
            session_count=0 if minutes == 0 else 1 + seed % 4,
            completed_tasks=0 if minutes == 0 else 1 + seed % 5,
            mistake_count=seed % 3,
            subject_minutes={scope: minutes} if scope != "all" else {"math": minutes // 2, "cs408": minutes // 2},
        ))
        cursor += timedelta(days=1)
    return result


@app.post("/api/v1/search/web", response_model=list[SearchSource])
async def web_search(payload: WebSearchRequest) -> list[SearchSource]:
    provider = get_search_provider(settings)
    results = await provider.search(payload.query, payload.include_domains)
    return [SearchSource(title=item.title, url=item.url, snippet=item.snippet, accessed_at=item.accessed_at) for item in results]


@app.post("/api/v1/documents/import-preview", response_model=ImportProposal)
async def preview_import(payload: ImportPreviewRequest) -> ImportProposal:
    proposal = ImportProposal(
        id=uuid4(),
        url=payload.url,
        title="待导入网络资料",
        summary="系统将在批准后下载、去重、解析并建立混合检索索引。",
        content_type="text/html",
    )
    import_proposals[proposal.id] = proposal
    return proposal


@app.post("/api/v1/documents/import-proposals/{proposal_id}/approve", response_model=ImportProposal)
async def approve_import(proposal_id: UUID) -> ImportProposal:
    proposal = import_proposals.get(proposal_id)
    if not proposal:
        raise HTTPException(404, "import proposal not found")
    if proposal.status == "approved":
        return proposal
    approved = proposal.model_copy(update={"status": "approved"})
    import_proposals[proposal_id] = approved
    return approved


@app.get("/api/v1/documents/{document_id}/ingestion-status")
async def ingestion_status(document_id: UUID) -> dict:
    return {"document_id": document_id, "status": "ready" if settings.demo_mode else "queued", "chunks": 0}


@app.post("/api/v1/agents/{agent}/runs")
async def run_agent(agent: str, payload: AgentRunRequest) -> dict:
    if agent not in {"coach", "tutor", "combined"}:
        raise HTTPException(404, "unknown agent")
    proposal = ActionProposal(
        id=uuid4(),
        agent="coach" if agent in {"coach", "combined"} else "tutor",
        action="create_review_task",
        payload={"title": "数据结构错题回顾", "planned_minutes": 45},
        summary="创建一个 45 分钟的数据结构错题复习任务",
    )
    action_proposals[proposal.id] = proposal
    return {
        "thread_id": payload.thread_id or str(uuid4()),
        "agent": agent,
        "answer": "已完成分析。当前运行在安全演示模式，写入动作已转换为待确认提案。",
        "proposal": proposal,
        "created_at": datetime.now(UTC),
    }


@app.post("/api/v1/proposals/{proposal_id}/{decision}", response_model=ActionProposal)
async def decide_proposal(proposal_id: UUID, decision: str) -> ActionProposal:
    if decision not in {"approve", "edit", "reject"}:
        raise HTTPException(422, "decision must be approve, edit or reject")
    proposal = action_proposals.get(proposal_id)
    if not proposal:
        raise HTTPException(404, "proposal not found")
    status = {"approve": "approved", "edit": "edited", "reject": "rejected"}[decision]
    updated = proposal.model_copy(update={"status": status})
    action_proposals[proposal_id] = updated
    return updated
