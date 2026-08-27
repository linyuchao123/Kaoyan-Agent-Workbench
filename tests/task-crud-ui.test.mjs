import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../app/lib/api.ts", import.meta.url), "utf8");

test("今日任务支持编辑标题科目时长和日计划", () => {
  assert.match(pageSource, /function beginTaskEdit/);
  assert.match(pageSource, /function saveTaskEdit/);
  assert.match(pageSource, /保存修改/);
  assert.match(pageSource, /planned_minutes: editTaskMinutes/);
  assert.match(pageSource, /plan_id: editTaskPlanId \|\| null/);
});

test("今日任务支持确认后删除并刷新真实指标", () => {
  assert.match(pageSource, /window\.confirm/);
  assert.match(pageSource, /api\.deleteTask\(task\.id\)/);
  assert.match(pageSource, /refreshDashboardMetrics\(\)/);
  assert.match(apiSource, /deleteTask: \(id: string\).*method: "DELETE"/);
});

test("云端任务创建失败时回滚临时记录并恢复输入", () => {
  assert.match(pageSource, /function studyWriteErrorMessage/);
  assert.match(pageSource, /items\.filter\(\(item\) => item\.id !== temporaryId\)/);
  assert.match(pageSource, /setNewTask\(\(current\) => current \|\| title\)/);
  assert.match(pageSource, /studyWriteErrorMessage\(error, "创建任务"\)/);
  assert.doesNotMatch(pageSource, /API 暂不可用 · 新任务仅保留在本页/);
});

test("任务创建期间禁用表单以避免重复提交", () => {
  assert.match(pageSource, /const \[newTaskBusy, setNewTaskBusy\]/);
  assert.match(pageSource, /setNewTaskBusy\(true\)/);
  assert.match(pageSource, /setNewTaskBusy\(false\)/);
  assert.match(pageSource, /newTaskBusy \? "正在保存…" : "添加"/);
});
