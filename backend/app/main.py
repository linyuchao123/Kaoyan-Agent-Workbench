import logging
from datetime import UTC, date, datetime
from hashlib import sha256
from io import BytesIO
from typing import Annotated, Literal
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import httpx
from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from langchain_core.messages import HumanMessage
from pypdf import PdfReader

from app.agents.context import build_agent_context
from app.agents.graph import build_graph
from app.agents.model import OpenAICompatibleAgentModel
from app.auth import AuthUser, get_current_user
from app.config import get_settings
from app.schemas import (
    ActionProposal,
    AgentProposalEditRequest,
    AgentRunRequest,
    CareerItemCreate,
    CareerItemType,
    CareerItemUpdate,
    CareerStatus,
    ContributionDay,
    ImportPreviewRequest,
    ImportProposal,
    MistakeCardCreate,
    MistakeReviewCreate,
    PlanCreate,
    PlanLevel,
    PlanProgress,
    PlanUpdate,
    PrivateKnowledgeSource,
    SchoolOptionCreate,
    SchoolOptionUpdate,
    SearchSource,
    StudySessionCreate,
    TaskCreate,
    TaskUpdate,
    WebSearchRequest,
)
from app.services.exporting import render_csv_export, render_json_export, render_markdown_export
from app.services.ingestion import chunk_markdown, chunk_pages, document_hash
from app.services.rag import choose_retrieval_mode
from app.services.repository import (
    RepositoryConflictError,
    RepositoryError,
    RepositoryValidationError,
    build_repository,
)
from app.services.search import get_search_provider
from app.services.security import UnsafeUrlError, validate_public_url
from app.services.store import SessionOverlapError
from app.services.web_import import download_public_document

settings = get_settings()
logger = logging.getLogger(__name__)
app = FastAPI(title="研途 API", version="0.7.0", docs_url="/docs")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

repository = build_repository(settings)
agent_model = OpenAICompatibleAgentModel(settings)
agent_graph = build_graph(agent_model)
search_provider = get_search_provider(settings)


@app.exception_handler(RepositoryError)
async def repository_error_handler(_: Request, error: RepositoryError) -> JSONResponse:
    logger.error("Repository request failed: %s", error)
    if isinstance(error, RepositoryConflictError):
        status = 409
    elif isinstance(error, RepositoryValidationError):
        status = 422
    else:
        status = 502
    return JSONResponse(status_code=status, content={"detail": str(error)})


@app.get("/health")
async def health() -> dict[str, str]:
    return {
        "status": "ok",
        "mode": repository.mode,
        "auth": "configured"
        if settings.supabase_url and settings.supabase_anon_key
        else "unconfigured",
    }


def prepare_document_chunks(content: bytes, content_type: str):
    if content_type == "application/pdf":
        try:
            pages = [(page.extract_text() or "") for page in PdfReader(BytesIO(content)).pages]
        except Exception as error:
            raise HTTPException(422, "PDF could not be parsed") from error
        chunks = chunk_pages(pages)
        text_chars = sum(len(page.strip()) for page in pages)
        status = "ocr_required" if text_chars < max(120, len(pages) * 40) else "ready"
        return chunks, status
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError as error:
        raise HTTPException(422, "text document must be UTF-8 encoded") from error
    return chunk_markdown(text), "ready"


@app.get("/api/v1/today")
async def today(user: Annotated[AuthUser, Depends(get_current_user)]) -> dict:
    return {
        "date": datetime.now(ZoneInfo("Asia/Shanghai")).date(),
        "tasks": await repository.list_tasks(user),
        "sessions": await repository.list_sessions(user),
    }


@app.get("/api/v1/tasks")
async def list_tasks(user: Annotated[AuthUser, Depends(get_current_user)]) -> list[dict]:
    return await repository.list_tasks(user)


@app.get("/api/v1/plans")
async def list_plans(
    user: Annotated[AuthUser, Depends(get_current_user)],
    level: PlanLevel | None = None,
) -> list[dict]:
    return await repository.list_plans(user, level)


@app.post("/api/v1/plans", status_code=201)
async def create_plan(
    payload: PlanCreate,
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict:
    return await repository.create_plan(user, payload)


@app.patch("/api/v1/plans/{plan_id}")
async def update_plan(
    plan_id: UUID,
    payload: PlanUpdate,
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict:
    plan = await repository.update_plan(user, plan_id, payload)
    if not plan:
        raise HTTPException(404, "plan not found")
    return plan


@app.delete("/api/v1/plans/{plan_id}", status_code=204)
async def delete_plan(
    plan_id: UUID,
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> Response:
    if not await repository.delete_plan(user, plan_id):
        raise HTTPException(404, "plan not found")
    return Response(status_code=204)


@app.get("/api/v1/plans/{plan_id}/progress")
async def get_plan_progress(
    plan_id: UUID,
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> PlanProgress:
    progress = await repository.plan_progress(user, plan_id)
    if not progress:
        raise HTTPException(404, "plan not found")
    return progress


@app.post("/api/v1/tasks", status_code=201)
async def create_task(
    payload: TaskCreate, user: Annotated[AuthUser, Depends(get_current_user)]
) -> dict:
    return await repository.create_task(user, payload)


@app.patch("/api/v1/tasks/{task_id}")
async def update_task(
    task_id: UUID,
    payload: TaskUpdate,
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict:
    task = await repository.update_task(user, task_id, payload)
    if not task:
        raise HTTPException(404, "task not found")
    return task


@app.get("/api/v1/sessions")
async def list_sessions(user: Annotated[AuthUser, Depends(get_current_user)]) -> list[dict]:
    return await repository.list_sessions(user)


@app.post("/api/v1/sessions", status_code=201)
async def create_session(
    payload: StudySessionCreate,
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict:
    if payload.ended_at <= payload.started_at:
        raise HTTPException(422, "ended_at must be later than started_at")
    try:
        return await repository.create_session(user, payload)
    except SessionOverlapError as error:
        raise HTTPException(409, str(error)) from error


@app.get("/api/v1/mistakes")
async def list_mistakes(
    user: Annotated[AuthUser, Depends(get_current_user)],
    due_only: bool = False,
) -> list[dict]:
    return await repository.list_mistakes(user, due_only)


@app.post("/api/v1/mistakes", status_code=201)
async def create_mistake(
    payload: MistakeCardCreate,
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict:
    return await repository.create_mistake(user, payload)


@app.post("/api/v1/mistakes/{card_id}/reviews")
async def review_mistake(
    card_id: UUID,
    payload: MistakeReviewCreate,
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict:
    card = await repository.review_mistake(user, card_id, payload)
    if not card:
        raise HTTPException(404, "mistake card not found")
    return card


@app.get("/api/v1/schools")
async def list_school_options(
    user: Annotated[AuthUser, Depends(get_current_user)],
    tier: str | None = None,
    exam_year: Annotated[int | None, Query(ge=2026, le=2100)] = None,
) -> list[dict]:
    if tier not in {None, "stretch", "match", "safety"}:
        raise HTTPException(422, "unknown school tier")
    return await repository.list_school_options(user, tier, exam_year)


@app.post("/api/v1/schools", status_code=201)
async def create_school_option(
    payload: SchoolOptionCreate,
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict:
    return await repository.create_school_option(user, payload)


@app.patch("/api/v1/schools/{option_id}")
async def update_school_option(
    option_id: UUID,
    payload: SchoolOptionUpdate,
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict:
    option = await repository.update_school_option(user, option_id, payload)
    if not option:
        raise HTTPException(404, "school option not found")
    return option


@app.delete("/api/v1/schools/{option_id}", status_code=204)
async def delete_school_option(
    option_id: UUID,
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> Response:
    if not await repository.delete_school_option(user, option_id):
        raise HTTPException(404, "school option not found")
    return Response(status_code=204)


@app.get("/api/v1/career-items")
async def list_career_items(
    user: Annotated[AuthUser, Depends(get_current_user)],
    item_type: CareerItemType | None = None,
    status: CareerStatus | None = None,
) -> list[dict]:
    return await repository.list_career_items(user, item_type, status)


@app.post("/api/v1/career-items", status_code=201)
async def create_career_item(
    payload: CareerItemCreate,
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict:
    return await repository.create_career_item(user, payload)


@app.patch("/api/v1/career-items/{item_id}")
async def update_career_item(
    item_id: UUID,
    payload: CareerItemUpdate,
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict:
    item = await repository.update_career_item(user, item_id, payload)
    if not item:
        raise HTTPException(404, "career item not found")
    return item


@app.delete("/api/v1/career-items/{item_id}", status_code=204)
async def delete_career_item(
    item_id: UUID,
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> Response:
    if not await repository.delete_career_item(user, item_id):
        raise HTTPException(404, "career item not found")
    return Response(status_code=204)


@app.get("/api/v1/export")
async def export_user_data(
    user: Annotated[AuthUser, Depends(get_current_user)],
    format: Literal["json", "csv", "markdown"] = "json",
) -> Response:
    plans = await repository.list_plans(user)
    tasks = await repository.list_tasks(user)
    sessions = await repository.list_sessions(user)
    mistakes = await repository.list_mistakes(user)
    schools = await repository.list_school_options(user)
    career_items = await repository.list_career_items(user)
    exported_at = datetime.now(UTC).isoformat()
    payload = {
        "metadata": {
            "schema_version": "2026-08-v1",
            "exported_at": exported_at,
            "timezone": "Asia/Shanghai",
        },
        "data": {
            "plans": plans,
            "tasks": tasks,
            "study_sessions": sessions,
            "mistake_cards": mistakes,
            "school_options": schools,
            "career_items": career_items,
        },
    }
    date_stamp = datetime.now(ZoneInfo("Asia/Shanghai")).date().isoformat()
    if format == "csv":
        body, media_type, suffix = render_csv_export(payload), "text/csv; charset=utf-8", "csv"
    elif format == "markdown":
        body, media_type, suffix = (
            render_markdown_export(payload),
            "text/markdown; charset=utf-8",
            "md",
        )
    else:
        body, media_type, suffix = render_json_export(payload), "application/json", "json"
    return Response(
        content=body,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="yantu-export-{date_stamp}.{suffix}"'
        },
    )


@app.get("/api/v1/analytics/contributions", response_model=list[ContributionDay])
async def contributions(
    from_date: Annotated[date, Query(alias="from")],
    to_date: Annotated[date, Query(alias="to")],
    user: Annotated[AuthUser, Depends(get_current_user)],
    scope: str = "all",
) -> list[ContributionDay]:
    if to_date < from_date or (to_date - from_date).days > 370:
        raise HTTPException(422, "date range must be between 0 and 370 days")
    if scope not in {"all", "math", "english", "politics", "cs408", "career"}:
        raise HTTPException(422, "unknown contribution scope")
    return await repository.contributions(user, from_date, to_date, scope)


@app.post("/api/v1/search/web", response_model=list[SearchSource])
async def web_search(
    payload: WebSearchRequest, _: Annotated[AuthUser, Depends(get_current_user)]
) -> list[SearchSource]:
    results = await search_provider.search(payload.query, payload.include_domains)
    return [
        SearchSource(
            title=item.title, url=item.url, snippet=item.snippet, accessed_at=item.accessed_at
        )
        for item in results
    ]


@app.post("/api/v1/documents/import-preview", response_model=ImportProposal)
async def preview_import(
    payload: ImportPreviewRequest,
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> ImportProposal:
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
    return await repository.create_import_proposal(user, proposal)


@app.post("/api/v1/documents/upload", status_code=201)
async def upload_document(
    file: Annotated[UploadFile, File()],
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict:
    content = await file.read(25 * 1024 * 1024 + 1)
    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(413, "document exceeds the 25 MB limit")
    filename = (file.filename or "未命名资料").replace("\\", "/").rsplit("/", 1)[-1]
    suffix = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if suffix not in {"pdf", "md", "markdown"}:
        raise HTTPException(415, "only PDF and Markdown files are supported")

    content_type = "application/pdf" if suffix == "pdf" else "text/markdown"
    chunks, status = prepare_document_chunks(content, content_type)
    item, duplicate = await repository.persist_document(
        user,
        document_id=uuid4(),
        filename=filename,
        content_type=content_type,
        content=content,
        digest=document_hash(content),
        ingestion_status=status,
        chunks=chunks,
    )
    return {**item, "duplicate": duplicate}


@app.get("/api/v1/documents")
async def list_documents(user: Annotated[AuthUser, Depends(get_current_user)]) -> list[dict]:
    return await repository.list_documents(user)


@app.get(
    "/api/v1/knowledge/private-search",
    response_model=list[PrivateKnowledgeSource],
)
async def search_private_knowledge(
    user: Annotated[AuthUser, Depends(get_current_user)],
    query: Annotated[str, Query(min_length=2, max_length=500)],
    limit: Annotated[int, Query(ge=1, le=20)] = 8,
    document_id: UUID | None = None,
) -> list[PrivateKnowledgeSource]:
    return await repository.search_private_knowledge(
        user,
        query,
        limit,
        [document_id] if document_id else None,
    )


@app.post("/api/v1/documents/import-proposals/{proposal_id}/approve")
async def approve_import(
    proposal_id: UUID, user: Annotated[AuthUser, Depends(get_current_user)]
) -> dict:
    proposal = await repository.get_import_proposal(user, proposal_id)
    if not proposal:
        raise HTTPException(404, "import proposal not found")
    try:
        downloaded = await download_public_document(str(proposal.url))
    except UnsafeUrlError as error:
        raise HTTPException(422, str(error)) from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    except httpx.HTTPError as error:
        raise HTTPException(502, "web document download failed") from error

    filename = downloaded.filename.replace("\\", "_").replace("/", "_")[:180]
    chunks, status = prepare_document_chunks(downloaded.content, downloaded.content_type)
    document, duplicate = await repository.persist_document(
        user,
        document_id=uuid4(),
        filename=filename,
        content_type=downloaded.content_type,
        content=downloaded.content,
        digest=document_hash(downloaded.content),
        ingestion_status=status,
        chunks=chunks,
        source_url=downloaded.final_url,
        title=downloaded.title,
    )
    approved = await repository.approve_import_proposal(user, proposal_id)
    if not approved:
        raise HTTPException(404, "import proposal not found")
    return {"proposal": approved, "document": document, "duplicate": duplicate}


@app.get("/api/v1/documents/{document_id}/ingestion-status")
async def ingestion_status(
    document_id: UUID, user: Annotated[AuthUser, Depends(get_current_user)]
) -> dict:
    document = await repository.get_document(user, document_id)
    if not document:
        raise HTTPException(404, "document not found")
    return {
        "document_id": document_id,
        "status": document["ingestion_status"],
        "chunks": document["chunk_count"],
        "flagged_chunks": document["flagged_chunk_count"],
    }


@app.post("/api/v1/agents/{agent}/runs")
async def run_agent(
    agent: str,
    payload: AgentRunRequest,
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict:
    if agent not in {"coach", "tutor", "combined"}:
        raise HTTPException(404, "unknown agent")
    retrieval_mode = choose_retrieval_mode(payload.message)
    context = await build_agent_context(
        repository,
        user,
        message=payload.message,
        route=agent,
        retrieval_mode=retrieval_mode,
        search_provider=search_provider,
    )
    result = await agent_graph.ainvoke(
        {
            "messages": [HumanMessage(content=payload.message)],
            "requested_route": agent,
            "user_id": str(user.id),
            "context": context,
        }
    )
    proposal_id = uuid4()
    idempotency_key = sha256(
        f"{payload.thread_id}:{proposal_id}:{agent}:{payload.message}".encode()
    ).hexdigest()
    priority = (
        context["due_mistakes"][0]
        if context["due_mistakes"]
        else context["pending_tasks"][0]
        if context["pending_tasks"]
        else None
    )
    proposal_title = f"{priority['title']}复习" if priority else "建立今日学习任务"
    proposal_subject = str(priority.get("subject", "cs408")) if priority else "cs408"
    proposal = ActionProposal(
        id=proposal_id,
        agent="coach" if agent in {"coach", "combined"} else "tutor",
        action="create_review_task",
        payload={"title": proposal_title, "subject": proposal_subject, "planned_minutes": 45},
        summary=f"创建一个 45 分钟的「{proposal_title}」任务",
        idempotency_key=idempotency_key,
    )
    thread_id, proposal = await repository.create_agent_proposal(
        user,
        thread_id=payload.thread_id,
        mode=agent,
        proposal=proposal,
    )
    return {
        "thread_id": thread_id,
        "agent": agent,
        "answer": result.get("answer", "已完成分析。写入动作已转换为待确认提案。"),
        "route": result.get("route", agent),
        "retrieval_mode": result.get("retrieval_mode", "private"),
        "model_status": result.get("model_status", "fallback"),
        "sources": [
            {
                "source_type": "private",
                "title": source["title"],
                "locator": source["locator"],
                "url": None,
                "accessed_at": None,
            }
            for source in context["private_sources"]
        ]
        + [
            {
                "source_type": "web",
                "title": source["title"],
                "locator": source["url"],
                "url": source["url"],
                "accessed_at": source["accessed_at"],
            }
            for source in context["web_sources"]
        ],
        "proposal": proposal,
        "created_at": datetime.now(UTC),
    }


@app.post("/api/v1/proposals/{proposal_id}/{decision}", response_model=ActionProposal)
async def decide_proposal(
    proposal_id: UUID,
    decision: str,
    user: Annotated[AuthUser, Depends(get_current_user)],
    payload: AgentProposalEditRequest | None = None,
) -> ActionProposal:
    if decision not in {"approve", "edit", "reject"}:
        raise HTTPException(422, "decision must be approve, edit or reject")
    if decision == "edit" and payload is None:
        raise HTTPException(422, "edited proposal payload is required")
    proposal = await repository.decide_agent_proposal(
        user,
        proposal_id,
        decision,
        payload.model_dump(mode="json") if payload else None,
    )
    if not proposal:
        raise HTTPException(404, "proposal not found")
    return proposal
