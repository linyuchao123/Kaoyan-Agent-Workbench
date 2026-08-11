import assert from "node:assert/strict";
import test from "node:test";

import { api, setApiAccessToken } from "../app/lib/api.ts";

test("创建任务时可以关联日计划且不能指定用户", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (input, init) => {
    captured = { input: String(input), init };
    return new Response(JSON.stringify({
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      plan_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      title: "极限基础题",
      subject: "math",
      planned_minutes: 30,
      due_at: null,
      completed: false,
    }), { status: 201, headers: { "Content-Type": "application/json" } });
  };
  setApiAccessToken("current-user-token");

  try {
    const task = await api.createTask({
      title: "极限基础题",
      subject: "math",
      planned_minutes: 30,
      plan_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    });
    const body = JSON.parse(captured.init.body);
    assert.equal(task.plan_id, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    assert.equal(body.plan_id, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    assert.equal("user_id" in body, false);
    assert.equal(new Headers(captured.init.headers).get("Authorization"), "Bearer current-user-token");
  } finally {
    setApiAccessToken(null);
    globalThis.fetch = originalFetch;
  }
});
