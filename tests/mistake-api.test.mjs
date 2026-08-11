import assert from "node:assert/strict";
import test from "node:test";

import { api, setApiAccessToken } from "../app/lib/api.ts";

test("错题录入、到期查询和复习反馈均携带当前登录身份", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const card = {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    subject: "cs408",
    title: "二叉树非递归遍历",
    question: "写出中序遍历的栈实现",
    answer: "",
    error_reason: "忘记转向右子树",
    mastery: 1,
    next_review_at: "2026-08-11T01:00:00Z",
    review_count: 0,
  };
  globalThis.fetch = async (input, init = {}) => {
    requests.push({ input: String(input), init });
    if (String(input).includes("/reviews")) {
      return new Response(JSON.stringify({ ...card, mastery: 2, review_count: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify(init.method === "POST" ? card : [card]), {
      status: init.method === "POST" ? 201 : 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  setApiAccessToken("current-user-token");

  try {
    const due = await api.listMistakes(true);
    const created = await api.createMistake({
      subject: "cs408",
      title: card.title,
      question: card.question,
      error_reason: card.error_reason,
    });
    const reviewed = await api.reviewMistake(card.id, "good");
    assert.equal(due.length, 1);
    assert.equal(created.id, card.id);
    assert.equal(reviewed.mastery, 2);
    assert.match(requests[0].input, /\/api\/v1\/mistakes\?due_only=true$/);
    assert.match(requests[2].input, /\/api\/v1\/mistakes\/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\/reviews$/);
    assert.deepEqual(JSON.parse(requests[2].init.body), { result: "good" });
    for (const request of requests) {
      assert.equal(new Headers(request.init.headers).get("Authorization"), "Bearer current-user-token");
    }
  } finally {
    setApiAccessToken(null);
    globalThis.fetch = originalFetch;
  }
});
