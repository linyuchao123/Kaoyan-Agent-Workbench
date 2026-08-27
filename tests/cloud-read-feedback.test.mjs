import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("云端只读页面统一隐藏英文技术错误并提供中文恢复建议", () => {
  assert.match(pageSource, /function cloudReadErrorMessage\(error: unknown, resource: string\)/);
  assert.match(pageSource, /登录状态已失效，请重新登录/);
  assert.match(pageSource, /无法连接本地后端，请确认 8000 端口服务已启动/);
  assert.match(pageSource, /已有云端数据不会受到影响/);
  for (const resource of ["计划", "计划统计", "学科统计", "院校情报", "求职记录", "搜索数据", "待处理事项"]) {
    assert.match(pageSource, new RegExp(`cloudReadErrorMessage\\(error, "${resource}"\\)`));
  }
});
