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

test("Agent 流式请求可以停止生成且不会写入未完成回答", () => {
  assert.match(pageSource, /new AbortController\(\)/);
  assert.match(pageSource, /agentRequest\.current\?\.abort\(\)/);
  assert.match(pageSource, /停止等待/);
  assert.match(pageSource, /本次未完整回答不会写入对话历史/);
  assert.match(pageSource, /api\.runAgentStream/);
});

test("Agent 新消息自动滚动并支持复制回答", () => {
  assert.match(pageSource, /messageListRef/);
  assert.match(pageSource, /messageList\.scrollTop = messageList\.scrollHeight/);
  assert.match(pageSource, /navigator\.clipboard\.writeText\(text\)/);
  assert.match(pageSource, /复制回答/);
});

test("Agent 页面允许手动选择双模型档位并展示实际来源", () => {
  assert.match(pageSource, /value=\{modelProfile\}/);
  assert.match(pageSource, /DeepSeek Flash · 快速/);
  assert.match(pageSource, /DeepSeek Pro · 深度/);
  assert.match(pageSource, /onModel: \(metadata\)/);
  assert.match(pageSource, /Qwen 备用/);
});

test("Agent 恢复历史会话时保留模型档位和消息模型元数据", () => {
  assert.match(pageSource, /setModelProfile\(thread\.model_profile\)/);
  assert.match(pageSource, /restoredAgentModel\(message\.metadata\)/);
  assert.match(pageSource, /setModelProfile\("flash"\)/);
});
