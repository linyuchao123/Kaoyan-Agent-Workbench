"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { api, setApiAccessToken, setApiAuthFailureHandler, type ActionProposal, type ApiPlan, type ApiTask, type ContributionScope, type Subject } from "./lib/api";
import { createShanghaiStudyInterval } from "./lib/study-time";
import { getSupabaseClient, isSupabaseConfigured } from "./lib/supabase";

type Scope = ContributionScope;
type View = "today" | "plan" | "subjects" | "schools" | "materials" | "agents";

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
};

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
  { key: "materials", label: "资料库", icon: "▱" },
  { key: "agents", label: "双 Agent", icon: "✦" },
];

const initialTasks: Task[] = [
  { id: "demo-math", title: "高等数学：极限与连续", detail: "复习讲义 1.3 · 完成 20 道基础题", subject: "math", done: false },
  { id: "demo-english", title: "英语：核心词汇复习", detail: "新词 50 个 · 复习 100 个", subject: "english", done: true },
  { id: "demo-cs408", title: "408：数据结构线性表", detail: "王道第 2 章 · 错题回顾", subject: "cs408", done: false },
  { id: "demo-career", title: "Agent 工作台开发", detail: "完成热力图与学习会话接口", subject: "career", done: false },
];

function taskFromApi(task: ApiTask): Task {
  return {
    id: task.id,
    title: task.title,
    detail: `计划 ${task.planned_minutes} 分钟${task.due_at ? ` · ${task.due_at.slice(0, 10)}` : ""}`,
    subject: task.subject,
    done: task.completed,
  };
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

function TodayView({ isDemo, displayName }: { isDemo: boolean; displayName: string }) {
  const [tasks, setTasks] = useState<Task[]>(() => isDemo ? initialTasks : []);
  const [newTask, setNewTask] = useState("");
  const [newTaskSubject, setNewTaskSubject] = useState<Subject>("math");
  const [focusSubject, setFocusSubject] = useState<Subject>("math");
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const [sessionStartedAt, setSessionStartedAt] = useState<Date | null>(null);
  const [pauseStartedAt, setPauseStartedAt] = useState<Date | null>(null);
  const [pausedSeconds, setPausedSeconds] = useState(0);
  const [todayMinutes, setTodayMinutes] = useState<number | null>(() => isDemo ? 260 : null);
  const [cloudState, setCloudState] = useState<"loading" | "ready" | "demo" | "error">(() => isDemo ? "demo" : "loading");
  const [recordStatus, setRecordStatus] = useState(isDemo ? "离线演示数据 · 登录并连接 Supabase 后自动同步" : "正在连接云端学习数据…");
  const [contributionRevision, setContributionRevision] = useState(0);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualBusy, setManualBusy] = useState(false);
  const [manualSubject, setManualSubject] = useState<Subject>("math");
  const [manualDate, setManualDate] = useState(() => shanghaiDateKey(new Date()));
  const [manualStartedTime, setManualStartedTime] = useState("19:00");
  const [manualEndedTime, setManualEndedTime] = useState("20:00");
  const [manualNote, setManualNote] = useState("");
  const [manualError, setManualError] = useState("");

  useEffect(() => {
    if (isDemo) return;
    let active = true;
    const today = shanghaiDateKey(new Date());
    Promise.all([api.today(), api.contributions(today, today, "all")])
      .then(([snapshot, contributions]) => {
        if (!active) return;
        setTasks(snapshot.tasks.map(taskFromApi));
        setTodayMinutes(contributions[0]?.effective_minutes ?? 0);
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

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  async function addTask(event: FormEvent) {
    event.preventDefault();
    if (!newTask.trim()) return;
    const title = newTask.trim();
    const temporaryId = `local-${Date.now()}`;
    setTasks((items) => [...items, { id: temporaryId, title, detail: "计划 30 分钟", subject: newTaskSubject, done: false }]);
    setNewTask("");
    if (isDemo) {
      setRecordStatus("演示任务仅保留在当前页面");
      return;
    }
    try {
      const saved = await api.createTask({ title, subject: newTaskSubject, planned_minutes: 30 });
      setTasks((items) => items.map((item) => item.id === temporaryId ? taskFromApi(saved) : item));
      setRecordStatus("任务已写入本地 API");
    } catch {
      setRecordStatus("API 暂不可用 · 新任务仅保留在本页");
    }
  }

  async function toggleTask(task: Task) {
    const completed = !task.done;
    setTasks((items) => items.map((item) => item.id === task.id ? { ...item, done: completed } : item));
    if (task.id.startsWith("demo-") || task.id.startsWith("local-")) return;
    try {
      await api.updateTask(task.id, { completed });
      setRecordStatus(completed ? "任务完成状态已同步" : "任务已恢复为待完成");
      setContributionRevision((value) => value + 1);
    } catch {
      setRecordStatus("同步失败 · 下次连接后请再次确认任务状态");
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

  function pauseFocus() {
    setRunning(false);
    setPauseStartedAt(new Date());
  }

  async function finishFocus() {
    if (!sessionStartedAt) return;
    const endedAt = new Date();
    const finalPausedSeconds = pausedSeconds + (pauseStartedAt ? Math.floor((endedAt.getTime() - pauseStartedAt.getTime()) / 1000) : 0);
    setRunning(false);
    if (isDemo) {
      setTodayMinutes((value) => (value ?? 0) + Math.floor(seconds / 60));
      setRecordStatus(`演示专注已记录在本页 · ${formatMinutes(Math.floor(seconds / 60))}`);
      setSessionStartedAt(null);
      setPauseStartedAt(null);
      setPausedSeconds(0);
      setSeconds(0);
      return;
    }
    try {
      await api.createSession({
        subject: focusSubject,
        started_at: sessionStartedAt.toISOString(),
        ended_at: endedAt.toISOString(),
        paused_seconds: finalPausedSeconds,
        source: "timer",
        note: "由今日工作台计时器记录",
      });
      setTodayMinutes((value) => (value ?? 0) + Math.floor(seconds / 60));
      setRecordStatus(`${subjectMeta[focusSubject].label}专注已记录 · ${formatMinutes(Math.floor(seconds / 60))}`);
      setContributionRevision((value) => value + 1);
      setSessionStartedAt(null);
      setPauseStartedAt(null);
      setPausedSeconds(0);
      setSeconds(0);
    } catch {
      setRecordStatus("本次专注未能同步，请保持页面并启动 API 后重试");
      setPausedSeconds(finalPausedSeconds);
      setPauseStartedAt(endedAt);
    }
  }

  async function addManualSession(event: FormEvent) {
    event.preventDefault();
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

    if (isDemo) {
      if (manualDate === shanghaiDateKey(new Date())) {
        setTodayMinutes((value) => (value ?? 0) + interval.effectiveMinutes);
      }
      setRecordStatus(`演示补录仅保留在本页 · ${formatMinutes(interval.effectiveMinutes)}`);
      setManualOpen(false);
      setManualNote("");
      return;
    }

    setManualBusy(true);
    try {
      await api.createSession({
        subject: manualSubject,
        started_at: interval.startedAt.toISOString(),
        ended_at: interval.endedAt.toISOString(),
        paused_seconds: 0,
        source: "manual",
        note: manualNote.trim() || "由今日工作台手动补录",
      });
      if (manualDate === shanghaiDateKey(new Date())) {
        setTodayMinutes((value) => (value ?? 0) + interval.effectiveMinutes);
      }
      setRecordStatus(`${manualDate} ${subjectMeta[manualSubject].label}已补录 · ${formatMinutes(interval.effectiveMinutes)}`);
      setContributionRevision((value) => value + 1);
      setManualOpen(false);
      setManualNote("");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "云端写入失败";
      setManualError(detail.includes("overlap") ? "该时间段与已有学习记录重叠，请调整后重试" : detail);
    } finally {
      setManualBusy(false);
    }
  }

  const completed = tasks.filter((task) => task.done).length;

  return (
    <>
      <div className="hero-row">
        <div>
          <div className="eyebrow">{shanghaiDisplayDate(new Date())} · 基础阶段</div>
          <h1>早上好，{displayName}</h1>
          <p>今天把注意力留给最重要的事。完成基础任务，就是向目标院校靠近一步。</p>
        </div>
        <button className="primary-button" onClick={beginFocus}>＋ 开始一次专注</button>
      </div>

      <div className="metric-grid">
        <article className="metric-card accent"><span>今日有效学习</span>{cloudState === "loading" ? <><strong className="metric-loading">加载中</strong><em>正在读取云端学习会话</em></> : cloudState === "error" ? <><strong>--</strong><em>云端数据暂时不可用</em></> : <><strong>{Math.floor((todayMinutes ?? 0) / 60)}<small>h</small> {(todayMinutes ?? 0) % 60}<small>m</small></strong><em>目标 6 小时 · {Math.min(100, Math.round((todayMinutes ?? 0) / 360 * 100))}%</em></>}</article>
        <article className="metric-card"><span>本周完成率</span><strong>68<small>%</small></strong><em>已完成 17 / 25 项</em></article>
        <article className="metric-card"><span>连续学习</span><strong>12<small>天</small></strong><em>最长记录 28 天</em></article>
        <article className="metric-card"><span>待复习错题</span><strong>16<small>道</small></strong><em>数学 7 · 408 9</em></article>
      </div>

      <StudyHeatmap isDemo={isDemo} refreshVersion={contributionRevision} />

      <div className="dashboard-grid">
        <section className="panel task-panel">
          <div className="panel-heading compact"><div><div className="eyebrow">今日清单</div><h2>{cloudState === "loading" ? "正在加载云端任务…" : `${completed} / ${tasks.length} 已完成`}</h2></div><span className="subtle-pill">考研 60% · 项目 40%</span></div>
          <div className="progress-track"><span style={{ width: `${tasks.length ? (completed / tasks.length) * 100 : 0}%` }} /></div>
          <div className="task-list">
            {cloudState === "loading" && <div className="task-loading cloud-loading-text">正在同步你的今日任务…</div>}
            {cloudState === "ready" && tasks.length === 0 && <div className="task-loading">今天还没有任务，可以从下方添加第一项。</div>}
            {tasks.map((task) => (
              <label className={`task-item ${task.done ? "done" : ""}`} key={task.id}>
                <input type="checkbox" checked={task.done} onChange={() => void toggleTask(task)} />
                <span className="fake-check">✓</span>
                <span className={`subject-badge ${task.subject}`}>{subjectMeta[task.subject].short}</span>
                <span className="task-copy"><strong>{task.title}</strong><small>{task.detail}</small></span>
              </label>
            ))}
          </div>
          <form className="quick-add" onSubmit={addTask}><select value={newTaskSubject} onChange={(event) => setNewTaskSubject(event.target.value as Subject)} aria-label="任务科目">{Object.entries(subjectMeta).map(([key, meta]) => <option key={key} value={key}>{meta.short}</option>)}</select><input value={newTask} onChange={(event) => setNewTask(event.target.value)} placeholder="快速添加一个任务…" aria-label="新任务" /><button type="submit">添加</button></form>
          <p className="record-status">● {recordStatus}</p>
        </section>

        <aside className="right-stack">
          <section className="panel focus-card">
            <div className="focus-top"><span className="focus-dot" /><span>{running ? `正在专注 · ${subjectMeta[focusSubject].label}` : "专注计时器"}</span></div>
            <strong className="timer">{formatTimer(seconds)}</strong>
            <select className="focus-select" value={focusSubject} onChange={(event) => setFocusSubject(event.target.value as Subject)} disabled={Boolean(sessionStartedAt)} aria-label="专注科目">{Object.entries(subjectMeta).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}</select>
            <div className="timer-actions"><button onClick={running ? pauseFocus : beginFocus}>{running ? "暂停" : sessionStartedAt ? "继续" : "开始"}</button><button className="secondary" onClick={() => void finishFocus()} disabled={!sessionStartedAt}>结束并记录</button></div>
          </section>
          <section className="panel manual-card">
            <div className="manual-heading"><div><div className="eyebrow">学习记录</div><strong>手动补录</strong></div><button type="button" onClick={() => { setManualOpen((value) => !value); setManualError(""); }}>{manualOpen ? "收起" : "＋ 补录"}</button></div>
            {manualOpen && <form className="manual-form" onSubmit={addManualSession}>
              <label className="manual-date">日期<input type="date" value={manualDate} max={shanghaiDateKey(new Date())} onChange={(event) => setManualDate(event.target.value)} required /></label>
              <label>科目<select value={manualSubject} onChange={(event) => setManualSubject(event.target.value as Subject)}>{Object.entries(subjectMeta).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}</select></label>
              <label>开始时间<input type="time" value={manualStartedTime} onChange={(event) => setManualStartedTime(event.target.value)} required /></label>
              <label>结束时间<input type="time" value={manualEndedTime} onChange={(event) => setManualEndedTime(event.target.value)} required /></label>
              <label className="manual-note">学习内容<input type="text" value={manualNote} onChange={(event) => setManualNote(event.target.value)} placeholder="例如：极限基础题复盘" maxLength={200} /></label>
              {manualError && <p className="manual-error" role="alert">{manualError}</p>}
              <div className="manual-actions"><button type="button" onClick={() => setManualOpen(false)} disabled={manualBusy}>取消</button><button type="submit" disabled={manualBusy}>{manualBusy ? "正在保存…" : "保存记录"}</button></div>
            </form>}
          </section>
          <section className="panel review-card">
            <div className="eyebrow">AI 学习教练</div>
            <p>你最近三天的 408 学习时间低于周计划 1.8 小时。建议今晚将“Agent 项目开发”缩短 30 分钟，补一次数据结构错题复习。</p>
            <div className="proposal-actions"><button>查看调整</button><button className="text-button">暂不处理</button></div>
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

function planDateRange(plan: ApiPlan) {
  return `${plan.starts_on.replaceAll("-", ".")} — ${plan.ends_on.replaceAll("-", ".")}`;
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

function PlanView({ isDemo }: { isDemo: boolean }) {
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
  const [editBusy, setEditBusy] = useState(false);
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
        if (active) setStatus(error instanceof Error ? `计划加载失败：${error.message}` : "计划加载失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [isDemo]);

  async function createStage(event: FormEvent) {
    event.preventDefault();
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
      setStatus(isDemo ? "演示阶段计划仅保留在当前页面" : "阶段计划已写入 Supabase 云端");
      setTitle("");
      setDescription("");
      setEndsOn("");
      setFormOpen(false);
    } catch (error) {
      setStatus(error instanceof Error ? `阶段计划保存失败：${error.message}` : "阶段计划保存失败");
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
      setStatus(isDemo ? "演示周计划仅保留在当前页面" : "周计划已写入 Supabase 云端");
      setWeekTitle("");
      setWeekDescription("");
      setWeekFormOpen(false);
    } catch (error) {
      setStatus(error instanceof Error ? `周计划保存失败：${error.message}` : "周计划保存失败");
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
      setStatus(isDemo ? "演示日计划仅保留在当前页面" : "日计划已写入 Supabase 云端");
      setDayTitle("");
      setDayDescription("");
      setDayFormOpen(false);
    } catch (error) {
      setStatus(error instanceof Error ? `日计划保存失败：${error.message}` : "日计划保存失败");
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
    setStatus(`正在编辑${planLevelLabel[plan.level]}计划“${plan.title}”`);
  }

  async function savePlanEdit(event: FormEvent) {
    event.preventDefault();
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
    };
    setEditBusy(true);
    try {
      const saved = isDemo
        ? { ...editingPlan, ...changes }
        : await api.updatePlan(editingPlan.id, changes);
      setPlans((items) => items
        .map((plan) => plan.id === saved.id ? saved : plan)
        .sort((left, right) => left.starts_on.localeCompare(right.starts_on)));
      setStatus(isDemo ? "演示计划修改仅保留在当前页面" : "计划修改已同步到 Supabase 云端");
      setEditingPlan(null);
    } catch (error) {
      setStatus(error instanceof Error ? `计划修改失败：${error.message}` : "计划修改失败");
    } finally {
      setEditBusy(false);
    }
  }

  async function removePlan(plan: ApiPlan) {
    const ids = planCascadeIds(plans, plan.id);
    const childCount = ids.size - 1;
    const suffix = childCount ? `，并同时删除 ${childCount} 条子计划` : "";
    if (!window.confirm(`确定删除“${plan.title}”${suffix}吗？此操作无法撤销。`)) return;
    try {
      if (!isDemo) await api.deletePlan(plan.id);
      setPlans((items) => items.filter((item) => !ids.has(item.id)));
      if (editingPlan?.id && ids.has(editingPlan.id)) setEditingPlan(null);
      setStatus(isDemo ? "演示计划已从当前页面移除" : "计划已从 Supabase 云端删除");
    } catch (error) {
      setStatus(error instanceof Error ? `计划删除失败：${error.message}` : "计划删除失败");
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
    {editingPlan && <form className="panel plan-form plan-edit-form" onSubmit={savePlanEdit}>
      <div className="plan-form-heading"><div className="eyebrow">编辑{planLevelLabel[editingPlan.level]}计划</div><h2>{editingPlan.title}</h2>{editParent && <small>所属{planLevelLabel[editParent.level]}计划：{editParent.title}（{editParent.starts_on} 至 {editParent.ends_on}）</small>}</div>
      <label className="plan-title">计划名称<input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} maxLength={160} required /></label>
      <label>{editingPlan.level === "day" ? "计划日期" : "开始日期"}<input type="date" value={editStartsOn} min={editParent?.starts_on} max={editParent?.ends_on} onChange={(event) => { setEditStartsOn(event.target.value); if (editingPlan.level === "day") setEditEndsOn(event.target.value); }} required /></label>
      {editingPlan.level !== "day" && <label>结束日期<input type="date" value={editEndsOn} min={editStartsOn || editParent?.starts_on} max={editParent?.ends_on} onChange={(event) => setEditEndsOn(event.target.value)} required /></label>}
      <label className="plan-description">计划目标<textarea value={editDescription} onChange={(event) => setEditDescription(event.target.value)} maxLength={2000} /></label>
      <div className="plan-form-actions"><button type="button" onClick={() => setEditingPlan(null)} disabled={editBusy}>取消</button><button className="primary-button" type="submit" disabled={editBusy}>{editBusy ? "正在保存…" : "保存修改"}</button></div>
    </form>}
    {loading ? <div className="panel plan-empty cloud-loading-text">正在加载你的阶段计划…</div> : stages.length === 0 ? <div className="panel plan-empty"><strong>还没有阶段计划</strong><span>点击“新建阶段计划”，先确定第一轮复习的时间范围与目标。</span></div> : <div className="stage-grid">{stages.map((stage, index) => <article className={`panel stage-card ${stage.status === "active" ? "current" : ""}`} key={stage.id}><div className="stage-index">{String(index + 1).padStart(2, "0")}</div><div><span>{planDateRange(stage)}</span><h2>{stage.title}</h2><p>{stage.description || "暂未填写阶段目标"}</p><small>{planStatusLabel[stage.status]} · {isDemo ? "演示数据" : "云端计划"}</small><div className="plan-item-actions"><button type="button" onClick={() => openPlanEditor(stage)}>编辑</button><button className="danger" type="button" onClick={() => void removePlan(stage)}>删除</button></div></div></article>)}</div>}
    <section className="panel weekly-plan"><div className="panel-heading"><div><div className="eyebrow">周计划</div><h2>{weeks.length ? `${weeks.length} 个周计划` : "尚未建立周计划"}</h2></div><div className="plan-heading-actions"><span className={`status-chip ${isDemo ? "" : "online"}`}>{isDemo ? "演示" : "云端"}</span><button className="outline-button" type="button" onClick={toggleWeekForm}>{weekFormOpen ? "收起" : "＋ 新建周计划"}</button></div></div>
      {weekFormOpen && <form className="plan-form week-plan-form" onSubmit={createWeek}>
        <label className="plan-title">所属阶段<select value={weekParentId} onChange={(event) => selectWeekParent(event.target.value)} required>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.title}（{stage.starts_on} 至 {stage.ends_on}）</option>)}</select></label>
        <label className="plan-title">周计划名称<input value={weekTitle} onChange={(event) => setWeekTitle(event.target.value)} placeholder="例如：基础阶段第 1 周" maxLength={160} required /></label>
        <label>开始日期<input type="date" value={weekStartsOn} min={weekParent?.starts_on} max={weekParent?.ends_on} onChange={(event) => { const nextStart = event.target.value; setWeekStartsOn(nextStart); if (weekParent) setWeekEndsOn(suggestedWeekEnd(nextStart, weekParent.ends_on)); }} required /></label>
        <label>结束日期<input type="date" value={weekEndsOn} min={weekStartsOn || weekParent?.starts_on} max={weekParent?.ends_on} onChange={(event) => setWeekEndsOn(event.target.value)} required /></label>
        <label className="plan-description">本周重点<textarea value={weekDescription} onChange={(event) => setWeekDescription(event.target.value)} placeholder="这一周最重要的学习结果是什么？" maxLength={2000} /></label>
        <div className="plan-form-actions"><button type="button" onClick={() => setWeekFormOpen(false)} disabled={weekBusy}>取消</button><button className="primary-button" type="submit" disabled={weekBusy}>{weekBusy ? "正在保存…" : "保存周计划"}</button></div>
      </form>}
      {weeks.length ? <div className="plan-list">{weeks.map((week) => <div className="plan-row" key={week.id}><div><strong>{week.title}</strong><small>{week.description || "暂未填写本周重点"}</small></div><span>{planDateRange(week)}</span><em>{planStatusLabel[week.status]}</em><div className="plan-item-actions"><button type="button" onClick={() => openPlanEditor(week)}>编辑</button><button className="danger" type="button" onClick={() => void removePlan(week)}>删除</button></div></div>)}</div> : <div className="plan-empty compact"><span>创建阶段计划后，下一步可以把它拆成可执行的周计划。</span></div>}
    </section>
    <section className="panel daily-plan"><div className="panel-heading"><div><div className="eyebrow">日计划</div><h2>{days.length ? `${days.length} 个日计划` : "尚未安排日计划"}</h2></div><div className="plan-heading-actions"><span className={`status-chip ${isDemo ? "" : "online"}`}>{isDemo ? "演示" : "云端"}</span><button className="outline-button" type="button" onClick={toggleDayForm}>{dayFormOpen ? "收起" : "＋ 新建日计划"}</button></div></div>
      {dayFormOpen && <form className="plan-form week-plan-form" onSubmit={createDay}>
        <label className="plan-title">所属周计划<select value={dayParentId} onChange={(event) => selectDayParent(event.target.value)} required>{weeks.map((week) => <option key={week.id} value={week.id}>{week.title}（{week.starts_on} 至 {week.ends_on}）</option>)}</select></label>
        <label className="plan-title">日计划名称<input value={dayTitle} onChange={(event) => setDayTitle(event.target.value)} placeholder="例如：高数极限专题与英语词汇" maxLength={160} required /></label>
        <label>计划日期<input type="date" value={dayDate} min={dayParent?.starts_on} max={dayParent?.ends_on} onChange={(event) => setDayDate(event.target.value)} required /></label>
        <label className="plan-description">当天成果<textarea value={dayDescription} onChange={(event) => setDayDescription(event.target.value)} placeholder="完成哪些章节、题目或复盘？" maxLength={2000} /></label>
        <div className="plan-form-actions"><button type="button" onClick={() => setDayFormOpen(false)} disabled={dayBusy}>取消</button><button className="primary-button" type="submit" disabled={dayBusy}>{dayBusy ? "正在保存…" : "保存日计划"}</button></div>
      </form>}
      {days.length ? <div className="plan-list">{days.map((day) => <div className="plan-row" key={day.id}><div><strong>{day.title}</strong><small>{day.description || "暂未填写当天成果"}</small></div><span>{day.starts_on.replaceAll("-", ".")}</span><em>{planStatusLabel[day.status]}</em><div className="plan-item-actions"><button type="button" onClick={() => openPlanEditor(day)}>编辑</button><button className="danger" type="button" onClick={() => void removePlan(day)}>删除</button></div></div>)}</div> : <div className="plan-empty compact"><span>创建周计划后，可以继续把目标拆成每天可完成、可复盘的行动。</span></div>}
    </section>
  </section>;
}

function SubjectsView() {
  const cards = [
    ["数学一", "极限与连续", "18 / 84 节", 21, "本周 8h 20m"],
    ["英语一", "核心词汇与长难句", "1,260 / 5,500 词", 23, "本周 5h 10m"],
    ["计算机 408", "数据结构 · 线性表", "12 / 96 节", 13, "本周 6h 45m"],
    ["政治", "计划 2027 暑期启动", "暂未开始", 0, "保持资料关注"],
  ];
  return <section className="content-view"><div className="view-title"><div><div className="eyebrow">知识结构与掌握程度</div><h1>学科学习</h1><p>用章节、题目和错题复习衡量真实进度。</p></div><button className="primary-button">＋ 添加学习资源</button></div><div className="subject-card-grid">{cards.map(([title, chapter, count, progress, time], index) => <article className="panel subject-card" key={String(title)}><div className={`subject-icon s${index}`}>{index === 2 ? "408" : String(title).slice(0,1)}</div><span>{time}</span><h2>{title}</h2><p>{chapter}</p><div className="progress-track"><span style={{ width: `${progress}%` }} /></div><div className="subject-bottom"><strong>{count}</strong><small>{progress}%</small></div></article>)}</div><section className="panel knowledge-panel"><div className="panel-heading"><div><div className="eyebrow">最近薄弱点</div><h2>需要再次理解的知识</h2></div><button className="outline-button">进入错题本</button></div><div className="knowledge-table"><div><strong>函数极限的等价无穷小替换</strong><span>数学一 · 错误 3 次</span><em>明天复习</em></div><div><strong>二叉树的非递归遍历</strong><span>数据结构 · 错误 2 次</span><em>今天复习</em></div><div><strong>长难句中的同位语从句</strong><span>英语一 · 掌握度 45%</span><em>后天复习</em></div></div></section></section>;
}

function SchoolsView() {
  const schools = [
    { tier: "冲", name: "中国科学技术大学", major: "软件学院 · 085405 软件工程", exams: "英二 · 数二 · 408", city: "合肥 / 苏州", year: "2026 基线" },
    { tier: "稳", name: "苏州大学", major: "计算机学院 · 085405 软件工程", exams: "英二 · 数二 · 408", city: "苏州", year: "2026 基线" },
    { tier: "稳", name: "南京理工大学", major: "计算机学院 · 085405 软件工程", exams: "英二 · 数二 · 408", city: "南京", year: "2026 基线" },
    { tier: "保", name: "待调研院校", major: "长三角就业导向专硕", exams: "优先 408", city: "沪苏浙皖", year: "等待补充" },
  ];
  return <section className="content-view"><div className="view-title"><div><div className="eyebrow">精确到学院与专业代码</div><h1>院校情报</h1><p>招生信息会变化，所有结论都保留年份与官方来源。</p></div><button className="primary-button">＋ 添加院校</button></div><div className="school-list">{schools.map((school) => <article className="panel school-card" key={school.name + school.tier}><div className={`tier tier-${school.tier}`}>{school.tier}</div><div className="school-main"><span>{school.year}</span><h2>{school.name}</h2><p>{school.major}</p></div><div className="school-meta"><span>初试科目</span><strong>{school.exams}</strong></div><div className="school-meta"><span>培养地点</span><strong>{school.city}</strong></div><button className="more-button">查看档案 →</button></article>)}</div></section>;
}

function MaterialsView({ isDemo }: { isDemo: boolean }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [docs, setDocs] = useState([
    { name: "王道数据结构 2027.pdf", type: "PDF · 486 页", status: "演示索引", tag: "408" },
    { name: "高数基础讲义.md", type: "Markdown · 38 KB", status: "演示索引", tag: "数学" },
    { name: "苏州大学 2026 招生目录", type: "网页 · 官方来源", status: "等待年度复核", tag: "院校" },
  ]);
  const [sourceUrl, setSourceUrl] = useState("");
  const [importStatus, setImportStatus] = useState("选择本地资料，或提交一个公开网页链接进行预览");
  const [busy, setBusy] = useState(false);

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
      setDocs((items) => [{ name: result.original_filename, type: `${file.type || "资料"} · ${Math.ceil(result.byte_size / 1024)} KB`, status, tag: "新导入" }, ...items]);
      setImportStatus(result.duplicate ? "检测到相同文件，已复用原索引" : `导入完成 · ${result.flagged_chunk_count} 个片段需要安全复核`);
    } catch (error) {
      setImportStatus(error instanceof Error ? `导入失败：${error.message}` : "导入失败");
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
      setSourceUrl("");
    } catch (error) {
      setImportStatus(error instanceof Error ? `链接预览失败：${error.message}` : "链接预览失败");
    } finally {
      setBusy(false);
    }
  }

  return <section className="content-view"><div className="view-title"><div><div className="eyebrow">个人资料 RAG</div><h1>资料库</h1><p>上传资料、保存可信网页，在回答中回到原文页码与链接。</p></div><button className="primary-button" onClick={() => fileInput.current?.click()}>＋ 导入资料</button></div><div className="material-layout"><section className="panel upload-zone"><input ref={fileInput} className="visually-hidden" type="file" accept=".pdf,.md,.markdown,application/pdf,text/markdown" onChange={(event) => void upload(event)} /><div className="upload-icon">⇧</div><h2>导入 PDF 或 Markdown</h2><p>文本 PDF 直接保留页码切分；扫描版自动标记为待 OCR。文件上限 25 MB。</p><button className="outline-button" disabled={busy} onClick={() => fileInput.current?.click()}>{busy ? "处理中…" : "选择文件"}</button><form className="url-import" onSubmit={previewUrl}><input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="粘贴公开网页或 PDF 链接" aria-label="资料链接" /><button type="submit" disabled={busy}>生成预览</button></form><small className="import-status">{importStatus}</small></section><section className="panel material-list"><div className="panel-heading compact"><div><div className="eyebrow">资料记录</div><h2>{docs.length} 份资料</h2></div><span className="subtle-pill">{isDemo ? "演示资料" : "混合检索准备中"}</span></div>{docs.map((doc) => <div className="document-row" key={`${doc.name}-${doc.status}`}><span className="document-icon">▤</span><div><strong>{doc.name}</strong><small>{doc.type}</small></div><em>{doc.tag}</em><span className="document-status">● {doc.status}</span></div>)}</section></div></section>;
}

function AgentsView({ isDemo }: { isDemo: boolean }) {
  const [mode, setMode] = useState<"coach" | "tutor" | "combined">("combined");
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<Array<{ role: "agent" | "user"; text: string }>>([{ role: "agent", text: "我可以结合你的学习记录与资料库，为你调整计划、解释知识点，或联网核对最新院校信息。任何写入操作都会先让你确认。" }]);
  const [proposal, setProposal] = useState<ActionProposal | null>(null);
  const [threadId, setThreadId] = useState<string>();
  const [busy, setBusy] = useState(false);

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
    setBusy(true);
    try {
      const result = await api.runAgent(mode, text, threadId);
      setThreadId(result.thread_id);
      setProposal(result.proposal);
      setMessages((items) => [...items, { role: "agent", text: `${result.answer}\n\n路由：${result.route} · 检索：${result.retrieval_mode}` }]);
    } catch {
      const fallback = mode === "coach"
        ? "计划教练已完成本地分析，但 Agent API 尚未启动。启动后端后，我会把建议转换成可审批提案。"
        : mode === "tutor"
          ? "资料导师当前无法连接检索服务。为避免无依据回答，我暂不补全事实。"
          : "双 Agent API 尚未连接；当前消息没有写入任何学习数据。";
      setMessages((items) => [...items, { role: "agent", text: fallback }]);
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: "approve" | "edit" | "reject") {
    if (!proposal) return;
    setBusy(true);
    try {
      const updated = await api.decideProposal(proposal.id, decision);
      setProposal(updated);
      const resultText = updated.status === "applied" ? "提案已批准并幂等写入任务清单。" : updated.status === "rejected" ? "提案已拒绝，没有修改学习数据。" : "提案已进入编辑状态。";
      setMessages((items) => [...items, { role: "agent", text: resultText }]);
    } catch {
      setMessages((items) => [...items, { role: "agent", text: "提案处理失败，没有执行写入。" }]);
    } finally {
      setBusy(false);
    }
  }

  return <section className="content-view agent-view"><div className="view-title"><div><div className="eyebrow">LangChain × LangGraph</div><h1>双 Agent 学习助手</h1><p>计划教练负责执行闭环，资料导师负责带引用的检索与答疑。</p></div><span className={`status-chip ${busy ? "" : "online"}`}>● {busy ? "分析中" : "等待请求"}</span></div><div className="agent-shell panel"><div className="agent-tabs">{[["coach","计划教练"],["tutor","资料导师"],["combined","联合模式"]].map(([key, label]) => <button key={key} className={mode === key ? "active" : ""} onClick={() => setMode(key as typeof mode)}>{label}</button>)}</div><div className="message-list">{messages.map((message, index) => <div className={`message ${message.role}`} key={index}><span>{message.role === "agent" ? "✦" : "你"}</span><p>{message.text}</p></div>)}</div>{proposal && <div className={`agent-proposal proposal-${proposal.status}`}><div><strong>{proposal.status === "pending" ? "待确认提案" : `提案状态：${proposal.status}`}</strong><p>{proposal.summary}</p></div>{proposal.status === "pending" && <div><button className="approve" disabled={busy} onClick={() => void decide("approve")}>批准写入</button><button className="outline-button" disabled={busy} onClick={() => void decide("edit")}>编辑</button><button className="text-button" disabled={busy} onClick={() => void decide("reject")}>拒绝</button></div>}</div>}<form className="agent-input" onSubmit={submit}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="询问计划、资料或最新院校信息…" /><button type="submit" disabled={busy}>{busy ? "分析中…" : "发送 ↑"}</button></form></div></section>;
}

function AuthScreen({ initialStatus = "" }: { initialStatus?: string }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const client = getSupabaseClient();
    if (!client || busy) return;
    setBusy(true);
    setStatus("");
    try {
      const result = mode === "login"
        ? await client.auth.signInWithPassword({ email: email.trim(), password })
        : await client.auth.signUp({ email: email.trim(), password });
      if (result.error) {
        setStatus(result.error.message);
      } else if (mode === "register" && !result.data.session) {
        setStatus("注册成功，请前往邮箱完成验证后登录。");
        setMode("login");
      } else {
        setStatus("登录成功，正在加载你的学习数据…");
      }
    } catch {
      setStatus("暂时无法连接登录服务，请检查网络后重试。");
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
          <h2>{mode === "login" ? "欢迎回来" : "创建学习账户"}</h2>
          <p>{mode === "login" ? "登录后继续今天的学习闭环。" : "第一版使用邮箱和密码注册。"}</p>
          <form onSubmit={submit}>
            <label>邮箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="name@example.com" required /></label>
            <label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={6} placeholder="至少 6 位" required /></label>
            <button className="primary-button auth-submit" type="submit" disabled={busy}>{busy ? "请稍候…" : mode === "login" ? "登录工作台" : "注册账户"}</button>
          </form>
          {status && <div className="auth-status" role="status">{status}</div>}
          <button className="auth-switch" onClick={() => { setMode(mode === "login" ? "register" : "login"); setStatus(""); }}>{mode === "login" ? "还没有账户？立即注册" : "已有账户？返回登录"}</button>
        </div>
      </section>
    </main>
  );
}

function Workbench({ user, isDemo, onSignOut }: { user: User | null; isDemo: boolean; onSignOut: () => Promise<void> }) {
  const [view, setView] = useState<View>("today");
  const [apiStatus, setApiStatus] = useState<"checking" | "cloud" | "demo" | "offline">("checking");
  const displayName = user?.email?.split("@")[0] || "林宇超";
  const avatar = displayName.slice(0, 2).toUpperCase();
  const content = { today: <TodayView key={isDemo ? "demo" : "cloud"} isDemo={isDemo} displayName={displayName} />, plan: <PlanView isDemo={isDemo} />, subjects: <SubjectsView />, schools: <SchoolsView />, materials: <MaterialsView isDemo={isDemo} />, agents: <AgentsView isDemo={isDemo} /> }[view];

  useEffect(() => {
    let active = true;
    const check = () => api.health()
      .then((health) => { if (active) setApiStatus(health.mode === "supabase" ? "cloud" : "demo"); })
      .catch(() => { if (active) setApiStatus("offline"); });
    void check();
    const timer = window.setInterval(check, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">研</span><div><strong>研途</strong><small>Agent Workbench</small></div></div>
        <nav>{navItems.map((item) => <button key={item.key} className={view === item.key ? "active" : ""} onClick={() => setView(item.key)}><span>{item.icon}</span>{item.label}</button>)}</nav>
        <div className="sidebar-goal"><span>2028 考研目标</span><strong>长三角 · 软件工程专硕</strong><div className="progress-track"><span style={{ width: "18%" }} /></div><small>基础阶段 · 第 3 周</small></div>
        <div className="profile"><span>{avatar}</span><div><strong>{displayName}</strong><small>{isDemo ? "离线演示账户" : user?.email}</small></div>{isDemo ? <button aria-label="演示模式说明">•••</button> : <button aria-label="退出登录" title="退出登录" onClick={() => void onSignOut()}>退出</button>}</div>
      </aside>
      <section className="main-content">
        <header className="topbar"><div className="mobile-brand"><span className="brand-mark">研</span><strong>研途</strong></div><div className={`sync-status ${isDemo ? "offline" : apiStatus}`}><i /> {isDemo ? "离线演示模式" : apiStatus === "cloud" ? "Supabase 云端同步已连接" : apiStatus === "demo" ? "已登录 · 后端仍为临时仓库" : apiStatus === "offline" ? "数据服务未连接" : "正在检查数据服务"}</div><div className="top-actions"><button aria-label="搜索">⌕</button><button aria-label="通知">○</button><button className="quick-capture">＋ 快速记录</button></div></header>
        <div className="content-wrap">{content}</div>
        <nav className="mobile-nav">{navItems.slice(0, 5).map((item) => <button key={item.key} className={view === item.key ? "active" : ""} onClick={() => setView(item.key)}><span>{item.icon}</span><small>{item.label.slice(0,2)}</small></button>)}</nav>
      </section>
    </main>
  );
}

export default function Home() {
  const [authState, setAuthState] = useState<{ status: "loading" | "demo" | "signed_out" | "signed_in"; user: User | null }>(() => ({
    status: isSupabaseConfigured ? "loading" : "demo",
    user: null,
  }));
  const [authNotice, setAuthNotice] = useState("");

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
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
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
  }

  if (authState.status === "loading") return <main className="auth-loading"><span className="brand-mark">研</span><p>正在恢复登录状态…</p></main>;
  if (authState.status === "signed_out") return <AuthScreen initialStatus={authNotice} />;
  return <Workbench user={authState.user} isDemo={authState.status === "demo"} onSignOut={signOut} />;
}
