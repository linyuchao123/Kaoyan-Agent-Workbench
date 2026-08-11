import assert from "node:assert/strict";
import test from "node:test";

import {
  ApiError,
  api,
  setApiAccessToken,
  setApiAuthFailureHandler,
} from "../app/lib/api.ts";

test("a 401 API response clears authentication and requests login recovery", async () => {
  const originalFetch = globalThis.fetch;
  let authFailureCount = 0;
  let authorizationHeader = "";

  globalThis.fetch = async (_input, init) => {
    authorizationHeader = new Headers(init?.headers).get("Authorization") ?? "";
    return new Response(JSON.stringify({ detail: "expired or invalid access token" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  };
  setApiAccessToken("expired-token");
  setApiAuthFailureHandler(() => {
    authFailureCount += 1;
  });

  try {
    await assert.rejects(
      api.today(),
      (error) =>
        error instanceof ApiError &&
        error.status === 401 &&
        error.message === "expired or invalid access token",
    );
    assert.equal(authorizationHeader, "Bearer expired-token");
    assert.equal(authFailureCount, 1);
  } finally {
    setApiAccessToken(null);
    setApiAuthFailureHandler(null);
    globalThis.fetch = originalFetch;
  }
});
