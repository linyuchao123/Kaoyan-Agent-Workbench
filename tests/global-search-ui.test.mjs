import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const component = pageSource.slice(pageSource.indexOf("function GlobalSearch"), pageSource.indexOf("function QuickCapture"));

test("顶部搜索按钮可以打开全局搜索弹窗", () => {
  assert.match(pageSource, /setSearchOpen\(true\)/);
  assert.match(component, /role="dialog"/);
  assert.match(component, /aria-labelledby="global-search-title"/);
});

test("全局搜索读取当前账户的核心业务数据", () => {
  assert.match(component, /api\.today\(\)/);
  assert.match(component, /api\.listPlans\(\)/);
  assert.match(component, /api\.listMistakes\(\)/);
  assert.match(component, /api\.listSchoolOptions\(\)/);
  assert.match(component, /api\.listDocuments\(\)/);
  assert.match(component, /api\.listCareerItems\(\)/);
  assert.doesNotMatch(component, /user_id/);
});

test("点击搜索结果会跳转到对应工作台模块", () => {
  assert.match(component, /onNavigate\(entry\.view\)/);
  assert.match(pageSource, /onNavigate=\{setView\}/);
});
