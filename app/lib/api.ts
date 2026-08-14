export type Subject = "math" | "english" | "politics" | "cs408" | "career";
export type ContributionScope = "all" | Subject;
export type PlanLevel = "stage" | "week" | "day";
export type PlanStatus = "draft" | "active" | "completed" | "archived";
export type MistakeSubject = Exclude<Subject, "career">;
export type MistakeReviewResult = "again" | "hard" | "good" | "easy";
export type SchoolTier = "stretch" | "match" | "safety";
export type DegreeType = "academic" | "professional";
export type CareerItemType = "milestone" | "resume" | "application" | "interview";
export type CareerStatus = "planned" | "in_progress" | "submitted" | "interviewing" | "offer" | "rejected" | "completed" | "archived";
export type ExportFormat = "json" | "csv" | "markdown";

export type ApiHealth = {
  status: "ok";
  mode: "demo" | "supabase";
  auth: "configured" | "unconfigured";
  agent: {
    mode: "live" | "partial" | "fallback";
    model_configured: boolean;
    web_search_configured: boolean;
  };
};

export type ApiTask = {
  id: string;
  plan_id: string | null;
  title: string;
  subject: Subject;
  planned_minutes: number;
  due_at: string | null;
  completed: boolean;
  completed_at?: string | null;
};

export type ApiPlan = {
  id: string;
  parent_id: string | null;
  level: PlanLevel;
  title: string;
  description: string;
  starts_on: string;
  ends_on: string;
  status: PlanStatus;
};

export type PlanProgress = {
  plan_id: string;
  task_count: number;
  completed_tasks: number;
  completion_rate: number;
  actual_minutes: number;
};

export type ApiMistakeCard = {
  id: string;
  subject: MistakeSubject;
  title: string;
  question: string;
  answer: string;
  error_reason: string;
  mastery: number;
  next_review_at: string;
  review_count: number;
};

export type ApiSchoolOption = {
  id: string;
  tier: SchoolTier;
  university: string;
  college: string;
  major_code: string;
  major_name: string;
  degree_type: DegreeType;
  exam_year: number;
  exam_subjects: string[];
  tuition_total: number | null;
  duration_years: number | null;
  location: string | null;
  source_url: string;
  source_checked_at: string;
  notes: string;
};

export type ApiCareerItem = {
  id: string;
  item_type: CareerItemType;
  title: string;
  company: string | null;
  status: CareerStatus;
  occurred_on: string | null;
  notes: string;
};

export type ApiDocument = {
  id: string;
  title: string;
  original_filename: string | null;
  source_type: "upload" | "web";
  source_url: string | null;
  content_type: string;
  byte_size: number | null;
  sha256: string | null;
  storage_path: string | null;
  version: number;
  ingestion_status: "queued" | "processing" | "ocr_required" | "ready" | "failed";
  ingestion_error: string | null;
  created_at: string;
  updated_at: string;
};

export type ApiPrivateKnowledgeSource = {
  chunk_id: number;
  document_id: string;
  title: string;
  heading: string | null;
  page_number: number | null;
  locator: string;
  content: string;
  score: number;
};

export type ContributionDay = {
  date: string;
  scope: string;
  effective_minutes: number;
  intensity_level: number;
  session_count: number;
  completed_tasks: number;
  mistake_count: number;
  subject_minutes: Record<string, number>;
};

export type ActionProposal = {
  id: string;
  agent: "coach" | "tutor";
  action: string;
  payload: {
    title: string;
    subject: Subject;
    planned_minutes: number;
  };
  summary: string;
  idempotency_key: string;
  status: "pending" | "approved" | "edited" | "rejected" | "applied" | "failed";
};

export type AgentProposalEdit = ActionProposal["payload"];

export type AgentSource = {
  source_type: "private" | "web";
  title: string;
  locator: string;
  url: string | null;
  accessed_at: string | null;
};

export type AgentMessage = {
  id: string;
  role: "user" | "agent";
  content: string;
  sources: AgentSource[];
  metadata: Record<string, unknown>;
  created_at: string;
};

export type AgentThreadHistory = {
  id: string;
  mode: "coach" | "tutor" | "combined";
  title: string;
  messages: AgentMessage[];
};

export type AgentThreadSummary = {
  id: string;
  mode: "coach" | "tutor" | "combined";
  title: string;
  updated_at: string;
};

export type ImportProposal = {
  id: string;
  url: string;
  title: string;
  summary: string;
  content_type: string;
  estimated_bytes: number | null;
  status: "pending" | "approved" | "rejected";
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
let accessToken: string | null = null;
let authFailureHandler: (() => void) | null = null;

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function setApiAccessToken(token: string | null) {
  accessToken = token;
}

export function setApiAuthFailureHandler(handler: (() => void) | null) {
  authFailureHandler = handler;
}

async function responseErrorMessage(response: Response): Promise<string> {
  const fallback = `API request failed with ${response.status}`;
  const body = await response.text();
  if (!body) return fallback;
  try {
    const payload = JSON.parse(body) as { detail?: unknown };
    return typeof payload.detail === "string" ? payload.detail : fallback;
  } catch {
    return body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    const detail = await responseErrorMessage(response);
    if (response.status === 401) {
      accessToken = null;
      authFailureHandler?.();
    }
    throw new ApiError(response.status, detail);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function download(path: string): Promise<{ blob: Blob; filename: string }> {
  const headers = new Headers();
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  const response = await fetch(`${API_URL}${path}`, { headers });
  if (!response.ok) {
    const detail = await responseErrorMessage(response);
    if (response.status === 401) {
      accessToken = null;
      authFailureHandler?.();
    }
    throw new ApiError(response.status, detail);
  }
  const disposition = response.headers.get("Content-Disposition") || "";
  const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || "yantu-export.json";
  return { blob: await response.blob(), filename };
}

export const api = {
  health: () => request<ApiHealth>("/health"),
  today: () => request<{ date: string; tasks: ApiTask[]; sessions: unknown[] }>("/api/v1/today"),
  listPlans: (level?: PlanLevel) => request<ApiPlan[]>(`/api/v1/plans${level ? `?level=${level}` : ""}`),
  createPlan: (payload: {
    parent_id?: string;
    level: PlanLevel;
    title: string;
    description: string;
    starts_on: string;
    ends_on: string;
    status?: PlanStatus;
  }) => request<ApiPlan>("/api/v1/plans", { method: "POST", body: JSON.stringify(payload) }),
  updatePlan: (id: string, payload: {
    title?: string;
    description?: string;
    starts_on?: string;
    ends_on?: string;
    status?: PlanStatus;
  }) => request<ApiPlan>(`/api/v1/plans/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  planProgress: (id: string) => request<PlanProgress>(`/api/v1/plans/${id}/progress`),
  deletePlan: (id: string) => request<void>(`/api/v1/plans/${id}`, { method: "DELETE" }),
  contributions: (from: string, to: string, scope: ContributionScope) =>
    request<ContributionDay[]>(`/api/v1/analytics/contributions?from=${from}&to=${to}&scope=${scope}`),
  createTask: (payload: { title: string; subject: Subject; planned_minutes: number; plan_id?: string }) =>
    request<ApiTask>("/api/v1/tasks", { method: "POST", body: JSON.stringify(payload) }),
  updateTask: (id: string, payload: { completed?: boolean; plan_id?: string | null }) =>
    request<ApiTask>(`/api/v1/tasks/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  listMistakes: (dueOnly = false) =>
    request<ApiMistakeCard[]>(`/api/v1/mistakes?due_only=${dueOnly}`),
  createMistake: (payload: {
    subject: MistakeSubject;
    title: string;
    question: string;
    answer?: string;
    error_reason?: string;
  }) => request<ApiMistakeCard>("/api/v1/mistakes", { method: "POST", body: JSON.stringify(payload) }),
  reviewMistake: (id: string, result: MistakeReviewResult) =>
    request<ApiMistakeCard>(`/api/v1/mistakes/${id}/reviews`, { method: "POST", body: JSON.stringify({ result }) }),
  listSchoolOptions: (tier?: SchoolTier, examYear?: number) => {
    const params = new URLSearchParams();
    if (tier) params.set("tier", tier);
    if (examYear) params.set("exam_year", String(examYear));
    const query = params.size ? `?${params.toString()}` : "";
    return request<ApiSchoolOption[]>(`/api/v1/schools${query}`);
  },
  createSchoolOption: (payload: {
    tier: SchoolTier;
    university: string;
    college: string;
    major_code: string;
    major_name: string;
    degree_type: DegreeType;
    exam_year: number;
    exam_subjects: string[];
    location?: string;
    source_url: string;
    notes?: string;
  }) => request<ApiSchoolOption>("/api/v1/schools", { method: "POST", body: JSON.stringify(payload) }),
  updateSchoolOption: (id: string, payload: Partial<{
    tier: SchoolTier;
    university: string;
    college: string;
    major_code: string;
    major_name: string;
    degree_type: DegreeType;
    exam_year: number;
    exam_subjects: string[];
    location: string;
    source_url: string;
    notes: string;
  }>) => request<ApiSchoolOption>(`/api/v1/schools/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteSchoolOption: (id: string) => request<void>(`/api/v1/schools/${id}`, { method: "DELETE" }),
  listCareerItems: (itemType?: CareerItemType, status?: CareerStatus) => {
    const params = new URLSearchParams();
    if (itemType) params.set("item_type", itemType);
    if (status) params.set("status", status);
    const query = params.size ? `?${params.toString()}` : "";
    return request<ApiCareerItem[]>(`/api/v1/career-items${query}`);
  },
  createCareerItem: (payload: {
    item_type: CareerItemType;
    title: string;
    company?: string;
    status?: CareerStatus;
    occurred_on?: string;
    notes?: string;
  }) => request<ApiCareerItem>("/api/v1/career-items", { method: "POST", body: JSON.stringify(payload) }),
  updateCareerItem: (id: string, payload: Partial<{
    item_type: CareerItemType;
    title: string;
    company: string | null;
    status: CareerStatus;
    occurred_on: string | null;
    notes: string;
  }>) => request<ApiCareerItem>(`/api/v1/career-items/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteCareerItem: (id: string) => request<void>(`/api/v1/career-items/${id}`, { method: "DELETE" }),
  exportData: (format: ExportFormat) => download(`/api/v1/export?format=${format}`),
  createSession: (payload: {
    subject: Subject;
    started_at: string;
    ended_at: string;
    paused_seconds: number;
    source: "timer" | "manual";
    note: string;
  }) => request("/api/v1/sessions", { method: "POST", body: JSON.stringify(payload) }),
  listDocuments: () => request<ApiDocument[]>("/api/v1/documents"),
  searchPrivateKnowledge: (query: string, documentId?: string) => {
    const params = new URLSearchParams({ query, limit: "8" });
    if (documentId) params.set("document_id", documentId);
    return request<ApiPrivateKnowledgeSource[]>(
      `/api/v1/knowledge/private-search?${params.toString()}`,
    );
  },
  uploadDocument: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<ApiDocument & {
      chunk_count: number;
      flagged_chunk_count: number;
      duplicate: boolean;
    }>("/api/v1/documents/upload", { method: "POST", body });
  },
  previewImport: (url: string) => request<ImportProposal>(
    "/api/v1/documents/import-preview",
    { method: "POST", body: JSON.stringify({ url }) },
  ),
  approveImport: (id: string) => request<{
    proposal: ImportProposal;
    document: ApiDocument;
    duplicate: boolean;
  }>(`/api/v1/documents/import-proposals/${id}/approve`, { method: "POST" }),
  runAgent: (agent: "coach" | "tutor" | "combined", message: string, threadId?: string) =>
    request<{
      thread_id: string;
      answer: string;
      route: string;
      retrieval_mode: string;
      model_status: "generated" | "fallback";
      sources: AgentSource[];
      proposal: ActionProposal | null;
    }>(`/api/v1/agents/${agent}/runs`, {
      method: "POST",
      body: JSON.stringify({ message, thread_id: threadId }),
    }),
  latestAgentThread: () => request<AgentThreadHistory | null>("/api/v1/agents/threads/latest"),
  listAgentThreads: () => request<AgentThreadSummary[]>("/api/v1/agents/threads?limit=20"),
  getAgentThread: (id: string) => request<AgentThreadHistory>(`/api/v1/agents/threads/${id}`),
  listPendingProposals: () => request<ActionProposal[]>("/api/v1/proposals?limit=10"),
  decideProposal: (
    id: string,
    decision: "approve" | "edit" | "reject",
    editedPayload?: AgentProposalEdit,
  ) => request<ActionProposal>(`/api/v1/proposals/${id}/${decision}`, {
    method: "POST",
    body: editedPayload ? JSON.stringify(editedPayload) : undefined,
  }),
};
