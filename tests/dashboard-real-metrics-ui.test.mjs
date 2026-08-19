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

test("今日接口声明真实仪表盘指标类型", () => {
  assert.match(apiSource, /export type DashboardMetrics/);
  assert.match(apiSource, /today: \(\) => request<ApiTodaySnapshot>/);
});
