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
