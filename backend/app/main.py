from datetime import UTC, date, datetime
from hashlib import sha256
from io import BytesIO
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from langchain_core.messages import HumanMessage
from pypdf import PdfReader

from app.agents.graph import build_graph
from app.config import get_settings
from app.schemas import (
    ActionProposal,
    AgentRunRequest,
    ContributionDay,
    ImportPreviewRequest,
    ImportProposal,
    SearchSource,
    StudySessionCreate,
    TaskCreate,
    TaskUpdate,
    WebSearchRequest,
)
from app.services.ingestion import chunk_markdown, chunk_pages, document_hash
from app.services.search import get_search_provider
from app.services.security import UnsafeUrlError, validate_public_url
from app.services.store import DemoStore, SessionOverlapError

settings = get_settings()
app = FastAPI(title="研途 API", version="0.2.0", docs_url="/docs")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

store = DemoStore()
import_proposals: dict[UUID, ImportProposal] = {}
action_proposals: dict[UUID, ActionProposal] = {}
applied_proposals: set[str] = set()
agent_graph = build_graph()
demo_documents: dict[UUID, dict] = {}
document_ids_by_hash: dict[str, UUID] = {}


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "mode": "demo" if settings.demo_mode else "cloud"}


@app.get("/api/v1/today")
async def today() -> dict:
    return {
        "date": datetime.now(UTC).date(),
        "tasks": store.list_tasks(),
        "sessions": store.list_sessions(),
    }


@app.get("/api/v1/tasks")
async def list_tasks() -> list[dict]:
    return store.list_tasks()


@app.post("/api/v1/tasks", status_code=201)
async def create_task(payload: TaskCreate) -> dict:
    return store.create_task(payload)


@app.patch("/api/v1/tasks/{task_id}")
async def update_task(task_id: UUID, payload: TaskUpdate) -> dict:
    task = store.update_task(task_id, payload)
    if not task:
        raise HTTPException(404, "task not found")
    return task


@app.get("/api/v1/sessions")
async def list_sessions() -> list[dict]:
    return store.list_sessions()


@app.post("/api/v1/sessions", status_code=201)
async def create_session(payload: StudySessionCreate) -> dict:
    if payload.ended_at <= payload.started_at:
        raise HTTPException(422, "ended_at must be later than started_at")
    try:
        return store.create_session(payload)
    except SessionOverlapError as error:
        raise HTTPException(409, str(error)) from error


@app.get("/api/v1/analytics/contributions", response_model=list[ContributionDay])
async def contributions(
    from_date: Annotated[date, Query(alias="from")],
    to_date: Annotated[date, Query(alias="to")],
    scope: str = "all",
) -> list[ContributionDay]:
    if to_date < from_date or (to_date - from_date).days > 370:
        raise HTTPException(422, "date range must be between 0 and 370 days")
    if scope not in {"all", "math", "english", "politics", "cs408", "career"}:
        raise HTTPException(422, "unknown contribution scope")
    return store.contributions(from_date, to_date, scope)


@app.post("/api/v1/search/web", response_model=list[SearchSource])
async def web_search(payload: WebSearchRequest) -> list[SearchSource]:
    provider = get_search_provider(settings)
    results = await provider.search(payload.query, payload.include_domains)
    return [
        SearchSource(
            title=item.title, url=item.url, snippet=item.snippet, accessed_at=item.accessed_at
        )
        for item in results
    ]


@app.post("/api/v1/documents/import-preview", response_model=ImportProposal)
async def preview_import(payload: ImportPreviewRequest) -> ImportProposal:
    try:
        validate_public_url(str(payload.url))
    except UnsafeUrlError as error:
        raise HTTPException(422, str(error)) from error
    proposal = ImportProposal(
        id=uuid4(),
        url=payload.url,
        title="待导入网络资料",
        summary="系统将在批准后下载、去重、解析并建立混合检索索引。",
        content_type="text/html",
    )
    import_proposals[proposal.id] = proposal
    return proposal


@app.post("/api/v1/documents/upload", status_code=201)
async def upload_document(file: Annotated[UploadFile, File()]) -> dict:
    content = await file.read(25 * 1024 * 1024 + 1)
    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(413, "document exceeds the 25 MB limit")
    filename = file.filename or "未命名资料"
    suffix = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if suffix not in {"pdf", "md", "markdown"}:
        raise HTTPException(415, "only PDF and Markdown files are supported")

    digest = document_hash(content)
    existing_id = document_ids_by_hash.get(digest)
    if existing_id:
        return {**demo_documents[existing_id], "duplicate": True}

    if suffix == "pdf":
        try:
            pages = [(page.extract_text() or "") for page in PdfReader(BytesIO(content)).pages]
        except Exception as error:
            raise HTTPException(422, "PDF could not be parsed") from error
        chunks = chunk_pages(pages)
        text_chars = sum(len(page.strip()) for page in pages)
        status = "ocr_required" if text_chars < max(120, len(pages) * 40) else "ready"
    else:
        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError as error:
            raise HTTPException(422, "Markdown must be UTF-8 encoded") from error
        chunks = chunk_markdown(text)
        status = "ready"

    document_id = uuid4()
    item = {
        "id": document_id,
        "title": filename.rsplit(".", 1)[0],
        "original_filename": filename,
        "content_type": file.content_type or "application/octet-stream",
        "byte_size": len(content),
        "sha256": digest,
        "ingestion_status": status,
        "chunk_count": len(chunks),
        "flagged_chunk_count": sum(chunk.flagged_untrusted_instruction for chunk in chunks),
        "duplicate": False,
    }
    demo_documents[document_id] = item
    document_ids_by_hash[digest] = document_id
    return item


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
    document = demo_documents.get(document_id)
    if not document:
        raise HTTPException(404, "document not found")
    return {
        "document_id": document_id,
        "status": document["ingestion_status"],
        "chunks": document["chunk_count"],
        "flagged_chunks": document["flagged_chunk_count"],
    }


@app.post("/api/v1/agents/{agent}/runs")
async def run_agent(agent: str, payload: AgentRunRequest) -> dict:
    if agent not in {"coach", "tutor", "combined"}:
        raise HTTPException(404, "unknown agent")
    result = await agent_graph.ainvoke(
        {
            "messages": [HumanMessage(content=payload.message)],
            "requested_route": agent,
        }
    )
    idempotency_key = sha256(f"{payload.thread_id}:{agent}:{payload.message}".encode()).hexdigest()
    proposal = ActionProposal(
        id=uuid4(),
        agent="coach" if agent in {"coach", "combined"} else "tutor",
        action="create_review_task",
        payload={"title": "数据结构错题回顾", "planned_minutes": 45},
        summary="创建一个 45 分钟的数据结构错题复习任务",
        idempotency_key=idempotency_key,
    )
    action_proposals[proposal.id] = proposal
    return {
        "thread_id": payload.thread_id or str(uuid4()),
        "agent": agent,
        "answer": result.get("answer", "已完成分析。写入动作已转换为待确认提案。"),
        "route": result.get("route", agent),
        "retrieval_mode": result.get("retrieval_mode", "private"),
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
    if decision == "approve":
        if proposal.idempotency_key not in applied_proposals:
            task_payload = TaskCreate(
                title=str(proposal.payload.get("title", "Agent 复习任务")),
                subject="cs408",
                planned_minutes=int(proposal.payload.get("planned_minutes", 45)),
            )
            store.create_task(task_payload)
            applied_proposals.add(proposal.idempotency_key)
        status = "applied"
    else:
        status = {"edit": "edited", "reject": "rejected"}[decision]
    updated = proposal.model_copy(update={"status": status})
    action_proposals[proposal_id] = updated
    return updated
