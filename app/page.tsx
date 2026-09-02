"use client";

import { ChangeEvent, FormEvent, KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { ApiError, api, setApiAccessToken, setApiAuthFailureHandler, type ActionProposal, type AgentModelMetadata, type AgentModelProfile, type AgentProposalEdit, type AgentSource, type AgentThreadHistory, type AgentThreadSummary, type ApiCareerItem, type ApiDocument, type ApiHealth, type ApiMistakeCard, type ApiPlan, type ApiPrivateKnowledgeSource, type ApiSchoolOption, type ApiStudySession, type ApiTask, type CareerItemType, type CareerStatus, type ContributionScope, type DashboardMetrics, type DegreeType, type ExportFormat, type ImportProposal, type MistakeReviewResult, type MistakeSubject, type PlanProgress, type PlanStatus, type SchoolTier, type Subject, type SubjectSummary } from "./lib/api";
import { createShanghaiStudyInterval } from "./lib/study-time";
import { getSupabaseClient, isSupabaseConfigured } from "./lib/supabase";
import { selectSidebarStage, stageDateProgress } from "./lib/stage-plan";
import { readStoredWorkbenchView, storeWorkbenchView, type WorkbenchView } from "./lib/workbench-view";
import { ExamCountdown } from "./components/exam-countdown";
import { WorkbenchLayout, type WorkbenchApiStatus } from "./components/workbench-layout";

type Scope = ContributionScope;
type View = WorkbenchView;

type StudyDay = {
  date: string;
  minutes: Record<Exclude<Scope, "all">, number>;
  sessions: number;
  tasks: number;
  mistakes: number;
};

type Task = {
  id: string;
  title: string;
  detail: string;
  subject: Subject;
  done: boolean;
  plannedMinutes: number;
  actualMinutes: number;
  planId: string | null;
  dueAt: string | null;
};

type StoredFocusSession = {
  startedAt: string;
  pauseStartedAt: string | null;
  pausedSeconds: number;
  taskId: string;
  subject: Subject;
  running: boolean;
};

function authRequestErrorMessage(error: unknown, mode: "login" | "register") {
  const details = typeof error === "object" && error !== null
    ? `${"code" in error ? String(error.code ?? "") : ""} ${"message" in error ? String(error.message ?? "") : ""}`.toLowerCase()
    : String(error ?? "").toLowerCase();
  const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 0;

  if (details.includes("email_not_confirmed") || details.includes("email not confirmed")) {
    return "邮箱尚未验证，请先打开验证邮件完成确认后再登录。";
  }
  if (details.includes("invalid_credentials") || details.includes("invalid login credentials")) {
    return "邮箱或密码错误，请检查后重新登录。";
  }
  if (details.includes("user_already_exists") || details.includes("already registered")) {
    return "该邮箱已经注册，请直接返回登录。";
  }
  if (details.includes("weak_password") || details.includes("password should be") || details.includes("password is too short")) {
    return "密码强度不足，请设置至少 6 位且不易猜测的密码。";
  }
  if (details.includes("signup_disabled") || details.includes("signups not allowed")) {
    return "当前云端项目暂未开放邮箱注册，请联系管理员检查 Supabase Auth 设置。";
  }
  if (status === 429 || details.includes("over_email_send_rate_limit") || details.includes("rate limit")) {
    return "操作过于频繁，请稍后再试；如果正在注册，请避免重复发送验证邮件。";
  }
  if (details.includes("failed to fetch") || details.includes("network")) {
    return "暂时无法连接 Supabase 登录服务，请检查网络后重试。";
  }
  return `${mode === "login" ? "登录" : "注册"}失败，请检查填写内容后重试；若问题持续，请检查 Supabase Auth 配置。`;
}

function passwordResetRequestErrorMessage(error: unknown) {
  const details = typeof error === "object" && error !== null
    ? `${"code" in error ? String(error.code ?? "") : ""} ${"message" in error ? String(error.message ?? "") : ""}`.toLowerCase()
    : String(error ?? "").toLowerCase();
  const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 0;

  if (status === 429 || details.includes("rate limit") || details.includes("over_email_send_rate_limit")) {
    return "重置邮件发送过于频繁，请稍后再试。";
  }
  if (details.includes("failed to fetch") || details.includes("network")) {
    return "暂时无法连接 Supabase 登录服务，请检查网络后重试。";
  }
  return "暂时无法发送密码重置邮件，请稍后重试或检查 Supabase Auth 配置。";
}

function passwordUpdateErrorMessage(error: unknown) {
  const details = typeof error === "object" && error !== null
    ? `${"code" in error ? String(error.code ?? "") : ""} ${"message" in error ? String(error.message ?? "") : ""}`.toLowerCase()
    : String(error ?? "").toLowerCase();

  if (details.includes("weak_password") || details.includes("password should be") || details.includes("password is too short")) {
    return "新密码强度不足，请设置至少 6 位且不易猜测的密码。";
  }
  if (details.includes("same_password") || details.includes("different from the old password")) {
    return "新密码不能与原密码相同，请更换后再试。";
  }
  if (details.includes("session") || details.includes("expired") || details.includes("invalid token")) {
    return "密码重置链接已失效，请返回登录页重新发送邮件。";
  }
  if (details.includes("failed to fetch") || details.includes("network")) {
    return "暂时无法连接 Supabase 登录服务，请检查网络后重试。";
  }
  return "新密码保存失败，请重新打开最新的重置邮件后再试。";
}

function accountPasswordUpdateErrorMessage(error: unknown) {
  const details = typeof error === "object" && error !== null
    ? `${"code" in error ? String(error.code ?? "") : ""} ${"message" in error ? String(error.message ?? "") : ""}`.toLowerCase()
    : String(error ?? "").toLowerCase();

  if (details.includes("weak_password") || details.includes("password should be") || details.includes("password is too short")) {
    return "新密码强度不足，请设置至少 6 位且不易猜测的密码。";
  }
  if (details.includes("same_password") || details.includes("different from the old password")) {
    return "新密码不能与原密码相同，请更换后再试。";
  }
  if (details.includes("session") || details.includes("expired") || details.includes("invalid token")) {
    return "登录状态已失效，请退出后重新登录再修改账户设置。";
  }
  if (details.includes("failed to fetch") || details.includes("network")) {
    return "暂时无法连接 Supabase 登录服务，请检查网络后重试。";
  }
  return "账户设置保存失败，请稍后重试。";
}

function agentRequestErrorMessage(error: unknown, mode: "coach" | "tutor" | "combined") {
  const safetyNotice = "本次请求没有写入学习数据。";
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return `登录状态已失效，请重新登录后重试。${safetyNotice}`;
    }
    if (error.status === 400 || error.status === 403 || error.status === 422) {
      return `Agent 请求被云端拒绝，请检查模型档位、API Key 与账户权限。${safetyNotice}`;
    }
    if (error.status === 429) {
      return `模型服务请求过于频繁或额度不足，请稍后重试或检查服务余额。${safetyNotice}`;
    }
    if (error.status >= 500) {
      const evidenceNotice = mode === "tutor" ? "为避免无依据回答，我不会自行补全资料事实。" : "";
      return `云端模型或检索服务暂时不可用，请稍后重试。${evidenceNotice}${safetyNotice}`;
    }
  }
  if (error instanceof TypeError) {
    return `无法连接后端服务，请确认本地后端已在 8000 端口启动。${safetyNotice}`;
  }
  const modeNotice = mode === "tutor" ? "为避免无依据回答，我不会自行补全资料事实。" : "";
  return `Agent 请求失败，请稍后重试。${modeNotice}${safetyNotice}`;
}

function materialRequestErrorMessage(error: unknown, action: "load" | "upload" | "preview" | "import" | "search" | "reindex") {
  const actionLabel = { load: "加载资料", upload: "导入资料", preview: "生成链接预览", import: "保存网页资料", search: "检索资料", reindex: "重新解析资料" }[action];
  if (error instanceof ApiError) {
    if (error.status === 401) return `${actionLabel}失败：登录状态已失效，请重新登录。`;
    if (error.status === 409) return `${actionLabel}失败：云端已有相同内容，请刷新资料列表后重试。`;
    if (error.status === 413) return `${actionLabel}失败：文件超过 25 MB 上限。`;
    if (error.status === 415) return `${actionLabel}失败：目前只支持 PDF 与 Markdown。`;
    if (error.status === 422) return `${actionLabel}失败：文件或链接内容无法解析，请检查后重试。`;
    if (error.status >= 500) return `${actionLabel}失败：云端存储、解析或模型服务暂时不可用，请稍后重试。`;
  }
  if (error instanceof TypeError) return `${actionLabel}失败：无法连接本地后端，请确认 8000 端口服务已启动。`;
  return `${actionLabel}失败，请稍后重试。`;
}

function studyWriteErrorMessage(error: unknown, action: string) {
  const safetyNotice = "本次变更未写入云端，页面已恢复到提交前状态。";
  if (error instanceof ApiError) {
    if (error.status === 401) return `${action}失败：登录状态已失效，请重新登录。${safetyNotice}`;
    if (error.status === 400 || error.status === 403 || error.status === 422) return `${action}失败：云端拒绝了本次数据，请检查填写内容后重试。${safetyNotice}`;
    if (error.status === 409) return `${action}失败：数据状态已发生变化，请刷新页面后重试。${safetyNotice}`;
    if (error.status >= 500) return `${action}失败：云端数据服务暂时不可用，请稍后重试。${safetyNotice}`;
  }
  if (error instanceof TypeError) return `${action}失败：无法连接本地后端，请确认 8000 端口服务已启动。${safetyNotice}`;
  return `${action}失败，请稍后重试。${safetyNotice}`;
}

function exportRequestErrorMessage(error: unknown) {
  const safetyNotice = "本次导出没有修改任何云端学习数据。";
  if (error instanceof ApiError) {
    if (error.status === 401) return `导出失败：登录状态已失效，请重新登录。${safetyNotice}`;
    if (error.status === 400 || error.status === 403 || error.status === 422) return `导出失败：云端拒绝了本次请求，请检查导出格式和账户权限。${safetyNotice}`;
    if (error.status >= 500) return `导出失败：云端备份服务暂时不可用，请稍后重试。${safetyNotice}`;
  }
  if (error instanceof TypeError) return `导出失败：无法连接本地后端，请确认 8000 端口服务已启动。${safetyNotice}`;
  return `导出失败，请稍后重试。${safetyNotice}`;
}

function cloudReadErrorMessage(error: unknown, resource: string) {
  const safetyNotice = "已有云端数据不会受到影响。";
  if (error instanceof ApiError) {
    if (error.status === 401) return `${resource}加载失败：登录状态已失效，请重新登录。${safetyNotice}`;
    if (error.status === 400 || error.status === 403 || error.status === 422) return `${resource}加载失败：请求被云端拒绝，请刷新页面并检查账户权限。${safetyNotice}`;
    if (error.status >= 500) return `${resource}加载失败：云端数据服务暂时不可用，请稍后重试。${safetyNotice}`;
  }
  if (error instanceof TypeError) return `${resource}加载失败：无法连接本地后端，请确认 8000 端口服务已启动。${safetyNotice}`;
  return `${resource}加载失败，请稍后重试。${safetyNotice}`;
}

function documentIngestionCopy(document: ApiDocument) {
  const copies: Record<ApiDocument["ingestion_status"], { label: string; description: string }> = {
    queued: { label: "等待处理", description: "文件已安全保存，正在等待解析任务" },
    processing: { label: "正在建立索引", description: "正在提取原文、切分片段并生成检索索引" },
    ocr_required: { label: "等待 OCR", description: "已识别为扫描 PDF，正在等待逐页文字识别" },
    ready: { label: "可以检索", description: "解析与索引已完成，可用于资料检索和 Agent 回答" },
    failed: { label: "处理失败", description: "本次处理未完成，可点击“重新处理”再次尝试" },
  };
  return copies[document.ingestion_status];
}

const scopes: { key: Scope; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "math", label: "数学" },
  { key: "english", label: "英语" },
  { key: "politics", label: "政治" },
  { key: "cs408", label: "408" },
  { key: "career", label: "项目" },
];

const subjectMeta: Record<Exclude<Scope, "all">, { label: string; short: string }> = {
  math: { label: "数学一", short: "数" },
  english: { label: "英语一", short: "英" },
  politics: { label: "政治", short: "政" },
  cs408: { label: "计算机 408", short: "408" },
  career: { label: "AI 项目", short: "AI" },
};

const navItems: { key: View; label: string; icon: string }[] = [
  { key: "today", label: "今日工作台", icon: "⌂" },
  { key: "plan", label: "三级计划", icon: "◇" },
  { key: "subjects", label: "学科学习", icon: "▤" },
  { key: "schools", label: "院校情报", icon: "◎" },
  { key: "career", label: "求职副线", icon: "◫" },
  { key: "materials", label: "资料库", icon: "▱" },
  { key: "backup", label: "数据备份", icon: "⇩" },
  { key: "agents", label: "双 Agent", icon: "✦" },
];

const initialTasks: Task[] = [
  { id: "demo-math", title: "高等数学：极限与连续", detail: "复习讲义 1.3 · 完成 20 道基础题", subject: "math", done: false, plannedMinutes: 90, actualMinutes: 35, planId: null, dueAt: null },
  { id: "demo-english", title: "英语：核心词汇复习", detail: "新词 50 个 · 复习 100 个", subject: "english", done: true, plannedMinutes: 60, actualMinutes: 65, planId: null, dueAt: null },
  { id: "demo-cs408", title: "408：数据结构线性表", detail: "王道第 2 章 · 错题回顾", subject: "cs408", done: false, plannedMinutes: 90, actualMinutes: 0, planId: null, dueAt: null },
  { id: "demo-career", title: "Agent 工作台开发", detail: "完成热力图与学习会话接口", subject: "career", done: false, plannedMinutes: 60, actualMinutes: 20, planId: null, dueAt: null },
];

const initialMistakes: ApiMistakeCard[] = [
  { id: "demo-mistake-1", subject: "cs408", title: "二叉树非递归遍历", question: "写出中序遍历的栈实现", answer: "先沿左链入栈，再访问并转向右子树", error_reason: "忘记访问后转向右子树", mastery: 1, next_review_at: new Date().toISOString(), review_count: 0 },
  { id: "demo-mistake-2", subject: "math", title: "等价无穷小替换条件", question: "何时不能直接进行等价无穷小替换？", answer: "加减关系中需要先变形，不能直接替换", error_reason: "混淆乘除和加减场景", mastery: 2, next_review_at: new Date().toISOString(), review_count: 1 },
];

function taskFromApi(task: ApiTask, planTitle?: string, knownActualMinutes?: number): Task {
  return {
    id: task.id,
    title: task.title,
    detail: `计划 ${task.planned_minutes} 分钟${planTitle ? ` · ${planTitle}` : ""}${task.due_at ? ` · ${task.due_at.slice(0, 10)}` : ""}`,
    subject: task.subject,
    done: task.completed,
    plannedMinutes: task.planned_minutes,
    actualMinutes: task.actual_minutes ?? knownActualMinutes ?? 0,
    planId: task.plan_id,
    dueAt: task.due_at,
  };
}

function TaskStudyProgress({ task }: { task: Task }) {
  const plannedMinutes = Math.max(1, task.plannedMinutes);
  const percentage = Math.round((task.actualMinutes / plannedMinutes) * 100);
  const visualPercentage = Math.min(100, percentage);
  const status = task.actualMinutes === 0
    ? "not-started"
    : task.actualMinutes < plannedMinutes
      ? "in-progress"
      : task.actualMinutes === plannedMinutes
        ? "reached"
        : "exceeded";
  const statusLabel = task.actualMinutes === 0
    ? "未开始"
    : task.actualMinutes < plannedMinutes
      ? `还差 ${formatMinutes(plannedMinutes - task.actualMinutes)}`
      : task.actualMinutes === plannedMinutes
        ? "刚好达标"
        : `超出 ${formatMinutes(task.actualMinutes - plannedMinutes)}`;

  return <span className={`task-study-progress ${status}`}>
    <span className="task-study-progress-copy">
      <small>实际 {formatMinutes(task.actualMinutes)} / 计划 {formatMinutes(task.plannedMinutes)}</small>
      <small>{statusLabel}</small>
    </span>
    <span
      className="task-study-progress-track"
      role="progressbar"
      aria-label={`${task.title}学习时长进度`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={visualPercentage}
    >
      <span style={{ width: `${visualPercentage}%` }} />
    </span>
  </span>;
}

function seededValue(seed: number) {
  const x = Math.sin(seed * 9283.17) * 43758.5453;
  return x - Math.floor(x);
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function shanghaiDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function shanghaiDisplayDate(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function buildYearData(year: number): StudyDay[] {
  const today = new Date();
  const currentYear = Number(shanghaiDateKey(today).slice(0, 4));
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year, 11, 31));
  const result: StudyDay[] = [];
  const cursor = new Date(start);
  let index = 0;

  while (cursor <= end) {
    const isFuture = cursor > today;
    const active = !isFuture && seededValue(index + year * 7) > (year === currentYear ? 0.36 : 0.28);
    const load = active ? 40 + Math.floor(seededValue(index * 5 + 11) * 360) : 0;
    const math = active ? Math.floor(load * (0.28 + seededValue(index + 3) * 0.18)) : 0;
    const english = active ? Math.floor(load * (0.12 + seededValue(index + 8) * 0.1)) : 0;
    const cs408 = active ? Math.floor(load * (0.22 + seededValue(index + 19) * 0.14)) : 0;
    const career = active ? Math.max(0, load - math - english - cs408) : 0;
    result.push({
      date: formatDate(cursor),
      minutes: { math, english, politics: 0, cs408, career },
      sessions: active ? 1 + Math.floor(seededValue(index + 31) * 4) : 0,
      tasks: active ? 1 + Math.floor(seededValue(index + 41) * 5) : 0,
      mistakes: active ? Math.floor(seededValue(index + 53) * 4) : 0,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    index += 1;
  }
  return result;
}

function buildEmptyYearData(year: number): StudyDay[] {
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year, 11, 31));
  const result: StudyDay[] = [];
  const cursor = new Date(start);

  while (cursor <= end) {
    result.push({
      date: formatDate(cursor),
      minutes: { math: 0, english: 0, politics: 0, cs408: 0, career: 0 },
      sessions: 0,
      tasks: 0,
      mistakes: 0,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function getMinutes(day: StudyDay, scope: Scope) {
  if (scope === "all") return Object.values(day.minutes).reduce((sum, value) => sum + value, 0);
  return day.minutes[scope];
}

function getLevel(minutes: number, scope: Scope) {
  const thresholds = scope === "all" ? [1, 60, 180, 300] : [1, 30, 60, 120];
  if (minutes < thresholds[0]) return 0;
  if (minutes < thresholds[1]) return 1;
  if (minutes < thresholds[2]) return 2;
  if (minutes < thresholds[3]) return 3;
  return 4;
}

function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} 分钟`;
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

function sessionTouchesShanghaiDay(session: ApiStudySession, day: string) {
  const dayStart = new Date(`${day}T00:00:00+08:00`).getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  return new Date(session.ended_at).getTime() > dayStart
    && new Date(session.started_at).getTime() < dayEnd;
}

function studySessionMinutes(session: ApiStudySession) {
  const durationSeconds = Math.floor(
    (new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 1000,
  );
  return Math.max(0, Math.floor((durationSeconds - session.paused_seconds) / 60));
}

function formatSessionTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function TodaySubjectBreakdown({ sessions }: { sessions: ApiStudySession[] }) {
  const subjectMinutes = sessions.reduce<Record<Subject, number>>((totals, session) => {
    totals[session.subject] += studySessionMinutes(session);
    return totals;
  }, { math: 0, english: 0, politics: 0, cs408: 0, career: 0 });
  const totalMinutes = Object.values(subjectMinutes).reduce((sum, minutes) => sum + minutes, 0);
  const rows = scopes
    .filter((scope): scope is { key: Subject; label: string } => scope.key !== "all")
    .map((scope) => ({ ...scope, minutes: subjectMinutes[scope.key] }))
    .filter((scope) => scope.minutes > 0)
    .sort((left, right) => right.minutes - left.minutes);

  return <div className="today-subject-breakdown">
    <div className="today-subject-heading"><strong>今日学习结构</strong><span>{formatMinutes(totalMinutes)}</span></div>
    {rows.length === 0
      ? <p>完成一次专注或补录后，这里会按科目汇总有效学习时长。</p>
      : <div className="today-subject-list">{rows.map((row) => {
        const percentage = Math.round((row.minutes / totalMinutes) * 100);
        return <div className="today-subject-row" key={row.key}>
          <span className={`subject-badge ${row.key}`}>{subjectMeta[row.key].short}</span>
          <span className="today-subject-copy"><span><strong>{row.label}</strong><small>{formatMinutes(row.minutes)} · {percentage}%</small></span><span className="today-subject-track"><span style={{ width: `${percentage}%` }} /></span></span>
        </div>;
      })}</div>}
  </div>;
}

function formatTimer(seconds: number) {
  const hours = Math.floor(seconds / 3600).toString().padStart(2, "0");
  const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const secs = (seconds % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}:${secs}`;
}

function StudyHeatmap({ isDemo, refreshVersion }: { isDemo: boolean; refreshVersion: number }) {
  const currentYear = Number(shanghaiDateKey(new Date()).slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const [scope, setScope] = useState<Scope>("all");
  const demoData = useMemo(() => buildYearData(year), [year]);
  const emptyData = useMemo(() => buildEmptyYearData(year), [year]);
  const queryKey = `${year}:${scope}`;
  const [cloudData, setCloudData] = useState<{ key: string; status: "api" | "error"; data: StudyDay[] | null } | null>(null);
  const dataSource = isDemo ? "demo" : cloudData?.key === queryKey ? cloudData.status : "loading";
  const remoteData = cloudData?.key === queryKey ? cloudData.data : null;
  const data = dataSource === "demo" ? demoData : remoteData ?? emptyData;
  const [selectedDate, setSelectedDate] = useState(shanghaiDateKey(new Date()));
  const selectedDay = data.find((day) => day.date === selectedDate) ?? data[data.length - 1];

  useEffect(() => {
    if (isDemo) return;
    let cancelled = false;
    api.contributions(`${year}-01-01`, `${year}-12-31`, scope)
      .then((days) => {
        if (cancelled) return;
        setCloudData({
          key: queryKey,
          status: "api",
          data: days.map((day) => ({
            date: day.date,
            minutes: {
              math: day.subject_minutes.math ?? 0,
              english: day.subject_minutes.english ?? 0,
              politics: day.subject_minutes.politics ?? 0,
              cs408: day.subject_minutes.cs408 ?? 0,
              career: day.subject_minutes.career ?? 0,
            },
            sessions: day.session_count,
            tasks: day.completed_tasks,
            mistakes: day.mistake_count,
          })),
        });
      })
      .catch(() => {
        if (!cancelled) setCloudData({ key: queryKey, status: "error", data: null });
      });
    return () => { cancelled = true; };
  }, [isDemo, queryKey, refreshVersion, scope, year]);

  const padded = useMemo(() => {
    const first = new Date(`${year}-01-01T00:00:00Z`);
    const mondayOffset = (first.getUTCDay() + 6) % 7;
    return [...Array<StudyDay | null>(mondayOffset).fill(null), ...data];
  }, [data, year]);
  const weeks = Array.from({ length: Math.ceil(padded.length / 7) }, (_, index) => padded.slice(index * 7, index * 7 + 7));
  const totalMinutes = data.reduce((sum, day) => sum + getMinutes(day, scope), 0);
  const activeDays = data.filter((day) => getMinutes(day, scope) > 0).length;
  const isLoading = dataSource === "loading";
  const hasError = dataSource === "error";

  return (
    <section className="panel heatmap-panel" aria-busy={isLoading}>
      <div className="panel-heading heatmap-heading">
        <div>
          <div className="eyebrow">学习轨迹</div>
          <h2 className={isLoading ? "cloud-loading-text" : undefined}>
            {isLoading
              ? "正在加载云端学习数据…"
              : hasError
                ? "云端学习数据加载失败"
                : `${year} 年有效学习 ${Math.round(totalMinutes / 60)} 小时`}
          </h2>
          <p>
            {isLoading
              ? "正在读取学习会话与年度统计"
              : hasError
                ? "请确认数据服务已启动后刷新页面"
                : `${activeDays} 个学习日 · ${dataSource === "api" ? "来自真实学习会话" : "离线演示数据"}`}
          </p>
        </div>
        <div className="year-switch" aria-label="选择年份">
          {[currentYear, currentYear - 1].map((item) => (
            <button key={item} className={year === item ? "active" : ""} onClick={() => setYear(item)}>{item}</button>
          ))}
        </div>
      </div>

      <div className="scope-row" aria-label="筛选学习科目">
        {scopes.map((item) => (
          <button key={item.key} className={scope === item.key ? "active" : ""} onClick={() => setScope(item.key)}>{item.label}</button>
        ))}
      </div>

      <div className="heatmap-scroll">
        <div className="month-row" aria-hidden="true">
          {Array.from({ length: 12 }, (_, index) => <span key={index}>{index + 1}月</span>)}
        </div>
        <div className="heatmap-body">
          <div className="weekday-labels" aria-hidden="true"><span>一</span><span></span><span>三</span><span></span><span>五</span><span></span><span>日</span></div>
          <div className={`heatmap-grid ${isLoading ? "loading" : ""}`} role="grid" aria-label={`${year} 学习贡献热力图`}>
            {weeks.map((week, weekIndex) => (
              <div className="heatmap-week" key={weekIndex} role="row">
                {Array.from({ length: 7 }, (_, dayIndex) => {
                  const day = week[dayIndex] ?? null;
                  if (!day) return <span className="heat-cell empty" key={dayIndex} aria-hidden="true" />;
                  const minutes = getMinutes(day, scope);
                  return (
                    <button
                      key={day.date}
                      className={`heat-cell level-${getLevel(minutes, scope)} ${selectedDate === day.date ? "selected" : ""}`}
                      title={`${day.date}：${formatMinutes(minutes)}`}
                      aria-label={`${day.date}，有效学习${formatMinutes(minutes)}`}
                      onClick={() => setSelectedDate(day.date)}
                      role="gridcell"
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="heatmap-footer">
        <div className="selected-summary">
          {isLoading ? (
            <span className="cloud-loading-text">正在同步云端统计…</span>
          ) : hasError ? (
            <span>暂时无法读取学习统计</span>
          ) : (
            <>
              <strong>{selectedDay.date}</strong>
              <span>{formatMinutes(getMinutes(selectedDay, scope))}</span>
              <span>{selectedDay.sessions} 次专注</span>
              <span>{selectedDay.tasks} 项完成</span>
              <span>{selectedDay.mistakes} 道错题</span>
            </>
          )}
        </div>
        <div className="legend"><span>少</span>{[0, 1, 2, 3, 4].map((level) => <i className={`level-${level}`} key={level} />)}<span>多</span></div>
      </div>
    </section>
  );
}

function TodayView({ isDemo, displayName, accountKey }: { isDemo: boolean; displayName: string; accountKey: string }) {
  const [tasks, setTasks] = useState<Task[]>(() => isDemo ? initialTasks : []);
  const [newTask, setNewTask] = useState("");
  const [newTaskSubject, setNewTaskSubject] = useState<Subject>("math");
  const [dayPlans, setDayPlans] = useState<ApiPlan[]>([]);
  const [newTaskPlanId, setNewTaskPlanId] = useState("");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTaskTitle, setEditTaskTitle] = useState("");
  const [editTaskSubject, setEditTaskSubject] = useState<Subject>("math");
  const [editTaskMinutes, setEditTaskMinutes] = useState(30);
  const [editTaskPlanId, setEditTaskPlanId] = useState("");
  const [taskBusyId, setTaskBusyId] = useState<string | null>(null);
  const [focusSubject, setFocusSubject] = useState<Subject>("math");
  const [focusTaskId, setFocusTaskId] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const [focusSaving, setFocusSaving] = useState(false);
  const [sessionStartedAt, setSessionStartedAt] = useState<Date | null>(null);
  const [pauseStartedAt, setPauseStartedAt] = useState<Date | null>(null);
  const [pausedSeconds, setPausedSeconds] = useState(0);
  const [focusHydrated, setFocusHydrated] = useState(false);
  const [todayMinutes, setTodayMinutes] = useState<number | null>(() => isDemo ? 260 : null);
  const [dashboardMetrics, setDashboardMetrics] = useState<DashboardMetrics | null>(() => isDemo ? {
    week_start: "2026-08-10",
    week_end: "2026-08-16",
    weekly_task_count: 25,
    weekly_completed_tasks: 17,
    weekly_completion_rate: 68,
    today_effective_minutes: 260,
    today_task_count: 4,
    today_planned_minutes: 360,
    active_stage_title: "基础阶段",
    current_streak_days: 12,
    longest_streak_days: 28,
  } : null);
  const [cloudState, setCloudState] = useState<"loading" | "ready" | "demo" | "error">(() => isDemo ? "demo" : "loading");
  const [recordStatus, setRecordStatus] = useState(isDemo ? "离线演示数据 · 登录并连接 Supabase 后自动同步" : "正在连接云端学习数据…");
  const [contributionRevision, setContributionRevision] = useState(0);
  const [newTaskBusy, setNewTaskBusy] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualBusy, setManualBusy] = useState(false);
  const [manualSubject, setManualSubject] = useState<Subject>("math");
  const [manualTaskId, setManualTaskId] = useState("");
  const [manualDate, setManualDate] = useState(() => shanghaiDateKey(new Date()));
  const [manualStartedTime, setManualStartedTime] = useState("19:00");
  const [manualEndedTime, setManualEndedTime] = useState("20:00");
  const [manualNote, setManualNote] = useState("");
  const [manualError, setManualError] = useState("");
  const [todaySessions, setTodaySessions] = useState<ApiStudySession[]>([]);
  const [sessionBusyId, setSessionBusyId] = useState<string | null>(null);
  const [mistakes, setMistakes] = useState<ApiMistakeCard[]>(() => isDemo ? initialMistakes : []);
  const [mistakeFormOpen, setMistakeFormOpen] = useState(false);
  const [mistakeBusy, setMistakeBusy] = useState(false);
  const [reviewBusyId, setReviewBusyId] = useState<string | null>(null);
  const [mistakeSubject, setMistakeSubject] = useState<MistakeSubject>("math");
  const [mistakeTitle, setMistakeTitle] = useState("");
  const [mistakeQuestion, setMistakeQuestion] = useState("");
  const [mistakeReason, setMistakeReason] = useState("");
  const [mistakeStatus, setMistakeStatus] = useState("");

  useEffect(() => {
    if (isDemo) return;
    let active = true;
    const today = shanghaiDateKey(new Date());
    Promise.all([api.today(), api.listPlans("day"), api.listMistakes(true)])
      .then(([snapshot, plans, dueMistakes]) => {
        if (!active) return;
        const todayPlans = plans.filter((plan) => plan.starts_on === today);
        const planTitleById = new Map(todayPlans.map((plan) => [plan.id, plan.title]));
        setDayPlans(todayPlans);
        setNewTaskPlanId(todayPlans.find((plan) => plan.status === "active")?.id ?? todayPlans[0]?.id ?? "");
        setTasks(snapshot.tasks.map((task) => taskFromApi(task, task.plan_id ? planTitleById.get(task.plan_id) : undefined)));
        setTodaySessions(snapshot.sessions
          .filter((session) => sessionTouchesShanghaiDay(session, today))
          .sort((left, right) => new Date(right.started_at).getTime() - new Date(left.started_at).getTime()));
        setMistakes(dueMistakes);
        setDashboardMetrics(snapshot.metrics);
        setTodayMinutes(snapshot.metrics.today_effective_minutes);
        setCloudState("ready");
        setRecordStatus("已同步至 Supabase 云端 · 数据来自学习会话");
      })
      .catch(() => {
        if (!active) return;
        setCloudState("error");
        setRecordStatus("云端学习数据加载失败 · 请检查数据服务后刷新页面");
      });
    return () => { active = false; };
  }, [isDemo]);

  async function refreshDashboardMetrics() {
    if (isDemo) return;
    try {
      const snapshot = await api.today();
      setDashboardMetrics(snapshot.metrics);
      setTodayMinutes(snapshot.metrics.today_effective_minutes);
      const actualMinutesByTask = new Map(snapshot.tasks.map((task) => [task.id, task.actual_minutes ?? 0]));
      setTasks((items) => items.map((task) => actualMinutesByTask.has(task.id)
        ? { ...task, actualMinutes: actualMinutesByTask.get(task.id) ?? 0 }
        : task));
    } catch {
      // Keep the last confirmed values; the next page refresh will retry.
    }
  }

  const focusStorageKey = `kaoyan-focus-session:${accountKey}`;

  useEffect(() => {
    const hydrationTimer = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(focusStorageKey);
        if (raw) {
          const stored = JSON.parse(raw) as StoredFocusSession;
          const startedAt = new Date(stored.startedAt);
          const pauseStartedAt = stored.pauseStartedAt ? new Date(stored.pauseStartedAt) : null;
          const validSubject = Object.hasOwn(subjectMeta, stored.subject);
          if (!Number.isNaN(startedAt.getTime()) && (!pauseStartedAt || !Number.isNaN(pauseStartedAt.getTime())) && validSubject) {
            setSessionStartedAt(startedAt);
            setPauseStartedAt(pauseStartedAt);
            setPausedSeconds(Math.max(0, stored.pausedSeconds));
            setFocusTaskId(stored.taskId || "");
            setFocusSubject(stored.subject);
            setRunning(Boolean(stored.running));
            setRecordStatus(stored.running ? "已恢复正在进行的专注计时" : "已恢复暂停中的专注计时");
          } else {
            window.localStorage.removeItem(focusStorageKey);
          }
        }
      } catch {
        window.localStorage.removeItem(focusStorageKey);
      } finally {
        setFocusHydrated(true);
      }
    }, 0);
    return () => {
      window.clearTimeout(hydrationTimer);
    };
  }, [focusStorageKey]);

  useEffect(() => {
    if (!focusHydrated) return;
    if (!sessionStartedAt) {
      window.localStorage.removeItem(focusStorageKey);
      return;
    }
    const stored: StoredFocusSession = {
      startedAt: sessionStartedAt.toISOString(),
      pauseStartedAt: pauseStartedAt?.toISOString() ?? null,
      pausedSeconds,
      taskId: focusTaskId,
      subject: focusSubject,
      running,
    };
    window.localStorage.setItem(focusStorageKey, JSON.stringify(stored));
  }, [focusHydrated, focusStorageKey, focusSubject, focusTaskId, pauseStartedAt, pausedSeconds, running, sessionStartedAt]);

  useEffect(() => {
    if (!sessionStartedAt) return;
    const updateElapsedSeconds = () => {
      const now = Date.now();
      const currentPauseSeconds = pauseStartedAt ? Math.max(0, Math.floor((now - pauseStartedAt.getTime()) / 1000)) : 0;
      const totalSeconds = Math.max(0, Math.floor((now - sessionStartedAt.getTime()) / 1000) - pausedSeconds - currentPauseSeconds);
      setSeconds(totalSeconds);
    };
    const initialFrame = window.requestAnimationFrame(updateElapsedSeconds);
    if (!running) return () => window.cancelAnimationFrame(initialFrame);
    const timer = window.setInterval(updateElapsedSeconds, 1000);
    return () => {
      window.cancelAnimationFrame(initialFrame);
      window.clearInterval(timer);
    };
  }, [pauseStartedAt, pausedSeconds, running, sessionStartedAt]);

  async function addTask(event: FormEvent) {
    event.preventDefault();
    if (!newTask.trim() || newTaskBusy) return;
    const title = newTask.trim();
    const selectedPlan = dayPlans.find((plan) => plan.id === newTaskPlanId);
    const temporaryId = `local-${Date.now()}`;
    setTasks((items) => [...items, { id: temporaryId, title, detail: `计划 30 分钟${selectedPlan ? ` · ${selectedPlan.title}` : ""}`, subject: newTaskSubject, done: false, plannedMinutes: 30, actualMinutes: 0, planId: newTaskPlanId || null, dueAt: null }]);
    setNewTask("");
    if (isDemo) {
      setRecordStatus("演示任务仅保留在当前页面");
      return;
    }
    setNewTaskBusy(true);
    try {
      const saved = await api.createTask({ title, subject: newTaskSubject, planned_minutes: 30, plan_id: newTaskPlanId || undefined });
      setTasks((items) => items.map((item) => item.id === temporaryId ? taskFromApi(saved, selectedPlan?.title) : item));
      setRecordStatus(selectedPlan ? `任务已关联日计划“${selectedPlan.title}”` : "任务已写入 Supabase 云端");
      void refreshDashboardMetrics();
    } catch (error) {
      setTasks((items) => items.filter((item) => item.id !== temporaryId));
      setNewTask((current) => current || title);
      setRecordStatus(studyWriteErrorMessage(error, "创建任务"));
    } finally {
      setNewTaskBusy(false);
    }
  }

  async function toggleTask(task: Task) {
    if (taskBusyId === task.id) return;
    const completed = !task.done;
    setTasks((items) => items.map((item) => item.id === task.id ? { ...item, done: completed } : item));
    if (task.id.startsWith("demo-") || task.id.startsWith("local-")) return;
    setTaskBusyId(task.id);
    try {
      await api.updateTask(task.id, { completed });
      setRecordStatus(completed ? "任务完成状态已同步" : "任务已恢复为待完成");
      setContributionRevision((value) => value + 1);
      void refreshDashboardMetrics();
    } catch (error) {
      setTasks((items) => items.map((item) => item.id === task.id ? { ...item, done: task.done } : item));
      setRecordStatus(studyWriteErrorMessage(error, completed ? "完成任务" : "恢复任务"));
    } finally {
      setTaskBusyId(null);
    }
  }

  function beginTaskEdit(task: Task) {
    setEditingTaskId(task.id);
    setEditTaskTitle(task.title);
    setEditTaskSubject(task.subject);
    setEditTaskMinutes(task.plannedMinutes);
    setEditTaskPlanId(task.planId ?? "");
    setRecordStatus(`正在编辑任务“${task.title}”`);
  }

  async function saveTaskEdit(event: FormEvent, task: Task) {
    event.preventDefault();
    if (taskBusyId) return;
    const title = editTaskTitle.trim();
    if (!title || editTaskMinutes < 1 || editTaskMinutes > 1440) {
      setRecordStatus("请填写任务标题，预计时长需在 1–1440 分钟之间");
      return;
    }
    const selectedPlan = dayPlans.find((plan) => plan.id === editTaskPlanId);
    const nextTask: Task = {
      ...task,
      title,
      subject: editTaskSubject,
      plannedMinutes: editTaskMinutes,
      planId: editTaskPlanId || null,
      detail: `计划 ${editTaskMinutes} 分钟${selectedPlan ? ` · ${selectedPlan.title}` : ""}${task.dueAt ? ` · ${task.dueAt.slice(0, 10)}` : ""}`,
    };
    if (isDemo || task.id.startsWith("demo-") || task.id.startsWith("local-")) {
      setTasks((items) => items.map((item) => item.id === task.id ? nextTask : item));
      setEditingTaskId(null);
      setRecordStatus("演示任务修改仅保留在当前页面");
      return;
    }
    setTaskBusyId(task.id);
    try {
      const saved = await api.updateTask(task.id, {
        title,
        subject: editTaskSubject,
        planned_minutes: editTaskMinutes,
        plan_id: editTaskPlanId || null,
      });
      setTasks((items) => items.map((item) => item.id === task.id ? taskFromApi(saved, selectedPlan?.title, task.actualMinutes) : item));
      if (focusTaskId === task.id) setFocusSubject(saved.subject);
      setEditingTaskId(null);
      setRecordStatus("任务修改已同步至 Supabase 云端");
      void refreshDashboardMetrics();
    } catch (error) {
      setRecordStatus(studyWriteErrorMessage(error, "修改任务"));
    } finally {
      setTaskBusyId(null);
    }
  }

  async function deleteTask(task: Task) {
    if (taskBusyId) return;
    if (focusTaskId === task.id && sessionStartedAt) {
      setRecordStatus("该任务正在专注计时，请先结束并记录本次专注");
      return;
    }
    if (!window.confirm(`确定删除任务“${task.title}”吗？`)) return;
    if (isDemo || task.id.startsWith("demo-") || task.id.startsWith("local-")) {
      setTasks((items) => items.filter((item) => item.id !== task.id));
      if (focusTaskId === task.id) setFocusTaskId("");
      if (manualTaskId === task.id) setManualTaskId("");
      setEditingTaskId(null);
      setRecordStatus("演示任务已从当前页面删除");
      return;
    }
    setTaskBusyId(task.id);
    try {
      await api.deleteTask(task.id);
      setTasks((items) => items.filter((item) => item.id !== task.id));
      if (focusTaskId === task.id) setFocusTaskId("");
      if (manualTaskId === task.id) setManualTaskId("");
      setEditingTaskId(null);
      setRecordStatus("任务已从 Supabase 云端删除");
      setContributionRevision((value) => value + 1);
      void refreshDashboardMetrics();
    } catch (error) {
      setRecordStatus(studyWriteErrorMessage(error, "删除任务"));
    } finally {
      setTaskBusyId(null);
    }
  }

  async function addMistake(event: FormEvent) {
    event.preventDefault();
    if (!mistakeTitle.trim() || !mistakeQuestion.trim()) {
      setMistakeStatus("请填写错题标题和题目内容");
      return;
    }
    const payload = {
      subject: mistakeSubject,
      title: mistakeTitle.trim(),
      question: mistakeQuestion.trim(),
      error_reason: mistakeReason.trim(),
    };
    setMistakeBusy(true);
    try {
      const saved = isDemo
        ? { ...payload, id: `demo-mistake-${Date.now()}`, answer: "", mastery: 1, next_review_at: new Date().toISOString(), review_count: 0 }
        : await api.createMistake(payload);
      setMistakes((items) => [saved, ...items]);
      setMistakeTitle("");
      setMistakeQuestion("");
      setMistakeReason("");
      setMistakeFormOpen(false);
      setMistakeStatus(isDemo ? "演示错题已加入当前复习列表" : "错题已写入云端并加入复习列表");
      setContributionRevision((value) => value + 1);
    } catch (error) {
      setMistakeStatus(studyWriteErrorMessage(error, "保存错题"));
    } finally {
      setMistakeBusy(false);
    }
  }

  async function reviewMistake(card: ApiMistakeCard, result: MistakeReviewResult) {
    setReviewBusyId(card.id);
    try {
      const reviewed = isDemo
        ? { ...card, review_count: card.review_count + 1 }
        : await api.reviewMistake(card.id, result);
      setMistakes((items) => items.filter((item) => item.id !== card.id));
      setMistakeStatus(`“${card.title}”复习完成，第 ${reviewed.review_count} 次记录已保存`);
    } catch (error) {
      setMistakeStatus(studyWriteErrorMessage(error, "保存复习记录"));
    } finally {
      setReviewBusyId(null);
    }
  }

  function beginFocus() {
    if (!sessionStartedAt) {
      setSessionStartedAt(new Date());
      setSeconds(0);
      setPausedSeconds(0);
    } else if (pauseStartedAt) {
      setPausedSeconds((value) => value + Math.floor((Date.now() - pauseStartedAt.getTime()) / 1000));
      setPauseStartedAt(null);
    }
    setRunning(true);
  }

  function beginTaskFocus(task: Task) {
    if (sessionStartedAt) {
      setRecordStatus("已有专注正在进行，请先结束当前计时");
      return;
    }
    setFocusTaskId(task.id);
    setFocusSubject(task.subject);
    setRecordStatus(`正在专注任务“${task.title}”`);
    beginFocus();
  }

  function selectFocusTask(event: ChangeEvent<HTMLSelectElement>) {
    const taskId = event.target.value;
    setFocusTaskId(taskId);
    const task = tasks.find((item) => item.id === taskId);
    if (task) setFocusSubject(task.subject);
  }

  function pauseFocus() {
    setRunning(false);
    setPauseStartedAt(new Date());
  }

  function cancelFocus() {
    if (!sessionStartedAt || focusSaving || !window.confirm("确定放弃本次专注吗？当前计时不会写入学习记录。")) return;
    setRunning(false);
    setSessionStartedAt(null);
    setPauseStartedAt(null);
    setPausedSeconds(0);
    setSeconds(0);
    setFocusTaskId("");
    setRecordStatus("本次专注已放弃，未写入学习记录");
  }

  async function finishFocus() {
    if (!sessionStartedAt || focusSaving) return;
    const endedAt = new Date();
    const linkedTask = tasks.find((task) => task.id === focusTaskId);
    const finalPausedSeconds = pausedSeconds + (pauseStartedAt ? Math.floor((endedAt.getTime() - pauseStartedAt.getTime()) / 1000) : 0);
    setRunning(false);
    if (isDemo) {
      const demoSession: ApiStudySession = {
        id: `demo-session-${Date.now()}`,
        task_id: linkedTask?.id ?? null,
        subject: focusSubject,
        started_at: sessionStartedAt.toISOString(),
        ended_at: endedAt.toISOString(),
        paused_seconds: finalPausedSeconds,
        source: "timer",
        note: "由今日工作台计时器记录",
      };
      setTodaySessions((items) => [demoSession, ...items]);
      setTodayMinutes((value) => (value ?? 0) + Math.floor(seconds / 60));
      if (linkedTask) setTasks((items) => items.map((task) => task.id === linkedTask.id
        ? { ...task, actualMinutes: task.actualMinutes + studySessionMinutes(demoSession) }
        : task));
      setRecordStatus(`演示专注已记录在本页 · ${formatMinutes(Math.floor(seconds / 60))}`);
      setSessionStartedAt(null);
      setPauseStartedAt(null);
      setPausedSeconds(0);
      setSeconds(0);
      setFocusTaskId("");
      return;
    }
    setFocusSaving(true);
    try {
      const saved = await api.createSession({
        task_id: linkedTask?.id,
        subject: focusSubject,
        started_at: sessionStartedAt.toISOString(),
        ended_at: endedAt.toISOString(),
        paused_seconds: finalPausedSeconds,
        source: "timer",
        note: "由今日工作台计时器记录",
      });
      if (sessionTouchesShanghaiDay(saved, shanghaiDateKey(new Date()))) {
        setTodaySessions((items) => [saved, ...items.filter((item) => item.id !== saved.id)]);
      }
      setTodayMinutes((value) => (value ?? 0) + Math.floor(seconds / 60));
      setRecordStatus(`${linkedTask ? `任务“${linkedTask.title}”` : subjectMeta[focusSubject].label}专注已记录 · ${formatMinutes(Math.floor(seconds / 60))}`);
      setContributionRevision((value) => value + 1);
      void refreshDashboardMetrics();
      setSessionStartedAt(null);
      setPauseStartedAt(null);
      setPausedSeconds(0);
      setSeconds(0);
      setFocusTaskId("");
    } catch (error) {
      setRecordStatus(studyWriteErrorMessage(error, "保存专注记录"));
      setPausedSeconds(finalPausedSeconds);
      setPauseStartedAt(endedAt);
    } finally {
      setFocusSaving(false);
    }
  }

  async function addManualSession(event: FormEvent) {
    event.preventDefault();
    if (manualBusy) return;
    setManualError("");
    if (manualDate > shanghaiDateKey(new Date())) {
      setManualError("不能补录未来的学习记录");
      return;
    }

    let interval: ReturnType<typeof createShanghaiStudyInterval>;
    try {
      interval = createShanghaiStudyInterval(
        manualDate,
        manualStartedTime,
        manualEndedTime,
      );
    } catch (error) {
      setManualError(error instanceof Error ? error.message : "补录时间无效");
      return;
    }

    const linkedTask = tasks.find((task) => task.id === manualTaskId);

    if (isDemo) {
      const demoSession: ApiStudySession = {
        id: `demo-session-${Date.now()}`,
        task_id: linkedTask?.id ?? null,
        subject: manualSubject,
        started_at: interval.startedAt.toISOString(),
        ended_at: interval.endedAt.toISOString(),
        paused_seconds: 0,
        source: "manual",
        note: manualNote.trim() || "由今日工作台手动补录",
      };
      if (manualDate === shanghaiDateKey(new Date())) {
        setTodaySessions((items) => [demoSession, ...items]);
        setTodayMinutes((value) => (value ?? 0) + interval.effectiveMinutes);
        if (linkedTask) setTasks((items) => items.map((task) => task.id === linkedTask.id
          ? { ...task, actualMinutes: task.actualMinutes + interval.effectiveMinutes }
          : task));
      }
      setRecordStatus(`演示补录仅保留在本页${linkedTask ? ` · 已关联“${linkedTask.title}”` : ""} · ${formatMinutes(interval.effectiveMinutes)}`);
      setManualOpen(false);
      setManualTaskId("");
      setManualNote("");
      return;
    }

    setManualBusy(true);
    try {
      const saved = await api.createSession({
        task_id: linkedTask?.id,
        subject: manualSubject,
        started_at: interval.startedAt.toISOString(),
        ended_at: interval.endedAt.toISOString(),
        paused_seconds: 0,
        source: "manual",
        note: manualNote.trim() || "由今日工作台手动补录",
      });
      if (manualDate === shanghaiDateKey(new Date())) {
        setTodaySessions((items) => [saved, ...items.filter((item) => item.id !== saved.id)]);
        setTodayMinutes((value) => (value ?? 0) + interval.effectiveMinutes);
      }
      setRecordStatus(`${manualDate} ${linkedTask ? `任务“${linkedTask.title}”` : subjectMeta[manualSubject].label}已补录 · ${formatMinutes(interval.effectiveMinutes)}`);
      setContributionRevision((value) => value + 1);
      void refreshDashboardMetrics();
      setManualOpen(false);
      setManualTaskId("");
      setManualNote("");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "云端写入失败";
      setManualError(detail.includes("overlap")
        ? "该时间段与已有学习记录重叠，请调整后重试"
        : studyWriteErrorMessage(error, "保存手动补录"));
    } finally {
      setManualBusy(false);
    }
  }

  async function deleteStudySession(session: ApiStudySession) {
    if (sessionBusyId) return;
    if (!window.confirm(`确定删除这条${subjectMeta[session.subject].label}学习记录吗？`)) return;
    if (isDemo || session.id.startsWith("demo-session-")) {
      setTodaySessions((items) => items.filter((item) => item.id !== session.id));
      setTodayMinutes((value) => Math.max(0, (value ?? 0) - studySessionMinutes(session)));
      if (session.task_id) setTasks((items) => items.map((task) => task.id === session.task_id
        ? { ...task, actualMinutes: Math.max(0, task.actualMinutes - studySessionMinutes(session)) }
        : task));
      setRecordStatus("演示学习记录已从当前页面删除");
      return;
    }
    setSessionBusyId(session.id);
    try {
      await api.deleteSession(session.id);
      setTodaySessions((items) => items.filter((item) => item.id !== session.id));
      setRecordStatus("误录的学习记录已从 Supabase 云端删除");
      setContributionRevision((value) => value + 1);
      await refreshDashboardMetrics();
    } catch (error) {
      setRecordStatus(studyWriteErrorMessage(error, "删除学习记录"));
    } finally {
      setSessionBusyId(null);
    }
  }

  const completed = tasks.filter((task) => task.done).length;
  const focusTask = tasks.find((task) => task.id === focusTaskId);
  const focusTargetLabel = focusTask?.title ?? subjectMeta[focusSubject].label;
  const focusSessionMinutes = Math.floor(seconds / 60);
  const focusTaskMinutes = focusTask ? focusTask.actualMinutes + focusSessionMinutes : 0;
  const focusTaskProgress = focusTask
    ? Math.min(100, Math.round((focusTaskMinutes / Math.max(1, focusTask.plannedMinutes)) * 100))
    : 0;
  const focusTaskRemainingMinutes = focusTask
    ? Math.max(0, focusTask.plannedMinutes - focusTaskMinutes)
    : 0;

  return (
    <>
      <div className="hero-row">
        <div>
          <div className="eyebrow">{shanghaiDisplayDate(new Date())}{dashboardMetrics?.active_stage_title ? ` · ${dashboardMetrics.active_stage_title}` : ""}</div>
          <h1>早上好，{displayName}</h1>
          <p>今天把注意力留给最重要的事。完成基础任务，就是向目标院校靠近一步。</p>
        </div>
        <button className="primary-button" onClick={beginFocus}>＋ 开始一次专注</button>
      </div>

      <div className="metric-grid">
        <article className="metric-card accent"><span>今日有效学习</span>{cloudState === "loading" ? <><strong className="metric-loading">加载中</strong><em>正在读取云端学习会话</em></> : cloudState === "error" ? <><strong>--</strong><em>云端数据暂时不可用</em></> : <><strong>{Math.floor((todayMinutes ?? 0) / 60)}<small>h</small> {(todayMinutes ?? 0) % 60}<small>m</small></strong><em>{dashboardMetrics?.today_planned_minutes ? `任务目标 ${formatMinutes(dashboardMetrics.today_planned_minutes)} · ${Math.min(100, Math.round((todayMinutes ?? 0) / dashboardMetrics.today_planned_minutes * 100))}%` : "今天还没有安排任务目标"}</em></>}</article>
        <article className="metric-card"><span>本周完成率</span>{cloudState === "loading" ? <><strong className="metric-loading">加载中</strong><em>正在统计本周任务</em></> : cloudState === "error" || !dashboardMetrics ? <><strong>--</strong><em>云端数据暂时不可用</em></> : <><strong>{dashboardMetrics.weekly_completion_rate}<small>%</small></strong><em>已完成 {dashboardMetrics.weekly_completed_tasks} / {dashboardMetrics.weekly_task_count} 项</em></>}</article>
        <article className="metric-card"><span>连续学习</span>{cloudState === "loading" ? <><strong className="metric-loading">加载中</strong><em>正在统计学习记录</em></> : cloudState === "error" || !dashboardMetrics ? <><strong>--</strong><em>云端数据暂时不可用</em></> : <><strong>{dashboardMetrics.current_streak_days}<small>天</small></strong><em>近一年最长 {dashboardMetrics.longest_streak_days} 天</em></>}</article>
        <article className="metric-card"><span>待复习错题</span>{cloudState === "loading" ? <><strong className="metric-loading">加载中</strong><em>正在读取复习队列</em></> : <><strong>{mistakes.length}<small>道</small></strong><em>{mistakes.length ? "已到期 · 建议今天完成" : "当前复习队列已清空"}</em></>}</article>
      </div>

      <ExamCountdown key={accountKey} accountKey={accountKey} today={shanghaiDateKey(new Date())} />

      <StudyHeatmap isDemo={isDemo} refreshVersion={contributionRevision} />

      <div className="dashboard-grid">
        <section className="panel task-panel">
          <div className="panel-heading compact"><div><div className="eyebrow">今日清单</div><h2>{cloudState === "loading" ? "正在加载云端任务…" : `${completed} / ${tasks.length} 已完成`}</h2></div><span className="subtle-pill">考研 60% · 项目 40%</span></div>
          <div className="progress-track"><span style={{ width: `${tasks.length ? (completed / tasks.length) * 100 : 0}%` }} /></div>
          <div className="task-list">
            {cloudState === "loading" && <div className="task-loading cloud-loading-text">正在同步你的今日任务…</div>}
            {cloudState === "ready" && tasks.length === 0 && <div className="task-loading">今天还没有任务，可以从下方添加第一项。</div>}
            {tasks.map((task) => <div className={`task-item-shell ${task.done ? "done" : ""}`} key={task.id}>
              <div className="task-item">
                <label className="task-check" aria-label={`${task.done ? "恢复" : "完成"}任务 ${task.title}`}>
                  <input type="checkbox" checked={task.done} onChange={() => void toggleTask(task)} disabled={taskBusyId === task.id} />
                  <span className="fake-check">✓</span>
                </label>
                <span className={`subject-badge ${task.subject}`}>{subjectMeta[task.subject].short}</span>
                <span className="task-copy"><strong>{task.title}</strong><small>{task.detail}</small><TaskStudyProgress task={task} /></span>
                <span className="task-actions">
                  {!task.done && <button type="button" onClick={() => beginTaskFocus(task)} disabled={Boolean(sessionStartedAt) || task.id.startsWith("local-")}>专注</button>}
                  <button type="button" onClick={() => beginTaskEdit(task)} disabled={taskBusyId === task.id}>编辑</button>
                  <button type="button" className="danger" onClick={() => void deleteTask(task)} disabled={taskBusyId === task.id}>{taskBusyId === task.id ? "处理中" : "删除"}</button>
                </span>
              </div>
              {editingTaskId === task.id && <form className="task-edit-form" onSubmit={(event) => void saveTaskEdit(event, task)}>
                <label>任务标题<input value={editTaskTitle} onChange={(event) => setEditTaskTitle(event.target.value)} maxLength={160} required /></label>
                <label>科目<select value={editTaskSubject} onChange={(event) => setEditTaskSubject(event.target.value as Subject)}>{Object.entries(subjectMeta).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}</select></label>
                <label>预计分钟<input type="number" min="1" max="1440" value={editTaskMinutes} onChange={(event) => setEditTaskMinutes(Number(event.target.value))} required /></label>
                <label>所属日计划<select value={editTaskPlanId} onChange={(event) => setEditTaskPlanId(event.target.value)}><option value="">不关联日计划</option>{task.planId && !dayPlans.some((plan) => plan.id === task.planId) && <option value={task.planId}>当前关联的历史日计划</option>}{dayPlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.title}</option>)}</select></label>
                <div className="task-edit-actions"><button type="button" onClick={() => setEditingTaskId(null)} disabled={taskBusyId === task.id}>取消</button><button type="submit" disabled={taskBusyId === task.id}>{taskBusyId === task.id ? "正在保存…" : "保存修改"}</button></div>
              </form>}
            </div>)}
          </div>
          <form className="quick-add" onSubmit={addTask}><select value={newTaskSubject} onChange={(event) => setNewTaskSubject(event.target.value as Subject)} aria-label="任务科目" disabled={newTaskBusy}>{Object.entries(subjectMeta).map(([key, meta]) => <option key={key} value={key}>{meta.short}</option>)}</select><select className="task-plan-select" value={newTaskPlanId} onChange={(event) => setNewTaskPlanId(event.target.value)} aria-label="所属日计划" disabled={newTaskBusy}><option value="">{dayPlans.length ? "不关联日计划" : "今天暂无日计划"}</option>{dayPlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.title}</option>)}</select><input value={newTask} onChange={(event) => setNewTask(event.target.value)} placeholder="快速添加一个任务…" aria-label="新任务" disabled={newTaskBusy} /><button type="submit" disabled={newTaskBusy}>{newTaskBusy ? "正在保存…" : "添加"}</button></form>
          <p className="record-status">● {recordStatus}</p>
        </section>

        <aside className="right-stack">
          <section className="panel focus-card">
            <div className={`focus-top ${sessionStartedAt && !running ? "paused" : ""}`}><span className="focus-dot" /><span>{running ? `正在专注 · ${focusTargetLabel}` : sessionStartedAt ? `已暂停 · ${focusTargetLabel}` : "专注计时器"}</span></div>
            <strong className="timer">{formatTimer(seconds)}</strong>
            <select className="focus-select" value={focusTaskId} onChange={selectFocusTask} disabled={Boolean(sessionStartedAt)} aria-label="关联今日任务"><option value="">自由专注（不关联任务）</option>{tasks.filter((task) => !task.done && (isDemo || !task.id.startsWith("local-"))).map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select>
            <select className="focus-select" value={focusSubject} onChange={(event) => setFocusSubject(event.target.value as Subject)} disabled={Boolean(sessionStartedAt) || Boolean(focusTaskId)} aria-label="专注科目">{Object.entries(subjectMeta).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}</select>
            {sessionStartedAt && <div className="focus-session-summary" aria-live="polite">
              {focusTask ? <>
                <span className="focus-session-copy"><span>任务累计 {formatMinutes(focusTaskMinutes)} / {formatMinutes(focusTask.plannedMinutes)}</span><strong>{focusTaskRemainingMinutes ? `还差 ${formatMinutes(focusTaskRemainingMinutes)}` : "任务时长已达标"}</strong></span>
                <span className="focus-session-track" role="progressbar" aria-label={`${focusTask.title}专注进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={focusTaskProgress}><span style={{ width: `${focusTaskProgress}%` }} /></span>
              </> : <span className="focus-session-copy"><span>自由专注 · {subjectMeta[focusSubject].label}</span><strong>本次已计入 {formatMinutes(focusSessionMinutes)}</strong></span>}
              {!running && <small>计时已暂停，暂停期间不计入有效学习时长</small>}
            </div>}
            <div className="timer-actions"><button onClick={running ? pauseFocus : beginFocus} disabled={focusSaving}>{running ? "暂停" : sessionStartedAt ? "继续" : "开始"}</button><button className="secondary" onClick={() => void finishFocus()} disabled={!sessionStartedAt || focusSaving}>{focusSaving ? "正在保存…" : "结束并记录"}</button><button className="cancel" onClick={cancelFocus} disabled={!sessionStartedAt || focusSaving}>放弃</button></div>
          </section>
          <section className="panel manual-card">
            <div className="manual-heading"><div><div className="eyebrow">学习记录</div><strong>手动补录</strong></div><button type="button" disabled={manualBusy} onClick={() => { setManualOpen((value) => !value); setManualError(""); }}>{manualOpen ? "收起" : "＋ 补录"}</button></div>
            {manualOpen && <form className="manual-form" onSubmit={addManualSession}>
              <label className="manual-date">日期<input type="date" value={manualDate} max={shanghaiDateKey(new Date())} onChange={(event) => setManualDate(event.target.value)} disabled={manualBusy} required /></label>
              <label className="manual-task">关联今日任务<select value={manualTaskId} onChange={(event) => { const taskId = event.target.value; setManualTaskId(taskId); const task = tasks.find((item) => item.id === taskId); if (task) setManualSubject(task.subject); }} aria-label="补录关联今日任务" disabled={manualBusy}><option value="">不关联任务</option>{tasks.filter((task) => isDemo || !task.id.startsWith("local-")).map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>
              <label>科目<select value={manualSubject} onChange={(event) => setManualSubject(event.target.value as Subject)} disabled={manualBusy || Boolean(manualTaskId)}>{Object.entries(subjectMeta).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}</select></label>
              <label>开始时间<input type="time" value={manualStartedTime} onChange={(event) => setManualStartedTime(event.target.value)} disabled={manualBusy} required /></label>
              <label>结束时间<input type="time" value={manualEndedTime} onChange={(event) => setManualEndedTime(event.target.value)} disabled={manualBusy} required /></label>
              <label className="manual-note">学习内容<input type="text" value={manualNote} onChange={(event) => setManualNote(event.target.value)} placeholder="例如：极限基础题复盘" maxLength={200} disabled={manualBusy} /></label>
              {manualError && <p className="manual-error" role="alert">{manualError}</p>}
              <div className="manual-actions"><button type="button" onClick={() => setManualOpen(false)} disabled={manualBusy}>取消</button><button type="submit" disabled={manualBusy}>{manualBusy ? "正在保存…" : "保存记录"}</button></div>
            </form>}
            <TodaySubjectBreakdown sessions={todaySessions} />
            <div className="recent-session-heading"><strong>今日最近记录</strong><span>{todaySessions.length} 次</span></div>
            <div className="recent-session-list">
              {todaySessions.length === 0 && <p className="recent-session-empty">今天还没有学习记录，完成一次专注或补录后会显示在这里。</p>}
              {todaySessions.slice(0, 5).map((session) => <article className="recent-session-item" key={session.id}>
                <span className={`subject-badge ${session.subject}`}>{subjectMeta[session.subject].short}</span>
                <span className="recent-session-copy"><strong>{tasks.find((task) => task.id === session.task_id)?.title ?? subjectMeta[session.subject].label} · {formatMinutes(studySessionMinutes(session))}</strong><small>{formatSessionTime(session.started_at)}–{formatSessionTime(session.ended_at)} · {session.source === "timer" ? "专注计时" : "手动补录"}</small>{session.task_id && <small>关联任务 · {tasks.find((task) => task.id === session.task_id)?.title ?? "已删除任务"}</small>}{session.note && <small>{session.note}</small>}</span>
                <button type="button" onClick={() => void deleteStudySession(session)} disabled={sessionBusyId === session.id}>{sessionBusyId === session.id ? "删除中" : "删除"}</button>
              </article>)}
            </div>
          </section>
          <section className="panel review-card">
            <div className="review-heading"><div><div className="eyebrow">错题复习</div><strong>{mistakes.length} 道待复习</strong></div><button type="button" onClick={() => { setMistakeFormOpen((value) => !value); setMistakeStatus(""); }}>{mistakeFormOpen ? "收起" : "＋ 速记"}</button></div>
            {mistakeFormOpen && <form className="mistake-form" onSubmit={addMistake}>
              <label>科目<select value={mistakeSubject} onChange={(event) => setMistakeSubject(event.target.value as MistakeSubject)}>{Object.entries(subjectMeta).filter(([key]) => key !== "career").map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}</select></label>
              <label>错题标题<input value={mistakeTitle} onChange={(event) => setMistakeTitle(event.target.value)} placeholder="例如：二叉树非递归遍历" maxLength={160} required /></label>
              <label>题目或知识点<textarea value={mistakeQuestion} onChange={(event) => setMistakeQuestion(event.target.value)} placeholder="记录题目、题号或关键条件" maxLength={10000} required /></label>
              <label>错误原因<textarea value={mistakeReason} onChange={(event) => setMistakeReason(event.target.value)} placeholder="我为什么做错？" maxLength={10000} /></label>
              <button type="submit" disabled={mistakeBusy}>{mistakeBusy ? "正在保存…" : "保存错题"}</button>
            </form>}
            <div className="mistake-list">
              {mistakes.length === 0 && <p className="mistake-empty">当前没有到期错题，保持这个节奏。</p>}
              {mistakes.map((card) => <article className="mistake-item" key={card.id}><div><span className={`subject-badge ${card.subject}`}>{subjectMeta[card.subject].short}</span><strong>{card.title}</strong><small>掌握度 {card.mastery}/5 · 已复习 {card.review_count} 次</small></div><p>{card.question}</p>{card.error_reason && <p className="mistake-reason">错因：{card.error_reason}</p>}<div className="review-actions"><button type="button" disabled={reviewBusyId === card.id} onClick={() => void reviewMistake(card, "again")}>重来</button><button type="button" disabled={reviewBusyId === card.id} onClick={() => void reviewMistake(card, "hard")}>困难</button><button type="button" disabled={reviewBusyId === card.id} onClick={() => void reviewMistake(card, "good")}>良好</button><button type="button" disabled={reviewBusyId === card.id} onClick={() => void reviewMistake(card, "easy")}>简单</button></div></article>)}
            </div>
            {mistakeStatus && <p className="mistake-status">● {mistakeStatus}</p>}
          </section>
        </aside>
      </div>
    </>
  );
}

const demoPlans: ApiPlan[] = [
  { id: "demo-stage-1", parent_id: null, level: "stage", title: "基础阶段", description: "数英 408 完成第一轮基础", starts_on: "2026-09-01", ends_on: "2027-02-28", status: "active" },
  { id: "demo-stage-2", parent_id: null, level: "stage", title: "强化阶段", description: "专题强化与院校池收缩", starts_on: "2027-03-01", ends_on: "2027-06-30", status: "draft" },
  { id: "demo-stage-3", parent_id: null, level: "stage", title: "真题阶段", description: "真题、政治与复试能力预备", starts_on: "2027-07-01", ends_on: "2027-10-31", status: "draft" },
  { id: "demo-stage-4", parent_id: null, level: "stage", title: "冲刺阶段", description: "模考、查漏补缺与状态管理", starts_on: "2027-11-01", ends_on: "2027-12-31", status: "draft" },
  { id: "demo-week-1", parent_id: "demo-stage-1", level: "week", title: "基础阶段第 1 周", description: "建立数学、英语与 408 的稳定节奏", starts_on: "2026-09-01", ends_on: "2026-09-06", status: "active" },
];

const planStatusLabel: Record<ApiPlan["status"], string> = {
  draft: "草稿",
  active: "执行中",
  completed: "已完成",
  archived: "已归档",
};

const planLevelLabel: Record<ApiPlan["level"], string> = {
  stage: "阶段",
  week: "周",
  day: "日",
};

const planStatusOptions: Array<{ value: PlanStatus; label: string }> = [
  { value: "draft", label: "草稿" },
  { value: "active", label: "执行中" },
  { value: "completed", label: "已完成" },
  { value: "archived", label: "已归档" },
];

function nextPlanStatus(plan: ApiPlan): { value: PlanStatus; label: string } {
  if (plan.status === "completed") return { value: "archived", label: "归档" };
  if (plan.status === "archived") return { value: "active", label: "恢复" };
  return { value: "completed", label: "完成" };
}

function planDateRange(plan: ApiPlan) {
  return `${plan.starts_on.replaceAll("-", ".")} — ${plan.ends_on.replaceAll("-", ".")}`;
}

function formatPlanMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours} 小时 ${remainder} 分钟` : `${remainder} 分钟`;
}

function suggestedWeekEnd(startsOn: string, parentEndsOn: string) {
  if (!startsOn) return "";
  const date = new Date(`${startsOn}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 6);
  return [date.toISOString().slice(0, 10), parentEndsOn].sort()[0];
}

function planCascadeIds(plans: ApiPlan[], rootId: string) {
  const ids = new Set([rootId]);
  let previousSize = 0;
  while (previousSize !== ids.size) {
    previousSize = ids.size;
    plans.forEach((plan) => {
      if (plan.parent_id && ids.has(plan.parent_id)) ids.add(plan.id);
    });
  }
  return ids;
}

function PlanView({ isDemo, onPlansChanged }: { isDemo: boolean; onPlansChanged?: () => void }) {
  const [plans, setPlans] = useState<ApiPlan[]>(() => isDemo ? demoPlans : []);
  const [loading, setLoading] = useState(!isDemo);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startsOn, setStartsOn] = useState(() => shanghaiDateKey(new Date()));
  const [endsOn, setEndsOn] = useState("");
  const [weekFormOpen, setWeekFormOpen] = useState(false);
  const [weekParentId, setWeekParentId] = useState("");
  const [weekTitle, setWeekTitle] = useState("");
  const [weekDescription, setWeekDescription] = useState("");
  const [weekStartsOn, setWeekStartsOn] = useState("");
  const [weekEndsOn, setWeekEndsOn] = useState("");
  const [weekBusy, setWeekBusy] = useState(false);
  const [dayFormOpen, setDayFormOpen] = useState(false);
  const [dayParentId, setDayParentId] = useState("");
  const [dayTitle, setDayTitle] = useState("");
  const [dayDescription, setDayDescription] = useState("");
  const [dayDate, setDayDate] = useState("");
  const [dayBusy, setDayBusy] = useState(false);
  const [editingPlan, setEditingPlan] = useState<ApiPlan | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editStartsOn, setEditStartsOn] = useState("");
  const [editEndsOn, setEditEndsOn] = useState("");
  const [editStatus, setEditStatus] = useState<PlanStatus>("draft");
  const [editBusy, setEditBusy] = useState(false);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);
  const [progressBusyId, setProgressBusyId] = useState<string | null>(null);
  const [selectedProgress, setSelectedProgress] = useState<{ plan: ApiPlan; progress: PlanProgress } | null>(null);
  const [status, setStatus] = useState(isDemo ? "当前显示离线演示计划" : "正在读取云端计划…");

  useEffect(() => {
    if (isDemo) return;
    let active = true;
    api.listPlans()
      .then((items) => {
        if (!active) return;
        setPlans(items);
        setStatus(items.length ? `已从云端同步 ${items.length} 条计划` : "云端还没有计划，可以创建第一个阶段计划");
      })
      .catch((error) => {
        if (active) setStatus(cloudReadErrorMessage(error, "计划"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [isDemo]);

  async function createStage(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!title.trim() || !endsOn || endsOn < startsOn) {
      setStatus(endsOn && endsOn < startsOn ? "阶段结束日期不能早于开始日期" : "请完整填写阶段名称和日期");
      return;
    }
    const payload = {
      level: "stage" as const,
      title: title.trim(),
      description: description.trim(),
      starts_on: startsOn,
      ends_on: endsOn,
      status: "active" as const,
    };
    setBusy(true);
    try {
      const saved = isDemo
        ? { ...payload, id: `demo-stage-${Date.now()}`, parent_id: null }
        : await api.createPlan(payload);
      setPlans((items) => [...items, saved].sort((left, right) => left.starts_on.localeCompare(right.starts_on)));
      onPlansChanged?.();
      setStatus(isDemo ? "演示阶段计划仅保留在当前页面" : "阶段计划已写入 Supabase 云端");
      setTitle("");
      setDescription("");
      setEndsOn("");
      setFormOpen(false);
    } catch (error) {
      setStatus(studyWriteErrorMessage(error, "保存阶段计划"));
    } finally {
      setBusy(false);
    }
  }

  const stages = plans.filter((plan) => plan.level === "stage");
  const weeks = plans.filter((plan) => plan.level === "week");
  const days = plans.filter((plan) => plan.level === "day");
  const weekParent = stages.find((stage) => stage.id === weekParentId);
  const dayParent = weeks.find((week) => week.id === dayParentId);
  const editParent = editingPlan?.parent_id
    ? plans.find((plan) => plan.id === editingPlan.parent_id)
    : undefined;

  function selectWeekParent(parentId: string) {
    const parent = stages.find((stage) => stage.id === parentId);
    setWeekParentId(parentId);
    if (!parent) {
      setWeekStartsOn("");
      setWeekEndsOn("");
      return;
    }
    setWeekStartsOn(parent.starts_on);
    setWeekEndsOn(suggestedWeekEnd(parent.starts_on, parent.ends_on));
  }

  function toggleWeekForm() {
    if (weekFormOpen) {
      setWeekFormOpen(false);
      return;
    }
    const parent = stages.find((stage) => stage.status === "active") ?? stages[0];
    if (!parent) {
      setStatus("请先创建阶段计划，再继续拆分周计划");
      return;
    }
    selectWeekParent(parent.id);
    setWeekFormOpen(true);
  }

  async function createWeek(event: FormEvent) {
    event.preventDefault();
    if (weekBusy) return;
    if (!weekParent || !weekTitle.trim() || !weekStartsOn || !weekEndsOn) {
      setStatus("请完整填写周计划的所属阶段、名称和日期");
      return;
    }
    if (weekEndsOn < weekStartsOn) {
      setStatus("周计划结束日期不能早于开始日期");
      return;
    }
    if (weekStartsOn < weekParent.starts_on || weekEndsOn > weekParent.ends_on) {
      setStatus("周计划日期必须在所属阶段范围内");
      return;
    }
    const payload = {
      parent_id: weekParent.id,
      level: "week" as const,
      title: weekTitle.trim(),
      description: weekDescription.trim(),
      starts_on: weekStartsOn,
      ends_on: weekEndsOn,
      status: "active" as const,
    };
    setWeekBusy(true);
    try {
      const saved = isDemo
        ? { ...payload, id: `demo-week-${weekParent.id}-${weekStartsOn}-${weekTitle.trim()}` }
        : await api.createPlan(payload);
      setPlans((items) => [...items, saved].sort((left, right) => left.starts_on.localeCompare(right.starts_on)));
      onPlansChanged?.();
      setStatus(isDemo ? "演示周计划仅保留在当前页面" : "周计划已写入 Supabase 云端");
      setWeekTitle("");
      setWeekDescription("");
      setWeekFormOpen(false);
    } catch (error) {
      setStatus(studyWriteErrorMessage(error, "保存周计划"));
    } finally {
      setWeekBusy(false);
    }
  }

  function selectDayParent(parentId: string) {
    const parent = weeks.find((week) => week.id === parentId);
    setDayParentId(parentId);
    setDayDate(parent?.starts_on ?? "");
  }

  function toggleDayForm() {
    if (dayFormOpen) {
      setDayFormOpen(false);
      return;
    }
    const parent = weeks.find((week) => week.status === "active") ?? weeks[0];
    if (!parent) {
      setStatus("请先创建周计划，再继续安排日计划");
      return;
    }
    selectDayParent(parent.id);
    setDayFormOpen(true);
  }

  async function createDay(event: FormEvent) {
    event.preventDefault();
    if (dayBusy) return;
    if (!dayParent || !dayTitle.trim() || !dayDate) {
      setStatus("请完整填写日计划的所属周、名称和日期");
      return;
    }
    if (dayDate < dayParent.starts_on || dayDate > dayParent.ends_on) {
      setStatus("日计划日期必须在所属周计划范围内");
      return;
    }
    const payload = {
      parent_id: dayParent.id,
      level: "day" as const,
      title: dayTitle.trim(),
      description: dayDescription.trim(),
      starts_on: dayDate,
      ends_on: dayDate,
      status: "active" as const,
    };
    setDayBusy(true);
    try {
      const saved = isDemo
        ? { ...payload, id: `demo-day-${dayParent.id}-${dayDate}-${dayTitle.trim()}` }
        : await api.createPlan(payload);
      setPlans((items) => [...items, saved].sort((left, right) => left.starts_on.localeCompare(right.starts_on)));
      onPlansChanged?.();
      setStatus(isDemo ? "演示日计划仅保留在当前页面" : "日计划已写入 Supabase 云端");
      setDayTitle("");
      setDayDescription("");
      setDayFormOpen(false);
    } catch (error) {
      setStatus(studyWriteErrorMessage(error, "保存日计划"));
    } finally {
      setDayBusy(false);
    }
  }

  function openPlanEditor(plan: ApiPlan) {
    setEditingPlan(plan);
    setEditTitle(plan.title);
    setEditDescription(plan.description);
    setEditStartsOn(plan.starts_on);
    setEditEndsOn(plan.ends_on);
    setEditStatus(plan.status);
    setStatus(`正在编辑${planLevelLabel[plan.level]}计划“${plan.title}”`);
  }

  async function savePlanEdit(event: FormEvent) {
    event.preventDefault();
    if (editBusy) return;
    if (!editingPlan || !editTitle.trim() || !editStartsOn || !editEndsOn) {
      setStatus("请完整填写计划名称和日期");
      return;
    }
    const nextEndsOn = editingPlan.level === "day" ? editStartsOn : editEndsOn;
    if (nextEndsOn < editStartsOn) {
      setStatus("计划结束日期不能早于开始日期");
      return;
    }
    if (
      editParent
      && (editStartsOn < editParent.starts_on || nextEndsOn > editParent.ends_on)
    ) {
      setStatus(`${planLevelLabel[editingPlan.level]}计划日期必须在所属${planLevelLabel[editParent.level]}计划范围内`);
      return;
    }
    const changes = {
      title: editTitle.trim(),
      description: editDescription.trim(),
      starts_on: editStartsOn,
      ends_on: nextEndsOn,
      status: editStatus,
    };
    setEditBusy(true);
    try {
      const saved = isDemo
        ? { ...editingPlan, ...changes }
        : await api.updatePlan(editingPlan.id, changes);
      setPlans((items) => items
        .map((plan) => plan.id === saved.id ? saved : plan)
        .sort((left, right) => left.starts_on.localeCompare(right.starts_on)));
      onPlansChanged?.();
      setStatus(isDemo ? "演示计划修改仅保留在当前页面" : "计划修改已同步到 Supabase 云端");
      setEditingPlan(null);
    } catch (error) {
      setStatus(studyWriteErrorMessage(error, "修改计划"));
    } finally {
      setEditBusy(false);
    }
  }

  async function removePlan(plan: ApiPlan) {
    if (deleteBusyId) return;
    const ids = planCascadeIds(plans, plan.id);
    const childCount = ids.size - 1;
    const suffix = childCount ? `，并同时删除 ${childCount} 条子计划` : "";
    if (!window.confirm(`确定删除“${plan.title}”${suffix}吗？此操作无法撤销。`)) return;
    setDeleteBusyId(plan.id);
    try {
      if (!isDemo) await api.deletePlan(plan.id);
      setPlans((items) => items.filter((item) => !ids.has(item.id)));
      onPlansChanged?.();
      if (editingPlan?.id && ids.has(editingPlan.id)) setEditingPlan(null);
      setStatus(isDemo ? "演示计划已从当前页面移除" : "计划已从 Supabase 云端删除");
    } catch (error) {
      setStatus(studyWriteErrorMessage(error, "删除计划"));
    } finally {
      setDeleteBusyId(null);
    }
  }

  async function changePlanStatus(plan: ApiPlan) {
    if (statusBusyId) return;
    const next = nextPlanStatus(plan);
    setStatusBusyId(plan.id);
    try {
      const saved = isDemo
        ? { ...plan, status: next.value }
        : await api.updatePlan(plan.id, { status: next.value });
      setPlans((items) => items.map((item) => item.id === saved.id ? saved : item));
      onPlansChanged?.();
      if (editingPlan?.id === saved.id) {
        setEditingPlan(saved);
        setEditStatus(saved.status);
      }
      setStatus(isDemo
        ? `演示计划已标记为${planStatusLabel[saved.status]}`
        : `计划已同步为${planStatusLabel[saved.status]}`);
    } catch (error) {
      setStatus(studyWriteErrorMessage(error, "修改计划状态"));
    } finally {
      setStatusBusyId(null);
    }
  }

  async function showPlanProgress(plan: ApiPlan) {
    setProgressBusyId(plan.id);
    try {
      const progress = isDemo
        ? {
            plan_id: plan.id,
            task_count: plan.level === "stage" ? 25 : plan.level === "week" ? 10 : 3,
            completed_tasks: plan.level === "stage" ? 17 : plan.level === "week" ? 6 : 2,
            completion_rate: plan.level === "stage" ? 68 : plan.level === "week" ? 60 : 67,
            actual_minutes: plan.level === "stage" ? 2540 : plan.level === "week" ? 720 : 95,
          }
        : await api.planProgress(plan.id);
      setSelectedProgress({ plan, progress });
      setStatus(isDemo ? "当前显示演示统计" : `已读取“${plan.title}”的云端统计`);
    } catch (error) {
      setStatus(cloudReadErrorMessage(error, "计划统计"));
    } finally {
      setProgressBusyId(null);
    }
  }

  return <section className="content-view">
    <div className="view-title"><div><div className="eyebrow">从目标倒推行动</div><h1>三级计划</h1><p>阶段、周、日三层联动，计划变化由你最终确认。</p></div><button className="primary-button" onClick={() => setFormOpen((value) => !value)}>{formOpen ? "收起表单" : "＋ 新建阶段计划"}</button></div>
    {formOpen && <form className="panel plan-form" onSubmit={createStage}>
      <div className="plan-form-heading"><div className="eyebrow">阶段计划</div><h2>定义一个长期复习阶段</h2></div>
      <label className="plan-title">阶段名称<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：基础阶段" maxLength={160} required /></label>
      <label>开始日期<input type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} required /></label>
      <label>结束日期<input type="date" value={endsOn} min={startsOn} onChange={(event) => setEndsOn(event.target.value)} required /></label>
      <label className="plan-description">阶段目标<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="这个阶段需要完成什么？" maxLength={2000} /></label>
      <div className="plan-form-actions"><button type="button" onClick={() => setFormOpen(false)} disabled={busy}>取消</button><button className="primary-button" type="submit" disabled={busy}>{busy ? "正在保存…" : "保存阶段计划"}</button></div>
    </form>}
    <p className="plan-status-line">● {status}</p>
    {selectedProgress && <section className="panel plan-progress-panel"><div><div className="eyebrow">计划执行统计</div><h2>{selectedProgress.plan.title}</h2><small>{planLevelLabel[selectedProgress.plan.level]}计划 · {planStatusLabel[selectedProgress.plan.status]}</small></div><div className="plan-progress-metric"><span>完成率</span><strong>{selectedProgress.progress.completion_rate}%</strong></div><div className="plan-progress-metric"><span>完成任务</span><strong>{selectedProgress.progress.completed_tasks} / {selectedProgress.progress.task_count}</strong></div><div className="plan-progress-metric"><span>实际学习</span><strong>{formatPlanMinutes(selectedProgress.progress.actual_minutes)}</strong></div><button type="button" aria-label="关闭计划统计" onClick={() => setSelectedProgress(null)}>×</button></section>}
    {editingPlan && <form className="panel plan-form plan-edit-form" onSubmit={savePlanEdit}>
      <div className="plan-form-heading"><div className="eyebrow">编辑{planLevelLabel[editingPlan.level]}计划</div><h2>{editingPlan.title}</h2>{editParent && <small>所属{planLevelLabel[editParent.level]}计划：{editParent.title}（{editParent.starts_on} 至 {editParent.ends_on}）</small>}</div>
      <label className="plan-title">计划名称<input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} maxLength={160} required /></label>
      <label>{editingPlan.level === "day" ? "计划日期" : "开始日期"}<input type="date" value={editStartsOn} min={editParent?.starts_on} max={editParent?.ends_on} onChange={(event) => { setEditStartsOn(event.target.value); if (editingPlan.level === "day") setEditEndsOn(event.target.value); }} required /></label>
      {editingPlan.level !== "day" && <label>结束日期<input type="date" value={editEndsOn} min={editStartsOn || editParent?.starts_on} max={editParent?.ends_on} onChange={(event) => setEditEndsOn(event.target.value)} required /></label>}
      <label>计划状态<select value={editStatus} onChange={(event) => setEditStatus(event.target.value as PlanStatus)}>{planStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label className="plan-description">计划目标<textarea value={editDescription} onChange={(event) => setEditDescription(event.target.value)} maxLength={2000} /></label>
      <div className="plan-form-actions"><button type="button" onClick={() => setEditingPlan(null)} disabled={editBusy}>取消</button><button className="primary-button" type="submit" disabled={editBusy}>{editBusy ? "正在保存…" : "保存修改"}</button></div>
    </form>}
    {loading ? <div className="panel plan-empty cloud-loading-text">正在加载你的阶段计划…</div> : stages.length === 0 ? <div className="panel plan-empty"><strong>还没有阶段计划</strong><span>点击“新建阶段计划”，先确定第一轮复习的时间范围与目标。</span></div> : <div className="stage-grid">{stages.map((stage, index) => <article className={`panel stage-card ${stage.status === "active" ? "current" : ""}`} key={stage.id}><div className="stage-index">{String(index + 1).padStart(2, "0")}</div><div><span>{planDateRange(stage)}</span><h2>{stage.title}</h2><p>{stage.description || "暂未填写阶段目标"}</p><small>{planStatusLabel[stage.status]} · {isDemo ? "演示数据" : "云端计划"}</small><div className="plan-item-actions"><button type="button" disabled={progressBusyId === stage.id} onClick={() => void showPlanProgress(stage)}>{progressBusyId === stage.id ? "读取中…" : "统计"}</button><button className="status-action" type="button" disabled={statusBusyId === stage.id} onClick={() => void changePlanStatus(stage)}>{statusBusyId === stage.id ? "同步中…" : nextPlanStatus(stage).label}</button><button type="button" onClick={() => openPlanEditor(stage)}>编辑</button><button className="danger" type="button" disabled={Boolean(deleteBusyId)} onClick={() => void removePlan(stage)}>{deleteBusyId === stage.id ? "删除中…" : "删除"}</button></div></div></article>)}</div>}
    <section className="panel weekly-plan"><div className="panel-heading"><div><div className="eyebrow">周计划</div><h2>{weeks.length ? `${weeks.length} 个周计划` : "尚未建立周计划"}</h2></div><div className="plan-heading-actions"><span className={`status-chip ${isDemo ? "" : "online"}`}>{isDemo ? "演示" : "云端"}</span><button className="outline-button" type="button" onClick={toggleWeekForm}>{weekFormOpen ? "收起" : "＋ 新建周计划"}</button></div></div>
      {weekFormOpen && <form className="plan-form week-plan-form" onSubmit={createWeek}>
        <label className="plan-title">所属阶段<select value={weekParentId} onChange={(event) => selectWeekParent(event.target.value)} required>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.title}（{stage.starts_on} 至 {stage.ends_on}）</option>)}</select></label>
        <label className="plan-title">周计划名称<input value={weekTitle} onChange={(event) => setWeekTitle(event.target.value)} placeholder="例如：基础阶段第 1 周" maxLength={160} required /></label>
        <label>开始日期<input type="date" value={weekStartsOn} min={weekParent?.starts_on} max={weekParent?.ends_on} onChange={(event) => { const nextStart = event.target.value; setWeekStartsOn(nextStart); if (weekParent) setWeekEndsOn(suggestedWeekEnd(nextStart, weekParent.ends_on)); }} required /></label>
        <label>结束日期<input type="date" value={weekEndsOn} min={weekStartsOn || weekParent?.starts_on} max={weekParent?.ends_on} onChange={(event) => setWeekEndsOn(event.target.value)} required /></label>
        <label className="plan-description">本周重点<textarea value={weekDescription} onChange={(event) => setWeekDescription(event.target.value)} placeholder="这一周最重要的学习结果是什么？" maxLength={2000} /></label>
        <div className="plan-form-actions"><button type="button" onClick={() => setWeekFormOpen(false)} disabled={weekBusy}>取消</button><button className="primary-button" type="submit" disabled={weekBusy}>{weekBusy ? "正在保存…" : "保存周计划"}</button></div>
      </form>}
      {weeks.length ? <div className="plan-list">{weeks.map((week) => <div className="plan-row" key={week.id}><div><strong>{week.title}</strong><small>{week.description || "暂未填写本周重点"}</small></div><span>{planDateRange(week)}</span><em>{planStatusLabel[week.status]}</em><div className="plan-item-actions"><button type="button" disabled={progressBusyId === week.id} onClick={() => void showPlanProgress(week)}>{progressBusyId === week.id ? "读取中…" : "统计"}</button><button className="status-action" type="button" disabled={statusBusyId === week.id} onClick={() => void changePlanStatus(week)}>{statusBusyId === week.id ? "同步中…" : nextPlanStatus(week).label}</button><button type="button" onClick={() => openPlanEditor(week)}>编辑</button><button className="danger" type="button" disabled={Boolean(deleteBusyId)} onClick={() => void removePlan(week)}>{deleteBusyId === week.id ? "删除中…" : "删除"}</button></div></div>)}</div> : <div className="plan-empty compact"><span>创建阶段计划后，下一步可以把它拆成可执行的周计划。</span></div>}
    </section>
    <section className="panel daily-plan"><div className="panel-heading"><div><div className="eyebrow">日计划</div><h2>{days.length ? `${days.length} 个日计划` : "尚未安排日计划"}</h2></div><div className="plan-heading-actions"><span className={`status-chip ${isDemo ? "" : "online"}`}>{isDemo ? "演示" : "云端"}</span><button className="outline-button" type="button" onClick={toggleDayForm}>{dayFormOpen ? "收起" : "＋ 新建日计划"}</button></div></div>
      {dayFormOpen && <form className="plan-form week-plan-form" onSubmit={createDay}>
        <label className="plan-title">所属周计划<select value={dayParentId} onChange={(event) => selectDayParent(event.target.value)} required>{weeks.map((week) => <option key={week.id} value={week.id}>{week.title}（{week.starts_on} 至 {week.ends_on}）</option>)}</select></label>
        <label className="plan-title">日计划名称<input value={dayTitle} onChange={(event) => setDayTitle(event.target.value)} placeholder="例如：高数极限专题与英语词汇" maxLength={160} required /></label>
        <label>计划日期<input type="date" value={dayDate} min={dayParent?.starts_on} max={dayParent?.ends_on} onChange={(event) => setDayDate(event.target.value)} required /></label>
        <label className="plan-description">当天成果<textarea value={dayDescription} onChange={(event) => setDayDescription(event.target.value)} placeholder="完成哪些章节、题目或复盘？" maxLength={2000} /></label>
        <div className="plan-form-actions"><button type="button" onClick={() => setDayFormOpen(false)} disabled={dayBusy}>取消</button><button className="primary-button" type="submit" disabled={dayBusy}>{dayBusy ? "正在保存…" : "保存日计划"}</button></div>
      </form>}
      {days.length ? <div className="plan-list">{days.map((day) => <div className="plan-row" key={day.id}><div><strong>{day.title}</strong><small>{day.description || "暂未填写当天成果"}</small></div><span>{day.starts_on.replaceAll("-", ".")}</span><em>{planStatusLabel[day.status]}</em><div className="plan-item-actions"><button type="button" disabled={progressBusyId === day.id} onClick={() => void showPlanProgress(day)}>{progressBusyId === day.id ? "读取中…" : "统计"}</button><button className="status-action" type="button" disabled={statusBusyId === day.id} onClick={() => void changePlanStatus(day)}>{statusBusyId === day.id ? "同步中…" : nextPlanStatus(day).label}</button><button type="button" onClick={() => openPlanEditor(day)}>编辑</button><button className="danger" type="button" disabled={Boolean(deleteBusyId)} onClick={() => void removePlan(day)}>{deleteBusyId === day.id ? "删除中…" : "删除"}</button></div></div>)}</div> : <div className="plan-empty compact"><span>创建周计划后，可以继续把目标拆成每天可完成、可复盘的行动。</span></div>}
    </section>
  </section>;
}

const demoSubjectSummaries: SubjectSummary[] = [
  { subject: "math", weekly_minutes: 500, total_minutes: 2520, task_count: 12, completed_tasks: 8, task_completion_rate: 67, mistake_count: 5, due_mistake_count: 2, review_count: 9, weak_points: initialMistakes.filter((item) => item.subject === "math").map((item) => ({ id: item.id, title: item.title, mastery: item.mastery, review_count: item.review_count, next_review_at: item.next_review_at })) },
  { subject: "english", weekly_minutes: 310, total_minutes: 1740, task_count: 9, completed_tasks: 6, task_completion_rate: 67, mistake_count: 0, due_mistake_count: 0, review_count: 0, weak_points: [] },
  { subject: "cs408", weekly_minutes: 405, total_minutes: 2160, task_count: 10, completed_tasks: 5, task_completion_rate: 50, mistake_count: 4, due_mistake_count: 1, review_count: 6, weak_points: initialMistakes.filter((item) => item.subject === "cs408").map((item) => ({ id: item.id, title: item.title, mastery: item.mastery, review_count: item.review_count, next_review_at: item.next_review_at })) },
  { subject: "politics", weekly_minutes: 0, total_minutes: 0, task_count: 0, completed_tasks: 0, task_completion_rate: 0, mistake_count: 0, due_mistake_count: 0, review_count: 0, weak_points: [] },
];

function reviewDateLabel(value: string) {
  const date = new Date(value);
  const today = shanghaiDateKey(new Date());
  const reviewDate = shanghaiDateKey(date);
  const difference = Math.round((Date.parse(`${reviewDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (difference < 0) return `逾期 ${Math.abs(difference)} 天`;
  if (difference === 0) return "今天复习";
  if (difference === 1) return "明天复习";
  return `${reviewDate} 复习`;
}

function SubjectsView({ isDemo, onOpenMaterials, onOpenToday }: { isDemo: boolean; onOpenMaterials: () => void; onOpenToday: () => void }) {
  const [summaries, setSummaries] = useState<SubjectSummary[]>(isDemo ? demoSubjectSummaries : []);
  const [loading, setLoading] = useState(!isDemo);
  const [status, setStatus] = useState(isDemo ? "当前显示演示学科统计" : "正在读取云端学科统计…");

  async function loadSummaries() {
    if (isDemo) return;
    setLoading(true);
    setStatus("正在读取云端学科统计…");
    try {
      const items = await api.subjectSummaries();
      setSummaries(items);
      setStatus("已根据任务、学习时长和错题记录生成真实统计");
    } catch (error) {
      setSummaries([]);
      setStatus(cloudReadErrorMessage(error, "学科统计"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isDemo) return;
    let active = true;
    void api.subjectSummaries()
      .then((items) => {
        if (!active) return;
        setSummaries(items);
        setStatus("已根据任务、学习时长和错题记录生成真实统计");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setSummaries([]);
        setStatus(cloudReadErrorMessage(error, "学科统计"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [isDemo]);

  const weakPoints = summaries.flatMap((summary) => summary.weak_points.map((item) => ({ ...item, subject: summary.subject }))).sort((left, right) => left.mastery - right.mastery || left.next_review_at.localeCompare(right.next_review_at)).slice(0, 8);

  return <section className="content-view">
    <div className="view-title"><div><div className="eyebrow">知识结构与掌握程度</div><h1>学科学习</h1><p>用真实任务、学习时长和错题复习衡量四门科目的进度。</p></div><button className="primary-button" type="button" onClick={onOpenMaterials}>＋ 添加学习资源</button></div>
    <p className={`plan-status-line ${loading ? "cloud-loading-text" : ""}`}>● {status}</p>
    <div className="subject-card-grid">{summaries.map((summary, index) => {
      const meta = subjectMeta[summary.subject];
      return <article className="panel subject-card" key={summary.subject}>
        <div className={`subject-icon s${index}`}>{meta.short}</div><span>本周 {formatMinutes(summary.weekly_minutes)}</span>
        <h2>{meta.label}</h2><p>{summary.task_count ? `${summary.completed_tasks} / ${summary.task_count} 项任务已完成` : "还没有学习任务"}</p>
        <div className="progress-track"><span style={{ width: `${summary.task_completion_rate}%` }} /></div>
        <div className="subject-bottom"><strong>近一年 {formatMinutes(summary.total_minutes)}</strong><small>完成率 {summary.task_completion_rate}%</small></div>
        <div className="subject-bottom"><strong>{summary.mistake_count} 道错题</strong><small>{summary.due_mistake_count} 道待复习</small></div>
      </article>;
    })}</div>
    {!loading && summaries.length === 0 && <div className="panel plan-empty"><strong>暂时无法显示学科统计</strong><span>{status}</span><button className="outline-button" type="button" onClick={() => void loadSummaries()}>重新读取</button></div>}
    <section className="panel knowledge-panel"><div className="panel-heading"><div><div className="eyebrow">最近薄弱点</div><h2>需要再次理解的知识</h2></div><button className="outline-button" type="button" onClick={onOpenToday}>进入今日错题复习</button></div>
      {weakPoints.length ? <div className="knowledge-table">{weakPoints.map((item) => <div key={item.id}><strong>{item.title}</strong><span>{subjectMeta[item.subject].label} · 掌握度 {item.mastery}/5 · 已复习 {item.review_count} 次</span><em>{reviewDateLabel(item.next_review_at)}</em></div>)}</div> : <div className="plan-empty compact"><span>{loading ? "正在读取薄弱点…" : "当前没有错题薄弱点，完成错题记录后会自动显示。"}</span></div>}
    </section>
  </section>;
}

const demoSchools: ApiSchoolOption[] = [
  { id: "demo-ustc", tier: "stretch", university: "中国科学技术大学", college: "软件学院", major_code: "085405", major_name: "软件工程", degree_type: "professional", exam_year: 2026, exam_subjects: ["英语二", "数学二", "408"], tuition_total: null, duration_years: null, location: "合肥 / 苏州", source_url: "https://yz.ustc.edu.cn/", source_checked_at: "2026-08-10T00:00:00Z", notes: "演示基线" },
  { id: "demo-suda", tier: "match", university: "苏州大学", college: "计算机科学与技术学院", major_code: "085405", major_name: "软件工程", degree_type: "professional", exam_year: 2026, exam_subjects: ["英语二", "数学二", "408"], tuition_total: null, duration_years: null, location: "苏州", source_url: "https://yjs.suda.edu.cn/", source_checked_at: "2026-08-10T00:00:00Z", notes: "演示基线" },
  { id: "demo-njust", tier: "match", university: "南京理工大学", college: "计算机科学与工程学院", major_code: "085405", major_name: "软件工程", degree_type: "professional", exam_year: 2026, exam_subjects: ["英语二", "数学二", "408"], tuition_total: null, duration_years: null, location: "南京", source_url: "https://gs.njust.edu.cn/", source_checked_at: "2026-08-10T00:00:00Z", notes: "演示基线" },
];

const schoolTierMeta: Record<SchoolTier, { label: string; title: string }> = {
  stretch: { label: "冲", title: "冲刺" },
  match: { label: "稳", title: "匹配" },
  safety: { label: "保", title: "保底" },
};

function SchoolsView({ isDemo }: { isDemo: boolean }) {
  const [schools, setSchools] = useState<ApiSchoolOption[]>(isDemo ? demoSchools : []);
  const [loading, setLoading] = useState(!isDemo);
  const [status, setStatus] = useState(isDemo ? "当前显示离线演示院校" : "正在加载云端院校情报…");
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [editingSchool, setEditingSchool] = useState<ApiSchoolOption | null>(null);
  const [tierFilter, setTierFilter] = useState<SchoolTier | "all">("all");
  const [yearFilter, setYearFilter] = useState("2028");
  const [tier, setTier] = useState<SchoolTier>("match");
  const [university, setUniversity] = useState("");
  const [college, setCollege] = useState("");
  const [majorCode, setMajorCode] = useState("");
  const [majorName, setMajorName] = useState("软件工程");
  const [degreeType, setDegreeType] = useState<DegreeType>("professional");
  const [examYear, setExamYear] = useState("2028");
  const [examSubjects, setExamSubjects] = useState("101 政治、201 英语一、301 数学一、408 计算机学科基础");
  const [location, setLocation] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (isDemo) return;
    let active = true;
    void api.listSchoolOptions(tierFilter === "all" ? undefined : tierFilter, Number(yearFilter) || undefined)
      .then((items) => {
        if (!active) return;
        setSchools(items);
        setStatus(`已从云端加载 ${items.length} 所院校记录`);
      })
      .catch((error) => {
        if (!active) return;
        setSchools([]);
        setStatus(cloudReadErrorMessage(error, "院校情报"));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isDemo, tierFilter, yearFilter]);

  const visibleSchools = isDemo
    ? demoSchools.filter((school) =>
        (tierFilter === "all" || school.tier === tierFilter) &&
        school.exam_year === (Number(yearFilter) || 2028),
      )
    : schools;

  function changeYearFilter(value: string) {
    setYearFilter(value);
    if (!isDemo) {
      setLoading(true);
      setStatus("正在加载云端院校情报…");
    }
  }

  function changeTierFilter(value: SchoolTier | "all") {
    setTierFilter(value);
    if (!isDemo) {
      setLoading(true);
      setStatus("正在加载云端院校情报…");
    }
  }

  function clearSchoolForm() {
    setEditingSchool(null);
    setTier("match");
    setUniversity("");
    setCollege("");
    setMajorCode("");
    setMajorName("软件工程");
    setDegreeType("professional");
    setExamYear(yearFilter || "2028");
    setExamSubjects("101 政治、201 英语一、301 数学一、408 计算机学科基础");
    setLocation("");
    setSourceUrl("");
    setNotes("");
  }

  function openSchoolEditor(school: ApiSchoolOption) {
    setEditingSchool(school);
    setTier(school.tier);
    setUniversity(school.university);
    setCollege(school.college);
    setMajorCode(school.major_code);
    setMajorName(school.major_name);
    setDegreeType(school.degree_type);
    setExamYear(String(school.exam_year));
    setExamSubjects(school.exam_subjects.join("、"));
    setLocation(school.location || "");
    setSourceUrl(school.source_url);
    setNotes(school.notes);
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveSchool(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (isDemo) {
      setStatus("离线演示模式不会写入真实院校数据，请登录后使用");
      return;
    }
    setBusy(true);
    setStatus(editingSchool ? "正在更新院校情报…" : "正在保存院校情报…");
    try {
      const payload = {
        tier,
        university: university.trim(),
        college: college.trim(),
        major_code: majorCode.trim(),
        major_name: majorName.trim(),
        degree_type: degreeType,
        exam_year: Number(examYear),
        exam_subjects: examSubjects.split(/[、,，]/).map((item) => item.trim()).filter(Boolean),
        location: location.trim() || undefined,
        source_url: sourceUrl.trim(),
        notes: notes.trim(),
      };
      const saved = editingSchool
        ? await api.updateSchoolOption(editingSchool.id, payload)
        : await api.createSchoolOption(payload);
      const remainsVisible = (tierFilter === "all" || tierFilter === saved.tier) && Number(yearFilter) === saved.exam_year;
      setSchools((items) => editingSchool
        ? (remainsVisible ? items.map((item) => item.id === saved.id ? saved : item) : items.filter((item) => item.id !== saved.id))
        : (remainsVisible ? [...items, saved] : items));
      setStatus(`${editingSchool ? "已更新" : "已保存"} ${saved.university} · ${saved.major_code}`);
      clearSchoolForm();
      setFormOpen(false);
    } catch (error) {
      setStatus(studyWriteErrorMessage(error, editingSchool ? "修改院校档案" : "保存院校档案"));
    } finally {
      setBusy(false);
    }
  }

  async function removeSchool(school: ApiSchoolOption) {
    if (deleteBusyId) return;
    if (isDemo) {
      setStatus("演示院校不会被删除");
      return;
    }
    if (!window.confirm(`确认删除 ${school.university} 的 ${school.major_name} 记录吗？`)) return;
    setDeleteBusyId(school.id);
    try {
      await api.deleteSchoolOption(school.id);
      setSchools((items) => items.filter((item) => item.id !== school.id));
      setStatus(`已删除 ${school.university} 的院校记录`);
    } catch (error) {
      setStatus(studyWriteErrorMessage(error, "删除院校档案"));
    } finally {
      setDeleteBusyId(null);
    }
  }

  return <section className="content-view"><div className="view-title"><div><div className="eyebrow">精确到学院与专业代码</div><h1>院校情报</h1><p>招生信息会变化，所有结论都保留年份与官方来源。</p></div><button className="primary-button" onClick={() => { if (formOpen) { setFormOpen(false); clearSchoolForm(); } else { clearSchoolForm(); setFormOpen(true); } }}>{formOpen ? "收起表单" : "＋ 添加院校"}</button></div>
    <div className="school-toolbar"><label>招生年份<input type="number" min="2026" max="2100" value={yearFilter} onChange={(event) => changeYearFilter(event.target.value)} /></label><label>院校梯度<select value={tierFilter} onChange={(event) => changeTierFilter(event.target.value as SchoolTier | "all")}><option value="all">全部梯度</option><option value="stretch">冲刺</option><option value="match">匹配</option><option value="safety">保底</option></select></label><span>● {status}</span></div>
    {formOpen && <form className="panel school-form" onSubmit={saveSchool}><div className="school-form-heading"><div className="eyebrow">{editingSchool ? "编辑院校档案" : "新增目标院校"}</div><h2>{editingSchool ? `更新 ${editingSchool.university} 的年度记录` : "保存可年度复核的招生档案"}</h2></div><label>院校梯度<select value={tier} onChange={(event) => setTier(event.target.value as SchoolTier)}><option value="stretch">冲刺</option><option value="match">匹配</option><option value="safety">保底</option></select></label><label>招生年份<input type="number" min="2026" max="2100" value={examYear} onChange={(event) => setExamYear(event.target.value)} required /></label><label>学校名称<input value={university} onChange={(event) => setUniversity(event.target.value)} maxLength={120} placeholder="例如：苏州大学" required /></label><label>学院名称<input value={college} onChange={(event) => setCollege(event.target.value)} maxLength={160} placeholder="精确到招生学院" required /></label><label>专业代码<input value={majorCode} onChange={(event) => setMajorCode(event.target.value)} maxLength={20} placeholder="例如：085405" required /></label><label>专业名称<input value={majorName} onChange={(event) => setMajorName(event.target.value)} maxLength={160} required /></label><label>培养类型<select value={degreeType} onChange={(event) => setDegreeType(event.target.value as DegreeType)}><option value="professional">专业学位</option><option value="academic">学术学位</option></select></label><label>培养地点<input value={location} onChange={(event) => setLocation(event.target.value)} maxLength={160} placeholder="例如：苏州" /></label><label className="school-form-wide">初试科目<input value={examSubjects} onChange={(event) => setExamSubjects(event.target.value)} placeholder="使用顿号分隔" required /></label><label className="school-form-wide">官方来源<input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="招生目录或学院官网链接" required /></label><label className="school-form-wide">核对备注<textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={5000} placeholder="记录科目变化、复试要求或待确认事项" /></label><div className="school-form-actions"><button type="button" onClick={() => { setFormOpen(false); clearSchoolForm(); }} disabled={busy}>取消</button><button className="primary-button" type="submit" disabled={busy}>{busy ? "正在保存…" : editingSchool ? "保存修改" : "保存院校档案"}</button></div></form>}
    {loading ? <div className="panel plan-empty cloud-loading-text">正在加载你的云端院校情报…</div> : visibleSchools.length === 0 ? <div className="panel plan-empty"><strong>当前筛选下还没有院校</strong><span>添加第一所目标院校，并记录招生年份与官方来源。</span></div> : <div className="school-list">{visibleSchools.map((school) => <article className="panel school-card" key={school.id}><div className={`tier tier-${school.tier}`}>{schoolTierMeta[school.tier].label}</div><div className="school-main"><span>{school.exam_year} 年 · {schoolTierMeta[school.tier].title} · {school.degree_type === "professional" ? "专硕" : "学硕"}</span><h2>{school.university}</h2><p>{school.college} · {school.major_code} {school.major_name}</p></div><div className="school-meta"><span>初试科目</span><strong>{school.exam_subjects.join(" · ") || "待核对"}</strong></div><div className="school-meta"><span>培养地点</span><strong>{school.location || "待核对"}</strong></div><div className="school-actions"><a href={school.source_url} target="_blank" rel="noreferrer">官方来源 ↗</a><button type="button" disabled={busy || deleteBusyId !== null} onClick={() => openSchoolEditor(school)}>编辑</button><button type="button" disabled={busy || deleteBusyId !== null} onClick={() => void removeSchool(school)}>{deleteBusyId === school.id ? "删除中…" : "删除"}</button></div></article>)}</div>}
  </section>;
}

const demoCareerItems: ApiCareerItem[] = [
  { id: "demo-career-1", item_type: "milestone", title: "完成 Agent 工作台 v0.5", company: null, status: "in_progress", occurred_on: "2026-09-15", notes: "补齐院校情报、求职副线和数据导出。" },
  { id: "demo-career-2", item_type: "resume", title: "AI 应用开发简历 v1", company: null, status: "planned", occurred_on: "2026-10-01", notes: "突出 FastAPI、Supabase、RAG 与 Agent 项目经历。" },
  { id: "demo-career-3", item_type: "application", title: "AI 应用开发实习", company: "杭州示例科技", status: "submitted", occurred_on: "2026-12-20", notes: "演示记录，不代表真实投递。" },
];

const careerTypeMeta: Record<CareerItemType, { label: string; short: string }> = {
  milestone: { label: "项目里程碑", short: "项" },
  resume: { label: "简历版本", short: "历" },
  application: { label: "求职投递", short: "投" },
  interview: { label: "面试复盘", short: "面" },
};

const careerStatusMeta: Record<CareerStatus, string> = {
  planned: "待开始",
  in_progress: "进行中",
  submitted: "已投递",
  interviewing: "面试中",
  offer: "已获 Offer",
  rejected: "未通过",
  completed: "已完成",
  archived: "已归档",
};

function CareerView({ isDemo }: { isDemo: boolean }) {
  const [items, setItems] = useState<ApiCareerItem[]>(isDemo ? demoCareerItems : []);
  const [loading, setLoading] = useState(!isDemo);
  const [message, setMessage] = useState(isDemo ? "当前显示离线演示求职记录" : "正在加载云端求职记录…");
  const [typeFilter, setTypeFilter] = useState<CareerItemType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<CareerStatus | "all">("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ApiCareerItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [itemType, setItemType] = useState<CareerItemType>("milestone");
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [careerStatus, setCareerStatus] = useState<CareerStatus>("planned");
  const [occurredOn, setOccurredOn] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (isDemo) return;
    let active = true;
    void api.listCareerItems(typeFilter === "all" ? undefined : typeFilter, statusFilter === "all" ? undefined : statusFilter)
      .then((records) => {
        if (!active) return;
        setItems(records);
        setMessage(`已从云端加载 ${records.length} 条求职记录`);
      })
      .catch((error) => {
        if (!active) return;
        setItems([]);
        setMessage(cloudReadErrorMessage(error, "求职记录"));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isDemo, statusFilter, typeFilter]);

  const visibleItems = isDemo
    ? demoCareerItems.filter((item) =>
        (typeFilter === "all" || item.item_type === typeFilter) &&
        (statusFilter === "all" || item.status === statusFilter),
      )
    : items;

  function changeTypeFilter(value: CareerItemType | "all") {
    setTypeFilter(value);
    if (!isDemo) {
      setLoading(true);
      setMessage("正在加载云端求职记录…");
    }
  }

  function changeStatusFilter(value: CareerStatus | "all") {
    setStatusFilter(value);
    if (!isDemo) {
      setLoading(true);
      setMessage("正在加载云端求职记录…");
    }
  }

  function resetForm() {
    setEditingItem(null);
    setItemType("milestone");
    setTitle("");
    setCompany("");
    setCareerStatus("planned");
    setOccurredOn("");
    setNotes("");
  }

  function openEditor(item: ApiCareerItem) {
    setEditingItem(item);
    setItemType(item.item_type);
    setTitle(item.title);
    setCompany(item.company || "");
    setCareerStatus(item.status);
    setOccurredOn(item.occurred_on || "");
    setNotes(item.notes);
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (isDemo) {
      setMessage("离线演示模式不会写入真实求职记录，请登录后使用");
      return;
    }
    setBusy(true);
    setMessage(editingItem ? "正在更新求职记录…" : "正在保存求职记录…");
    try {
      const payload = {
        item_type: itemType,
        title: title.trim(),
        company: company.trim() || undefined,
        status: careerStatus,
        occurred_on: occurredOn || undefined,
        notes: notes.trim(),
      };
      const saved = editingItem
        ? await api.updateCareerItem(editingItem.id, { ...payload, company: company.trim() || null, occurred_on: occurredOn || null })
        : await api.createCareerItem(payload);
      const visible = (typeFilter === "all" || saved.item_type === typeFilter) && (statusFilter === "all" || saved.status === statusFilter);
      setItems((records) => editingItem
        ? (visible ? records.map((item) => item.id === saved.id ? saved : item) : records.filter((item) => item.id !== saved.id))
        : (visible ? [...records, saved] : records));
      setMessage(`${editingItem ? "已更新" : "已保存"}：${saved.title}`);
      resetForm();
      setFormOpen(false);
    } catch (error) {
      setMessage(studyWriteErrorMessage(error, editingItem ? "修改求职记录" : "保存求职记录"));
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(item: ApiCareerItem) {
    if (deleteBusyId) return;
    if (isDemo) {
      setMessage("演示求职记录不会被删除");
      return;
    }
    if (!window.confirm(`确认删除“${item.title}”吗？`)) return;
    setDeleteBusyId(item.id);
    try {
      await api.deleteCareerItem(item.id);
      setItems((records) => records.filter((record) => record.id !== item.id));
      setMessage(`已删除：${item.title}`);
    } catch (error) {
      setMessage(studyWriteErrorMessage(error, "删除求职记录"));
    } finally {
      setDeleteBusyId(null);
    }
  }

  const metricCounts = {
    total: visibleItems.length,
    submitted: visibleItems.filter((item) => ["submitted", "interviewing", "offer"].includes(item.status)).length,
    interviewing: visibleItems.filter((item) => item.status === "interviewing").length,
    offer: visibleItems.filter((item) => item.status === "offer").length,
  };

  return <section className="content-view">
    <div className="view-title"><div><div className="eyebrow">实习与 AI 应用开发成长轨迹</div><h1>求职副线</h1><p>记录项目、简历、投递和面试；这些记录不计入考研有效学习时长。</p></div><button className="primary-button" onClick={() => { if (formOpen) { setFormOpen(false); resetForm(); } else { resetForm(); setFormOpen(true); } }}>{formOpen ? "收起表单" : "＋ 添加求职记录"}</button></div>
    <div className="career-separation-note"><strong>独立统计</strong><span>求职记录用于追踪就业准备，不会改变学习热力图、连续学习天数或考研完成率。</span></div>
    <div className="career-metrics"><article className="panel"><span>当前记录</span><strong>{metricCounts.total}</strong><small>条</small></article><article className="panel"><span>已进入流程</span><strong>{metricCounts.submitted}</strong><small>项</small></article><article className="panel"><span>面试中</span><strong>{metricCounts.interviewing}</strong><small>项</small></article><article className="panel"><span>Offer</span><strong>{metricCounts.offer}</strong><small>份</small></article></div>
    <div className="career-toolbar"><label>记录类型<select value={typeFilter} onChange={(event) => changeTypeFilter(event.target.value as CareerItemType | "all")}><option value="all">全部类型</option>{Object.entries(careerTypeMeta).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}</select></label><label>当前状态<select value={statusFilter} onChange={(event) => changeStatusFilter(event.target.value as CareerStatus | "all")}><option value="all">全部状态</option>{Object.entries(careerStatusMeta).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><span>● {message}</span></div>
    {formOpen && <form className="panel career-form" onSubmit={saveItem}><div className="career-form-heading"><div className="eyebrow">{editingItem ? "编辑求职记录" : "新增求职记录"}</div><h2>{editingItem ? `更新 ${editingItem.title}` : "沉淀可复盘的求职过程"}</h2></div><label>记录类型<select value={itemType} onChange={(event) => setItemType(event.target.value as CareerItemType)}>{Object.entries(careerTypeMeta).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}</select></label><label>状态<select value={careerStatus} onChange={(event) => setCareerStatus(event.target.value as CareerStatus)}>{Object.entries(careerStatusMeta).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="career-form-wide">标题<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} placeholder="例如：AI Agent 实习投递" required /></label><label>公司 / 版本<input value={company} onChange={(event) => setCompany(event.target.value)} maxLength={160} placeholder="公司名称或简历版本" /></label><label>计划 / 发生日期<input type="date" value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} /></label><label className="career-form-wide">复盘备注<textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={5000} placeholder="记录准备内容、投递渠道、面试问题和后续改进" /></label><div className="career-form-actions"><button type="button" onClick={() => { setFormOpen(false); resetForm(); }} disabled={busy}>取消</button><button className="primary-button" type="submit" disabled={busy}>{busy ? "正在保存…" : editingItem ? "保存修改" : "保存求职记录"}</button></div></form>}
    {loading ? <div className="panel plan-empty cloud-loading-text">正在加载你的云端求职记录…</div> : visibleItems.length === 0 ? <div className="panel plan-empty"><strong>当前筛选下还没有求职记录</strong><span>从一个项目里程碑或第一版简历开始记录。</span></div> : <div className="career-list">{visibleItems.map((item) => <article className="panel career-card" key={item.id}><div className={`career-type career-type-${item.item_type}`}>{careerTypeMeta[item.item_type].short}</div><div className="career-main"><span>{careerTypeMeta[item.item_type].label} · {careerStatusMeta[item.status]}</span><h2>{item.title}</h2><p>{item.company || "个人成长记录"}{item.occurred_on ? ` · ${item.occurred_on}` : " · 日期待定"}</p></div><div className="career-notes">{item.notes || "暂未填写复盘备注"}</div><div className="career-actions"><button type="button" disabled={busy || deleteBusyId !== null} onClick={() => openEditor(item)}>编辑</button><button type="button" disabled={busy || deleteBusyId !== null} onClick={() => void removeItem(item)}>{deleteBusyId === item.id ? "删除中…" : "删除"}</button></div></article>)}</div>}
  </section>;
}

const exportFormatMeta: Record<ExportFormat, { label: string; extension: string; detail: string }> = {
  json: { label: "完整 JSON", extension: ".json", detail: "适合完整备份、恢复准备和后续程序处理" },
  csv: { label: "通用 CSV", extension: ".csv", detail: "适合用 Excel、Numbers 或数据分析工具查看" },
  markdown: { label: "复盘 Markdown", extension: ".md", detail: "适合保存到 Obsidian、笔记库或长期归档" },
};

function BackupView({ isDemo }: { isDemo: boolean }) {
  const [format, setFormat] = useState<ExportFormat>("json");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(isDemo ? "离线演示模式不会生成真实账户备份" : "选择格式后即可下载当前账户数据");

  async function exportData() {
    if (busy) return;
    if (isDemo) {
      setStatus("请登录 Supabase 账户后导出你的真实数据");
      return;
    }
    setBusy(true);
    setStatus(`正在生成${exportFormatMeta[format].label}备份…`);
    try {
      const result = await api.exportData(format);
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setStatus(`下载完成：${result.filename}`);
    } catch (error) {
      setStatus(exportRequestErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return <section className="content-view">
    <div className="view-title"><div><div className="eyebrow">数据可携带与长期归档</div><h1>数据备份</h1><p>随时导出自己的核心记录，服务器仍是在线使用时的最终事实来源。</p></div></div>
    <section className="panel backup-hero"><div><span className="backup-icon">⇩</span><div><div className="eyebrow">当前账户完整快照</div><h2>把长期学习过程握在自己手里</h2><p>一次导出包含三级计划、学习任务、学习会话、错题卡、院校情报和求职副线。导出文件不包含密码、访问令牌或用户编号。</p></div></div><div className="backup-actions"><label>导出格式<select value={format} disabled={busy} onChange={(event) => setFormat(event.target.value as ExportFormat)}>{Object.entries(exportFormatMeta).map(([key, meta]) => <option value={key} key={key}>{meta.label}（{meta.extension}）</option>)}</select></label><button className="primary-button" type="button" disabled={busy} onClick={() => void exportData()}>{busy ? "正在生成…" : "下载个人数据"}</button><span>● {status}</span></div></section>
    <div className="backup-format-grid">{Object.entries(exportFormatMeta).map(([key, meta]) => <button type="button" disabled={busy} className={`panel backup-format ${format === key ? "selected" : ""}`} key={key} onClick={() => setFormat(key as ExportFormat)}><strong>{meta.extension}</strong><div><h2>{meta.label}</h2><p>{meta.detail}</p></div><span>{format === key ? "已选择" : "选择"}</span></button>)}</div>
    <section className="panel backup-scope"><div className="panel-heading"><div><div className="eyebrow">备份范围</div><h2>本次导出的六类数据</h2></div><span className="status-chip online">仅当前账户</span></div><div className="backup-datasets"><span>三级计划</span><span>学习任务</span><span>学习会话</span><span>错题卡</span><span>院校情报</span><span>求职副线</span></div><p>当前导出包含已结构化的核心数据；资料库原始文件与检索索引的完整备份将在后续版本补齐。</p></section>
  </section>;
}

const DEMO_DOCUMENTS: ApiDocument[] = [
  { id: "demo-doc-1", title: "王道数据结构 2027", original_filename: "王道数据结构 2027.pdf", source_type: "upload", source_url: null, content_type: "application/pdf", byte_size: 5_400_000, sha256: null, storage_path: null, version: 1, ingestion_status: "ready", ingestion_error: null, created_at: "2026-08-10T00:00:00Z", updated_at: "2026-08-10T00:00:00Z" },
  { id: "demo-doc-2", title: "高数基础讲义", original_filename: "高数基础讲义.md", source_type: "upload", source_url: null, content_type: "text/markdown", byte_size: 38_000, sha256: null, storage_path: null, version: 1, ingestion_status: "ready", ingestion_error: null, created_at: "2026-08-10T00:00:00Z", updated_at: "2026-08-10T00:00:00Z" },
];

function HighlightedSearchText({ text, terms }: { text: string; terms: string[] }) {
  const normalizedTerms = [...new Set(terms.map((term) => term.trim()).filter(Boolean))]
    .sort((left, right) => right.length - left.length);
  if (normalizedTerms.length === 0) return <>{text}</>;
  const escapedTerms = normalizedTerms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escapedTerms.join("|")})`, "gi");
  const normalized = new Set(normalizedTerms.map((term) => term.toLocaleLowerCase()));
  return <>{text.split(pattern).map((part, index) => normalized.has(part.toLocaleLowerCase())
    ? <mark key={`${part}-${index}`}>{part}</mark>
    : <span key={`${part}-${index}`}>{part}</span>)}</>;
}

function MaterialsView({ isDemo }: { isDemo: boolean }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [docs, setDocs] = useState<ApiDocument[]>(isDemo ? DEMO_DOCUMENTS : []);
  const [sourceUrl, setSourceUrl] = useState("");
  const [importProposal, setImportProposal] = useState<ImportProposal | null>(null);
  const [importStatus, setImportStatus] = useState(isDemo ? "当前显示离线演示资料" : "正在加载云端资料库…");
  const [loading, setLoading] = useState(!isDemo);
  const [busy, setBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ApiPrivateKnowledgeSource[]>([]);
  const [searchStatus, setSearchStatus] = useState("输入关键词，检索个人资料中的原文片段");
  const [searchBusy, setSearchBusy] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [expandedSourceIds, setExpandedSourceIds] = useState<Set<number>>(new Set());
  const [reindexingId, setReindexingId] = useState<string | null>(null);
  const pendingDocumentIds = docs
    .filter((document) => ["queued", "processing", "ocr_required"].includes(document.ingestion_status))
    .map((document) => document.id)
    .sort()
    .join(",");

  useEffect(() => {
    if (isDemo) return;
    let active = true;
    void api.listDocuments()
      .then((documents) => {
        if (!active) return;
        setDocs(documents);
        setImportStatus(`已从云端加载 ${documents.length} 份资料`);
      })
      .catch((error) => {
        if (!active) return;
        setDocs([]);
        setImportStatus(materialRequestErrorMessage(error, "load"));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isDemo]);

  useEffect(() => {
    if (isDemo || !pendingDocumentIds) return;
    const timer = window.setInterval(() => {
      void api.listDocuments().then(setDocs).catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [isDemo, pendingDocumentIds]);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (isDemo) {
      setImportStatus("当前为离线演示模式；登录后才能安全导入个人资料");
      event.target.value = "";
      return;
    }
    setBusy(true);
    setImportStatus(`正在解析 ${file.name}…`);
    try {
      const result = await api.uploadDocument(file);
      const status = result.ingestion_status === "ocr_required" ? "等待 OCR" : `已切分 ${result.chunk_count} 段`;
      setDocs((items) => [result, ...items.filter((item) => item.id !== result.id)]);
      setImportStatus(result.duplicate ? "检测到相同文件，已复用云端资料与索引" : `导入完成 · ${status} · ${result.flagged_chunk_count} 个片段需要安全复核`);
    } catch (error) {
      setImportStatus(materialRequestErrorMessage(error, "upload"));
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  async function previewUrl(event: FormEvent) {
    event.preventDefault();
    if (!sourceUrl.trim()) return;
    if (isDemo) {
      setImportStatus("当前为离线演示模式；登录后才能生成导入提案");
      return;
    }
    setBusy(true);
    try {
      const preview = await api.previewImport(sourceUrl.trim());
      setImportStatus(`已生成待确认提案：${preview.summary}`);
      setImportProposal(preview);
    } catch (error) {
      setImportStatus(materialRequestErrorMessage(error, "preview"));
    } finally {
      setBusy(false);
    }
  }

  async function approveUrlImport() {
    if (!importProposal || busy) return;
    setBusy(true);
    setImportStatus("正在安全下载、解析并写入个人资料库…");
    try {
      const result = await api.approveImport(importProposal.id);
      setDocs((items) => [result.document, ...items.filter((item) => item.id !== result.document.id)]);
      setImportProposal(null);
      setSourceUrl("");
      setImportStatus(result.duplicate ? "该内容已存在，已复用原资料" : "网页资料已确认并完成入库");
    } catch (error) {
      setImportStatus(materialRequestErrorMessage(error, "import"));
    } finally {
      setBusy(false);
    }
  }

  async function searchPrivateKnowledge(event: FormEvent) {
    event.preventDefault();
    const query = searchQuery.trim();
    if (query.length < 2 || searchBusy) return;
    if (isDemo) {
      setSearchStatus("当前为离线演示模式；登录后才能检索个人资料");
      return;
    }
    setSearchBusy(true);
    setSearchStatus(`正在检索“${query}”…`);
    try {
      const results = await api.searchPrivateKnowledge(query, selectedDocumentId || undefined);
      setSearchResults(results);
      setExpandedSourceIds(new Set());
      const scopeLabel = selectedDocumentId ? "所选资料" : "全部资料";
      setSearchStatus(results.length ? `在${scopeLabel}中找到 ${results.length} 个相关原文片段` : `在${scopeLabel}中没有找到匹配内容，请更换关键词`);
    } catch (error) {
      setSearchResults([]);
      setSearchStatus(materialRequestErrorMessage(error, "search"));
    } finally {
      setSearchBusy(false);
    }
  }

  async function reindexDocument(document: ApiDocument) {
    if (isDemo || reindexingId) return;
    setReindexingId(document.id);
    setImportStatus(`正在重新解析 ${document.original_filename || document.title}…`);
    try {
      const result = await api.reindexDocument(document.id);
      setDocs((items) => items.map((item) => item.id === result.id ? result : item));
      setSearchResults([]);
      setSearchStatus("资料索引已更新，请重新发起检索");
      setImportStatus(result.reindex_status === "ocr_queued"
        ? "已进入 OCR 重建队列，页面会自动刷新处理状态"
        : `重新解析完成 · 分块 v${result.chunking_version ?? 2} · ${result.chunk_count ?? 0} 个片段`);
    } catch (error) {
      setImportStatus(materialRequestErrorMessage(error, "reindex"));
    } finally {
      setReindexingId(null);
    }
  }

  const visibleDocuments = isDemo ? DEMO_DOCUMENTS : docs;
  return <section className="content-view">
    <div className="view-title"><div><div className="eyebrow">个人资料 RAG</div><h1>资料库</h1><p>上传资料、保存可信网页，在回答中回到原文页码与链接。</p></div><button className="primary-button" onClick={() => fileInput.current?.click()}>＋ 导入资料</button></div>
    <div className="material-layout">
      <section className="panel upload-zone">
        <input ref={fileInput} className="visually-hidden" type="file" accept=".pdf,.md,.markdown,application/pdf,text/markdown" onChange={(event) => void upload(event)} />
        <div className="upload-icon">⇧</div><h2>导入 PDF 或 Markdown</h2><p>文本 PDF 直接保留页码切分；扫描版自动标记为待 OCR。文件上限 25 MB。</p>
        <button className="outline-button" disabled={busy} onClick={() => fileInput.current?.click()}>{busy ? "处理中…" : "选择文件"}</button>
        <form className="url-import" onSubmit={previewUrl}><input type="url" value={sourceUrl} onChange={(event) => { setSourceUrl(event.target.value); setImportProposal(null); }} placeholder="粘贴公开网页或 PDF 链接" aria-label="资料链接" /><button type="submit" disabled={busy}>生成预览</button></form>
        <small className="import-status">{importStatus}</small>
        {importProposal && <div className="import-confirm"><strong>待确认网络资料</strong><span>{importProposal.url}</span><p>{importProposal.summary}</p><button type="button" disabled={busy} onClick={() => void approveUrlImport()}>确认下载并入库</button></div>}
      </section>
      <section className="panel material-list">
        <div className="panel-heading compact"><div><div className="eyebrow">资料记录</div><h2>{loading ? "正在加载" : `${visibleDocuments.length} 份资料`}</h2></div><span className="subtle-pill">{isDemo ? "演示资料" : "私有云端资料"}</span></div>
        {loading ? <div className="plan-empty compact">正在读取你的云端资料…</div> : visibleDocuments.length === 0 ? <div className="plan-empty compact"><strong>还没有个人资料</strong><span>上传第一份 PDF 或 Markdown，建立你的私有检索库。</span></div> : visibleDocuments.map((doc) => { const ingestionCopy = documentIngestionCopy(doc); return <div className="document-row" key={doc.id}>
          <span className="document-icon">▤</span>
          <div><strong>{doc.original_filename || doc.title}</strong><small>{doc.content_type} · {doc.byte_size === null ? "大小未知" : `${Math.max(1, Math.ceil(doc.byte_size / 1024))} KB`} · 分块 v{doc.chunking_version ?? 1}{doc.indexed_at ? ` · ${new Date(doc.indexed_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} 更新` : ""}</small></div>
          <em>{doc.source_type === "web" ? "网页" : doc.content_type.includes("pdf") ? "PDF" : "MD"}</em>
          <span className={`document-status status-${doc.ingestion_status}`}><strong>● {ingestionCopy.label}</strong><small>{ingestionCopy.description}</small></span>
          <button className="document-reindex" type="button" disabled={isDemo || reindexingId !== null || doc.ingestion_status === "processing"} onClick={() => void reindexDocument(doc)}>{reindexingId === doc.id ? "解析中…" : doc.ingestion_status === "failed" ? "重新处理" : "重新解析"}</button>
          {doc.ingestion_status === "failed" && <p className="document-error" role="alert">处理建议：确认文件可正常打开、云端模型额度充足后重新处理。{doc.ingestion_error ? "后台已记录详细错误，便于继续排查。" : ""}</p>}
        </div>; })}
      </section>
    </div>
    <section className="panel private-search-panel">
      <div className="panel-heading"><div><div className="eyebrow">私有资料检索</div><h2>从自己的原文中查找依据</h2><p>已启用关键词与 Embedding 混合检索；向量服务不可用时自动回退关键词检索。</p></div><span className="subtle-pill">仅当前账户</span></div>
      <form className="private-search-form" onSubmit={searchPrivateKnowledge}><select value={selectedDocumentId} onChange={(event) => setSelectedDocumentId(event.target.value)} aria-label="限定检索资料"><option value="">全部资料</option>{visibleDocuments.filter((doc) => doc.ingestion_status === "ready").map((doc) => <option key={doc.id} value={doc.id}>{doc.original_filename || doc.title}</option>)}</select><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} minLength={2} maxLength={500} placeholder="例如：函数的定义" aria-label="私有资料检索关键词" /><button type="submit" disabled={searchBusy || searchQuery.trim().length < 2}>{searchBusy ? "检索中…" : "检索原文"}</button></form>
      <small className="private-search-status">{searchStatus}</small>
      {searchResults.length > 0 && <div className="private-search-results">{searchResults.map((source) => { const expanded = expandedSourceIds.has(source.chunk_id); const displayedText = expanded ? source.content : source.snippet || source.content; const canExpand = Boolean(source.snippet && source.content !== source.snippet); return <article key={source.chunk_id}><div><strong>{source.title}</strong><span>{source.page_number ? `第 ${source.page_number} 页` : source.heading || "文档正文"}</span></div><div className="search-result-meta"><span>{source.retrieval_mode === "hybrid" ? "混合检索" : "关键词检索"}</span><span>相关度 {Math.max(0, source.score).toFixed(2)}</span></div><p><HighlightedSearchText text={displayedText} terms={source.matched_terms} /></p><footer><small>{source.locator}</small>{canExpand && <button type="button" onClick={() => setExpandedSourceIds((current) => { const next = new Set(current); if (expanded) next.delete(source.chunk_id); else next.add(source.chunk_id); return next; })}>{expanded ? "收起上下文" : "展开上下文"}</button>}</footer></article>; })}</div>}
    </section>
  </section>;
}

function AgentProposalCard({ proposal, draft, editing, busy, onDraftChange, onStartEdit, onCancelEdit, onSaveEdit, onApprove, onReject }: { proposal: ActionProposal; draft: AgentProposalEdit | null; editing: boolean; busy: boolean; onDraftChange: (draft: AgentProposalEdit) => void; onStartEdit: () => void; onCancelEdit: () => void; onSaveEdit: (event: FormEvent) => void; onApprove: () => void; onReject: () => void }) {
  const canDecide = proposal.status === "pending" || proposal.status === "edited";
  return <div className={`agent-proposal proposal-${proposal.status}`}><div><strong>{proposal.status === "pending" ? "待确认提案" : `提案状态：${proposal.status}`}</strong><p>{proposal.payload.title} · {subjectMeta[proposal.payload.subject].label} · {proposal.payload.planned_minutes} 分钟</p></div>{editing && draft ? <form className="agent-proposal-edit" onSubmit={onSaveEdit}><label>任务标题<input required maxLength={160} value={draft.title} onChange={(event) => onDraftChange({ ...draft, title: event.target.value })} /></label><label>科目<select value={draft.subject} onChange={(event) => onDraftChange({ ...draft, subject: event.target.value as Subject })}>{scopes.filter((item) => item.key !== "all").map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label><label>计划分钟<input required type="number" min={1} max={1440} value={draft.planned_minutes} onChange={(event) => onDraftChange({ ...draft, planned_minutes: Number(event.target.value) })} /></label><div><button className="approve" disabled={busy} type="submit">保存编辑</button><button className="text-button" disabled={busy} type="button" onClick={onCancelEdit}>取消</button></div></form> : canDecide && <div><button className="approve" disabled={busy} onClick={onApprove}>批准写入</button><button className="outline-button" disabled={busy} onClick={onStartEdit}>编辑</button><button className="text-button" disabled={busy} onClick={onReject}>拒绝</button></div>}</div>;
}

const agentWelcomeMessage = "我可以结合你的学习记录与资料库，为你调整计划、解释知识点，或联网核对最新院校信息。任何写入操作都会先让你确认。";

type AgentChatMessage = {
  role: "agent" | "user";
  text: string;
  sources?: AgentSource[];
  model?: AgentModelMetadata;
};

function restoredAgentModel(metadata: Record<string, unknown>): AgentModelMetadata | undefined {
  const profile = metadata.model_profile;
  if (
    typeof metadata.provider !== "string"
    || typeof metadata.model !== "string"
    || (profile !== "flash" && profile !== "pro")
    || typeof metadata.fallback_used !== "boolean"
  ) return undefined;
  return {
    provider: metadata.provider,
    model: metadata.model,
    model_profile: profile,
    fallback_used: metadata.fallback_used,
  };
}

function AgentsView({ isDemo }: { isDemo: boolean }) {
  const [mode, setMode] = useState<"coach" | "tutor" | "combined">("combined");
  const [modelProfile, setModelProfile] = useState<AgentModelProfile>("flash");
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<AgentChatMessage[]>([{ role: "agent", text: agentWelcomeMessage }]);
  const [proposal, setProposal] = useState<ActionProposal | null>(null);
  const [proposalDraft, setProposalDraft] = useState<AgentProposalEdit | null>(null);
  const [editingProposal, setEditingProposal] = useState(false);
  const [threadId, setThreadId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [capabilities, setCapabilities] = useState<ApiHealth | null>(null);
  const [capabilityState, setCapabilityState] = useState<"loading" | "ready" | "error">("loading");
  const [capabilityCheckedAt, setCapabilityCheckedAt] = useState<Date | null>(null);
  const [threads, setThreads] = useState<AgentThreadSummary[]>([]);
  const [copyFeedback, setCopyFeedback] = useState<{ index: number; label: string } | null>(null);
  const agentRequest = useRef<AbortController | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);

  function restoreThread(thread: AgentThreadHistory) {
    setThreadId(thread.id);
    setMode(thread.mode);
    setModelProfile(thread.model_profile);
    setMessages(thread.messages.length ? thread.messages.map((message) => ({ role: message.role, text: message.content, sources: message.sources, model: restoredAgentModel(message.metadata) })) : [{ role: "agent", text: agentWelcomeMessage }]);
  }

  const refreshCapabilities = useCallback(async () => {
    setCapabilityState("loading");
    try {
      setCapabilities(await api.health());
      setCapabilityCheckedAt(new Date());
      setCapabilityState("ready");
    } catch {
      setCapabilities(null);
      setCapabilityState("error");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api.health().then((health) => {
      if (cancelled) return;
      setCapabilities(health);
      setCapabilityCheckedAt(new Date());
      setCapabilityState("ready");
    }).catch(() => {
      if (cancelled) return;
      setCapabilities(null);
      setCapabilityState("error");
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => () => agentRequest.current?.abort(), []);

  useEffect(() => {
    const scrollFrame = window.requestAnimationFrame(() => {
      const messageList = messageListRef.current;
      if (messageList) messageList.scrollTop = messageList.scrollHeight;
    });
    return () => window.cancelAnimationFrame(scrollFrame);
  }, [messages]);

  useEffect(() => {
    if (isDemo) return;
    let cancelled = false;
    void Promise.all([api.latestAgentThread(), api.listPendingProposals(), api.listAgentThreads()]).then(([thread, items, threadItems]) => {
      if (cancelled) return;
      setThreads(threadItems);
      const restoredMessages = thread?.messages.length
        ? thread.messages.map((message) => ({
            role: message.role,
            text: message.content,
            sources: message.sources,
            model: restoredAgentModel(message.metadata),
          }))
        : null;
      if (thread) {
        setThreadId(thread.id);
        setMode(thread.mode);
        setModelProfile(thread.model_profile);
      }
      if (items.length > 0) {
        setProposal(items[0]);
        setProposalDraft(items[0].payload);
      }
      if (restoredMessages || items.length > 0) {
        setMessages([
          ...(restoredMessages ?? []),
          ...(items.length > 0 ? [{ role: "agent" as const, text: "已恢复你上次未处理的 Agent 提案，请继续批准、编辑或拒绝。" }] : []),
        ]);
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [isDemo]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!query.trim() || busy) return;
    const text = query.trim();
    setMessages((items) => [...items, { role: "user", text }]);
    setQuery("");
    if (isDemo) {
      setMessages((items) => [...items, { role: "agent", text: "当前为离线演示模式。登录并连接 Supabase 后，Agent 才能读取你的个人学习数据。" }]);
      return;
    }
    setMessages((items) => [...items, { role: "agent", text: "正在准备回答…" }]);
    let streamedAnswer = "";
    let streamedModel: AgentModelMetadata | undefined;
    const updateStreamingMessage = (message: string, sources?: AgentSource[], model?: AgentModelMetadata) => {
      setMessages((items) => {
        const updated = [...items];
        const index = updated.length - 1;
        if (index >= 0 && updated[index].role === "agent") {
          updated[index] = { role: "agent", text: message, sources, model };
        }
        return updated;
      });
    };
    const controller = new AbortController();
    agentRequest.current = controller;
    setBusy(true);
    try {
      const result = await api.runAgentStream(mode, text, threadId, modelProfile, {
        onStatus: (message) => {
          if (!streamedAnswer) updateStreamingMessage(`${message}…`);
        },
        onModel: (metadata) => {
          streamedModel = metadata;
          if (!streamedAnswer) {
            const providerLabel = metadata.fallback_used ? "Qwen 备用模型" : metadata.model_profile === "pro" ? "DeepSeek Pro" : "DeepSeek Flash";
            updateStreamingMessage(`${providerLabel} 正在生成回答…`, undefined, metadata);
          }
        },
        onDelta: (delta) => {
          streamedAnswer += delta;
          updateStreamingMessage(streamedAnswer, undefined, streamedModel);
        },
      }, controller.signal);
      setThreadId(result.thread_id);
      void api.listAgentThreads().then(setThreads).catch(() => undefined);
      setProposal(result.proposal);
      setProposalDraft(result.proposal?.payload ?? null);
      setEditingProposal(false);
      const modelLabel = result.model_status === "generated" ? "模型生成" : "安全降级";
      const resultModel = { provider: result.provider, model: result.model, model_profile: result.model_profile, fallback_used: result.fallback_used };
      const fallbackLabel = result.fallback_used ? " · DeepSeek 不可用，已切换 Qwen" : "";
      updateStreamingMessage(`${streamedAnswer || result.answer}\n\n路由：${result.route} · 检索：${result.retrieval_mode} · ${modelLabel}${fallbackLabel}`, result.sources, resultModel);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        updateStreamingMessage(`${streamedAnswer}${streamedAnswer ? "\n\n" : ""}已停止生成。本次未完整回答不会写入对话历史；没有经过确认的提案不会写入学习数据。`);
        return;
      }
      updateStreamingMessage(agentRequestErrorMessage(error, mode));
    } finally {
      if (agentRequest.current === controller) {
        agentRequest.current = null;
        setBusy(false);
      }
    }
  }

  function stopWaiting() {
    agentRequest.current?.abort();
  }

  async function copyAgentMessage(text: string, index: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback({ index, label: "已复制" });
    } catch {
      setCopyFeedback({ index, label: "复制失败" });
    }
  }

  function startNewConversation() {
    if (proposal && (proposal.status === "pending" || proposal.status === "edited")) {
      setMessages((items) => [...items, { role: "agent", text: "当前还有待确认提案。请先批准或拒绝，再开始新对话，避免遗漏未处理的学习安排。" }]);
      return;
    }
    setThreadId(undefined);
    setModelProfile("flash");
    setProposal(null);
    setProposalDraft(null);
    setEditingProposal(false);
    setQuery("");
    setMessages([{ role: "agent", text: agentWelcomeMessage }]);
  }

  async function openConversation(selectedThreadId: string) {
    if (selectedThreadId === threadId || busy) return;
    if (proposal && (proposal.status === "pending" || proposal.status === "edited")) {
      setMessages((items) => [...items, { role: "agent", text: "当前还有待确认提案。请先处理提案，再切换历史对话。" }]);
      return;
    }
    setBusy(true);
    try {
      restoreThread(await api.getAgentThread(selectedThreadId));
    } catch {
      setMessages((items) => [...items, { role: "agent", text: "历史对话读取失败，当前对话没有变化。" }]);
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: "approve" | "reject") {
    if (!proposal) return;
    setBusy(true);
    try {
      const updated = await api.decideProposal(proposal.id, decision);
      setProposal(updated);
      setEditingProposal(false);
      const resultText = updated.status === "applied" ? "提案已批准并幂等写入任务清单。" : updated.status === "rejected" ? "提案已拒绝，没有修改学习数据。" : "提案已进入编辑状态。";
      setMessages((items) => [...items, { role: "agent", text: resultText }]);
    } catch {
      setMessages((items) => [...items, { role: "agent", text: "提案处理失败，没有执行写入。" }]);
    } finally {
      setBusy(false);
    }
  }

  async function saveProposalEdit(event: FormEvent) {
    event.preventDefault();
    if (!proposal || !proposalDraft || busy) return;
    setBusy(true);
    try {
      const updated = await api.decideProposal(proposal.id, "edit", proposalDraft);
      setProposal(updated);
      setProposalDraft(updated.payload);
      setEditingProposal(false);
      setMessages((items) => [...items, { role: "agent", text: "提案内容已更新，仍未写入任务。请再次确认后批准。" }]);
    } catch {
      setMessages((items) => [...items, { role: "agent", text: "提案编辑保存失败，原提案未执行。" }]);
    } finally {
      setBusy(false);
    }
  }

  const primaryModelReady = !isDemo && capabilities?.agent.primary_model_configured;
  const fallbackModelReady = !isDemo && capabilities?.agent.fallback_model_configured;
  const embeddingReady = !isDemo && capabilities?.rag.embedding_configured;
  const ocrReady = !isDemo && capabilities?.ocr.configured;
  const searchReady = !isDemo && capabilities?.agent.web_search_configured;
  return (
    <section className="content-view agent-view">
      <div className="view-title">
        <div>
          <div className="eyebrow">LangChain × LangGraph</div>
          <h1>双 Agent 学习助手</h1>
          <p>计划教练负责执行闭环，资料导师负责带引用的检索与答疑。</p>
        </div>
        <div className="agent-heading-actions">
          <span className={`status-chip ${busy ? "" : "online"}`}>● {busy ? "分析中" : "等待请求"}</span>
          <button className="outline-button" type="button" onClick={startNewConversation} disabled={busy}>＋ 新建对话</button>
        </div>
      </div>
      <div className="agent-capability-panel panel" aria-label="云端能力状态">
        <div className="agent-capability-toolbar">
          <div>
            <strong>云端能力状态</strong>
            <small>
              {capabilityState === "loading"
                ? "正在读取后端配置…"
                : capabilityState === "error"
                  ? "后端暂时无法连接，请检查服务后重试"
                  : `配置状态更新于 ${capabilityCheckedAt?.toLocaleTimeString("zh-CN", { hour12: false }) ?? "刚刚"}；实际调用异常会在对话中明确提示`}
            </small>
          </div>
          <button type="button" className="outline-button" onClick={() => void refreshCapabilities()} disabled={capabilityState === "loading"}>
            {capabilityState === "loading" ? "检查中…" : "重新检查配置"}
          </button>
        </div>
        <div className="agent-capabilities">
          <div>
            <span className={primaryModelReady ? "ready" : "fallback"}>主模型</span>
            <strong>{primaryModelReady ? "DeepSeek 配置就绪" : "DeepSeek 未配置"}</strong>
            <small>{primaryModelReady ? "支持 Flash 与 Pro，默认由用户手动选择" : "未配置 CHAT_API_KEY，无法生成真实回答"}</small>
          </div>
          <div>
            <span className={fallbackModelReady ? "ready" : "fallback"}>备用</span>
            <strong>{fallbackModelReady ? "Qwen 备用就绪" : "Qwen 备用未配置"}</strong>
            <small>{fallbackModelReady ? "DeepSeek 超时、限流或服务异常时按档位接管" : "主模型异常时不会伪装成备用回答"}</small>
          </div>
          <div>
            <span className={embeddingReady ? "ready" : "fallback"}>检索</span>
            <strong>{embeddingReady ? "混合检索已配置" : "关键词检索模式"}</strong>
            <small>{embeddingReady ? `${capabilities?.rag.embedding_model} · ${capabilities?.rag.embedding_dimensions} 维` : "Embedding 不可用时保留 PostgreSQL 全文检索"}</small>
          </div>
          <div>
            <span className={ocrReady ? "ready" : "fallback"}>OCR</span>
            <strong>{ocrReady ? "Qwen OCR 已配置" : "OCR 尚未就绪"}</strong>
            <small>{ocrReady ? `${capabilities?.ocr.model} · PDF 渲染器已就绪` : capabilities?.ocr.renderer_configured ? "请检查 OCR Key 与模型配置" : "需要配置模型并安装 pdftoppm"}</small>
          </div>
          <div>
            <span className={searchReady ? "ready" : "fallback"}>联网</span>
            <strong>{searchReady ? "Tavily 联网检索已配置" : "仅使用个人资料"}</strong>
            <small>{searchReady ? "最新信息可附网页来源与访问时间" : "未配置 Tavily Key，不会生成虚假网络来源"}</small>
          </div>
        </div>
      </div>
      <div className="agent-shell panel">
        {threads.length > 0 && (
          <div className="agent-thread-list" aria-label="历史对话">
            {threads.map((thread) => (
              <button key={thread.id} type="button" className={thread.id === threadId ? "active" : ""} onClick={() => void openConversation(thread.id)} disabled={busy}>
                <strong>{thread.title}</strong>
                <small>{new Date(thread.updated_at).toLocaleDateString("zh-CN")}</small>
              </button>
            ))}
          </div>
        )}
        <div className="agent-tabs">
          {[["coach", "计划教练"], ["tutor", "资料导师"], ["combined", "联合模式"]].map(([key, label]) => (
            <button key={key} className={mode === key ? "active" : ""} onClick={() => setMode(key as typeof mode)} disabled={busy}>{label}</button>
          ))}
          <label className="agent-model-select">
            <span>回答模型</span>
            <select value={modelProfile} onChange={(event) => setModelProfile(event.target.value as AgentModelProfile)} disabled={busy}>
              <option value="flash">DeepSeek Flash · 快速</option>
              <option value="pro">DeepSeek Pro · 深度</option>
            </select>
            <small>{modelProfile === "pro" ? "质量更高，响应更慢且费用更高" : "适合日常答疑、计划和资料概括"}</small>
          </label>
        </div>
        <div className="message-list" ref={messageListRef}>
          {messages.map((message, index) => (
            <div className={`message ${message.role}`} key={index}>
              <span>{message.role === "agent" ? "✦" : "你"}</span>
              <div className="message-body">
                <p>{message.text}</p>
                {message.model && <small className={`message-model ${message.model.fallback_used ? "fallback" : ""}`}>{message.model.fallback_used ? "Qwen 备用" : message.model.model_profile === "pro" ? "DeepSeek Pro" : "DeepSeek Flash"} · {message.model.model}</small>}
                {message.role === "agent" && <button className="message-copy-button" type="button" onClick={() => void copyAgentMessage(message.text, index)}>{copyFeedback?.index === index ? copyFeedback.label : "复制回答"}</button>}
                {message.sources && message.sources.length > 0 && (
                  <div className="agent-sources">
                    <strong>本次回答来源</strong>
                    {message.sources.map((source) => source.url ? (
                      <a key={`${source.source_type}-${source.locator}`} href={source.url} target="_blank" rel="noreferrer">
                        <span>网络</span><b>{source.title}</b><small>{source.accessed_at ? `访问于 ${new Date(source.accessed_at).toLocaleString("zh-CN")}` : source.locator}</small>
                      </a>
                    ) : (
                      <div key={`${source.source_type}-${source.locator}`}><span>个人</span><b>{source.title}</b><small>{source.locator}</small></div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        {proposal && (
          <AgentProposalCard
            proposal={proposal}
            draft={proposalDraft}
            editing={editingProposal}
            busy={busy}
            onDraftChange={setProposalDraft}
            onStartEdit={() => { setProposalDraft(proposal.payload); setEditingProposal(true); }}
            onCancelEdit={() => { setProposalDraft(proposal.payload); setEditingProposal(false); }}
            onSaveEdit={saveProposalEdit}
            onApprove={() => void decide("approve")}
            onReject={() => void decide("reject")}
          />
        )}
        <form className="agent-input" onSubmit={submit}>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="询问计划、资料或最新院校信息…" disabled={busy} />
          {busy
            ? <button className="cancel" type="button" onClick={stopWaiting}>停止等待</button>
            : <button type="submit" disabled={!query.trim()}>发送 ↑</button>}
        </form>
      </div>
    </section>
  );
}

function AuthScreen({ initialStatus = "", recoveryMode = false, onRecoveryComplete }: { initialStatus?: string; recoveryMode?: boolean; onRecoveryComplete?: (notice: string) => void }) {
  const [mode, setMode] = useState<"login" | "register" | "forgot" | "reset">(recoveryMode ? "reset" : "login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === "forgot" || mode === "reset") return;
    const client = getSupabaseClient();
    if (!client || busy) return;
    const normalizedDisplayName = displayName.trim();
    if (mode === "register" && (normalizedDisplayName.length < 2 || normalizedDisplayName.length > 32)) {
      setStatus("昵称需要填写 2 至 32 个字符。");
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      const result = mode === "login"
        ? await client.auth.signInWithPassword({ email: email.trim(), password })
        : await client.auth.signUp({ email: email.trim(), password, options: { data: { display_name: normalizedDisplayName } } });
      if (result.error) {
        setStatus(authRequestErrorMessage(result.error, mode));
      } else if (mode === "register" && !result.data.session) {
        setStatus("注册成功，请前往邮箱完成验证后登录。");
        setMode("login");
      } else {
        setStatus("登录成功，正在加载你的学习数据…");
      }
    } catch (error) {
      setStatus(authRequestErrorMessage(error, mode));
    } finally {
      setBusy(false);
    }
  }

  async function requestPasswordReset(event: FormEvent) {
    event.preventDefault();
    const client = getSupabaseClient();
    if (!client || busy) return;
    setBusy(true);
    setStatus("");
    try {
      const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.location.origin,
      });
      if (error) {
        setStatus(passwordResetRequestErrorMessage(error));
      } else {
        setStatus("如果该邮箱已注册，密码重置邮件会在几分钟内送达，请检查收件箱和垃圾邮件。重置链接仅供本人使用。");
      }
    } catch (error) {
      setStatus(passwordResetRequestErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function updatePassword(event: FormEvent) {
    event.preventDefault();
    const client = getSupabaseClient();
    if (!client || busy) return;
    if (password !== passwordConfirmation) {
      setStatus("两次输入的新密码不一致，请重新确认。");
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      const { error } = await client.auth.updateUser({ password });
      if (error) {
        setStatus(passwordUpdateErrorMessage(error));
        return;
      }
      await client.auth.signOut({ scope: "local" });
      onRecoveryComplete?.("密码已更新，请使用新密码登录工作台。");
    } catch (error) {
      setStatus(passwordUpdateErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-brand-panel">
        <div className="brand auth-brand"><span className="brand-mark">研</span><div><strong>研途</strong><small>Agent Workbench</small></div></div>
        <div><div className="eyebrow">2028 考研长期工作台</div><h1>让每一天的投入，<br />都留下可以复盘的证据。</h1><p>任务、专注、热力图和学习资料统一保存在你的个人云端空间。</p></div>
        <div className="auth-proof"><span>01</span><p><strong>数据长期保存</strong><small>重启和换设备后，学习记录依然存在</small></p></div>
        <div className="auth-proof"><span>02</span><p><strong>严格个人隔离</strong><small>每个账户只能访问自己的任务与资料</small></p></div>
      </section>
      <section className="auth-form-panel">
        <div className="auth-card">
          <span className="auth-kicker">SUPABASE CLOUD</span>
          <h2>{mode === "login" ? "欢迎回来" : mode === "register" ? "创建学习账户" : mode === "forgot" ? "找回密码" : "设置新密码"}</h2>
          <p>{mode === "login" ? "登录后继续今天的学习闭环。" : mode === "register" ? "第一版使用邮箱和密码注册。" : mode === "forgot" ? "输入注册邮箱，我们会发送安全的密码重置链接。" : "重置链接已验证，请为账户设置一个新的登录密码。"}</p>
          <form onSubmit={mode === "forgot" ? requestPasswordReset : mode === "reset" ? updatePassword : submit}>
            {mode === "register" && <label>学习昵称<input type="text" value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="nickname" minLength={2} maxLength={32} placeholder="例如：小林" required /></label>}
            {mode !== "reset" && <label>邮箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="name@example.com" required /></label>}
            {mode !== "forgot" && <label>{mode === "reset" ? "新密码" : "密码"}<div className="auth-password-field"><input type={passwordVisible ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={6} placeholder="至少 6 位" required /><button type="button" aria-label={passwordVisible ? "隐藏密码" : "显示密码"} aria-pressed={passwordVisible} onClick={() => setPasswordVisible((visible) => !visible)}>{passwordVisible ? "隐藏" : "显示"}</button></div></label>}
            {mode === "reset" && <label>确认新密码<input type={passwordVisible ? "text" : "password"} value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} autoComplete="new-password" minLength={6} placeholder="再次输入新密码" required /></label>}
            {mode === "login" && <button className="auth-forgot" type="button" onClick={() => { setMode("forgot"); setPasswordVisible(false); setStatus(""); }}>忘记密码？</button>}
            <button className="primary-button auth-submit" type="submit" disabled={busy}>{busy ? "请稍候…" : mode === "login" ? "登录工作台" : mode === "register" ? "注册账户" : mode === "forgot" ? "发送重置邮件" : "保存新密码"}</button>
          </form>
          {status && <div className="auth-status" role="status">{status}</div>}
          {mode !== "reset" && <button className="auth-switch" onClick={() => { setMode(mode === "login" ? "register" : "login"); setPasswordVisible(false); setStatus(""); }}>{mode === "login" ? "还没有账户？立即注册" : "返回登录"}</button>}
        </div>
      </section>
    </main>
  );
}

type WorkbenchSearchEntry = {
  id: string;
  view: View;
  category: string;
  title: string;
  detail: string;
};

function GlobalSearch({ open, isDemo, onClose, onNavigate }: { open: boolean; isDemo: boolean; onClose: () => void; onNavigate: (view: View) => void }) {
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<WorkbenchSearchEntry[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    const focusFrame = window.requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!open) return;
    if (isDemo) return;
    let active = true;
    void Promise.all([
      api.today(),
      api.listPlans(),
      api.listMistakes(),
      api.listSchoolOptions(),
      api.listDocuments(),
      api.listCareerItems(),
    ]).then(([today, plans, mistakes, schools, documents, careerItems]) => {
      if (!active) return;
      setEntries([
        ...today.tasks.map((task) => ({ id: task.id, view: "today" as const, category: "今日任务", title: task.title, detail: `${subjectMeta[task.subject].label} · ${task.planned_minutes} 分钟` })),
        ...plans.map((plan) => ({ id: plan.id, view: "plan" as const, category: `${plan.level === "stage" ? "阶段" : plan.level === "week" ? "周" : "日"}计划`, title: plan.title, detail: `${plan.starts_on} 至 ${plan.ends_on}` })),
        ...mistakes.map((mistake) => ({ id: mistake.id, view: "today" as const, category: "错题卡", title: mistake.title, detail: subjectMeta[mistake.subject].label })),
        ...schools.map((school) => ({ id: school.id, view: "schools" as const, category: "院校情报", title: `${school.university} · ${school.major_name}`, detail: `${school.college} · ${school.exam_year}` })),
        ...documents.map((document) => ({ id: document.id, view: "materials" as const, category: "个人资料", title: document.title, detail: document.original_filename || document.content_type })),
        ...careerItems.map((item) => ({ id: item.id, view: "career" as const, category: "求职记录", title: item.title, detail: item.company || careerStatusMeta[item.status] })),
      ]);
      setStatus("搜索范围仅包含当前账户的云端数据");
    }).catch((error) => {
      if (active) setStatus(cloudReadErrorMessage(error, "搜索数据"));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [isDemo, open]);

  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const results = normalizedQuery
    ? entries.filter((entry) => `${entry.category} ${entry.title} ${entry.detail}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery)).slice(0, 30)
    : [];
  const visibleStatus = isDemo ? "离线演示模式不读取个人数据，登录后可使用全局搜索。" : status;
  const visibleLoading = !isDemo && loading;
  if (!open) return null;

  function openSearchResult(entry: WorkbenchSearchEntry) {
    onNavigate(entry.view);
    onClose();
  }

  function handleSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveResultIndex((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveResultIndex((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      openSearchResult(results[Math.min(activeResultIndex, results.length - 1)]);
    }
  }

  return (
    <div className="global-search-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="global-search-dialog panel" role="dialog" aria-modal="true" aria-labelledby="global-search-title">
        <div className="global-search-field">
          <span>⌕</span>
          <label className="visually-hidden" htmlFor="global-search-input" id="global-search-title">搜索个人工作台</label>
          <input id="global-search-input" ref={searchInputRef} value={query} onChange={(event) => { setQuery(event.target.value); setActiveResultIndex(0); }} onKeyDown={handleSearchKeyDown} aria-controls="global-search-results" aria-activedescendant={results.length ? `global-search-result-${activeResultIndex}` : undefined} placeholder="搜索任务、计划、错题、院校、资料或求职记录" />
          <button type="button" aria-label="关闭搜索" onClick={onClose}>Esc</button>
        </div>
        <div className="global-search-results" id="global-search-results">
          {visibleLoading ? <div className="global-search-empty">正在读取你的云端数据…</div>
            : !normalizedQuery ? <div className="global-search-empty">输入关键词开始搜索，结果不会离开你的账户。</div>
              : results.length === 0 ? <div className="global-search-empty">没有找到匹配记录</div>
                : results.map((entry, index) => (
                  <button id={`global-search-result-${index}`} key={`${entry.view}-${entry.id}`} className={index === activeResultIndex ? "active" : ""} type="button" onMouseEnter={() => setActiveResultIndex(index)} onClick={() => openSearchResult(entry)}>
                    <span>{entry.category}</span><strong>{entry.title}</strong><small>{entry.detail}</small>
                  </button>
                ))}
        </div>
        <small className="global-search-status">{visibleStatus}</small>
      </section>
    </div>
  );
}

type AttentionEntry = {
  id: string;
  view: View;
  category: string;
  title: string;
  detail: string;
};

function AttentionCenter({ open, isDemo, onClose, onNavigate, onCountChange }: { open: boolean; isDemo: boolean; onClose: () => void; onNavigate: (view: View) => void; onCountChange: (count: number) => void }) {
  const [items, setItems] = useState<AttentionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const loadedOnce = useRef(false);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  useEffect(() => {
    if (isDemo || (!open && loadedOnce.current)) return;
    let active = true;
    void Promise.all([
      api.today(),
      api.listMistakes(true),
      api.listPendingProposals(),
      api.listDocuments(),
    ]).then(([today, mistakes, proposals, documents]) => {
      if (!active) return;
      const nextItems: AttentionEntry[] = [
        ...today.tasks.filter((task) => !task.completed).map((task) => ({ id: task.id, view: "today" as const, category: "待完成任务", title: task.title, detail: `${subjectMeta[task.subject].label} · 计划 ${task.planned_minutes} 分钟` })),
        ...mistakes.map((mistake) => ({ id: mistake.id, view: "today" as const, category: "到期错题", title: mistake.title, detail: `已复习 ${mistake.review_count} 次` })),
        ...proposals.filter((proposal) => proposal.status === "pending" || proposal.status === "edited").map((proposal) => ({ id: proposal.id, view: "agents" as const, category: "Agent 提案", title: proposal.summary, detail: "需要批准、编辑或拒绝" })),
        ...documents.filter((document) => document.ingestion_status === "ocr_required" || document.ingestion_status === "failed").map((document) => ({ id: document.id, view: "materials" as const, category: document.ingestion_status === "ocr_required" ? "等待 OCR" : "资料处理失败", title: document.title, detail: document.ingestion_error || document.original_filename || "请进入资料库检查" })),
      ].slice(0, 30);
      loadedOnce.current = true;
      setItems(nextItems);
      setStatus("待处理事项来自当前账户的实时云端记录");
      setLoading(false);
      onCountChange(nextItems.length);
    }).catch((error) => {
      if (!active) return;
      loadedOnce.current = true;
      setStatus(cloudReadErrorMessage(error, "待处理事项"));
      setLoading(false);
    });
    return () => { active = false; };
  }, [isDemo, onCountChange, open]);

  if (!open) return null;
  const visibleLoading = !isDemo && loading;
  const visibleStatus = isDemo ? "离线演示模式不读取个人待办，登录后可查看。" : status;
  return (
    <div className="attention-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="attention-dialog panel" role="dialog" aria-modal="true" aria-labelledby="attention-title">
        <div className="attention-heading"><div><div className="eyebrow">需要行动</div><h2 id="attention-title">待处理事项</h2></div><button type="button" aria-label="关闭待处理事项" onClick={onClose}>×</button></div>
        <div className="attention-list">
          {visibleLoading ? <div className="attention-empty">正在检查云端事项…</div>
            : items.length === 0 ? <div className="attention-empty"><strong>暂时没有待处理事项</strong><span>保持现在的节奏。</span></div>
              : items.map((item) => (
                <button key={`${item.category}-${item.id}`} type="button" onClick={() => { onNavigate(item.view); onClose(); }}>
                  <span>{item.category}</span><strong>{item.title}</strong><small>{item.detail}</small>
                </button>
              ))}
        </div>
        <small className="attention-status">{visibleStatus}</small>
      </section>
    </div>
  );
}

function QuickCapture({ open, isDemo, onClose, onSaved }: { open: boolean; isDemo: boolean; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<"task" | "mistake">("task");
  const [subject, setSubject] = useState<Subject>("math");
  const [title, setTitle] = useState("");
  const [plannedMinutes, setPlannedMinutes] = useState(30);
  const [question, setQuestion] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    const focusFrame = window.requestAnimationFrame(() => titleInputRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [busy, onClose, open]);

  if (!open) return null;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || busy) return;
    if (kind === "mistake" && !question.trim()) {
      setStatus("请填写题目或知识点内容");
      return;
    }
    if (isDemo) {
      setStatus("离线演示模式不会保存个人记录，请登录云端账户后使用。");
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      if (kind === "task") {
        await api.createTask({ title: title.trim(), subject, planned_minutes: plannedMinutes });
      } else {
        await api.createMistake({
          title: title.trim(),
          subject: subject === "career" ? "math" : subject,
          question: question.trim(),
          error_reason: reason.trim(),
        });
      }
      setTitle("");
      setQuestion("");
      setReason("");
      setPlannedMinutes(30);
      onSaved();
      onClose();
    } catch (error) {
      setStatus(studyWriteErrorMessage(error, kind === "task" ? "快速创建任务" : "快速记录错题"));
    } finally {
      setBusy(false);
    }
  }

  const availableSubjects = kind === "task"
    ? scopes.filter((item) => item.key !== "all")
    : scopes.filter((item) => item.key !== "all" && item.key !== "career");
  return (
    <div className="quick-capture-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="quick-capture-dialog panel" role="dialog" aria-modal="true" aria-labelledby="quick-capture-title">
        <div className="quick-capture-heading">
          <div><div className="eyebrow">随时记录</div><h2 id="quick-capture-title">快速记录学习现场</h2></div>
          <button type="button" aria-label="关闭快速记录" onClick={onClose} disabled={busy}>×</button>
        </div>
        <div className="quick-capture-tabs">
          <button type="button" className={kind === "task" ? "active" : ""} onClick={() => { setKind("task"); setStatus(""); }}>今日任务</button>
          <button type="button" className={kind === "mistake" ? "active" : ""} onClick={() => { setKind("mistake"); setStatus(""); if (subject === "career") setSubject("math"); }}>错题卡</button>
        </div>
        <form onSubmit={save}>
          <label>科目<select value={subject} onChange={(event) => setSubject(event.target.value as Subject)}>{availableSubjects.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
          <label className="quick-capture-wide">{kind === "task" ? "任务名称" : "错题标题"}<input ref={titleInputRef} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} placeholder={kind === "task" ? "例如：完成线性代数第二讲" : "例如：极限等价无穷小误用"} required /></label>
          {kind === "task" ? (
            <label>计划时长（分钟）<input type="number" min={1} max={1440} value={plannedMinutes} onChange={(event) => setPlannedMinutes(Number(event.target.value))} required /></label>
          ) : (
            <>
              <label className="quick-capture-wide">题目或知识点<textarea value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={5000} required /></label>
              <label className="quick-capture-wide">错误原因<textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={5000} placeholder="可稍后补充" /></label>
            </>
          )}
          {status && <div className="quick-capture-status" role="status">{status}</div>}
          <div className="quick-capture-actions"><button type="button" onClick={onClose} disabled={busy}>取消</button><button className="primary-button" type="submit" disabled={busy}>{busy ? "正在保存…" : "保存到云端"}</button></div>
        </form>
      </section>
    </div>
  );
}

function AccountSecurity({ email, initialDisplayName, onClose, onSignOut, onUserUpdated }: { email: string; initialDisplayName: string; onClose: () => void; onSignOut: () => Promise<void>; onUserUpdated: (user: User) => void }) {
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const resetAndClose = useCallback(() => {
    setPassword("");
    setPasswordConfirmation("");
    setPasswordVisible(false);
    setStatus("");
    onClose();
  }, [onClose]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) resetAndClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, resetAndClose]);

  async function updateAccount(event: FormEvent) {
    event.preventDefault();
    const client = getSupabaseClient();
    if (!client || busy) return;
    const normalizedDisplayName = displayName.trim();
    if (normalizedDisplayName.length < 2 || normalizedDisplayName.length > 32) {
      setStatus("昵称需要填写 2 至 32 个字符。");
      return;
    }
    if (password && password !== passwordConfirmation) {
      setStatus("两次输入的新密码不一致，请重新确认。");
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      const attributes = password
        ? { password, data: { display_name: normalizedDisplayName } }
        : { data: { display_name: normalizedDisplayName } };
      const result = await client.auth.updateUser(attributes);
      if (result.error) {
        setStatus(accountPasswordUpdateErrorMessage(result.error));
        return;
      }
      onUserUpdated(result.data.user);
      setPassword("");
      setPasswordConfirmation("");
      setStatus(password ? "昵称与密码已安全更新。" : "学习昵称已更新。侧边栏已同步显示新昵称。");
    } catch (error) {
      setStatus(accountPasswordUpdateErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="account-security-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) resetAndClose(); }}>
      <section className="account-security-dialog panel" role="dialog" aria-modal="true" aria-labelledby="account-security-title">
        <div className="quick-capture-heading">
          <div><div className="eyebrow">账户与隐私</div><h2 id="account-security-title">账户安全</h2></div>
          <button type="button" aria-label="关闭账户安全" onClick={resetAndClose} disabled={busy}>×</button>
        </div>
        <div className="account-security-email"><span>当前登录邮箱</span><strong>{email}</strong></div>
        <form onSubmit={updateAccount}>
          <label>学习昵称<input type="text" value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="nickname" minLength={2} maxLength={32} required /></label>
          <div className="account-security-section"><strong>修改密码（可选）</strong><small>不需要修改密码时请保持以下两项为空。</small></div>
          <label>新密码<div className="auth-password-field"><input type={passwordVisible ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} minLength={password ? 6 : undefined} autoComplete="new-password" /><button type="button" aria-label={passwordVisible ? "隐藏新密码" : "显示新密码"} aria-pressed={passwordVisible} onClick={() => setPasswordVisible((value) => !value)}>{passwordVisible ? "隐藏" : "显示"}</button></div></label>
          <label>确认新密码<input type={passwordVisible ? "text" : "password"} value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} minLength={passwordConfirmation ? 6 : undefined} autoComplete="new-password" /></label>
          {status && <div className="account-security-status" role="status">{status}</div>}
          <div className="account-security-actions"><button className="danger-button" type="button" onClick={() => void onSignOut()} disabled={busy}>退出当前账户</button><button className="primary-button" type="submit" disabled={busy}>{busy ? "正在保存…" : "保存账户设置"}</button></div>
        </form>
      </section>
    </div>
  );
}

function Workbench({ user, isDemo, onSignOut, onUserUpdated }: { user: User | null; isDemo: boolean; onSignOut: () => Promise<void>; onUserUpdated: (user: User) => void }) {
  const accountKey = user?.id ?? "demo";
  const [view, setView] = useState<View>(() => readStoredWorkbenchView(typeof window === "undefined" ? null : window.localStorage, accountKey));
  const [apiStatus, setApiStatus] = useState<WorkbenchApiStatus>("checking");
  const [healthRevision, setHealthRevision] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [attentionCount, setAttentionCount] = useState(0);
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [accountSecurityOpen, setAccountSecurityOpen] = useState(false);
  const [studyRevision, setStudyRevision] = useState(0);
  const [planRevision, setPlanRevision] = useState(0);
  const [sidebarStage, setSidebarStage] = useState<ApiPlan | null>(() => isDemo ? selectSidebarStage(demoPlans, shanghaiDateKey(new Date())) : null);
  const [sidebarStageState, setSidebarStageState] = useState<"loading" | "ready" | "empty" | "error">(() => isDemo ? "ready" : "loading");
  const metadataDisplayName = typeof user?.user_metadata?.display_name === "string" ? user.user_metadata.display_name.trim() : "";
  const displayName = metadataDisplayName || user?.email?.split("@")[0] || "林宇超";
  const avatar = displayName.slice(0, 2).toUpperCase();
  const navigateToView = useCallback((nextView: View) => {
    setView(nextView);
    storeWorkbenchView(typeof window === "undefined" ? null : window.localStorage, accountKey, nextView);
  }, [accountKey]);
  const retryApiHealth = useCallback(() => {
    setApiStatus("checking");
    setHealthRevision((revision) => revision + 1);
  }, []);
  const content = { today: <TodayView key={`${isDemo ? "demo" : "cloud"}-${studyRevision}`} isDemo={isDemo} displayName={displayName} accountKey={accountKey} />, plan: <PlanView isDemo={isDemo} onPlansChanged={() => setPlanRevision((revision) => revision + 1)} />, subjects: <SubjectsView isDemo={isDemo} onOpenMaterials={() => navigateToView("materials")} onOpenToday={() => navigateToView("today")} />, schools: <SchoolsView isDemo={isDemo} />, career: <CareerView isDemo={isDemo} />, materials: <MaterialsView isDemo={isDemo} />, backup: <BackupView isDemo={isDemo} />, agents: <AgentsView isDemo={isDemo} /> }[view];
  const sidebarStageProgress = sidebarStage ? stageDateProgress(sidebarStage, shanghaiDateKey(new Date())) : 0;

  useEffect(() => {
    let active = true;
    const check = () => api.health()
      .then((health) => { if (active) setApiStatus(health.mode === "supabase" ? "cloud" : "demo"); })
      .catch(() => { if (active) setApiStatus("offline"); });
    void check();
    const timer = window.setInterval(check, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [healthRevision]);

  useEffect(() => {
    if (isDemo) return;

    let active = true;
    void api.listPlans("stage")
      .then((plans) => {
        if (!active) return;
        const selected = selectSidebarStage(plans, shanghaiDateKey(new Date()));
        setSidebarStage(selected);
        setSidebarStageState(selected ? "ready" : "empty");
      })
      .catch(() => {
        if (!active) return;
        setSidebarStage(null);
        setSidebarStageState("error");
      });
    return () => { active = false; };
  }, [isDemo, planRevision, view]);

  useEffect(() => {
    const openSearchWithShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", openSearchWithShortcut);
    return () => window.removeEventListener("keydown", openSearchWithShortcut);
  }, []);

  return <WorkbenchLayout
    activeView={view}
    apiStatus={apiStatus}
    isDemo={isDemo}
    navItems={navItems}
    attentionCount={attentionCount}
    onNavigate={navigateToView}
    onRetryApiHealth={retryApiHealth}
    onOpenSearch={() => setSearchOpen(true)}
    onOpenAttention={() => setAttentionOpen(true)}
    onOpenQuickCapture={() => setQuickCaptureOpen(true)}
    sidebarGoal={<div className={`sidebar-goal ${sidebarStageState}`} aria-busy={sidebarStageState === "loading"}>
      <span>2028 考研阶段</span>
      <strong>{sidebarStageState === "loading" ? "正在读取阶段计划…" : sidebarStageState === "error" ? "阶段计划暂时不可用" : sidebarStageState === "empty" ? "尚未创建阶段计划" : sidebarStage?.title}</strong>
      <div className="progress-track" aria-label={sidebarStage ? `阶段日期进度 ${sidebarStageProgress}%` : "暂无阶段进度"}><span style={{ width: `${sidebarStageProgress}%` }} /></div>
      <small>{sidebarStageState === "ready" && sidebarStage ? `${planDateRange(sidebarStage)} · ${sidebarStageProgress}%` : sidebarStageState === "loading" ? "正在同步云端数据" : sidebarStageState === "error" ? "请检查云端连接后重试" : "先制定第一轮复习目标"}</small>
      <button type="button" onClick={() => navigateToView("plan")}>{sidebarStageState === "empty" ? "创建阶段计划" : "查看三级计划"}</button>
    </div>}
    profile={<div className="profile"><span>{avatar}</span><div><strong>{displayName}</strong><small>{isDemo ? "离线演示账户" : user?.email}</small></div>{isDemo ? <button aria-label="演示模式说明">•••</button> : <button aria-label="打开账户安全" title="账户安全" onClick={() => setAccountSecurityOpen(true)}>账户</button>}</div>}
    overlays={<>
      <GlobalSearch open={searchOpen} isDemo={isDemo} onClose={() => setSearchOpen(false)} onNavigate={navigateToView} />
      <AttentionCenter open={attentionOpen} isDemo={isDemo} onClose={() => setAttentionOpen(false)} onNavigate={navigateToView} onCountChange={setAttentionCount} />
      <QuickCapture open={quickCaptureOpen} isDemo={isDemo} onClose={() => setQuickCaptureOpen(false)} onSaved={() => { setStudyRevision((value) => value + 1); navigateToView("today"); }} />
      {!isDemo && accountSecurityOpen && <AccountSecurity email={user?.email ?? ""} initialDisplayName={displayName} onClose={() => setAccountSecurityOpen(false)} onSignOut={onSignOut} onUserUpdated={onUserUpdated} />}
    </>}
  >{content}</WorkbenchLayout>;
}

export default function Home() {
  const [authState, setAuthState] = useState<{ status: "loading" | "demo" | "signed_out" | "signed_in"; user: User | null }>(() => ({
    status: isSupabaseConfigured ? "loading" : "demo",
    user: null,
  }));
  const [authNotice, setAuthNotice] = useState("");
  const [passwordRecovery, setPasswordRecovery] = useState(false);

  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) {
      setApiAccessToken(null);
      return;
    }
    let active = true;
    void client.auth.getSession()
      .then(({ data }) => {
        if (!active) return;
        setApiAccessToken(data.session?.access_token ?? null);
        setAuthState({ status: data.session ? "signed_in" : "signed_out", user: data.session?.user ?? null });
      })
      .catch(() => {
        if (!active) return;
        setApiAccessToken(null);
        setAuthState({ status: "signed_out", user: null });
      });
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY") setPasswordRecovery(true);
      setApiAccessToken(session?.access_token ?? null);
      setAuthState({ status: session ? "signed_in" : "signed_out", user: session?.user ?? null });
    });
    setApiAuthFailureHandler(() => {
      if (!active) return;
      setApiAccessToken(null);
      setAuthNotice("登录状态已失效，请重新登录。");
      setAuthState({ status: "signed_out", user: null });
      void client.auth.signOut({ scope: "local" });
    });
    return () => {
      active = false;
      setApiAuthFailureHandler(null);
      subscription.unsubscribe();
    };
  }, []);

  async function signOut() {
    const client = getSupabaseClient();
    if (client) await client.auth.signOut();
    setApiAccessToken(null);
    setAuthNotice("");
    setPasswordRecovery(false);
  }

  if (authState.status === "loading") return <main className="auth-loading"><span className="brand-mark">研</span><p>正在恢复登录状态…</p></main>;
  if (passwordRecovery) return <AuthScreen recoveryMode onRecoveryComplete={(notice) => { setPasswordRecovery(false); setAuthNotice(notice); setAuthState({ status: "signed_out", user: null }); }} />;
  if (authState.status === "signed_out") return <AuthScreen initialStatus={authNotice} />;
  return <Workbench key={authState.user?.id ?? "demo"} user={authState.user} isDemo={authState.status === "demo"} onSignOut={signOut} onUserUpdated={(user) => setAuthState({ status: "signed_in", user })} />;
}
