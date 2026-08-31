import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../app/lib/api.ts", import.meta.url), "utf8");

test("学科学习页面读取云端统计并展示真实指标", () => {
  assert.match(apiSource, /subjectSummaries:\s*\(\)\s*=>/);
  assert.match(pageSource, /api\.subjectSummaries\(\)/);
  assert.match(pageSource, /summary\.weekly_minutes/);
  assert.match(pageSource, /summary\.task_completion_rate/);
  assert.match(pageSource, /summary\.due_mistake_count/);
  assert.doesNotMatch(pageSource, /18 \/ 84 节/);
});

test("学科学习页面的资料与复习入口具备交互", () => {
  assert.match(pageSource, /onClick=\{onOpenMaterials\}/);
  assert.match(pageSource, /onClick=\{onOpenToday\}/);
  assert.match(pageSource, /onOpenMaterials=\{\(\) => navigateToView\("materials"\)\}/);
  assert.match(pageSource, /onOpenToday=\{\(\) => navigateToView\("today"\)\}/);
});
