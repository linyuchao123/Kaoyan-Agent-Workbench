import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const componentSource = await readFile(new URL("../app/components/mistake-library.tsx", import.meta.url), "utf8");
const viewSource = await readFile(new URL("../app/lib/workbench-view.ts", import.meta.url), "utf8");

test("错题库是独立工作台页面并进入移动端主导航", () => {
  assert.match(viewSource, /"mistakes"/);
  assert.match(pageSource, /key: "mistakes", label: "错题库"/);
  assert.match(pageSource, /mistakes: <MistakeLibrary/);
  assert.match(pageSource, /view: "mistakes" as const, category: "错题卡"/);
  assert.match(pageSource, /view: "mistakes" as const, category: "到期错题"/);
});

test("完整错题库支持搜索、到期状态与科目筛选", () => {
  assert.match(componentSource, /type StatusFilter = "all" \| "due" \| "scheduled"/);
  assert.match(componentSource, /placeholder="标题、题目、答案或错因"/);
  assert.match(componentSource, /复习状态/);
  assert.match(componentSource, /全部科目/);
  assert.match(componentSource, /filteredCards/);
});

test("完整错题库复用云端创建编辑删除和间隔复习接口", () => {
  assert.match(componentSource, /api\.listMistakes\(\)/);
  assert.match(componentSource, /api\.createMistake\(payload\)/);
  assert.match(componentSource, /api\.updateMistake\(editingCard\.id, payload\)/);
  assert.match(componentSource, /api\.deleteMistake\(card\.id\)/);
  assert.match(componentSource, /api\.reviewMistake\(card\.id, result\)/);
  assert.match(componentSource, /window\.confirm/);
});

test("错题库明确区分加载、空数据、错误和筛选无结果", () => {
  assert.match(componentSource, /<RequestStatePanel/);
  assert.match(componentSource, /正在读取云端错题库/);
  assert.match(componentSource, /错题库还是空的/);
  assert.match(componentSource, /错题库加载失败/);
  assert.match(componentSource, /没有匹配的错题/);
});
