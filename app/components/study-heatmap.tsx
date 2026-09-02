"use client";

import { useEffect, useMemo, useState } from "react";
import { api, type ContributionScope } from "../lib/api";

type Scope = ContributionScope;
type HeatmapMetric = "completion" | "minutes";

type StudyDay = {
  date: string;
  minutes: Record<Exclude<Scope, "all">, number>;
  sessions: number;
  tasks: number;
  targetTasks: number;
  completedTargetTasks: number;
  completionRate: number;
  mistakes: number;
};

const scopes: { key: Scope; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "math", label: "数学" },
  { key: "english", label: "英语" },
  { key: "politics", label: "政治" },
  { key: "cs408", label: "408" },
  { key: "career", label: "项目" },
];

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

function buildYearData(year: number, scope: Scope): StudyDay[] {
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
    const allTargetTasks = active ? 2 + Math.floor(seededValue(index + 71) * 5) : 0;
    const targetTasks = scope === "all" ? allTargetTasks : Math.round(allTargetTasks * ({ math, english, politics: 0, cs408, career }[scope] / Math.max(1, load)));
    const completedTargetTasks = targetTasks ? Math.min(targetTasks, Math.floor(seededValue(index + 79) * (targetTasks + 1))) : 0;
    result.push({
      date: formatDate(cursor),
      minutes: { math, english, politics: 0, cs408, career },
      sessions: active ? 1 + Math.floor(seededValue(index + 31) * 4) : 0,
      tasks: active ? 1 + Math.floor(seededValue(index + 41) * 5) : 0,
      targetTasks,
      completedTargetTasks,
      completionRate: targetTasks ? Math.round(completedTargetTasks / targetTasks * 100) : 0,
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
      targetTasks: 0,
      completedTargetTasks: 0,
      completionRate: 0,
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

function getCompletionLevel(rate: number, targetTasks: number) {
  if (targetTasks === 0) return 0;
  if (rate >= 100) return 4;
  if (rate >= 75) return 3;
  if (rate >= 50) return 2;
  return 1;
}

function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} 分钟`;
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

export function StudyHeatmap({ isDemo, refreshVersion }: { isDemo: boolean; refreshVersion: number }) {
  const currentYear = Number(shanghaiDateKey(new Date()).slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const [scope, setScope] = useState<Scope>("all");
  const [metric, setMetric] = useState<HeatmapMetric>("completion");
  const demoData = useMemo(() => buildYearData(year, scope), [scope, year]);
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
            targetTasks: day.target_tasks,
            completedTargetTasks: day.completed_target_tasks,
            completionRate: day.task_completion_rate,
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
  const targetDays = data.filter((day) => day.targetTasks > 0).length;
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
                : metric === "completion"
                  ? `${year} 年目标完成度`
                  : `${year} 年有效学习 ${Math.round(totalMinutes / 60)} 小时`}
          </h2>
          <p>{isLoading ? "正在读取学习会话与年度统计" : hasError ? "请确认数据服务已启动后刷新页面" : `${metric === "completion" ? `${targetDays} 个目标日` : `${activeDays} 个学习日`} · ${dataSource === "api" ? "来自真实学习记录" : "离线演示数据"}`}</p>
        </div>
        <div className="year-switch" aria-label="选择年份">
          {[currentYear, currentYear - 1].map((item) => <button key={item} className={year === item ? "active" : ""} onClick={() => setYear(item)}>{item}</button>)}
        </div>
      </div>

      <div className="heatmap-metric-switch" aria-label="选择热力图指标">
        <button type="button" className={metric === "completion" ? "active" : ""} aria-pressed={metric === "completion"} onClick={() => setMetric("completion")}>目标完成度</button>
        <button type="button" className={metric === "minutes" ? "active" : ""} aria-pressed={metric === "minutes"} onClick={() => setMetric("minutes")}>有效学习时长</button>
      </div>

      <div className="scope-row" aria-label="筛选学习科目">
        {scopes.map((item) => <button key={item.key} className={scope === item.key ? "active" : ""} onClick={() => setScope(item.key)}>{item.label}</button>)}
      </div>

      <div className="heatmap-scroll">
        <div className="month-row" aria-hidden="true">{Array.from({ length: 12 }, (_, index) => <span key={index}>{index + 1}月</span>)}</div>
        <div className="heatmap-body">
          <div className="weekday-labels" aria-hidden="true"><span>一</span><span /><span>三</span><span /><span>五</span><span /><span>日</span></div>
          <div className={`heatmap-grid ${isLoading ? "loading" : ""}`} role="grid" aria-label={`${year} 学习贡献热力图`}>
            {weeks.map((week, weekIndex) => <div className="heatmap-week" key={weekIndex} role="row">
              {Array.from({ length: 7 }, (_, dayIndex) => {
                const day = week[dayIndex] ?? null;
                if (!day) return <span className="heat-cell empty" key={dayIndex} aria-hidden="true" />;
                const minutes = getMinutes(day, scope);
                const level = metric === "completion" ? getCompletionLevel(day.completionRate, day.targetTasks) : getLevel(minutes, scope);
                const metricLabel = metric === "completion" ? `${day.completionRate}%（${day.completedTargetTasks}/${day.targetTasks} 项）` : formatMinutes(minutes);
                return <button key={day.date} className={`heat-cell level-${level} ${selectedDate === day.date ? "selected" : ""}`} title={`${day.date}：${metricLabel}`} aria-label={`${day.date}，${metric === "completion" ? `目标完成度${metricLabel}` : `有效学习${metricLabel}`}`} onClick={() => setSelectedDate(day.date)} role="gridcell" />;
              })}
            </div>)}
          </div>
        </div>
      </div>

      <div className="heatmap-footer">
        <div className="selected-summary">
          {isLoading ? <span className="cloud-loading-text">正在同步云端统计…</span> : hasError ? <span>暂时无法读取学习统计</span> : <>
            <strong>{selectedDay.date}</strong>
            <span>{metric === "completion" ? `目标完成 ${selectedDay.completedTargetTasks} / ${selectedDay.targetTasks} 项 · ${selectedDay.completionRate}%` : formatMinutes(getMinutes(selectedDay, scope))}</span>
            <span>{selectedDay.sessions} 次专注</span>
            <span>{selectedDay.tasks} 项完成</span>
            <span>{selectedDay.mistakes} 道错题</span>
          </>}
        </div>
        <div className="legend"><span>少</span>{[0, 1, 2, 3, 4].map((level) => <i className={`level-${level}`} key={level} />)}<span>多</span></div>
      </div>
    </section>
  );
}
