import assert from "node:assert/strict";
import test from "node:test";

import { api, setApiAccessToken } from "../app/lib/api.ts";

test("院校情报支持按年份和梯度筛选", async () => {
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
    await api.listSchoolOptions("stretch", 2028);
    const url = new URL(capturedUrl);
    assert.equal(url.pathname, "/api/v1/schools");
    assert.equal(url.searchParams.get("tier"), "stretch");
    assert.equal(url.searchParams.get("exam_year"), "2028");
    assert.equal(capturedHeaders.get("Authorization"), "Bearer current-user-token");
  } finally {
    setApiAccessToken(null);
    globalThis.fetch = originalFetch;
  }
});

test("创建和删除院校档案使用当前登录身份且不能指定用户", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ input: String(input), init });
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return new Response(JSON.stringify({
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      tier: "match",
      university: "苏州大学",
      college: "计算机科学与技术学院",
      major_code: "085405",
      major_name: "软件工程",
      degree_type: "professional",
      exam_year: 2028,
      exam_subjects: ["101 政治", "201 英语一", "301 数学一", "408"],
      tuition_total: null,
      duration_years: null,
      location: "苏州",
      source_url: "https://example.edu.cn/admissions/2028",
      source_checked_at: "2026-08-12T00:00:00Z",
      notes: "等待 2028 招生目录复核",
    }), { status: 201, headers: { "Content-Type": "application/json" } });
  };
  setApiAccessToken("current-user-token");

  try {
    const created = await api.createSchoolOption({
      tier: "match",
      university: "苏州大学",
      college: "计算机科学与技术学院",
      major_code: "085405",
      major_name: "软件工程",
      degree_type: "professional",
      exam_year: 2028,
      exam_subjects: ["101 政治", "201 英语一", "301 数学一", "408"],
      location: "苏州",
      source_url: "https://example.edu.cn/admissions/2028",
      notes: "等待 2028 招生目录复核",
    });
    await api.deleteSchoolOption(created.id);

    const payload = JSON.parse(requests[0].init.body);
    assert.equal(payload.university, "苏州大学");
    assert.equal("user_id" in payload, false);
    assert.equal(requests[0].init.method, "POST");
    assert.equal(requests[1].init.method, "DELETE");
    assert.match(requests[1].input, /\/api\/v1\/schools\/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa$/);
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
