import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const apiSource = await readFile(new URL("../app/lib/api.ts", import.meta.url), "utf8");

test("today tasks display actual versus planned study time", () => {
  assert.match(apiSource, /actual_minutes\?: number/);
  assert.match(pageSource, /actualMinutes: task\.actual_minutes \?\? knownActualMinutes \?\? 0/);
  assert.match(pageSource, /实际 \{formatMinutes\(task\.actualMinutes\)\} \/ 计划/);
  assert.match(pageSource, /task\.actualMinutes >= task\.plannedMinutes \? " · 已达成"/);
});

test("dashboard refresh synchronizes actual task minutes", () => {
  assert.match(pageSource, /actualMinutesByTask = new Map\(snapshot\.tasks/);
  assert.match(pageSource, /actualMinutes: actualMinutesByTask\.get\(task\.id\) \?\? 0/);
});
