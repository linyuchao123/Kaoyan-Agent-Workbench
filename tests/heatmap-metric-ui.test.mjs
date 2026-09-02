import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../app/lib/api.ts", import.meta.url), "utf8");
const heatmapSource = readFileSync(new URL("../app/components/study-heatmap.tsx", import.meta.url), "utf8");

test("热力图默认展示目标完成度并可切换有效学习时长", () => {
  assert.match(heatmapSource, /useState<HeatmapMetric>\("completion"\)/);
  assert.match(heatmapSource, /aria-label="选择热力图指标"/);
  assert.match(heatmapSource, /aria-pressed=\{metric === "completion"\}/);
  assert.match(heatmapSource, /目标完成度/);
  assert.match(heatmapSource, /有效学习时长/);
});

test("目标完成度使用真实目标数而不是完成数量猜测百分比", () => {
  assert.match(apiSource, /target_tasks: number/);
  assert.match(apiSource, /completed_target_tasks: number/);
  assert.match(apiSource, /task_completion_rate: number/);
  assert.match(heatmapSource, /day\.task_completion_rate/);
  assert.match(heatmapSource, /getCompletionLevel\(day\.completionRate, day\.targetTasks\)/);
});

test("首页通过独立组件渲染学习热力图", () => {
  assert.match(pageSource, /import \{ StudyHeatmap \} from "\.\/components\/study-heatmap"/);
  assert.match(pageSource, /<StudyHeatmap isDemo=\{isDemo\} refreshVersion=\{contributionRevision\} \/>/);
});
