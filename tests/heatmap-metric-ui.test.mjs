import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../app/lib/api.ts", import.meta.url), "utf8");

test("热力图默认展示目标完成度并可切换有效学习时长", () => {
  assert.match(pageSource, /useState<HeatmapMetric>\("completion"\)/);
  assert.match(pageSource, /aria-label="选择热力图指标"/);
  assert.match(pageSource, /aria-pressed=\{metric === "completion"\}/);
  assert.match(pageSource, /目标完成度/);
  assert.match(pageSource, /有效学习时长/);
});

test("目标完成度使用真实目标数而不是完成数量猜测百分比", () => {
  assert.match(apiSource, /target_tasks: number/);
  assert.match(apiSource, /completed_target_tasks: number/);
  assert.match(apiSource, /task_completion_rate: number/);
  assert.match(pageSource, /day\.task_completion_rate/);
  assert.match(pageSource, /getCompletionLevel\(day\.completionRate, day\.targetTasks\)/);
});
