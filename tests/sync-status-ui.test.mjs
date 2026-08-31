import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("顶部云端连接状态支持手动重新检查", () => {
  assert.match(pageSource, /const retryApiHealth = useCallback/);
  assert.match(pageSource, /setHealthRevision\(\(revision\) => revision \+ 1\)/);
  assert.match(pageSource, /onClick=\{retryApiHealth\}/);
  assert.match(pageSource, /数据服务未连接 · 点击重试/);
  assert.match(pageSource, /正在重新检查数据服务/);
  assert.match(pageSource, /disabled=\{isDemo \|\| apiStatus === "checking"\}/);
});
