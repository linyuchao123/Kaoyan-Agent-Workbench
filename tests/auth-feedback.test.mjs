import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const profileMigrationSource = await readFile(new URL("../supabase/migrations/202608290001_sync_profile_display_name.sql", import.meta.url), "utf8");

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

test("登录页支持发送密码重置邮件并提供中文反馈", () => {
  assert.match(pageSource, /useState<"login" \| "register" \| "forgot" \| "reset">\(recoveryMode \? "reset" : "login"\)/);
  assert.match(pageSource, /client\.auth\.resetPasswordForEmail\(email\.trim\(\),/);
  assert.match(pageSource, /redirectTo: window\.location\.origin/);
  assert.match(pageSource, /如果该邮箱已注册，密码重置邮件会在几分钟内送达/);
  assert.match(pageSource, /function passwordResetRequestErrorMessage\(error: unknown\)/);
  assert.match(pageSource, /忘记密码？/);
  assert.match(pageSource, /发送重置邮件/);
});

test("重置邮件回跳后可以校验并保存新密码", () => {
  assert.match(pageSource, /event === "PASSWORD_RECOVERY"/);
  assert.match(pageSource, /if \(passwordRecovery\) return <AuthScreen recoveryMode/);
  assert.match(pageSource, /client\.auth\.updateUser\(\{ password \}\)/);
  assert.match(pageSource, /password !== passwordConfirmation/);
  assert.match(pageSource, /两次输入的新密码不一致/);
  assert.match(pageSource, /client\.auth\.signOut\(\{ scope: "local" \}\)/);
  assert.match(pageSource, /密码已更新，请使用新密码登录工作台/);
  assert.match(pageSource, /function passwordUpdateErrorMessage\(error: unknown\)/);
});

test("注册时保存学习昵称并限制昵称长度", () => {
  assert.match(pageSource, /const \[displayName, setDisplayName\] = useState\(""\)/);
  assert.match(pageSource, /options: \{ data: \{ display_name: normalizedDisplayName \} \}/);
  assert.match(pageSource, /autoComplete="nickname" minLength=\{2\} maxLength=\{32\}/);
  assert.match(pageSource, /昵称需要填写 2 至 32 个字符/);
});

test("登录后可以修改昵称、可选密码并退出", () => {
  assert.match(pageSource, /function AccountSecurity\(\{ accountId, email, initialDisplayName, onClose, onSignOut, onUserUpdated \}/);
  assert.match(pageSource, /function accountPasswordUpdateErrorMessage\(error: unknown\)/);
  assert.match(pageSource, /const \[accountSecurityOpen, setAccountSecurityOpen\] = useState\(false\)/);
  assert.match(pageSource, /aria-label="打开账户安全"/);
  assert.match(pageSource, /\{ password, data: \{ display_name: normalizedDisplayName \} \}/);
  assert.match(pageSource, /\{ data: \{ display_name: normalizedDisplayName \} \}/);
  assert.match(pageSource, /onUserUpdated\(result\.data\.user\)/);
  assert.match(pageSource, /metadataDisplayName \|\| user\?\.email\?\.split\("@"\)\[0\]/);
  assert.match(pageSource, /学习昵称已更新。侧边栏已同步显示新昵称/);
  assert.match(pageSource, /退出当前账户/);
});

test("退出时可选清理当前账户的本机资料缓存", () => {
  assert.match(pageSource, /退出时清除此账户的本机资料缓存/);
  assert.match(pageSource, /removeAccountLocalRagBundles\(accountId\)/);
  assert.match(pageSource, /onSignOut\(clearLocalRagOnSignOut\)/);
  assert.match(pageSource, /不影响云端资料或其他账户/);
});

test("Auth 昵称变更由数据库触发器同步到个人资料", () => {
  assert.match(profileMigrationSource, /create or replace function public\.sync_profile_display_name\(\)/);
  assert.match(profileMigrationSource, /security definer/);
  assert.match(profileMigrationSource, /after update of raw_user_meta_data on auth\.users/);
  assert.match(profileMigrationSource, /where id = new\.id/);
  assert.match(profileMigrationSource, /revoke all on function public\.sync_profile_display_name\(\) from public/);
});
