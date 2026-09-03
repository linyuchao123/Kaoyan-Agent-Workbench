import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("私有资料检索支持限定单份资料", () => {
  assert.match(pageSource, /aria-label="限定检索资料"/);
  assert.match(pageSource, /searchPrivateKnowledge\(query, selectedDocumentId \|\| undefined\)/);
});

test("检索结果默认展示摘要并支持展开上下文", () => {
  assert.match(pageSource, /source\.snippet \|\| source\.content/);
  assert.match(pageSource, /展开上下文/);
  assert.match(pageSource, /收起上下文/);
});

test("检索结果高亮匹配词并标明检索模式", () => {
  assert.match(pageSource, /function HighlightedSearchText/);
  assert.match(pageSource, /source\.matched_terms/);
  assert.match(pageSource, /source\.retrieval_mode === "hybrid"/);
});

test("资料列表支持重新解析并自动轮询 OCR 状态", () => {
  assert.match(pageSource, /api\.reindexDocument\(document\.id\)/);
  assert.match(pageSource, /分块 v\{doc\.chunking_version/);
  assert.match(pageSource, /window\.setInterval/);
  assert.match(pageSource, /页面会自动刷新处理状态/);
});

test("资料列表解释每个处理阶段并提供可操作失败提示", () => {
  assert.match(pageSource, /function documentIngestionCopy/);
  assert.match(pageSource, /正在提取原文、切分片段并生成检索索引/);
  assert.match(pageSource, /已识别为扫描 PDF，正在等待逐页文字识别/);
  assert.match(pageSource, /处理建议：确认文件可正常打开、云端模型额度充足后重新处理/);
  assert.match(pageSource, /function materialRequestErrorMessage/);
});

test("资料库可以安全打开 PDF 或 Markdown 电子书", () => {
  assert.match(pageSource, /api\.readDocumentContent\(document\.id\)/);
  assert.match(pageSource, /URL\.createObjectURL\(blob\)/);
  assert.match(pageSource, /URL\.revokeObjectURL\(readerUrl\)/);
  assert.match(pageSource, /aria-label="关闭阅读器"/);
  assert.match(pageSource, /<iframe title=\{readerDocument\.title\}/);
  assert.match(pageSource, /<pre>\{readerText\}<\/pre>/);
});
