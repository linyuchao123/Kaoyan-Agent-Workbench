import assert from "node:assert/strict";
import test from "node:test";

import { createShanghaiStudyInterval } from "../app/lib/study-time.ts";

test("手动补录时间按上海时区转换并计算有效分钟", () => {
  const interval = createShanghaiStudyInterval("2026-08-11", "19:00", "20:30");

  assert.equal(interval.startedAt.toISOString(), "2026-08-11T11:00:00.000Z");
  assert.equal(interval.endedAt.toISOString(), "2026-08-11T12:30:00.000Z");
  assert.equal(interval.effectiveMinutes, 90);
});

test("手动补录拒绝结束时间不晚于开始时间", () => {
  assert.throws(
    () => createShanghaiStudyInterval("2026-08-11", "20:00", "19:00"),
    /结束时间必须晚于开始时间/,
  );
});
