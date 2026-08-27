import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("登录注册错误统一转换为中文安全提示", () => {
  assert.match(pageSource, /function authRequestErrorMessage\(error: unknown, mode: "login" \| "register"\)/);
  assert.match(pageSource, /邮箱尚未验证，请先打开验证邮件完成确认/);
  assert.match(pageSource, /邮箱或密码错误，请检查后重新登录/);
  assert.match(pageSource, /该邮箱已经注册，请直接返回登录/);
  assert.match(pageSource, /密码强度不足，请设置至少 6 位/);
  assert.match(pageSource, /操作过于频繁，请稍后再试/);
  assert.match(pageSource, /暂时无法连接 Supabase 登录服务/);
});

test("认证页面不再直接展示 Supabase 英文错误原文", () => {
  assert.doesNotMatch(pageSource, /setStatus\(result\.error\.message\)/);
  assert.match(pageSource, /setStatus\(authRequestErrorMessage\(result\.error, mode\)\)/);
  assert.match(pageSource, /setStatus\(authRequestErrorMessage\(error, mode\)\)/);
});

test("登录注册页可以显示或隐藏密码并同步无障碍状态", () => {
  assert.match(pageSource, /const \[passwordVisible, setPasswordVisible\] = useState\(false\)/);
  assert.match(pageSource, /type=\{passwordVisible \? "text" : "password"\}/);
  assert.match(pageSource, /aria-label=\{passwordVisible \? "隐藏密码" : "显示密码"\}/);
  assert.match(pageSource, /aria-pressed=\{passwordVisible\}/);
  assert.match(pageSource, /setPasswordVisible\(false\)/);
});
