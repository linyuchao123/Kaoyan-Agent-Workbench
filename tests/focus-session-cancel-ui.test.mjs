import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("误触开始的专注可以确认后放弃且不会写入记录", () => {
  assert.match(pageSource, /function cancelFocus\(\)/);
  assert.match(pageSource, /确定放弃本次专注吗？当前计时不会写入学习记录/);
  assert.match(pageSource, /setSessionStartedAt\(null\)/);
  assert.match(pageSource, /setPausedSeconds\(0\)/);
  assert.match(pageSource, /setFocusTaskId\(""\)/);
  assert.match(pageSource, /className="cancel" onClick=\{cancelFocus\}/);
});
