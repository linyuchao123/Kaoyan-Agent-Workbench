import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { api, setApiAccessToken } from "../app/lib/api.ts";

const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("阶段计划通过登录身份写入且前端不能指定用户", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (input, init) => {
    requests.push({ input: String(input), init });
    return new Response(JSON.stringify({
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      parent_id: null,
      level: "stage",
      title: "基础阶段",
      description: "完成第一轮基础",
      starts_on: "2026-09-01",
      ends_on: "2027-02-28",
      status: "active",
    }), { status: 201, headers: { "Content-Type": "application/json" } });
  };
  setApiAccessToken("current-user-token");

  try {
    const plan = await api.createPlan({
      level: "stage",
      title: "基础阶段",
      description: "完成第一轮基础",
      starts_on: "2026-09-01",
      ends_on: "2027-02-28",
    });
    assert.equal(plan.level, "stage");
    assert.match(requests[0].input, /\/api\/v1\/plans$/);
    assert.equal(requests[0].init.method, "POST");
    assert.equal(
      new Headers(requests[0].init.headers).get("Authorization"),
      "Bearer current-user-token",
    );
    const payload = JSON.parse(requests[0].init.body);
    assert.equal(payload.title, "基础阶段");
    assert.equal("user_id" in payload, false);
  } finally {
    setApiAccessToken(null);
    globalThis.fetch = originalFetch;
  }
});

test("周计划写入时携带所属阶段但不携带用户编号", async () => {
  const originalFetch = globalThis.fetch;
  let request;

  globalThis.fetch = async (input, init) => {
    request = { input: String(input), init };
    return new Response(JSON.stringify({
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      parent_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      level: "week",
      title: "基础阶段第 1 周",
      description: "建立稳定节奏",
      starts_on: "2026-09-01",
      ends_on: "2026-09-07",
      status: "active",
    }), { status: 201, headers: { "Content-Type": "application/json" } });
  };
  setApiAccessToken("current-user-token");

  try {
    await api.createPlan({
      parent_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      level: "week",
      title: "基础阶段第 1 周",
      description: "建立稳定节奏",
      starts_on: "2026-09-01",
      ends_on: "2026-09-07",
    });
    const payload = JSON.parse(request.init.body);
    assert.equal(payload.parent_id, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    assert.equal(payload.level, "week");
    assert.equal("user_id" in payload, false);
  } finally {
    setApiAccessToken(null);
    globalThis.fetch = originalFetch;
  }
});

test("日计划写入时归属于周计划且起止日期一致", async () => {
  const originalFetch = globalThis.fetch;
  let request;

  globalThis.fetch = async (input, init) => {
    request = { input: String(input), init };
    return new Response(JSON.stringify({
      id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      parent_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      level: "day",
      title: "高数极限专题",
      description: "完成 20 道基础题",
      starts_on: "2026-09-02",
      ends_on: "2026-09-02",
      status: "active",
    }), { status: 201, headers: { "Content-Type": "application/json" } });
  };
  setApiAccessToken("current-user-token");

  try {
    await api.createPlan({
      parent_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      level: "day",
      title: "高数极限专题",
      description: "完成 20 道基础题",
      starts_on: "2026-09-02",
      ends_on: "2026-09-02",
    });
    const payload = JSON.parse(request.init.body);
    assert.equal(payload.parent_id, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    assert.equal(payload.level, "day");
    assert.equal(payload.starts_on, payload.ends_on);
    assert.equal("user_id" in payload, false);
  } finally {
    setApiAccessToken(null);
    globalThis.fetch = originalFetch;
  }
});

test("计划支持修改与删除并正确处理无内容响应", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (input, init) => {
    requests.push({ input: String(input), init });
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return new Response(JSON.stringify({
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      parent_id: null,
      level: "stage",
      title: "基础阶段（已调整）",
      description: "完成第一轮基础",
      starts_on: "2026-09-01",
      ends_on: "2027-02-28",
      status: "active",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  setApiAccessToken("current-user-token");

  try {
    const updated = await api.updatePlan("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", {
      title: "基础阶段（已调整）",
      status: "completed",
    });
    await api.deletePlan("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    assert.equal(updated.title, "基础阶段（已调整）");
    assert.equal(JSON.parse(requests[0].init.body).status, "completed");
    assert.equal(requests[0].init.method, "PATCH");
    assert.equal(requests[1].init.method, "DELETE");
    assert.match(requests[1].input, /\/api\/v1\/plans\/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa$/);
    for (const request of requests) {
      assert.equal(
        new Headers(request.init.headers).get("Authorization"),
        "Bearer current-user-token",
      );
    }
  } finally {
    setApiAccessToken(null);
    globalThis.fetch = originalFetch;
  }
});

test("按需读取单条计划的完成率与实际学习时长", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  globalThis.fetch = async (input) => {
    capturedUrl = String(input);
    return new Response(JSON.stringify({
      plan_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      task_count: 10,
      completed_tasks: 6,
      completion_rate: 60,
      actual_minutes: 720,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const progress = await api.planProgress("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    assert.equal(progress.completion_rate, 60);
    assert.equal(progress.actual_minutes, 720);
    assert.match(capturedUrl, /\/api\/v1\/plans\/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\/progress$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("三级计划写入期间防止重复请求并提供中文云端反馈", () => {
  assert.match(pageSource, /async function createStage[\s\S]*?if \(busy\) return;/);
  assert.match(pageSource, /async function createWeek[\s\S]*?if \(weekBusy\) return;/);
  assert.match(pageSource, /async function createDay[\s\S]*?if \(dayBusy\) return;/);
  assert.match(pageSource, /async function savePlanEdit[\s\S]*?if \(editBusy\) return;/);
  assert.match(pageSource, /async function removePlan[\s\S]*?if \(deleteBusyId\) return;/);
  assert.match(pageSource, /studyWriteErrorMessage\(error, "保存阶段计划"\)/);
  assert.match(pageSource, /studyWriteErrorMessage\(error, "修改计划"\)/);
  assert.match(pageSource, /studyWriteErrorMessage\(error, "删除计划"\)/);
  assert.match(pageSource, /deleteBusyId === stage\.id \? "删除中…" : "删除"/);
});
