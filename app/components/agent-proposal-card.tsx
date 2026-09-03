import type { FormEvent } from "react";

import type { ActionProposal, AgentProposalEdit, AgentProposalTask, Subject } from "../lib/api";

const subjects: Array<{ key: Subject; label: string }> = [
  { key: "math", label: "数学" },
  { key: "english", label: "英语" },
  { key: "politics", label: "政治" },
  { key: "cs408", label: "408" },
  { key: "career", label: "职业" },
];
const subjectLabel = Object.fromEntries(subjects.map((item) => [item.key, item.label])) as Record<Subject, string>;

type AgentProposalCardProps = {
  proposal: ActionProposal;
  draft: AgentProposalEdit | null;
  editing: boolean;
  busy: boolean;
  onDraftChange: (draft: AgentProposalEdit) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (event: FormEvent) => void;
  onApprove: () => void;
  onReject: () => void;
};

function TaskFields({ task, index, maxMinutes, onChange }: { task: AgentProposalTask; index?: number; maxMinutes: number; onChange: (task: AgentProposalTask) => void }) {
  return <div className="agent-proposal-task-fields"><label>{index === undefined ? "任务标题" : `任务 ${index + 1}`}<input required maxLength={160} value={task.title} onChange={(event) => onChange({ ...task, title: event.target.value })} /></label><label>科目<select value={task.subject} onChange={(event) => onChange({ ...task, subject: event.target.value as Subject })}>{subjects.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label><label>计划分钟<input required type="number" min={1} max={maxMinutes} value={task.planned_minutes} onChange={(event) => onChange({ ...task, planned_minutes: Number(event.target.value) })} /></label></div>;
}

export function AgentProposalCard({ proposal, draft, editing, busy, onDraftChange, onStartEdit, onCancelEdit, onSaveEdit, onApprove, onReject }: AgentProposalCardProps) {
  const canDecide = proposal.status === "pending" || proposal.status === "edited";
  const proposalTasks = proposal.action === "create_daily_tasks" ? proposal.payload.tasks : [proposal.payload];
  const totalMinutes = proposalTasks.reduce((total, task) => total + task.planned_minutes, 0);
  const draftMinutes = draft && "tasks" in draft ? draft.tasks.reduce((total, task) => total + task.planned_minutes, 0) : 0;
  return <div className={`agent-proposal proposal-${proposal.status}`}>
    <div className="agent-proposal-summary"><strong>{proposal.status === "pending" ? "待确认提案" : `提案状态：${proposal.status}`}</strong>{proposal.action === "create_daily_tasks" ? <><p>{proposalTasks.length} 项 · 共 {totalMinutes} 分钟，批准后一次性写入</p><ol>{proposalTasks.map((task, index) => <li key={`${task.subject}-${task.title}-${index}`}><span>{task.title}</span><small>{subjectLabel[task.subject]} · {task.planned_minutes} 分钟</small></li>)}</ol></> : <p>{proposal.payload.title} · {subjectLabel[proposal.payload.subject]} · {proposal.payload.planned_minutes} 分钟</p>}</div>
    {editing && draft ? <form className={`agent-proposal-edit ${"tasks" in draft ? "daily" : ""}`} onSubmit={onSaveEdit}>{"tasks" in draft ? <><div className="agent-proposal-task-list">{draft.tasks.map((task, index) => <div className="agent-proposal-task-edit" key={index}><TaskFields task={task} index={index} maxMinutes={120} onChange={(updatedTask) => onDraftChange({ tasks: draft.tasks.map((item, itemIndex) => itemIndex === index ? updatedTask : item) })} />{draft.tasks.length > 1 && <button className="text-button" type="button" disabled={busy} onClick={() => onDraftChange({ tasks: draft.tasks.filter((_, itemIndex) => itemIndex !== index) })}>移除</button>}</div>)}</div><div className="agent-proposal-edit-footer"><span className={draftMinutes > 240 ? "invalid" : ""}>合计 {draftMinutes} / 240 分钟</span>{draft.tasks.length < 4 && <button className="outline-button" type="button" disabled={busy} onClick={() => onDraftChange({ tasks: [...draft.tasks, { title: "新增学习任务", subject: "cs408", planned_minutes: 30 }] })}>＋ 添加任务</button>}<button className="approve" disabled={busy || draftMinutes > 240} type="submit">保存编辑</button><button className="text-button" disabled={busy} type="button" onClick={onCancelEdit}>取消</button></div></> : <><TaskFields task={draft} maxMinutes={1440} onChange={onDraftChange} /><div><button className="approve" disabled={busy} type="submit">保存编辑</button><button className="text-button" disabled={busy} type="button" onClick={onCancelEdit}>取消</button></div></>}</form> : canDecide && <div className="agent-proposal-actions"><button className="approve" disabled={busy} onClick={onApprove}>批准写入</button><button className="outline-button" disabled={busy} onClick={onStartEdit}>编辑</button><button className="text-button" disabled={busy} onClick={onReject}>拒绝</button></div>}
  </div>;
}
