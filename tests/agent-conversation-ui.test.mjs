import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const proposalSource = await readFile(new URL("../app/components/agent-proposal-card.tsx", import.meta.url), "utf8");

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

test("Agent 页面展示可刷新的云端能力状态", () => {
  assert.match(pageSource, /aria-label="云端能力状态"/);
  assert.match(pageSource, /重新检查配置/);
  assert.match(pageSource, /primary_model_configured/);
  assert.match(pageSource, /fallback_model_configured/);
  assert.match(pageSource, /embedding_configured/);
  assert.match(pageSource, /ocr\.configured/);
  assert.match(pageSource, /未配置 Tavily Key，不会生成虚假网络来源/);
});

test("Agent 今日计划提案可审阅并编辑多项任务", () => {
  assert.match(pageSource, /生成今天的学习计划/);
  assert.match(proposalSource, /proposal\.action === "create_daily_tasks"/);
  assert.match(proposalSource, /批准后一次性写入/);
  assert.match(proposalSource, /合计 \{draftMinutes\} \/ 240 分钟/);
  assert.match(proposalSource, /＋ 添加任务/);
  assert.match(proposalSource, /移除/);
});

test("Agent 请求失败会区分登录、限流、云端异常和后端未启动", () => {
  assert.match(pageSource, /function agentRequestErrorMessage/);
  assert.match(pageSource, /error instanceof ApiError/);
  assert.match(pageSource, /登录状态已失效，请重新登录后重试/);
  assert.match(pageSource, /模型服务请求过于频繁或额度不足/);
  assert.match(pageSource, /云端模型或检索服务暂时不可用/);
  assert.match(pageSource, /无法连接后端服务，请确认本地后端已在 8000 端口启动/);
  assert.match(pageSource, /本次请求没有写入学习数据/);
});

test("Agent 恢复历史会话时保留模型档位和消息模型元数据", () => {
  assert.match(pageSource, /setModelProfile\(thread\.model_profile\)/);
  assert.match(pageSource, /restoredAgentModel\(message\.metadata\)/);
  assert.match(pageSource, /setModelProfile\("flash"\)/);
});
