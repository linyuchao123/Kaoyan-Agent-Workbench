import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("院校编辑器声明并重置正在编辑的院校状态", () => {
  assert.match(pageSource, /const \[editingSchool, setEditingSchool\] = useState<ApiSchoolOption \| null>\(null\)/);
  assert.match(pageSource, /function clearSchoolForm\(\)[\s\S]*?setEditingSchool\(null\)/);
  assert.match(pageSource, /function openSchoolEditor\(school: ApiSchoolOption\)[\s\S]*?setEditingSchool\(school\)/);
});
