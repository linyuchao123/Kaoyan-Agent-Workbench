import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const componentSource = await readFile(new URL("../app/components/today-action-strip.tsx", import.meta.url), "utf8");

test("首页展示 AI 今日计划提案与今日错题复习入口", () => {
  assert.match(pageSource, /<TodayActionStrip/);
  assert.match(componentSource, /AI 今日计划提案/);
  assert.match(componentSource, /今日错题复习/);
  assert.match(componentSource, /先审阅和编辑整组计划；批准后才会原子写入/);
});

test("AI 计划入口将安全请求预填到计划教练但不会自动提交", () => {
  assert.match(pageSource, /setAgentPlanQuery\("请结合我今天未完成的任务、到期错题和近期学习进度/);
  assert.match(pageSource, /initialQuery=\{agentPlanQuery\}/);
  assert.match(pageSource, /initialQuery \? "coach" : "combined"/);
});

test("错题入口滚动到现有复习队列", () => {
  assert.match(pageSource, /getElementById\("today-mistake-review"\)/);
  assert.match(pageSource, /id="today-mistake-review"/);
  assert.match(pageSource, /scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/);
});
