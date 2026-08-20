import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("手动补录可以关联今日任务并沿用任务科目", () => {
  assert.match(pageSource, /const \[manualTaskId, setManualTaskId\] = useState\(""\)/);
  assert.match(pageSource, /aria-label="补录关联今日任务"/);
  assert.match(pageSource, /if \(task\) setManualSubject\(task\.subject\)/);
  assert.match(pageSource, /task_id: linkedTask\?\.id/);
  assert.match(pageSource, /disabled=\{Boolean\(manualTaskId\)\}/);
});

test("演示补录会同步累计关联任务的实际学习时长", () => {
  assert.match(pageSource, /actualMinutes: task\.actualMinutes \+ interval\.effectiveMinutes/);
  assert.match(pageSource, /setManualTaskId\(""\)/);
});
