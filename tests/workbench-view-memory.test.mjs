import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  isWorkbenchView,
  readStoredWorkbenchView,
  storeWorkbenchView,
  workbenchViewStorageKey,
} from "../app/lib/workbench-view.ts";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

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
  assert.equal(isWorkbenchView("mistakes"), true);
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

test("工作台先用稳定首页完成服务端 hydration 再恢复账户视图", () => {
  assert.match(pageSource, /useState<View>\("today"\)/);
  assert.match(pageSource, /setView\(readStoredWorkbenchView\(window\.localStorage, accountKey\)\)/);
  assert.doesNotMatch(pageSource, /useState<View>\(\(\) => readStoredWorkbenchView/);
});
