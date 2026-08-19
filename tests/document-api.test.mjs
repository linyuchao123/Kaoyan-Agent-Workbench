import assert from "node:assert/strict";
import test from "node:test";

import { api, setApiAccessToken } from "../app/lib/api.ts";

const documentRecord = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  title: "408 数据结构笔记",
  original_filename: "408-数据结构.md",
  source_type: "upload",
  source_url: null,
  content_type: "text/markdown",
  byte_size: 1024,
  sha256: "document-sha256",
  storage_path: "current-user/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/408-数据结构.md",
  version: 1,
  ingestion_status: "ready",
  ingestion_error: null,
  created_at: "2026-08-12T00:00:00Z",
  updated_at: "2026-08-12T00:00:00Z",
};

test("资料列表读取当前账户的云端记录", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (input, init) => {
    request = { input: String(input), init };
    return new Response(JSON.stringify([documentRecord]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  setApiAccessToken("current-user-token");

  try {
    const documents = await api.listDocuments();
    assert.equal(documents.length, 1);
    assert.equal(documents[0].original_filename, "408-数据结构.md");
    assert.match(request.input, /\/api\/v1\/documents$/);
    assert.equal(new Headers(request.init.headers).get("Authorization"), "Bearer current-user-token");
  } finally {
    setApiAccessToken(null);
    globalThis.fetch = originalFetch;
  }
});

test("资料上传使用 multipart 表单并携带当前登录身份", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (input, init) => {
    request = { input: String(input), init };
    return new Response(JSON.stringify({
      ...documentRecord,
      chunk_count: 3,
      flagged_chunk_count: 0,
      duplicate: false,
    }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  };
  setApiAccessToken("current-user-token");

  try {
    const file = new File(["# 408 数据结构"], "408-数据结构.md", { type: "text/markdown" });
    const uploaded = await api.uploadDocument(file);
    const headers = new Headers(request.init.headers);

    assert.equal(uploaded.chunk_count, 3);
    assert.equal(request.init.method, "POST");
    assert.ok(request.init.body instanceof FormData);
    assert.equal(request.init.body.get("file").name, "408-数据结构.md");
    assert.equal(headers.get("Authorization"), "Bearer current-user-token");
    assert.equal(headers.has("Content-Type"), false);
  } finally {
    setApiAccessToken(null);
    globalThis.fetch = originalFetch;
  }
});

test("私有资料检索编码查询参数并携带当前登录身份", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (input, init) => {
    request = { input: String(input), init };
    return new Response(JSON.stringify([{
      chunk_id: 9,
      document_id: documentRecord.id,
      title: "408 数据结构笔记",
      heading: "线性表",
      page_number: null,
      locator: "线性表 · 片段 1",
      content: "顺序表支持按下标随机访问。",
      score: 1,
    }]), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  setApiAccessToken("current-user-token");

  try {
    const sources = await api.searchPrivateKnowledge("顺序表 随机访问", documentRecord.id);
    const url = new URL(request.input);
    assert.equal(sources[0].locator, "线性表 · 片段 1");
    assert.equal(url.pathname, "/api/v1/knowledge/private-search");
    assert.equal(url.searchParams.get("query"), "顺序表 随机访问");
    assert.equal(url.searchParams.get("document_id"), documentRecord.id);
    assert.equal(new Headers(request.init.headers).get("Authorization"), "Bearer current-user-token");
  } finally {
    setApiAccessToken(null);
    globalThis.fetch = originalFetch;
  }
});

test("网页资料只有确认后才调用批准入库接口", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ input: String(input), init });
    if (String(input).endsWith("/api/v1/documents/import-preview")) {
      return new Response(JSON.stringify({
        id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        url: "https://example.edu/guide",
        title: "待导入网络资料",
        summary: "确认后导入",
        content_type: "text/html",
        estimated_bytes: null,
        status: "pending",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({
      proposal: { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", status: "approved" },
      document: { ...documentRecord, source_type: "web", source_url: "https://example.edu/guide" },
      duplicate: false,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  setApiAccessToken("current-user-token");

  try {
    const preview = await api.previewImport("https://example.edu/guide");
    assert.equal(requests.length, 1, "生成预览时不应自动批准下载");
    await api.approveImport(preview.id);
    assert.equal(requests.length, 2);
    assert.match(requests[1].input, /\/import-proposals\/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb\/approve$/);
    assert.equal(requests[1].init.method, "POST");
    assert.equal(new Headers(requests[1].init.headers).get("Authorization"), "Bearer current-user-token");
    assert.doesNotMatch(String(requests[1].init.body), /user_id/);
  } finally {
    setApiAccessToken(null);
    globalThis.fetch = originalFetch;
  }
});

test("Agent 提案编辑只提交允许修改的任务字段", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (input, init) => {
    request = { input: String(input), init };
    return new Response(JSON.stringify({
      id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      agent: "coach",
      action: "create_review_task",
      payload: { title: "线性代数错题复盘", subject: "math", planned_minutes: 75 },
      summary: "创建复习任务",
      idempotency_key: "proposal-key",
      status: "edited",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  setApiAccessToken("current-user-token");

  try {
    await api.decideProposal("cccccccc-cccc-cccc-cccc-cccccccccccc", "edit", {
      title: "线性代数错题复盘",
      subject: "math",
      planned_minutes: 75,
    });
    assert.match(request.input, /\/api\/v1\/proposals\/cccccccc-cccc-cccc-cccc-cccccccccccc\/edit$/);
    assert.equal(request.init.method, "POST");
    assert.equal(new Headers(request.init.headers).get("Authorization"), "Bearer current-user-token");
    assert.deepEqual(JSON.parse(request.init.body), {
      title: "线性代数错题复盘",
      subject: "math",
      planned_minutes: 75,
    });
    assert.doesNotMatch(request.init.body, /user_id/);
  } finally {
    setApiAccessToken(null);
    globalThis.fetch = originalFetch;
  }
});

test("Agent 页面可读取当前账户的待审批提案", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (input, init) => {
    request = { input: String(input), init };
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  setApiAccessToken("current-user-token");

  try {
    await api.listPendingProposals();
    assert.match(request.input, /\/api\/v1\/proposals\?limit=10$/);
    assert.equal(new Headers(request.init.headers).get("Authorization"), "Bearer current-user-token");
    assert.doesNotMatch(request.input, /user_id/);
  } finally {
    setApiAccessToken(null);
    globalThis.fetch = originalFetch;
  }
});

test("Agent 页面可恢复当前账户最近一次对话", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (input, init) => {
    request = { input: String(input), init };
    return new Response("null", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  setApiAccessToken("agent-history-token");

  try {
    const history = await api.latestAgentThread();
    assert.equal(history, null);
    assert.match(request.input, /\/api\/v1\/agents\/threads\/latest$/);
    assert.equal(new Headers(request.init.headers).get("Authorization"), "Bearer agent-history-token");
    assert.doesNotMatch(request.input, /user_id/);
  } finally {
    setApiAccessToken(null);
    globalThis.fetch = originalFetch;
  }
});

test("Agent 页面可列出并读取当前账户的历史对话", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ input: String(input), init });
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  setApiAccessToken("agent-thread-token");

  try {
    await api.listAgentThreads();
    await api.getAgentThread("11111111-1111-1111-1111-111111111111");
    assert.match(requests[0].input, /\/api\/v1\/agents\/threads\?limit=20$/);
    assert.match(requests[1].input, /\/api\/v1\/agents\/threads\/11111111-1111-1111-1111-111111111111$/);
    for (const request of requests) {
      assert.equal(new Headers(request.init.headers).get("Authorization"), "Bearer agent-thread-token");
      assert.doesNotMatch(request.input, /user_id/);
    }
  } finally {
    setApiAccessToken(null);
    globalThis.fetch = originalFetch;
  }
});

test("Agent 请求支持传入取消信号", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (input, init) => {
    request = { input: String(input), init };
    return new Response(JSON.stringify({
      thread_id: "22222222-2222-2222-2222-222222222222",
      answer: "已完成分析",
      route: "coach",
      retrieval_mode: "none",
      model_status: "fallback",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      model_profile: "flash",
      fallback_used: false,
      sources: [],
      proposal: null,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const controller = new AbortController();

  try {
    await api.runAgent("coach", "安排今天的复习", "flash", undefined, controller.signal);
    assert.equal(request.init.signal, controller.signal);
    assert.deepEqual(JSON.parse(request.init.body), {
      message: "安排今天的复习",
      model_profile: "flash",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
