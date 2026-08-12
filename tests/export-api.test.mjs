import assert from "node:assert/strict";
import test from "node:test";

import { api, setApiAccessToken } from "../app/lib/api.ts";

test("个人数据导出携带登录身份并读取服务端文件名", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedHeaders;
  globalThis.fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedHeaders = new Headers(init?.headers);
    return new Response("# 研途学习工作台数据导出", {
      status: 200,
      headers: {
        "Content-Type": "text/markdown",
        "Content-Disposition": 'attachment; filename="yantu-export-2026-08-12.md"',
      },
    });
  };
  setApiAccessToken("current-user-token");

  try {
    const result = await api.exportData("markdown");
    const url = new URL(capturedUrl);
    assert.equal(url.pathname, "/api/v1/export");
    assert.equal(url.searchParams.get("format"), "markdown");
    assert.equal(capturedHeaders.get("Authorization"), "Bearer current-user-token");
    assert.equal(result.filename, "yantu-export-2026-08-12.md");
    assert.equal(await result.blob.text(), "# 研途学习工作台数据导出");
  } finally {
    setApiAccessToken(null);
    globalThis.fetch = originalFetch;
  }
});
