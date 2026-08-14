import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("Agent 页面可以开始新对话并清除旧线程编号", () => {
  assert.match(pageSource, /function startNewConversation\(\)/);
  assert.match(pageSource, /setThreadId\(undefined\)/);
  assert.match(pageSource, /＋ 新建对话/);
});

test("存在待确认提案时不会隐藏提案并切换对话", () => {
  assert.match(pageSource, /proposal\.status === "pending" \|\| proposal\.status === "edited"/);
  assert.match(pageSource, /请先批准或拒绝，再开始新对话/);
});

test("Agent 页面展示历史对话并允许读取指定线程", () => {
  assert.match(pageSource, /aria-label="历史对话"/);
  assert.match(pageSource, /api\.listAgentThreads\(\)/);
  assert.match(pageSource, /api\.getAgentThread\(selectedThreadId\)/);
});

test("Agent 长请求可以停止等待且不会宣称服务端已经终止", () => {
  assert.match(pageSource, /new AbortController\(\)/);
  assert.match(pageSource, /agentRequest\.current\?\.abort\(\)/);
  assert.match(pageSource, /停止等待/);
  assert.match(pageSource, /服务端可能仍在安全完成分析/);
});

test("Agent 新消息自动滚动并支持复制回答", () => {
  assert.match(pageSource, /messageListRef/);
  assert.match(pageSource, /messageList\.scrollTop = messageList\.scrollHeight/);
  assert.match(pageSource, /navigator\.clipboard\.writeText\(text\)/);
  assert.match(pageSource, /复制回答/);
});
