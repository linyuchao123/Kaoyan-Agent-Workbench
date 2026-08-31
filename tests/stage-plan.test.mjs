import assert from "node:assert/strict";
import test from "node:test";

import { selectSidebarStage, stageDateProgress } from "../app/lib/stage-plan.ts";

function stage(overrides = {}) {
  return {
    id: "stage-1",
    parent_id: null,
    level: "stage",
    title: "基础阶段",
    description: "",
    starts_on: "2026-09-01",
    ends_on: "2026-09-10",
    status: "draft",
    ...overrides,
  };
}

test("sidebar prefers an active stage and ignores archived plans", () => {
  const selected = selectSidebarStage([
    stage({ id: "archived", status: "archived" }),
    stage({ id: "future", starts_on: "2026-10-01", ends_on: "2026-10-31" }),
    stage({ id: "active", status: "active" }),
  ], "2026-08-31");

  assert.equal(selected?.id, "active");
});

test("sidebar falls back to current, nearest future, then latest past stage", () => {
  const plans = [
    stage({ id: "past", starts_on: "2026-07-01", ends_on: "2026-07-31" }),
    stage({ id: "current", starts_on: "2026-08-01", ends_on: "2026-09-15" }),
    stage({ id: "future", starts_on: "2026-10-01", ends_on: "2026-10-31" }),
  ];

  assert.equal(selectSidebarStage(plans, "2026-08-31")?.id, "current");
  assert.equal(selectSidebarStage(plans, "2026-09-20")?.id, "future");
  assert.equal(selectSidebarStage(plans, "2026-12-01")?.id, "future");
});

test("stage date progress is inclusive and safely clamped", () => {
  const plan = stage();
  assert.equal(stageDateProgress(plan, "2026-08-31"), 0);
  assert.equal(stageDateProgress(plan, "2026-09-01"), 10);
  assert.equal(stageDateProgress(plan, "2026-09-05"), 50);
  assert.equal(stageDateProgress(plan, "2026-09-11"), 100);
  assert.equal(stageDateProgress(stage({ status: "completed" }), "2026-08-31"), 100);
});
