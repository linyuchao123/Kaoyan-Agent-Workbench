import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("顶部快速记录按钮可以打开真实表单", () => {
  assert.match(pageSource, /onClick=\{\(\) => setQuickCaptureOpen\(true\)\}/);
  assert.match(pageSource, /role="dialog"/);
  assert.match(pageSource, /aria-labelledby="quick-capture-title"/);
});

test("快速记录可以写入任务或错题且不传用户编号", () => {
  const component = pageSource.slice(pageSource.indexOf("function QuickCapture"), pageSource.indexOf("function Workbench"));
  assert.match(component, /api\.createTask\(/);
  assert.match(component, /api\.createMistake\(/);
  assert.doesNotMatch(component, /user_id/);
});

test("快速记录保存后刷新今日工作台", () => {
  assert.match(pageSource, /setStudyRevision\(\(value\) => value \+ 1\)/);
  assert.match(pageSource, /setView\("today"\)/);
});
