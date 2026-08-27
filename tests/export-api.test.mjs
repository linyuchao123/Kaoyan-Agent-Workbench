import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { api, setApiAccessToken } from "../app/lib/api.ts";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

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

test("数据导出期间防止重复请求并显示中文安全反馈", () => {
  assert.match(pageSource, /async function exportData\(\) \{\s*if \(busy\) return;/);
  assert.match(pageSource, /setStatus\(exportRequestErrorMessage\(error\)\)/);
  assert.match(pageSource, /导出失败：登录状态已失效，请重新登录/);
  assert.match(pageSource, /导出失败：无法连接本地后端，请确认 8000 端口服务已启动/);
  assert.match(pageSource, /本次导出没有修改任何云端学习数据/);
  assert.match(pageSource, /<select value=\{format\} disabled=\{busy\}/);
});
