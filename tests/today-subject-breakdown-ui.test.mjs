import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("首页按真实学习会话汇总今日科目结构", () => {
  assert.match(pageSource, /function TodaySubjectBreakdown/);
  assert.match(pageSource, /totals\[session\.subject\] \+= studySessionMinutes\(session\)/);
  assert.match(pageSource, /<TodaySubjectBreakdown sessions=\{todaySessions\} \/>/);
  assert.match(pageSource, /今日学习结构/);
  assert.match(pageSource, /row\.minutes \/ totalMinutes/);
});
