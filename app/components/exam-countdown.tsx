"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_EXAM_TARGET_DATE,
  clearExamTargetDate,
  daysUntilExam,
  formatExamTargetDate,
  readExamTargetDate,
  storeExamTargetDate,
} from "../lib/exam-target";

type ExamCountdownProps = {
  accountKey: string;
  today: string;
};

export function ExamCountdown({ accountKey, today }: ExamCountdownProps) {
  const [targetDate, setTargetDate] = useState(DEFAULT_EXAM_TARGET_DATE);
  const [draftDate, setDraftDate] = useState(DEFAULT_EXAM_TARGET_DATE);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const storedDate = readExamTargetDate(window.localStorage, accountKey);
      setTargetDate(storedDate);
      setDraftDate(storedDate);
    });
    return () => { cancelled = true; };
  }, [accountKey]);

  const remainingDays = daysUntilExam(today, targetDate);
  const hasEnded = targetDate < today;

  function saveTarget() {
    if (!storeExamTargetDate(window.localStorage, accountKey, draftDate)) return;
    setTargetDate(draftDate);
    setEditing(false);
  }

  function restoreDefault() {
    clearExamTargetDate(window.localStorage, accountKey);
    setTargetDate(DEFAULT_EXAM_TARGET_DATE);
    setDraftDate(DEFAULT_EXAM_TARGET_DATE);
    setEditing(false);
  }

  return (
    <section className="exam-countdown" aria-label="考研倒计时">
      <div>
        <span>{hasEnded ? "目标日期已到" : "距离目标初试日"}</span>
        <strong>{hasEnded ? "请更新" : remainingDays}<small>{hasEnded ? "" : "天"}</small></strong>
        <em>{formatExamTargetDate(targetDate)} · 日期可调整</em>
      </div>
      <button type="button" onClick={() => setEditing((value) => !value)} aria-expanded={editing}>
        {editing ? "取消" : "设置日期"}
      </button>
      {editing && (
        <div className="exam-countdown-editor">
          <label>目标初试日<input type="date" min={today} value={draftDate} onInput={(event) => setDraftDate(event.currentTarget.value)} /></label>
          <button type="button" className="primary-button" onClick={saveTarget}>保存</button>
          {targetDate !== DEFAULT_EXAM_TARGET_DATE && <button type="button" onClick={restoreDefault}>恢复 2028 默认值</button>}
        </div>
      )}
    </section>
  );
}
