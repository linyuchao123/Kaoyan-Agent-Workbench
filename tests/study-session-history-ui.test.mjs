import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const apiSource = await readFile(new URL("../app/lib/api.ts", import.meta.url), "utf8");

test("今日工作台展示真实学习记录并支持删除误录", () => {
  assert.match(pageSource, /snapshot\.sessions[\s\S]*sessionTouchesShanghaiDay/);
  assert.match(pageSource, /今日最近记录/);
  assert.match(pageSource, /async function deleteStudySession/);
  assert.match(pageSource, /await api\.deleteSession\(session\.id\)/);
  assert.match(apiSource, /deleteSession: \(id: string\) => request<void>/);
});

test("学习记录使用上海时区筛选并展示有效分钟", () => {
  assert.match(pageSource, /function sessionTouchesShanghaiDay/);
  assert.match(pageSource, /function studySessionMinutes/);
  assert.match(pageSource, /timeZone: "Asia\/Shanghai"/);
});
