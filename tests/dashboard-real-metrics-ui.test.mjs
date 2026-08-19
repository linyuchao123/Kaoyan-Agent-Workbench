import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../app/lib/api.ts", import.meta.url), "utf8");

test("首页周完成率和连续学习读取云端摘要", () => {
  assert.match(pageSource, /snapshot\.metrics/);
  assert.match(pageSource, /dashboardMetrics\.weekly_completion_rate/);
  assert.match(pageSource, /dashboardMetrics\.current_streak_days/);
  assert.match(pageSource, /dashboardMetrics\.longest_streak_days/);
  assert.doesNotMatch(pageSource, /<span>本周完成率<\/span><strong>68/);
});

test("首页阶段名称和今日目标来自真实计划", () => {
  assert.match(pageSource, /dashboardMetrics\?\.active_stage_title/);
  assert.match(pageSource, /dashboardMetrics\?\.today_planned_minutes/);
  assert.doesNotMatch(pageSource, /目标 6 小时/);
  assert.match(apiSource, /today_planned_minutes:\s*number/);
  assert.match(apiSource, /active_stage_title:\s*string \| null/);
});

test("今日接口声明真实仪表盘指标类型", () => {
  assert.match(apiSource, /export type DashboardMetrics/);
  assert.match(apiSource, /today: \(\) => request<ApiTodaySnapshot>/);
});
