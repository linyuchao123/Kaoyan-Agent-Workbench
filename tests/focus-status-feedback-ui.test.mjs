import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const styleSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("暂停中的专注明确显示任务与暂停状态", () => {
  assert.match(pageSource, /sessionStartedAt \? `已暂停 · \$\{focusTargetLabel\}`/);
  assert.match(pageSource, /计时已暂停，暂停期间不计入有效学习时长/);
  assert.match(styleSource, /\.focus-top\.paused/);
});

test("关联任务的专注展示累计时长与目标进度", () => {
  assert.match(pageSource, /任务累计 \{formatMinutes\(focusTaskMinutes\)\}/);
  assert.match(pageSource, /aria-label=\{`\$\{focusTask\.title\}专注进度`\}/);
  assert.match(pageSource, /任务时长已达标/);
  assert.match(styleSource, /\.focus-session-track/);
});

test("自由专注展示本次有效计时时长", () => {
  assert.match(pageSource, /自由专注 · \{subjectMeta\[focusSubject\]\.label\}/);
  assert.match(pageSource, /本次已计入 \{formatMinutes\(focusSessionMinutes\)\}/);
});

test("专注记录保存期间防止重复提交并保留失败计时", () => {
  assert.match(pageSource, /const \[focusSaving, setFocusSaving\] = useState\(false\)/);
  assert.match(pageSource, /if \(!sessionStartedAt \|\| focusSaving\) return/);
  assert.match(pageSource, /setFocusSaving\(true\)/);
  assert.match(pageSource, /studyWriteErrorMessage\(error, "保存专注记录"\)/);
  assert.match(pageSource, /setPausedSeconds\(finalPausedSeconds\)/);
  assert.match(pageSource, /focusSaving \? "正在保存…" : "结束并记录"/);
});
