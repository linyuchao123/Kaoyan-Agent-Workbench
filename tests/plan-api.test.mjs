import assert from "node:assert/strict";
import test from "node:test";

import { api, setApiAccessToken } from "../app/lib/api.ts";

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
