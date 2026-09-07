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
  assert.match(pageSource, /onOpenAdvisor\(Number\(yearFilter\) \|\| 2028\)/);
  assert.match(pageSource, /\$\{examYear\} 年目标院校档案/);
});

test("资料库预填带原文定位要求的可编辑问题", () => {
  assert.match(pageSource, /AI 解读资料/);
  assert.match(pageSource, /const openMaterialAdvisor = useCallback[\s\S]*?setAgentInitialMode\("tutor"\)/);
  assert.match(pageSource, /只根据我的资料解释这个知识点，并标注原文标题与定位/);
  assert.match(pageSource, /请在这里补充具体知识点/);
  assert.match(pageSource, /<MaterialsView[\s\S]*?onOpenAdvisor=\{openMaterialAdvisor\}/);
});

test("上下文入口不会被历史线程覆盖或自动发送", () => {
  assert.match(pageSource, /initialMode \?\? \(initialQuery \? "coach" : "combined"\)/);
  assert.match(pageSource, /enteredWithInitialQuery = useRef\(Boolean\(initialQuery\)\)/);
  assert.match(pageSource, /if \(thread && !enteredWithInitialQuery\.current\)/);
  assert.match(pageSource, /restoredMessages = !enteredWithInitialQuery\.current && thread\?\.messages\.length/);
  assert.match(pageSource, /<AgentsView[\s\S]*?initialMode=\{agentInitialMode\}/);
  assert.match(pageSource, /async function submit\(event: FormEvent\)[\s\S]*?api\.runAgentStream/);
});

test("Agent 回答区区分院校、求职、个人资料和网络来源", () => {
  assert.match(pageSource, /function agentSourceLabel/);
  assert.match(pageSource, /school: "院校档案"/);
  assert.match(pageSource, /career: "求职记录"/);
  assert.match(pageSource, /agentSourceLabel\(source\.source_type\)/);
});
