import assert from "node:assert/strict";
import test from "node:test";

import {
  isWorkbenchView,
  readStoredWorkbenchView,
  storeWorkbenchView,
  workbenchViewStorageKey,
} from "../app/lib/workbench-view.ts";

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

test("workbench views accept only the public navigation whitelist", () => {
  assert.equal(isWorkbenchView("materials"), true);
  assert.equal(isWorkbenchView("agents"), true);
  assert.equal(isWorkbenchView("admin"), false);
  assert.equal(isWorkbenchView(null), false);
});

test("the last workbench view is isolated by account", () => {
  const storage = createStorage();
  storeWorkbenchView(storage, "account-a", "materials");
  storeWorkbenchView(storage, "account-b", "plan");

  assert.equal(readStoredWorkbenchView(storage, "account-a"), "materials");
  assert.equal(readStoredWorkbenchView(storage, "account-b"), "plan");
  assert.notEqual(workbenchViewStorageKey("account-a"), workbenchViewStorageKey("account-b"));
});

test("missing, invalid, or unavailable storage safely falls back to today", () => {
  const storage = createStorage();
  storage.setItem(workbenchViewStorageKey("account-a"), "removed-view");

  assert.equal(readStoredWorkbenchView(storage, "account-a"), "today");
  assert.equal(readStoredWorkbenchView(null, "account-a"), "today");
  assert.equal(readStoredWorkbenchView({ getItem: () => { throw new Error("blocked"); } }, "account-a"), "today");
  assert.doesNotThrow(() => storeWorkbenchView({ setItem: () => { throw new Error("blocked"); } }, "account-a", "today"));
});
