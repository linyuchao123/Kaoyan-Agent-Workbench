import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const layoutSource = readFileSync(new URL("../app/components/workbench-layout.tsx", import.meta.url), "utf8");

test("工作台控制器复用统一桌面与移动布局", () => {
  assert.match(pageSource, /<WorkbenchLayout/);
  assert.match(pageSource, /onNavigate=\{navigateToView\}/);
  assert.match(layoutSource, /aria-label="工作台主导航"/);
  assert.match(layoutSource, /aria-label="移动端主导航"/);
  assert.match(layoutSource, /<div className="content-wrap">\{children\}<\/div>/);
});

test("统一布局保留同步状态和三个全局快捷操作", () => {
  assert.match(layoutSource, /syncStatusCopy\(isDemo, apiStatus\)/);
  assert.match(layoutSource, /aria-label="搜索"/);
  assert.match(layoutSource, /aria-label="待处理事项"/);
  assert.match(layoutSource, /＋ 快速记录/);
});
