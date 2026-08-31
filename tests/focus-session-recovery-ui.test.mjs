import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("专注计时按账户保存并在刷新后恢复", () => {
  assert.match(pageSource, /type StoredFocusSession = \{/);
  assert.match(pageSource, /kaoyan-focus-session:\$\{accountKey\}/);
  assert.match(pageSource, /window\.localStorage\.getItem\(focusStorageKey\)/);
  assert.match(pageSource, /window\.localStorage\.setItem\(focusStorageKey, JSON\.stringify\(stored\)\)/);
  assert.match(pageSource, /已恢复正在进行的专注计时/);
});

test("恢复后的计时由时间戳重算并扣除暂停时间", () => {
  assert.match(pageSource, /now - sessionStartedAt\.getTime\(\)/);
  assert.match(pageSource, /- pausedSeconds - currentPauseSeconds/);
  assert.match(pageSource, /window\.setInterval\(updateElapsedSeconds, 1000\)/);
});

test("专注状态使用登录用户编号隔离", () => {
  assert.match(pageSource, /const accountKey = user\?\.id \?\? "demo";/);
  assert.match(pageSource, /accountKey=\{accountKey\}/);
});
