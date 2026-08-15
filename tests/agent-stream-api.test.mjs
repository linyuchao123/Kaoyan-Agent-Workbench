import assert from "node:assert/strict";
import test from "node:test";

import { api, setApiAccessToken } from "../app/lib/api.ts";

test("Agent SSE 流可跨任意网络分片逐段解析", async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  const chunks = [
    "event: status\r",
    "\ndata: {\"message\":\"正在读取资料\"}\r\n\r",
    "\nevent: model\ndata: {\"provider\":\"deepseek\",\"model\":\"deepseek-v4-pro\",\"model_profile\":\"pro\",\"fallback_used\":false}\n\nevent: delta\ndata: {\"text\":\"第一段\"}\n\nevent: del",
    "ta\ndata: {\"text\":\"第二段\"}\n\nevent: done\ndata: {\"thread_id\":\"thread-1\",\"answer\":\"第一段第二段\",\"route\":\"tutor\",\"retrieval_mode\":\"private\",\"model_status\":\"generated\",\"provider\":\"deepseek\",\"model\":\"deepseek-v4-pro\",\"model_profile\":\"pro\",\"fallback_used\":false,\"sources\":[],\"proposal\":null}\n\n",
  ];
  const statuses = [];
  const models = [];
  const deltas = [];
  const controller = new AbortController();
  let capturedRequest;

  setApiAccessToken("stream-token");
  globalThis.fetch = async (input, init) => {
    capturedRequest = { input: String(input), init };
    return new Response(new ReadableStream({
      start(streamController) {
        for (const chunk of chunks) streamController.enqueue(encoder.encode(chunk));
        streamController.close();
      },
    }), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  };

  try {
    const result = await api.runAgentStream("tutor", "根据我的资料解释二叉树", undefined, "pro", {
      onStatus: (message) => statuses.push(message),
      onModel: (metadata) => models.push(metadata),
      onDelta: (text) => deltas.push(text),
    }, controller.signal);

    assert.deepEqual(statuses, ["正在读取资料"]);
    assert.deepEqual(models, [{ provider: "deepseek", model: "deepseek-v4-pro", model_profile: "pro", fallback_used: false }]);
    assert.deepEqual(deltas, ["第一段", "第二段"]);
    assert.equal(result.answer, "第一段第二段");
    assert.equal(result.thread_id, "thread-1");
    assert.match(capturedRequest.input, /\/api\/v1\/agents\/tutor\/runs\/stream$/);
    assert.equal(capturedRequest.init.headers.get("Authorization"), "Bearer stream-token");
    assert.equal(capturedRequest.init.headers.get("Accept"), "text/event-stream");
    assert.equal(capturedRequest.init.signal, controller.signal);
    assert.deepEqual(JSON.parse(capturedRequest.init.body), {
      message: "根据我的资料解释二叉树",
      model_profile: "pro",
    });
  } finally {
    globalThis.fetch = originalFetch;
    setApiAccessToken(null);
  }
});

test("Agent SSE 在未收到完成事件时明确报错", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("event: delta\ndata: {\"text\":\"未完成\"}\n\n", {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });

  try {
    await assert.rejects(
      api.runAgentStream("coach", "制定计划", undefined, "flash", {}),
      /Agent stream ended before completion/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
