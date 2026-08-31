import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("侧栏阶段目标读取云端计划并支持修改后刷新", () => {
  assert.match(pageSource, /api\.listPlans\("stage"\)/);
  assert.match(pageSource, /selectSidebarStage\(plans,/);
  assert.match(pageSource, /onPlansChanged=\{\(\) => setPlanRevision/);
  assert.match(pageSource, /正在读取阶段计划/);
  assert.match(pageSource, /尚未创建阶段计划/);
  assert.match(pageSource, /navigateToView\("plan"\)/);
  assert.doesNotMatch(pageSource, /长三角 · 软件工程专硕/);
});
