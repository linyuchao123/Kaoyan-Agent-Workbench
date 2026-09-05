import assert from "node:assert/strict";
import test from "node:test";

import { localRagBundleKey, searchLocalRagChunks } from "../app/lib/local-rag.ts";

const chunks = [
  { chunk_index: 2, heading: "线性表", page_number: 8, locator: "第 8 页", content: "链表适合频繁插入和删除。" },
  { chunk_index: 1, heading: "顺序表", page_number: 3, locator: "第 3 页", content: "顺序表支持随机访问，顺序表需要连续空间。" },
  { chunk_index: 3, heading: "树", page_number: 12, locator: "第 12 页", content: "二叉树可以递归遍历。" },
];

test("本地 RAG 按关键词命中次数排序并限制结果数", () => {
  const results = searchLocalRagChunks(chunks, "顺序表 链表", 2);
  assert.deepEqual(results.map((item) => item.chunk_index), [1, 2]);
});

test("本地 RAG 对空查询和无匹配查询返回空结果", () => {
  assert.deepEqual(searchLocalRagChunks(chunks, "   "), []);
  assert.deepEqual(searchLocalRagChunks(chunks, "概率论"), []);
});

test("本地 RAG 缓存键按账户隔离", () => {
  assert.notEqual(localRagBundleKey("user-one", "doc-one"), localRagBundleKey("user-two", "doc-one"));
  assert.equal(localRagBundleKey("user-one", "doc-one"), "user-one:doc-one");
});
