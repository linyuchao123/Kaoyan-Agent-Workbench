import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const layoutSource = readFileSync(new URL("../app/components/workbench-layout.tsx", import.meta.url), "utf8");
const workbenchSource = `${pageSource}\n${layoutSource}`;

test("顶部云端连接状态支持手动重新检查", () => {
  assert.match(pageSource, /const retryApiHealth = useCallback/);
  assert.match(pageSource, /setHealthRevision\(\(revision\) => revision \+ 1\)/);
  assert.match(pageSource, /onRetryApiHealth=\{retryApiHealth\}/);
  assert.match(workbenchSource, /数据服务未连接 · 点击重试/);
  assert.match(workbenchSource, /正在重新检查数据服务/);
  assert.match(layoutSource, /disabled=\{isDemo \|\| apiStatus === "checking"\}/);
});
