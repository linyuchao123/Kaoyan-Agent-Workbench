export type Subject = "math" | "english" | "politics" | "cs408" | "career";
export type ContributionScope = "all" | Subject;

export type ApiTask = {
  id: string;
  title: string;
  subject: Subject;
  planned_minutes: number;
  due_at: string | null;
  completed: boolean;
  completed_at?: string | null;
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
  summary: string;
  status: "pending" | "approved" | "edited" | "rejected" | "applied" | "failed";
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
  return response.json() as Promise<T>;
}

export const api = {
  health: () => request<{ status: string; mode: "demo" | "supabase"; auth: "configured" | "unconfigured" }>("/health"),
  today: () => request<{ date: string; tasks: ApiTask[]; sessions: unknown[] }>("/api/v1/today"),
  contributions: (from: string, to: string, scope: ContributionScope) =>
    request<ContributionDay[]>(`/api/v1/analytics/contributions?from=${from}&to=${to}&scope=${scope}`),
  createTask: (payload: { title: string; subject: Subject; planned_minutes: number }) =>
    request<ApiTask>("/api/v1/tasks", { method: "POST", body: JSON.stringify(payload) }),
  updateTask: (id: string, payload: { completed: boolean }) =>
    request<ApiTask>(`/api/v1/tasks/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  createSession: (payload: {
    subject: Subject;
    started_at: string;
    ended_at: string;
    paused_seconds: number;
    source: "timer" | "manual";
    note: string;
  }) => request("/api/v1/sessions", { method: "POST", body: JSON.stringify(payload) }),
  uploadDocument: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<{
      id: string;
      title: string;
      original_filename: string;
      byte_size: number;
      ingestion_status: "ready" | "ocr_required";
      chunk_count: number;
      flagged_chunk_count: number;
      duplicate: boolean;
    }>("/api/v1/documents/upload", { method: "POST", body });
  },
  previewImport: (url: string) => request<{ id: string; title: string; summary: string; status: string }>(
    "/api/v1/documents/import-preview",
    { method: "POST", body: JSON.stringify({ url }) },
  ),
  runAgent: (agent: "coach" | "tutor" | "combined", message: string, threadId?: string) =>
    request<{
      thread_id: string;
      answer: string;
      route: string;
      retrieval_mode: string;
      proposal: ActionProposal;
    }>(`/api/v1/agents/${agent}/runs`, {
      method: "POST",
      body: JSON.stringify({ message, thread_id: threadId }),
    }),
  decideProposal: (id: string, decision: "approve" | "edit" | "reject") =>
    request<ActionProposal>(`/api/v1/proposals/${id}/${decision}`, { method: "POST" }),
};
