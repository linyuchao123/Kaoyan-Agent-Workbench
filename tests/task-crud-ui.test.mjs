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
