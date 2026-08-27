import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("院校编辑器声明并重置正在编辑的院校状态", () => {
  assert.match(pageSource, /const \[editingSchool, setEditingSchool\] = useState<ApiSchoolOption \| null>\(null\)/);
  assert.match(pageSource, /function clearSchoolForm\(\)[\s\S]*?setEditingSchool\(null\)/);
  assert.match(pageSource, /function openSchoolEditor\(school: ApiSchoolOption\)[\s\S]*?setEditingSchool\(school\)/);
});

test("院校档案写入期间防止重复请求并显示中文云端反馈", () => {
  assert.match(pageSource, /async function saveSchool[\s\S]*?if \(busy\) return;/);
  assert.match(pageSource, /async function removeSchool[\s\S]*?if \(deleteBusyId\) return;/);
  assert.match(pageSource, /studyWriteErrorMessage\(error, editingSchool \? "修改院校档案" : "保存院校档案"\)/);
  assert.match(pageSource, /studyWriteErrorMessage\(error, "删除院校档案"\)/);
  assert.match(pageSource, /deleteBusyId === school\.id \? "删除中…" : "删除"/);
});
