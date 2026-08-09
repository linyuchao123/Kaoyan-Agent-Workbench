"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Scope = "all" | "math" | "english" | "politics" | "cs408" | "career";
type View = "today" | "plan" | "subjects" | "schools" | "materials" | "agents";

type StudyDay = {
  date: string;
  minutes: Record<Exclude<Scope, "all">, number>;
  sessions: number;
  tasks: number;
  mistakes: number;
};

type Task = {
  id: number;
  title: string;
  detail: string;
  subject: Exclude<Scope, "all">;
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
  { id: 1, title: "高等数学：极限与连续", detail: "复习讲义 1.3 · 完成 20 道基础题", subject: "math", done: false },
  { id: 2, title: "英语：核心词汇复习", detail: "新词 50 个 · 复习 100 个", subject: "english", done: true },
  { id: 3, title: "408：数据结构线性表", detail: "王道第 2 章 · 错题回顾", subject: "cs408", done: false },
  { id: 4, title: "Agent 工作台开发", detail: "完成热力图与学习会话接口", subject: "career", done: false },
];

function seededValue(seed: number) {
  const x = Math.sin(seed * 9283.17) * 43758.5453;
  return x - Math.floor(x);
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function buildYearData(year: number): StudyDay[] {
  const today = new Date("2026-08-10T12:00:00+08:00");
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year, 11, 31));
  const result: StudyDay[] = [];
  const cursor = new Date(start);
  let index = 0;

  while (cursor <= end) {
    const isFuture = cursor > today;
    const active = !isFuture && seededValue(index + year * 7) > (year === 2026 ? 0.36 : 0.28);
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
  const [year, setYear] = useState(2026);
  const [scope, setScope] = useState<Scope>("all");
  const data = useMemo(() => buildYearData(year), [year]);
  const [selectedDate, setSelectedDate] = useState("2026-08-10");
  const selectedDay = data.find((day) => day.date === selectedDate) ?? data[data.length - 1];

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
          <p>{activeDays} 个学习日 · 当前连续 12 天 · 最长连续 28 天</p>
        </div>
        <div className="year-switch" aria-label="选择年份">
          {[2026, 2025].map((item) => (
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
  const [seconds, setSeconds] = useState(42 * 60 + 18);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  function addTask(event: FormEvent) {
    event.preventDefault();
    if (!newTask.trim()) return;
    setTasks((items) => [...items, { id: Date.now(), title: newTask.trim(), detail: "今日临时任务", subject: "math", done: false }]);
    setNewTask("");
  }

  const completed = tasks.filter((task) => task.done).length;

  return (
    <>
      <div className="hero-row">
        <div>
          <div className="eyebrow">2026年8月10日 · 距离初试还有 502 天</div>
          <h1>早上好，林宇超</h1>
          <p>今天把注意力留给最重要的事。完成基础任务，就是向目标院校靠近一步。</p>
        </div>
        <button className="primary-button" onClick={() => setRunning(true)}>＋ 开始一次专注</button>
      </div>

      <div className="metric-grid">
        <article className="metric-card accent"><span>今日有效学习</span><strong>4<small>h</small> 20<small>m</small></strong><em>目标 6 小时 · 72%</em></article>
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
                <input type="checkbox" checked={task.done} onChange={() => setTasks((items) => items.map((item) => item.id === task.id ? { ...item, done: !item.done } : item))} />
                <span className="fake-check">✓</span>
                <span className={`subject-badge ${task.subject}`}>{subjectMeta[task.subject].short}</span>
                <span className="task-copy"><strong>{task.title}</strong><small>{task.detail}</small></span>
              </label>
            ))}
          </div>
          <form className="quick-add" onSubmit={addTask}><input value={newTask} onChange={(event) => setNewTask(event.target.value)} placeholder="快速添加一个任务…" aria-label="新任务" /><button type="submit">添加</button></form>
        </section>

        <aside className="right-stack">
          <section className="panel focus-card">
            <div className="focus-top"><span className="focus-dot" /><span>{running ? "正在专注 · 数学一" : "专注计时器"}</span></div>
            <strong className="timer">{formatTimer(seconds)}</strong>
            <p>高等数学 · 极限与连续</p>
            <div className="timer-actions"><button onClick={() => setRunning((value) => !value)}>{running ? "暂停" : "继续"}</button><button className="secondary" onClick={() => { setRunning(false); setSeconds(0); }}>结束并记录</button></div>
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
  const docs = [["王道数据结构 2027.pdf","PDF · 486 页","已完成索引","408"],["高数基础讲义.md","Markdown · 38 KB","已完成索引","数学"],["苏州大学 2026 招生目录","网页 · 官方来源","等待年度复核","院校"]];
  return <section className="content-view"><div className="view-title"><div><div className="eyebrow">个人资料 RAG</div><h1>资料库</h1><p>上传资料、保存可信网页，在回答中回到原文页码与链接。</p></div><button className="primary-button">＋ 导入资料</button></div><div className="material-layout"><section className="panel upload-zone"><div className="upload-icon">⇧</div><h2>拖入 PDF 或 Markdown</h2><p>扫描版 PDF 将自动进入 OCR；网页资料需预览确认后入库。</p><button className="outline-button">选择文件</button></section><section className="panel material-list"><div className="panel-heading compact"><div><div className="eyebrow">已入库</div><h2>3 份资料</h2></div><span className="subtle-pill">混合检索已开启</span></div>{docs.map(([name, type, status, tag]) => <div className="document-row" key={name}><span className="document-icon">▤</span><div><strong>{name}</strong><small>{type}</small></div><em>{tag}</em><span className="document-status">● {status}</span></div>)}</section></div></section>;
}

function AgentsView() {
  const [mode, setMode] = useState<"coach" | "tutor" | "combined">("combined");
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState([{ role: "agent", text: "我可以结合你的学习记录与资料库，为你调整计划、解释知识点，或联网核对最新院校信息。任何写入操作都会先让你确认。" }]);
  function submit(event: FormEvent) { event.preventDefault(); if (!query.trim()) return; const text = query.trim(); setMessages((items) => [...items, { role: "user", text }, { role: "agent", text: mode === "coach" ? "我已读取本周计划与实际学习记录。当前数学进度正常，408 落后约 1.8 小时。我建议生成一个周三晚间的补偿任务，等待你确认后写入。" : mode === "tutor" ? "我会先检索你的私有资料；如果依据不足，再联网查找可信来源，并把两类引用分开呈现。" : "计划教练和资料导师已并行分析：先补足数据结构线性表的错题复习，再将相关讲义片段加入明日任务。我已生成变更提案，尚未写入。" }]); setQuery(""); }
  return <section className="content-view agent-view"><div className="view-title"><div><div className="eyebrow">LangChain × LangGraph</div><h1>双 Agent 学习助手</h1><p>计划教练负责执行闭环，资料导师负责带引用的检索与答疑。</p></div><span className="status-chip online">● 服务就绪</span></div><div className="agent-shell panel"><div className="agent-tabs">{[["coach","计划教练"],["tutor","资料导师"],["combined","联合模式"]].map(([key, label]) => <button key={key} className={mode === key ? "active" : ""} onClick={() => setMode(key as typeof mode)}>{label}</button>)}</div><div className="message-list">{messages.map((message, index) => <div className={`message ${message.role}`} key={index}><span>{message.role === "agent" ? "✦" : "你"}</span><p>{message.text}</p></div>)}</div><div className="agent-proposal"><div><strong>待确认提案</strong><p>创建「数据结构错题回顾」· 明天 19:30 · 45 分钟</p></div><div><button className="approve">批准写入</button><button className="outline-button">编辑</button><button className="text-button">拒绝</button></div></div><form className="agent-input" onSubmit={submit}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="询问计划、资料或最新院校信息…" /><button type="submit">发送 ↑</button></form></div></section>;
}

export default function Home() {
  const [view, setView] = useState<View>("today");
  const content = { today: <TodayView />, plan: <PlanView />, subjects: <SubjectsView />, schools: <SchoolsView />, materials: <MaterialsView />, agents: <AgentsView /> }[view];

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">研</span><div><strong>研途</strong><small>Agent Workbench</small></div></div>
        <nav>{navItems.map((item) => <button key={item.key} className={view === item.key ? "active" : ""} onClick={() => setView(item.key)}><span>{item.icon}</span>{item.label}</button>)}</nav>
        <div className="sidebar-goal"><span>2028 考研目标</span><strong>长三角 · 软件工程专硕</strong><div className="progress-track"><span style={{ width: "18%" }} /></div><small>基础阶段 · 第 3 周</small></div>
        <div className="profile"><span>LY</span><div><strong>林宇超</strong><small>苏大应院 · 软件工程</small></div><button aria-label="打开设置">•••</button></div>
      </aside>
      <section className="main-content">
        <header className="topbar"><div className="mobile-brand"><span className="brand-mark">研</span><strong>研途</strong></div><div className="sync-status"><i /> 数据已同步 · 刚刚</div><div className="top-actions"><button aria-label="搜索">⌕</button><button aria-label="通知">○</button><button className="quick-capture">＋ 快速记录</button></div></header>
        <div className="content-wrap">{content}</div>
        <nav className="mobile-nav">{navItems.slice(0, 5).map((item) => <button key={item.key} className={view === item.key ? "active" : ""} onClick={() => setView(item.key)}><span>{item.icon}</span><small>{item.label.slice(0,2)}</small></button>)}</nav>
      </section>
    </main>
  );
}
