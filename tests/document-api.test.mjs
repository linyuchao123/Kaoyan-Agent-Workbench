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
