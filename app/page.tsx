"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { api, type ActionProposal, type ApiTask, type ContributionScope, type Subject } from "./lib/api";

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

function StudyHeatmap() {
  const currentYear = Number(shanghaiDateKey(new Date()).slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const [scope, setScope] = useState<Scope>("all");
  const demoData = useMemo(() => buildYearData(year), [year]);
  const [remoteData, setRemoteData] = useState<StudyDay[] | null>(null);
  const [dataSource, setDataSource] = useState<"api" | "demo">("demo");
  const data = remoteData ?? demoData;
  const [selectedDate, setSelectedDate] = useState(shanghaiDateKey(new Date()));
  const selectedDay = data.find((day) => day.date === selectedDate) ?? data[data.length - 1];

  useEffect(() => {
    let cancelled = false;
    api.contributions(`${year}-01-01`, `${year}-12-31`, scope)
      .then((days) => {
        if (cancelled) return;
        setRemoteData(days.map((day) => ({
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
        })));
        setDataSource("api");
      })
      .catch(() => {
        if (!cancelled) setDataSource("demo");
      });
    return () => { cancelled = true; };
  }, [scope, year]);

  const padded = useMemo(() => {
    const first = new Date(`${year}-01-01T00:00:00Z`);
    const mondayOffset = (first.getUTCDay() + 6) % 7;
    return [...Array<StudyDay | null>(mondayOffset).fill(null), ...data];
  }, [data, year]);
  const weeks = Array.from({ length: Math.ceil(padded.length / 7) }, (_, index) => padded.slice(index * 7, index * 7 + 7));
  const totalMinutes = data.reduce((sum, day) => sum + getMinutes(day, scope), 0);
  const activeDays = data.filter((day) => getMinutes(day, scope) > 0).length;

  return (
    <section className="panel heatmap-panel">
      <div className="panel-heading heatmap-heading">
        <div>
          <div className="eyebrow">学习轨迹</div>
          <h2>{year} 年有效学习 {Math.round(totalMinutes / 60)} 小时</h2>
          <p>{activeDays} 个学习日 · {dataSource === "api" ? "来自真实学习会话" : "后端未连接，显示演示数据"}</p>
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
          <div className="heatmap-grid" role="grid" aria-label={`${year} 学习贡献热力图`}>
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
          <strong>{selectedDay.date}</strong>
          <span>{formatMinutes(getMinutes(selectedDay, scope))}</span>
          <span>{selectedDay.sessions} 次专注</span>
          <span>{selectedDay.tasks} 项完成</span>
          <span>{selectedDay.mistakes} 道错题</span>
        </div>
        <div className="legend"><span>少</span>{[0, 1, 2, 3, 4].map((level) => <i className={`level-${level}`} key={level} />)}<span>多</span></div>
      </div>
    </section>
  );
}

function TodayView() {
  const [tasks, setTasks] = useState(initialTasks);
  const [newTask, setNewTask] = useState("");
  const [newTaskSubject, setNewTaskSubject] = useState<Subject>("math");
  const [focusSubject, setFocusSubject] = useState<Subject>("math");
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const [sessionStartedAt, setSessionStartedAt] = useState<Date | null>(null);
  const [pauseStartedAt, setPauseStartedAt] = useState<Date | null>(null);
  const [pausedSeconds, setPausedSeconds] = useState(0);
  const [todayMinutes, setTodayMinutes] = useState(260);
  const [recordStatus, setRecordStatus] = useState("演示数据 · 启动 API 后自动同步");

  useEffect(() => {
    const today = shanghaiDateKey(new Date());
    Promise.all([api.today(), api.contributions(today, today, "all")])
      .then(([snapshot, contributions]) => {
        setTasks(snapshot.tasks.map(taskFromApi));
        setTodayMinutes(contributions[0]?.effective_minutes ?? 0);
        setRecordStatus("已连接本地 API · 数据来自学习会话");
      })
      .catch(() => setRecordStatus("后端未连接 · 当前操作保留在本页"));
  }, []);

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
    try {
      await api.createSession({
        subject: focusSubject,
        started_at: sessionStartedAt.toISOString(),
        ended_at: endedAt.toISOString(),
        paused_seconds: finalPausedSeconds,
        source: "timer",
        note: "由今日工作台计时器记录",
      });
      setTodayMinutes((value) => value + Math.floor(seconds / 60));
      setRecordStatus(`${subjectMeta[focusSubject].label}专注已记录 · ${formatMinutes(Math.floor(seconds / 60))}`);
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

  const completed = tasks.filter((task) => task.done).length;

  return (
    <>
      <div className="hero-row">
        <div>
          <div className="eyebrow">{shanghaiDisplayDate(new Date())} · 基础阶段</div>
          <h1>早上好，林宇超</h1>
          <p>今天把注意力留给最重要的事。完成基础任务，就是向目标院校靠近一步。</p>
        </div>
        <button className="primary-button" onClick={beginFocus}>＋ 开始一次专注</button>
      </div>

      <div className="metric-grid">
        <article className="metric-card accent"><span>今日有效学习</span><strong>{Math.floor(todayMinutes / 60)}<small>h</small> {todayMinutes % 60}<small>m</small></strong><em>目标 6 小时 · {Math.min(100, Math.round(todayMinutes / 360 * 100))}%</em></article>
        <article className="metric-card"><span>本周完成率</span><strong>68<small>%</small></strong><em>已完成 17 / 25 项</em></article>
        <article className="metric-card"><span>连续学习</span><strong>12<small>天</small></strong><em>最长记录 28 天</em></article>
        <article className="metric-card"><span>待复习错题</span><strong>16<small>道</small></strong><em>数学 7 · 408 9</em></article>
      </div>

      <StudyHeatmap />

      <div className="dashboard-grid">
        <section className="panel task-panel">
          <div className="panel-heading compact"><div><div className="eyebrow">今日清单</div><h2>{completed} / {tasks.length} 已完成</h2></div><span className="subtle-pill">考研 60% · 项目 40%</span></div>
          <div className="progress-track"><span style={{ width: `${tasks.length ? (completed / tasks.length) * 100 : 0}%` }} /></div>
          <div className="task-list">
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

function PlanView() {
  const stages = [
    { title: "基础阶段", range: "2026.09 — 2027.02", progress: 18, note: "数英 408 完成第一轮基础" },
    { title: "强化阶段", range: "2027.03 — 2027.06", progress: 0, note: "专题强化与院校池收缩" },
    { title: "真题阶段", range: "2027.07 — 2027.10", progress: 0, note: "真题、政治与复试能力预备" },
    { title: "冲刺阶段", range: "2027.11 — 2027.12", progress: 0, note: "模考、查漏补缺与状态管理" },
  ];
  return <section className="content-view"><div className="view-title"><div><div className="eyebrow">从目标倒推行动</div><h1>三级计划</h1><p>阶段、周、日三层联动，计划变化由你最终确认。</p></div><button className="primary-button">＋ 新建阶段计划</button></div><div className="stage-grid">{stages.map((stage, index) => <article className={`panel stage-card ${index === 0 ? "current" : ""}`} key={stage.title}><div className="stage-index">0{index + 1}</div><div><span>{stage.range}</span><h2>{stage.title}</h2><p>{stage.note}</p><div className="progress-track"><span style={{ width: `${stage.progress}%` }} /></div><small>{stage.progress}% 完成</small></div></article>)}</div><section className="panel weekly-plan"><div className="panel-heading"><div><div className="eyebrow">本周重点</div><h2>8月10日 — 8月16日</h2></div><span className="status-chip">执行中</span></div><div className="allocation-list">{[["数学一","12h",72],["英语一","7h",58],["计算机 408","10h",61],["AI 项目","8h",44]].map(([name, time, value]) => <div className="allocation" key={String(name)}><span>{name}</span><div className="progress-track"><span style={{ width: `${value}%` }} /></div><strong>{time}</strong></div>)}</div></section></section>;
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

function MaterialsView() {
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

  return <section className="content-view"><div className="view-title"><div><div className="eyebrow">个人资料 RAG</div><h1>资料库</h1><p>上传资料、保存可信网页，在回答中回到原文页码与链接。</p></div><button className="primary-button" onClick={() => fileInput.current?.click()}>＋ 导入资料</button></div><div className="material-layout"><section className="panel upload-zone"><input ref={fileInput} className="visually-hidden" type="file" accept=".pdf,.md,.markdown,application/pdf,text/markdown" onChange={(event) => void upload(event)} /><div className="upload-icon">⇧</div><h2>导入 PDF 或 Markdown</h2><p>文本 PDF 直接保留页码切分；扫描版自动标记为待 OCR。文件上限 25 MB。</p><button className="outline-button" disabled={busy} onClick={() => fileInput.current?.click()}>{busy ? "处理中…" : "选择文件"}</button><form className="url-import" onSubmit={previewUrl}><input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="粘贴公开网页或 PDF 链接" aria-label="资料链接" /><button type="submit" disabled={busy}>生成预览</button></form><small className="import-status">{importStatus}</small></section><section className="panel material-list"><div className="panel-heading compact"><div><div className="eyebrow">资料记录</div><h2>{docs.length} 份资料</h2></div><span className="subtle-pill">混合检索已开启</span></div>{docs.map((doc) => <div className="document-row" key={`${doc.name}-${doc.status}`}><span className="document-icon">▤</span><div><strong>{doc.name}</strong><small>{doc.type}</small></div><em>{doc.tag}</em><span className="document-status">● {doc.status}</span></div>)}</section></div></section>;
}

function AgentsView() {
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

export default function Home() {
  const [view, setView] = useState<View>("today");
  const [apiStatus, setApiStatus] = useState<"checking" | "online" | "offline">("checking");
  const content = { today: <TodayView key={apiStatus} />, plan: <PlanView />, subjects: <SubjectsView />, schools: <SchoolsView />, materials: <MaterialsView />, agents: <AgentsView /> }[view];

  useEffect(() => {
    let active = true;
    const check = () => api.health()
      .then(() => { if (active) setApiStatus("online"); })
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
        <div className="profile"><span>LY</span><div><strong>林宇超</strong><small>苏大应院 · 软件工程</small></div><button aria-label="打开设置">•••</button></div>
      </aside>
      <section className="main-content">
        <header className="topbar"><div className="mobile-brand"><span className="brand-mark">研</span><strong>研途</strong></div><div className={`sync-status ${apiStatus}`}><i /> {apiStatus === "online" ? "本地 API 已连接" : apiStatus === "offline" ? "离线演示模式" : "正在检查数据服务"}</div><div className="top-actions"><button aria-label="搜索">⌕</button><button aria-label="通知">○</button><button className="quick-capture">＋ 快速记录</button></div></header>
        <div className="content-wrap">{content}</div>
        <nav className="mobile-nav">{navItems.slice(0, 5).map((item) => <button key={item.key} className={view === item.key ? "active" : ""} onClick={() => setView(item.key)}><span>{item.icon}</span><small>{item.label.slice(0,2)}</small></button>)}</nav>
      </section>
    </main>
  );
}
