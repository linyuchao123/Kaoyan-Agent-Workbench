import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const componentSource = readFileSync(new URL("../app/components/request-state-panel.tsx", import.meta.url), "utf8");

test("统一请求状态明确区分加载、空数据、错误和成功", () => {
  assert.match(componentSource, /state === "ready"/);
  assert.match(componentSource, /state === "loading"/);
  assert.match(componentSource, /state === "error"/);
  assert.match(componentSource, /role="status"/);
  assert.match(componentSource, /role="alert"/);
});

test("院校与求职页面不会把请求错误误报为空数据", () => {
  assert.match(pageSource, /const schoolRequestState: RequestState = loading \? "loading" : loadError \? "error"/);
  assert.match(pageSource, /const careerRequestState: RequestState = loading \? "loading" : loadError \? "error"/);
  assert.match(pageSource, /<RequestStatePanel state=\{schoolRequestState\}/);
  assert.match(pageSource, /<RequestStatePanel state=\{careerRequestState\}/);
});
