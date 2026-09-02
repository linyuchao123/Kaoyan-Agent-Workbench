import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_EXAM_TARGET_DATE,
  clearExamTargetDate,
  daysUntilExam,
  examTargetStorageKey,
  formatExamTargetDate,
  isValidExamTargetDate,
  readExamTargetDate,
  storeExamTargetDate,
} from "../app/lib/exam-target.ts";

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("2028 exam target is the safe default and countdown uses calendar days", () => {
  assert.equal(DEFAULT_EXAM_TARGET_DATE, "2028-12-23");
  assert.equal(daysUntilExam("2028-12-20", DEFAULT_EXAM_TARGET_DATE), 3);
  assert.equal(daysUntilExam(DEFAULT_EXAM_TARGET_DATE, DEFAULT_EXAM_TARGET_DATE), 0);
  assert.equal(daysUntilExam("2028-12-24", DEFAULT_EXAM_TARGET_DATE), 0);
  assert.equal(formatExamTargetDate(DEFAULT_EXAM_TARGET_DATE), "2028 年 12 月 23 日");
});

test("exam target accepts real calendar dates only", () => {
  assert.equal(isValidExamTargetDate("2028-02-29"), true);
  assert.equal(isValidExamTargetDate("2027-02-29"), false);
  assert.equal(isValidExamTargetDate("2028-13-01"), false);
  assert.equal(isValidExamTargetDate("not-a-date"), false);
});

test("exam target settings are isolated by account and can restore the default", () => {
  const storage = createStorage();
  assert.equal(storeExamTargetDate(storage, "account-a", "2029-01-02"), true);
  assert.equal(readExamTargetDate(storage, "account-a"), "2029-01-02");
  assert.equal(readExamTargetDate(storage, "account-b"), DEFAULT_EXAM_TARGET_DATE);
  assert.notEqual(examTargetStorageKey("account-a"), examTargetStorageKey("account-b"));

  clearExamTargetDate(storage, "account-a");
  assert.equal(readExamTargetDate(storage, "account-a"), DEFAULT_EXAM_TARGET_DATE);
});

test("unavailable storage and invalid values safely fall back", () => {
  const brokenReader = { getItem: () => { throw new Error("blocked"); } };
  const brokenWriter = { setItem: () => { throw new Error("blocked"); } };
  assert.equal(readExamTargetDate(null, "account-a"), DEFAULT_EXAM_TARGET_DATE);
  assert.equal(readExamTargetDate(brokenReader, "account-a"), DEFAULT_EXAM_TARGET_DATE);
  assert.equal(storeExamTargetDate(brokenWriter, "account-a", "2029-01-02"), false);
  assert.equal(storeExamTargetDate(null, "account-a", "invalid"), false);
});
