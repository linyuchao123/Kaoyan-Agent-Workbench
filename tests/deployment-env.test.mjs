import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("../scripts/validate-deployment-env.mjs", import.meta.url));

function validate(overrides = {}) {
  return spawnSync(process.execPath, [scriptPath], {
    encoding: "utf8",
    cwd: tmpdir(),
    env: { PATH: process.env.PATH ?? "", ...overrides },
  });
}

test("开发演示构建允许不配置云端", () => {
  const result = validate();
  assert.equal(result.status, 0);
  assert.match(result.stdout, /开发\/演示环境校验通过/);
});

test("Supabase 公开配置不允许只填一项", () => {
  const result = validate({ NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /必须同时填写或同时留空/);
});

test("生产构建拒绝缺失云端配置和本机 API", () => {
  const result = validate({
    NEXT_PUBLIC_APP_ENV: "production",
    NEXT_PUBLIC_API_URL: "http://localhost:8000",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /必须完整填写 Supabase/);
  assert.match(result.stderr, /必须使用 HTTPS/);
  assert.match(result.stderr, /不能指向本机/);
});

test("生产构建接受完整 HTTPS 配置且不输出密钥", () => {
  const result = validate({
    NEXT_PUBLIC_APP_ENV: "production",
    NEXT_PUBLIC_API_URL: "https://api.study.example.com",
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon-example",
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /生产环境校验通过/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /public-anon-example/);
});
