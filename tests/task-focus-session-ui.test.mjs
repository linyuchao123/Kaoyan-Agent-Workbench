import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const apiSource = await readFile(new URL("../app/lib/api.ts", import.meta.url), "utf8");

test("今日任务可以直接发起专注并关联学习会话", () => {
  assert.match(pageSource, /function beginTaskFocus\(task: Task\)/);
  assert.match(pageSource, /关联今日任务/);
  assert.match(pageSource, /task_id: linkedTask\?\.id/);
  assert.match(pageSource, />专注<\/button>/);
  assert.match(apiSource, /createSession: \(payload: \{\s*task_id\?: string;/);
});

test("最近学习记录展示关联任务名称", () => {
  assert.match(pageSource, /关联任务 ·/);
  assert.match(pageSource, /已删除任务/);
});
