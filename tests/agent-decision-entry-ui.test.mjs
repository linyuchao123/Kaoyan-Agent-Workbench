import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("院校与求职页面只预填分析问题并进入资料导师", () => {
  assert.match(pageSource, /AI 对比院校/);
  assert.match(pageSource, /AI 分析进展/);
  assert.match(pageSource, /const openSchoolAdvisor = useCallback[\s\S]*?setAgentInitialMode\("tutor"\)/);
  assert.match(pageSource, /const openCareerAdvisor = useCallback[\s\S]*?setAgentInitialMode\("tutor"\)/);
  assert.match(pageSource, /只做分析，不要创建或修改任何记录/);
});

test("上下文入口不会被历史线程覆盖或自动发送", () => {
  assert.match(pageSource, /initialMode \?\? \(initialQuery \? "coach" : "combined"\)/);
  assert.match(pageSource, /enteredWithInitialQuery = useRef\(Boolean\(initialQuery\)\)/);
  assert.match(pageSource, /if \(thread && !enteredWithInitialQuery\.current\)/);
  assert.match(pageSource, /restoredMessages = !enteredWithInitialQuery\.current && thread\?\.messages\.length/);
  assert.match(pageSource, /<AgentsView[\s\S]*?initialMode=\{agentInitialMode\}/);
  assert.match(pageSource, /async function submit\(event: FormEvent\)[\s\S]*?api\.runAgentStream/);
});
