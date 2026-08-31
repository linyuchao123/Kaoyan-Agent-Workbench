import asyncio
import json
import logging
from datetime import UTC, date, datetime, timedelta
from hashlib import sha256
from io import BytesIO
from time import perf_counter
from typing import Annotated, Literal, cast
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import httpx
from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from langchain_core.messages import HumanMessage
from pypdf import PdfReader

from app.agents.context import AgentContext, build_agent_context
from app.agents.graph import build_graph, coach_fallback, tutor_fallback
from app.agents.model import AgentModelConfigurationError, OpenAICompatibleAgentModel
from app.auth import AuthUser, get_current_user
from app.config import get_settings
from app.domain.dashboard import (
    active_stage_title,
    attach_task_actual_minutes,
    build_dashboard_metrics,
    select_today_tasks,
)
from app.domain.subjects import build_subject_summaries
from app.schemas import (
    ActionProposal,
    AgentCitation,
    AgentModelUsageSummary,
    AgentProposalEditRequest,
    AgentRunRequest,
    AgentThreadHistory,
    AgentThreadSummary,
    CareerItemCreate,
    CareerItemType,
    CareerItemUpdate,
    CareerStatus,
    ContributionDay,
    DashboardMetrics,
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
    SubjectSummary,
    TaskCreate,
    TaskUpdate,
    WebSearchRecord,
    WebSearchRequest,
)
from app.services.embeddings import OpenAICompatibleEmbeddingProvider
from app.services.exporting import render_csv_export, render_json_export, render_markdown_export
from app.services.ingestion import chunk_markdown, chunk_pages, document_hash, embed_safe_chunks
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
from app.workers.ocr import OpenAIVisionOcrProvider

settings = get_settings()
logger = logging.getLogger(__name__)
app = FastAPI(title="研途 API", version="0.9.0", docs_url="/docs")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

repository = build_repository(settings)
agent_model = OpenAICompatibleAgentModel(settings)
embedding_provider = OpenAICompatibleEmbeddingProvider(settings)
ocr_provider = OpenAIVisionOcrProvider(settings)
agent_graph = build_graph(agent_model)
search_provider = get_search_provider(settings)

WRITE_INTENT_MARKERS = ("安排", "创建", "添加", "生成任务", "调整计划", "写入", "建立任务")


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


@app.exception_handler(AgentModelConfigurationError)
async def agent_model_configuration_error_handler(
    _: Request, error: AgentModelConfigurationError
) -> JSONResponse:
    logger.error("Agent model configuration failed: %s", error)
    return JSONResponse(status_code=502, content={"detail": str(error)})


@app.get("/health")
async def health() -> dict[str, object]:
    model_configured = agent_model.configured
    web_search_configured = search_provider.configured
    if model_configured and web_search_configured:
        agent_mode = "live"
    elif model_configured or web_search_configured:
        agent_mode = "partial"
    else:
        agent_mode = "fallback"
    return {
        "status": "ok",
        "mode": repository.mode,
        "auth": "configured"
        if settings.supabase_url and settings.supabase_anon_key
        else "unconfigured",
        "agent": {
            "mode": agent_mode,
            "model_configured": model_configured,
            "primary_model_configured": agent_model.primary_configured,
            "fallback_model_configured": agent_model.fallback_configured,
            "primary_provider": settings.chat_provider,
            "fallback_provider": settings.chat_fallback_provider,
            "default_profile": settings.chat_default_profile,
            "web_search_configured": web_search_configured,
        },
        "rag": {
            "mode": "hybrid" if embedding_provider.configured else "keyword",
            "embedding_configured": embedding_provider.configured,
            "embedding_provider": embedding_provider.provider,
            "embedding_model": embedding_provider.model,
            "embedding_dimensions": embedding_provider.dimensions,
            "embedding_version": embedding_provider.version,
        },
        "ocr": {
            "configured": ocr_provider.configured,
            "provider": settings.ocr_provider,
            "model": settings.ocr_model,
            "fallback_model": settings.ocr_fallback_model,
            "renderer_configured": bool(ocr_provider.pdftoppm_path),
        },
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


async def queue_document_ocr(user: AuthUser, document_id: UUID):
    try:
        return await repository.enqueue_document_ocr(user, document_id)
    except RepositoryError as error:
        logger.warning("Document was saved but its OCR job could not be queued: %s", error)
        return None


def shanghai_now() -> datetime:
    return datetime.now(ZoneInfo("Asia/Shanghai"))


def shanghai_today() -> date:
    return shanghai_now().date()


@app.get("/api/v1/today")
async def today(user: Annotated[AuthUser, Depends(get_current_user)]) -> dict:
    current_date = shanghai_today()
    contribution_start = current_date - timedelta(days=364)
    tasks, sessions, plans, contribution_days = await asyncio.gather(
        repository.list_tasks(user),
        repository.list_sessions(user),
        repository.list_plans(user),
        repository.contributions(user, contribution_start, current_date, "all"),
    )
    day_plans = [plan for plan in plans if plan.get("level") == "day"]
    today_tasks = select_today_tasks(
        today=current_date,
        tasks=tasks,
        day_plans=day_plans,
    )
    today_tasks = attach_task_actual_minutes(tasks=today_tasks, sessions=sessions)
    metrics: DashboardMetrics = build_dashboard_metrics(
        today=current_date,
        tasks=tasks,
        day_plans=day_plans,
        contributions=contribution_days,
        today_tasks=today_tasks,
        stage_title=active_stage_title(today=current_date, plans=plans),
    )
    return {
        "date": current_date,
        "tasks": today_tasks,
        "sessions": sessions,
        "metrics": metrics,
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


@app.delete("/api/v1/tasks/{task_id}", status_code=204)
async def delete_task(
    task_id: UUID,
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> Response:
    if not await repository.delete_task(user, task_id):
        raise HTTPException(404, "task not found")
    return Response(status_code=204)


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


@app.delete("/api/v1/sessions/{session_id}", status_code=204)
async def delete_session(
    session_id: UUID,
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> Response:
    if not await repository.delete_session(user, session_id):
        raise HTTPException(404, "study session not found")
    return Response(status_code=204)


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


@app.get("/api/v1/analytics/subjects", response_model=list[SubjectSummary])
async def subject_summaries(
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> list[SubjectSummary]:
    current_time = shanghai_now()
    current_date = current_time.date()
    tasks, mistakes, contribution_days = await asyncio.gather(
        repository.list_tasks(user),
        repository.list_mistakes(user),
        repository.contributions(
            user,
            current_date - timedelta(days=364),
            current_date,
            "all",
        ),
    )
    return build_subject_summaries(
        today=current_date,
        now=current_time,
        tasks=tasks,
        mistakes=mistakes,
        contributions=contribution_days,
    )


@app.get("/api/v1/analytics/model-usage", response_model=AgentModelUsageSummary)
async def model_usage(
    user: Annotated[AuthUser, Depends(get_current_user)],
    days: Annotated[int, Query(ge=1, le=365)] = 30,
) -> AgentModelUsageSummary:
    summary = await repository.agent_model_usage_summary(user, days=days)
    estimated_cost = 0.0
    has_unpriced_usage = False
    for item in summary.breakdown:
        prices = settings.chat_token_prices(item.provider, item.model_profile)
        if prices is None:
            has_unpriced_usage = has_unpriced_usage or item.request_count > 0
            continue
        input_price, output_price = prices
        estimated_cost += item.input_tokens * input_price / 1_000_000
        estimated_cost += item.output_tokens * output_price / 1_000_000
    if summary.total_requests and not has_unpriced_usage:
        summary.estimated_cost = round(estimated_cost, 6)
        summary.cost_note = "按本地配置的每百万 Token 单价估算，最终以供应商账单为准"
    return summary


@app.post("/api/v1/search/web", response_model=list[SearchSource])
async def web_search(
    payload: WebSearchRequest, user: Annotated[AuthUser, Depends(get_current_user)]
) -> list[SearchSource]:
    results = await search_provider.search(payload.query, payload.include_domains)
    sources = [
        SearchSource(
            title=item.title, url=item.url, snippet=item.snippet, accessed_at=item.accessed_at
        )
        for item in results
    ]
    try:
        await repository.record_web_search(
            user,
            query=payload.query,
            provider=search_provider.name,
            results=sources,
        )
    except RepositoryError:
        logger.warning("Web search succeeded but its history record could not be persisted")
    return sources


@app.get("/api/v1/search/web/history", response_model=list[WebSearchRecord])
async def web_search_history(
    user: Annotated[AuthUser, Depends(get_current_user)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> list[WebSearchRecord]:
    return await repository.list_web_search_records(user, limit)


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
    if status == "ready":
        chunks = await embed_safe_chunks(chunks, embedding_provider)
    embedding_metadata = (
        embedding_provider.descriptor
        if any(chunk.embedding is not None for chunk in chunks)
        else None
    )
    document_id = uuid4()
    item, duplicate = await repository.persist_document(
        user,
        document_id=document_id,
        filename=filename,
        content_type=content_type,
        content=content,
        digest=document_hash(content),
        ingestion_status=status,
        chunks=chunks,
        embedding_metadata=embedding_metadata,
    )
    ocr_job = (
        await queue_document_ocr(user, document_id)
        if status == "ocr_required" and not duplicate
        else None
    )
    return {**item, "duplicate": duplicate, "ocr_job": ocr_job}


@app.get("/api/v1/documents")
async def list_documents(user: Annotated[AuthUser, Depends(get_current_user)]) -> list[dict]:
    return await repository.list_documents(user)


@app.post("/api/v1/documents/{document_id}/reindex")
async def reindex_document(
    document_id: UUID, user: Annotated[AuthUser, Depends(get_current_user)]
) -> dict:
    document = await repository.get_document(user, document_id)
    if not document:
        raise HTTPException(404, "document not found")

    content = await repository.read_document_content(user, document_id)
    chunks, status = prepare_document_chunks(content, str(document["content_type"]))
    if status == "ocr_required":
        ocr_job = await repository.enqueue_document_reindex_ocr(user, document_id)
        updated = await repository.get_document(user, document_id)
        return {**(updated or document), "reindex_status": "ocr_queued", "ocr_job": ocr_job}

    chunks = await embed_safe_chunks(chunks, embedding_provider)
    embedding_metadata = (
        embedding_provider.descriptor
        if any(chunk.embedding is not None for chunk in chunks)
        else None
    )
    updated = await repository.replace_document_chunks(
        user,
        document_id,
        chunks,
        embedding_metadata,
    )
    if not updated:
        raise HTTPException(404, "document not found")
    return {**updated, "reindex_status": "ready", "ocr_job": None}


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
    query_embedding = await embedding_provider.embed_query(query)
    return await repository.search_private_knowledge(
        user,
        query,
        limit,
        [document_id] if document_id else None,
        query_embedding,
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
    if status == "ready":
        chunks = await embed_safe_chunks(chunks, embedding_provider)
    embedding_metadata = (
        embedding_provider.descriptor
        if any(chunk.embedding is not None for chunk in chunks)
        else None
    )
    document_id = uuid4()
    document, duplicate = await repository.persist_document(
        user,
        document_id=document_id,
        filename=filename,
        content_type=downloaded.content_type,
        content=downloaded.content,
        digest=document_hash(downloaded.content),
        ingestion_status=status,
        chunks=chunks,
        source_url=downloaded.final_url,
        title=downloaded.title,
        embedding_metadata=embedding_metadata,
    )
    ocr_job = (
        await queue_document_ocr(user, document_id)
        if status == "ocr_required" and not duplicate
        else None
    )
    approved = await repository.approve_import_proposal(user, proposal_id)
    if not approved:
        raise HTTPException(404, "import proposal not found")
    return {
        "proposal": approved,
        "document": document,
        "duplicate": duplicate,
        "ocr_job": ocr_job,
    }


@app.get("/api/v1/documents/{document_id}/ingestion-status")
async def ingestion_status(
    document_id: UUID, user: Annotated[AuthUser, Depends(get_current_user)]
) -> dict:
    document = await repository.get_document(user, document_id)
    if not document:
        raise HTTPException(404, "document not found")
    ocr_job = await repository.get_document_ocr_job(user, document_id)
    return {
        "document_id": document_id,
        "status": document["ingestion_status"],
        "chunks": document["chunk_count"],
        "flagged_chunks": document["flagged_chunk_count"],
        "ocr_job": ocr_job,
    }


@app.post("/api/v1/documents/{document_id}/ocr/retry")
async def retry_document_ocr(
    document_id: UUID, user: Annotated[AuthUser, Depends(get_current_user)]
):
    document = await repository.get_document(user, document_id)
    if not document:
        raise HTTPException(404, "document not found")
    if (
        document["ingestion_status"] not in {"ocr_required", "failed"}
        and not document.get("ocr_failed_pages")
    ):
        raise HTTPException(409, "document does not require OCR")
    return await repository.enqueue_document_ocr(user, document_id)


async def prepare_agent_execution(
    agent: Literal["coach", "tutor", "combined"],
    payload: AgentRunRequest,
    user: AuthUser,
) -> tuple[str, AgentContext, UUID, ActionProposal | None]:
    retrieval_mode = choose_retrieval_mode(payload.message)
    query_embedding = (
        await embedding_provider.embed_query(payload.message)
        if agent in {"tutor", "combined"} and retrieval_mode in {"private", "hybrid"}
        else None
    )
    context = await build_agent_context(
        repository,
        user,
        message=payload.message,
        route=agent,
        retrieval_mode=retrieval_mode,
        search_provider=search_provider,
        query_embedding=query_embedding,
    )
    wants_write = agent == "coach" or (
        agent == "combined"
        and any(marker in payload.message for marker in WRITE_INTENT_MARKERS)
    )
    proposal: ActionProposal | None = None
    if wants_write:
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
        requested_proposal = ActionProposal(
            id=proposal_id,
            agent="coach",
            action="create_review_task",
            payload={
                "title": proposal_title,
                "subject": proposal_subject,
                "planned_minutes": 45,
            },
            summary=f"创建一个 45 分钟的「{proposal_title}」任务",
            idempotency_key=idempotency_key,
        )
        thread_id, proposal = await repository.create_agent_proposal(
            user,
            thread_id=payload.thread_id,
            mode=agent,
            proposal=requested_proposal,
        )
    else:
        thread_id = await repository.ensure_agent_thread(
            user,
            thread_id=payload.thread_id,
            mode=agent,
            title=payload.message[:160],
        )
    await repository.set_agent_thread_model_profile(
        user,
        thread_id=thread_id,
        model_profile=payload.model_profile,
    )
    return retrieval_mode, context, thread_id, proposal


def agent_citations(context: AgentContext) -> list[AgentCitation]:
    return [
        AgentCitation(
            source_type="private",
            title=source["title"],
            locator=source["locator"],
        )
        for source in context["private_sources"]
    ] + [
        AgentCitation(
            source_type="web",
            title=source["title"],
            locator=source["url"],
            url=source["url"],
            accessed_at=source["accessed_at"],
        )
        for source in context["web_sources"]
    ]


async def persist_agent_exchange(
    *,
    user: AuthUser,
    thread_id: UUID,
    message: str,
    answer: str,
    sources: list[AgentCitation],
    route: str,
    retrieval_mode: str,
    model_status: str,
    model_profile: str,
    provider: str,
    model: str,
    fallback_used: bool,
    model_runs: list[dict],
) -> None:
    try:
        await repository.append_agent_exchange(
            user,
            thread_id=thread_id,
            user_message=message,
            agent_message=answer,
            sources=sources,
            metadata={
                "route": route,
                "retrieval_mode": retrieval_mode,
                "model_status": model_status,
                "model_profile": model_profile,
                "provider": provider,
                "model": model,
                "fallback_used": fallback_used,
                "model_runs": model_runs,
            },
        )
    except RepositoryError:
        logger.warning("Agent run succeeded but its message history could not be persisted")


async def record_model_usage_safely(
    *,
    user: AuthUser,
    thread_id: UUID,
    model_profile: str,
    provider: str,
    model: str,
    fallback_used: bool,
    status: str,
    latency_ms: int,
    input_tokens: int = 0,
    output_tokens: int = 0,
    error_type: str | None = None,
) -> None:
    try:
        await repository.record_agent_model_usage(
            user,
            thread_id=thread_id,
            model_profile=model_profile,
            provider=provider,
            model=model,
            fallback_used=fallback_used,
            status=status,
            latency_ms=latency_ms,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            error_type=error_type,
        )
    except RepositoryError:
        logger.warning("Agent model usage could not be persisted")


@app.post("/api/v1/agents/{agent}/runs")
async def run_agent(
    agent: str,
    payload: AgentRunRequest,
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict:
    if agent not in {"coach", "tutor", "combined"}:
        raise HTTPException(404, "unknown agent")
    requested_agent = cast(Literal["coach", "tutor", "combined"], agent)
    retrieval_mode, context, thread_id, proposal = await prepare_agent_execution(
        requested_agent, payload, user
    )
    started_at = perf_counter()
    try:
        result = await agent_graph.ainvoke(
            {
                "messages": [HumanMessage(content=payload.message)],
                "requested_route": requested_agent,
                "user_id": str(user.id),
                "context": context,
                "model_profile": payload.model_profile,
            }
        )
    except AgentModelConfigurationError as error:
        await record_model_usage_safely(
            user=user,
            thread_id=thread_id,
            model_profile=payload.model_profile,
            provider=settings.chat_provider,
            model=settings.resolved_chat_model(payload.model_profile),
            fallback_used=False,
            status="error",
            latency_ms=int((perf_counter() - started_at) * 1000),
            error_type="configuration_error",
        )
        raise HTTPException(502, str(error)) from error
    answer = result.get("answer", "已完成分析。写入动作已转换为待确认提案。")
    sources = agent_citations(context)
    route = result.get("route", requested_agent)
    model_status = result.get("model_status", "fallback")
    provider = result.get("provider", "deterministic")
    model_name = result.get("model", "safe-fallback")
    fallback_used = result.get("fallback_used", False)
    model_runs = result.get("model_runs", [])
    await persist_agent_exchange(
        user=user,
        thread_id=thread_id,
        message=payload.message,
        answer=answer,
        sources=sources,
        route=route,
        retrieval_mode=retrieval_mode,
        model_status=model_status,
        model_profile=payload.model_profile,
        provider=provider,
        model=model_name,
        fallback_used=fallback_used,
        model_runs=model_runs,
    )
    await record_model_usage_safely(
        user=user,
        thread_id=thread_id,
        model_profile=payload.model_profile,
        provider=provider,
        model=model_name,
        fallback_used=fallback_used,
        status="success" if model_status == "generated" else "degraded",
        latency_ms=int((perf_counter() - started_at) * 1000),
        input_tokens=sum(int(run.get("input_tokens", 0)) for run in model_runs),
        output_tokens=sum(int(run.get("output_tokens", 0)) for run in model_runs),
        error_type=None if model_status == "generated" else "providers_unavailable",
    )
    return {
        "thread_id": thread_id,
        "agent": requested_agent,
        "answer": answer,
        "route": route,
        "retrieval_mode": retrieval_mode,
        "model_status": model_status,
        "provider": provider,
        "model": model_name,
        "model_profile": payload.model_profile,
        "fallback_used": fallback_used,
        "sources": sources,
        "proposal": proposal,
        "created_at": datetime.now(UTC),
    }


def encode_sse(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False, default=str)}\n\n"


@app.post("/api/v1/agents/{agent}/runs/stream")
async def stream_agent(
    agent: str,
    payload: AgentRunRequest,
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> StreamingResponse:
    if agent not in {"coach", "tutor", "combined"}:
        raise HTTPException(404, "unknown agent")
    requested_agent = cast(Literal["coach", "tutor", "combined"], agent)

    async def event_stream():
        thread_id: UUID | None = None
        started_at = perf_counter()
        try:
            yield encode_sse(
                "status", {"stage": "context", "message": "正在读取学习记录与资料来源"}
            )
            retrieval_mode, context, thread_id, proposal = await prepare_agent_execution(
                requested_agent, payload, user
            )
            sources = agent_citations(context)
            yield encode_sse(
                "status", {"stage": "generation", "message": "正在生成可追溯回答"}
            )
            answer_parts: list[str] = []
            generated = False
            model_runs: list[dict[str, str | bool | int]] = []
            state = {"context": context, "retrieval_mode": retrieval_mode}

            async def stream_branch(kind: Literal["coach", "tutor"]):
                nonlocal generated
                fallback = coach_fallback(state) if kind == "coach" else tutor_fallback(state)
                has_evidence = bool(context["private_sources"] or context["web_sources"])
                can_generate = kind == "coach" or has_evidence
                received = False
                if can_generate:
                    async for delta in agent_model.stream(
                        agent=kind,
                        question=payload.message,
                        context=context,
                        fallback=fallback,
                        model_profile=payload.model_profile,
                    ):
                        if not received:
                            run = {
                                "provider": delta.provider,
                                "model": delta.model,
                                "model_profile": delta.model_profile,
                                "fallback_used": delta.fallback_used,
                                "input_tokens": delta.input_tokens,
                                "output_tokens": delta.output_tokens,
                            }
                            model_runs.append(run)
                            yield encode_sse("model", run)
                        elif model_runs:
                            if delta.input_tokens:
                                model_runs[-1]["input_tokens"] = delta.input_tokens
                            if delta.output_tokens:
                                model_runs[-1]["output_tokens"] = delta.output_tokens
                        received = True
                        generated = True
                        answer_parts.append(delta.text)
                        yield encode_sse("delta", {"text": delta.text})
                if not received:
                    answer_parts.append(fallback)
                    yield encode_sse("delta", {"text": fallback})

            branches: tuple[Literal["coach", "tutor"], ...] = (
                ("coach", "tutor")
                if requested_agent == "combined"
                else (cast(Literal["coach", "tutor"], requested_agent),)
            )
            for branch_index, branch in enumerate(branches):
                if branch_index:
                    answer_parts.append("\n\n")
                    yield encode_sse("delta", {"text": "\n\n"})
                async for event in stream_branch(branch):
                    yield event

            answer = "".join(answer_parts)
            model_status = "generated" if generated else "fallback"
            providers = {str(run["provider"]) for run in model_runs}
            models = {str(run["model"]) for run in model_runs}
            provider = next(iter(providers)) if len(providers) == 1 else "mixed" if providers else "deterministic"
            model_name = next(iter(models)) if len(models) == 1 else "mixed" if models else "safe-fallback"
            fallback_used = any(bool(run["fallback_used"]) for run in model_runs)
            await persist_agent_exchange(
                user=user,
                thread_id=thread_id,
                message=payload.message,
                answer=answer,
                sources=sources,
                route=requested_agent,
                retrieval_mode=retrieval_mode,
                model_status=model_status,
                model_profile=payload.model_profile,
                provider=provider,
                model=model_name,
                fallback_used=fallback_used,
                model_runs=model_runs,
            )
            await record_model_usage_safely(
                user=user,
                thread_id=thread_id,
                model_profile=payload.model_profile,
                provider=provider,
                model=model_name,
                fallback_used=fallback_used,
                status="success" if model_status == "generated" else "degraded",
                latency_ms=int((perf_counter() - started_at) * 1000),
                input_tokens=sum(int(run.get("input_tokens", 0)) for run in model_runs),
                output_tokens=sum(int(run.get("output_tokens", 0)) for run in model_runs),
                error_type=(
                    None if model_status == "generated" else "providers_unavailable"
                ),
            )
            yield encode_sse(
                "done",
                {
                    "thread_id": str(thread_id),
                    "agent": requested_agent,
                    "answer": answer,
                    "route": requested_agent,
                    "retrieval_mode": retrieval_mode,
                    "model_status": model_status,
                    "provider": provider,
                    "model": model_name,
                    "model_profile": payload.model_profile,
                    "fallback_used": fallback_used,
                    "sources": [source.model_dump(mode="json") for source in sources],
                    "proposal": proposal.model_dump(mode="json") if proposal else None,
                    "created_at": datetime.now(UTC).isoformat(),
                },
            )
        except asyncio.CancelledError:
            raise
        except AgentModelConfigurationError as error:
            logger.error("Streaming Agent model configuration failed: %s", error)
            if thread_id:
                await record_model_usage_safely(
                    user=user,
                    thread_id=thread_id,
                    model_profile=payload.model_profile,
                    provider=settings.chat_provider,
                    model=settings.resolved_chat_model(payload.model_profile),
                    fallback_used=False,
                    status="error",
                    latency_ms=int((perf_counter() - started_at) * 1000),
                    error_type="configuration_error",
                )
            yield encode_sse("error", {"message": str(error)})
        except Exception:
            logger.exception("Streaming Agent run failed")
            yield encode_sse(
                "error",
                {
                    "message": "Agent 流式回答失败，未确认的提案不会写入学习数据。",
                },
            )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/v1/agents/threads/latest", response_model=AgentThreadHistory | None)
async def latest_agent_thread(
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> AgentThreadHistory | None:
    return await repository.latest_agent_thread(user)


@app.get("/api/v1/agents/threads", response_model=list[AgentThreadSummary])
async def list_agent_threads(
    user: Annotated[AuthUser, Depends(get_current_user)],
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> list[AgentThreadSummary]:
    return await repository.list_agent_threads(user, limit)


@app.get("/api/v1/agents/threads/{thread_id}", response_model=AgentThreadHistory)
async def get_agent_thread(
    thread_id: UUID,
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> AgentThreadHistory:
    thread = await repository.get_agent_thread(user, thread_id)
    if not thread:
        raise HTTPException(404, "agent thread not found")
    return thread


@app.get("/api/v1/proposals", response_model=list[ActionProposal])
async def list_pending_proposals(
    user: Annotated[AuthUser, Depends(get_current_user)],
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
) -> list[ActionProposal]:
    return await repository.list_pending_agent_proposals(user, limit)


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
