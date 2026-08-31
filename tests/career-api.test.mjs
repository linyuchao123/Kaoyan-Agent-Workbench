import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { api, setApiAccessToken } from "../app/lib/api.ts";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("求职记录支持按类型和状态筛选", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedHeaders;
  globalThis.fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedHeaders = new Headers(init?.headers);
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  };
  setApiAccessToken("current-user-token");

  try {
    await api.listCareerItems("application", "submitted");
    const url = new URL(capturedUrl);
    assert.equal(url.pathname, "/api/v1/career-items");
    assert.equal(url.searchParams.get("item_type"), "application");
    assert.equal(url.searchParams.get("status"), "submitted");
    assert.equal(capturedHeaders.get("Authorization"), "Bearer current-user-token");
  } finally {
    setApiAccessToken(null);
    globalThis.fetch = originalFetch;
  }
});

test("求职记录增删改使用当前登录身份且不允许前端指定用户", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const responseItem = {
    id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    item_type: "application",
    title: "AI 应用开发实习",
    company: "杭州示例科技",
    status: "submitted",
    occurred_on: "2026-12-20",
    notes: "已投递",
  };
  globalThis.fetch = async (input, init) => {
    requests.push({ input: String(input), init });
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return new Response(JSON.stringify(responseItem), {
      status: init?.method === "POST" ? 201 : 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  setApiAccessToken("current-user-token");

  try {
    const created = await api.createCareerItem({
      item_type: "application",
      title: "AI 应用开发实习",
      company: "杭州示例科技",
      status: "submitted",
      occurred_on: "2026-12-20",
      notes: "已投递",
    });
    await api.updateCareerItem(created.id, { status: "interviewing", notes: "等待技术面" });
    await api.deleteCareerItem(created.id);

    const createPayload = JSON.parse(requests[0].init.body);
    assert.equal(createPayload.title, "AI 应用开发实习");
    assert.equal("user_id" in createPayload, false);
    assert.equal(requests[0].init.method, "POST");
    assert.equal(requests[1].init.method, "PATCH");
    assert.deepEqual(JSON.parse(requests[1].init.body), { status: "interviewing", notes: "等待技术面" });
    assert.equal(requests[2].init.method, "DELETE");
    for (const request of requests) {
      assert.equal(new Headers(request.init.headers).get("Authorization"), "Bearer current-user-token");
    }
  } finally {
    setApiAccessToken(null);
    globalThis.fetch = originalFetch;
  }
});

test("求职记录写入期间防止重复请求并显示中文云端反馈", () => {
  assert.match(pageSource, /async function saveItem[\s\S]*?if \(busy\) return;/);
  assert.match(pageSource, /async function removeItem[\s\S]*?if \(deleteBusyId\) return;/);
  assert.match(pageSource, /studyWriteErrorMessage\(error, editingItem \? "修改求职记录" : "保存求职记录"\)/);
  assert.match(pageSource, /studyWriteErrorMessage\(error, "删除求职记录"\)/);
  assert.match(pageSource, /deleteBusyId === item\.id \? "删除中…" : "删除"/);
});
