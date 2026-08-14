import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const component = pageSource.slice(pageSource.indexOf("function AttentionCenter"), pageSource.indexOf("function QuickCapture"));

test("顶部待处理按钮可以打开事项中心", () => {
  assert.match(pageSource, /aria-label="待处理事项"/);
  assert.match(pageSource, /setAttentionOpen\(true\)/);
  assert.match(component, /role="dialog"/);
});

test("事项中心汇总真实待完成记录", () => {
  assert.match(component, /api\.today\(\)/);
  assert.match(component, /api\.listMistakes\(true\)/);
  assert.match(component, /api\.listPendingProposals\(\)/);
  assert.match(component, /api\.listDocuments\(\)/);
  assert.match(component, /proposal\.status === "pending"/);
  assert.match(component, /document\.ingestion_status === "ocr_required"/);
  assert.doesNotMatch(component, /user_id/);
});

test("进入云端工作台后会预取待处理事项数量", () => {
  assert.match(component, /const loadedOnce = useRef\(false\)/);
  assert.match(component, /isDemo \|\| \(!open && loadedOnce\.current\)/);
  assert.match(component, /loadedOnce\.current = true/);
  assert.match(component, /onCountChange\(nextItems\.length\)/);
});

test("点击待处理事项可以前往对应模块", () => {
  assert.match(component, /onNavigate\(item\.view\)/);
  assert.match(pageSource, /onCountChange=\{setAttentionCount\}/);
});
