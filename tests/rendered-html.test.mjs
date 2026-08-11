import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("服务端明确渲染云端认证或离线演示启动状态", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /研途/);
  assert.match(html, /AI 考研工作台/);
  const isCloudBoot = html.includes("正在恢复登录状态");
  const isDemoBoot = html.includes("离线演示模式");
  assert.notEqual(isCloudBoot, isDemoBoot, "页面必须明确处于云端认证或离线演示状态之一");
  if (isDemoBoot) {
    assert.match(html, /离线演示数据/);
    assert.doesNotMatch(html, /Supabase 云端同步已连接/);
  }
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/);
});
