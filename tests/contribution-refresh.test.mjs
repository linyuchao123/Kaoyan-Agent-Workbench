import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("云端学习记录变化后会重新请求热力图统计", () => {
  assert.match(
    pageSource,
    /function StudyHeatmap\(\{ isDemo, refreshVersion \}/,
    "热力图应接收刷新版本",
  );
  assert.match(
    pageSource,
    /\[isDemo, queryKey, refreshVersion, scope, year\]/,
    "刷新版本变化后应重新请求贡献数据",
  );

  const refreshCalls = pageSource.match(
    /setContributionRevision\(\(value\) => value \+ 1\);/g,
  );
  assert.equal(
    refreshCalls?.length,
    6,
    "任务状态、任务删除、计时记录、手动补录、学习记录删除和错题录入成功后都应刷新热力图",
  );
});
