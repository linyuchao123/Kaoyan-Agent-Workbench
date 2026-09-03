"use client";

import { FormEvent, useMemo, useState, useEffect } from "react";
import { ApiError, api, type ApiMistakeCard, type MistakeReviewResult, type MistakeSubject } from "../lib/api";
import { RequestStatePanel, type RequestState } from "./request-state-panel";

const subjects: Array<{ value: MistakeSubject; label: string; short: string }> = [
  { value: "math", label: "数学一", short: "数" },
  { value: "english", label: "英语一", short: "英" },
  { value: "politics", label: "政治", short: "政" },
  { value: "cs408", label: "计算机 408", short: "408" },
];

type StatusFilter = "all" | "due" | "scheduled";

function isDue(card: ApiMistakeCard) {
  return new Date(card.next_review_at).getTime() <= Date.now();
}

function reviewDateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "等待安排";
  if (date.getTime() <= Date.now()) return "现在应复习";
  return `下次 ${new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric" }).format(date)}`;
}

function writeErrorMessage(error: unknown, action: string) {
  if (error instanceof ApiError && error.status === 401) return `${action}失败：登录状态已失效，请重新登录。`;
  if (error instanceof ApiError && error.status === 404) return `${action}失败：该错题可能已被删除，请刷新后重试。`;
  if (error instanceof ApiError && error.status >= 500) return `${action}失败：云端数据服务暂时不可用。`;
  if (error instanceof TypeError) return `${action}失败：无法连接本地后端。`;
  return `${action}失败，本次变更未写入云端，请稍后重试。`;
}

function demoReview(card: ApiMistakeCard, result: MistakeReviewResult) {
  const settings: Record<MistakeReviewResult, { mastery: number; days: number }> = {
    again: { mastery: -1, days: 1 },
    hard: { mastery: 0, days: 3 },
    good: { mastery: 1, days: 7 },
    easy: { mastery: 2, days: 14 },
  };
  const next = new Date();
  next.setDate(next.getDate() + settings[result].days);
  return {
    ...card,
    mastery: Math.max(1, Math.min(5, card.mastery + settings[result].mastery)),
    review_count: card.review_count + 1,
    next_review_at: next.toISOString(),
  };
}

export function MistakeLibrary({ isDemo, demoCards }: { isDemo: boolean; demoCards: ApiMistakeCard[] }) {
  const [cards, setCards] = useState<ApiMistakeCard[]>(() => isDemo ? demoCards : []);
  const [requestState, setRequestState] = useState<RequestState>(() => isDemo ? (demoCards.length ? "ready" : "empty") : "loading");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [subjectFilter, setSubjectFilter] = useState<"all" | MistakeSubject>("all");
  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<ApiMistakeCard | null>(null);
  const [subject, setSubject] = useState<MistakeSubject>("math");
  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [errorReason, setErrorReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (isDemo) return;
    let active = true;
    api.listMistakes()
      .then((items) => {
        if (!active) return;
        setCards(items);
        setRequestState(items.length ? "ready" : "empty");
      })
      .catch(() => {
        if (active) setRequestState("error");
      });
    return () => { active = false; };
  }, [isDemo]);

  const filteredCards = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return cards.filter((card) => {
      if (statusFilter === "due" && !isDue(card)) return false;
      if (statusFilter === "scheduled" && isDue(card)) return false;
      if (subjectFilter !== "all" && card.subject !== subjectFilter) return false;
      if (!normalizedQuery) return true;
      return [card.title, card.question, card.answer, card.error_reason]
        .some((value) => value.toLocaleLowerCase("zh-CN").includes(normalizedQuery));
    });
  }, [cards, query, statusFilter, subjectFilter]);

  const dueCount = cards.filter(isDue).length;

  function resetForm() {
    setEditingCard(null);
    setSubject("math");
    setTitle("");
    setQuestion("");
    setAnswer("");
    setErrorReason("");
  }

  function openCreateForm() {
    resetForm();
    setStatus("");
    setFormOpen(true);
  }

  function openEditForm(card: ApiMistakeCard) {
    setEditingCard(card);
    setSubject(card.subject);
    setTitle(card.title);
    setQuestion(card.question);
    setAnswer(card.answer);
    setErrorReason(card.error_reason);
    setStatus("");
    setFormOpen(true);
  }

  async function saveCard(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !question.trim() || busyId) return;
    const payload = { subject, title: title.trim(), question: question.trim(), answer: answer.trim(), error_reason: errorReason.trim() };
    const operationId = editingCard?.id ?? "new";
    setBusyId(operationId);
    try {
      const saved = isDemo
        ? editingCard
          ? { ...editingCard, ...payload }
          : { ...payload, id: `demo-library-${Date.now()}`, mastery: 1, next_review_at: new Date().toISOString(), review_count: 0 }
        : editingCard
          ? await api.updateMistake(editingCard.id, payload)
          : await api.createMistake(payload);
      setCards((items) => editingCard ? items.map((item) => item.id === saved.id ? saved : item) : [saved, ...items]);
      setRequestState("ready");
      setStatus(`“${saved.title}”已${editingCard ? "更新" : "加入"}错题库。`);
      setFormOpen(false);
      resetForm();
    } catch (error) {
      setStatus(writeErrorMessage(error, editingCard ? "更新错题" : "保存错题"));
    } finally {
      setBusyId(null);
    }
  }

  async function deleteCard(card: ApiMistakeCard) {
    if (busyId || !window.confirm(`确定删除错题“${card.title}”吗？相关复习记录也会一并删除。`)) return;
    setBusyId(card.id);
    try {
      if (!isDemo) await api.deleteMistake(card.id);
      const remaining = cards.filter((item) => item.id !== card.id);
      setCards(remaining);
      setRequestState(remaining.length ? "ready" : "empty");
      setStatus(`“${card.title}”已从错题库删除。`);
    } catch (error) {
      setStatus(writeErrorMessage(error, "删除错题"));
    } finally {
      setBusyId(null);
    }
  }

  async function reviewCard(card: ApiMistakeCard, result: MistakeReviewResult) {
    if (busyId) return;
    setBusyId(card.id);
    try {
      const reviewed = isDemo ? demoReview(card, result) : await api.reviewMistake(card.id, result);
      setCards((items) => items.map((item) => item.id === reviewed.id ? reviewed : item));
      setStatus(`“${card.title}”第 ${reviewed.review_count} 次复习已记录。`);
    } catch (error) {
      setStatus(writeErrorMessage(error, "保存复习记录"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="content-view mistake-library-view">
      <div className="view-title">
        <div><div className="eyebrow">Mistake Library</div><h1>完整错题库</h1><p>把错因、正确解法和间隔复习收在同一个闭环里。</p></div>
        <button className="primary-button" type="button" onClick={openCreateForm}>＋ 记录错题</button>
      </div>

      <div className="mistake-library-metrics">
        <article className="panel"><span>错题总数</span><strong>{cards.length}</strong><small>当前账户全部记录</small></article>
        <article className="panel due"><span>今日待复习</span><strong>{dueCount}</strong><small>{dueCount ? "优先清空到期队列" : "今日复习已完成"}</small></article>
        <article className="panel"><span>累计复习</span><strong>{cards.reduce((sum, card) => sum + card.review_count, 0)}</strong><small>每次评分都会留痕</small></article>
        <article className="panel"><span>高掌握度</span><strong>{cards.filter((card) => card.mastery >= 4).length}</strong><small>掌握度达到 4–5</small></article>
      </div>

      <div className="mistake-library-toolbar panel">
        <label>搜索错题<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="标题、题目、答案或错因" /></label>
        <label>复习状态<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}><option value="all">全部状态</option><option value="due">今日到期</option><option value="scheduled">后续复习</option></select></label>
        <label>科目<select value={subjectFilter} onChange={(event) => setSubjectFilter(event.target.value as "all" | MistakeSubject)}><option value="all">全部科目</option>{subjects.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
        <span>{filteredCards.length} / {cards.length} 道</span>
      </div>

      {formOpen && <form className="panel mistake-library-form" onSubmit={saveCard}>
        <div className="mistake-library-form-heading"><div className="eyebrow">{editingCard ? "编辑错题" : "新增错题"}</div><h2>{editingCard ? `完善“${editingCard.title}”` : "记录一道值得再次遇见的题"}</h2></div>
        <label>科目<select value={subject} onChange={(event) => setSubject(event.target.value as MistakeSubject)} disabled={Boolean(busyId)}>{subjects.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
        <label>标题<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} disabled={Boolean(busyId)} required /></label>
        <label className="wide">题目或知识点<textarea value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={10000} disabled={Boolean(busyId)} required /></label>
        <label className="wide">正确答案<textarea value={answer} onChange={(event) => setAnswer(event.target.value)} maxLength={10000} disabled={Boolean(busyId)} /></label>
        <label className="wide">错误原因<textarea value={errorReason} onChange={(event) => setErrorReason(event.target.value)} maxLength={10000} disabled={Boolean(busyId)} /></label>
        <div className="mistake-library-form-actions"><button type="button" onClick={() => { setFormOpen(false); resetForm(); }} disabled={Boolean(busyId)}>取消</button><button className="primary-button" type="submit" disabled={Boolean(busyId)}>{busyId ? "正在保存…" : editingCard ? "保存修改" : "加入错题库"}</button></div>
      </form>}

      {status && <p className="mistake-library-status" role="status">● {status}</p>}

      <RequestStatePanel state={requestState} loadingText="正在读取云端错题库…" emptyTitle="错题库还是空的" emptyDescription="记录第一道错题后，可以持续补充答案、错因并进行间隔复习。" errorText="错题库加载失败，请检查云端连接后刷新页面。">
        {filteredCards.length ? <div className="mistake-library-list">{filteredCards.map((card) => {
          const subjectItem = subjects.find((item) => item.value === card.subject) ?? subjects[0];
          return <article className={`panel mistake-library-card ${isDue(card) ? "due" : ""}`} key={card.id}>
            <div className="mistake-library-card-heading"><span className={`subject-badge ${card.subject}`}>{subjectItem.short}</span><div><strong>{card.title}</strong><small>掌握度 {card.mastery}/5 · 已复习 {card.review_count} 次 · {reviewDateLabel(card.next_review_at)}</small></div><span className={isDue(card) ? "due-label" : "scheduled-label"}>{isDue(card) ? "今日到期" : "已安排"}</span></div>
            <div className="mistake-library-content"><p><span>题目</span>{card.question}</p><p><span>答案</span>{card.answer || "尚未补充正确答案"}</p><p><span>错因</span>{card.error_reason || "尚未记录错误原因"}</p></div>
            <div className="mistake-library-actions"><div className="review-actions"><button type="button" disabled={busyId === card.id} onClick={() => void reviewCard(card, "again")}>重来</button><button type="button" disabled={busyId === card.id} onClick={() => void reviewCard(card, "hard")}>困难</button><button type="button" disabled={busyId === card.id} onClick={() => void reviewCard(card, "good")}>良好</button><button type="button" disabled={busyId === card.id} onClick={() => void reviewCard(card, "easy")}>简单</button></div><div><button type="button" onClick={() => openEditForm(card)} disabled={busyId === card.id}>编辑</button><button className="danger" type="button" onClick={() => void deleteCard(card)} disabled={busyId === card.id}>删除</button></div></div>
          </article>;
        })}</div> : <div className="panel plan-empty request-state"><strong>没有匹配的错题</strong><span>调整关键词、复习状态或科目筛选后再试。</span></div>}
      </RequestStatePanel>
    </section>
  );
}
