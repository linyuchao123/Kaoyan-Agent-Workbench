import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dockerfile = await readFile(new URL("../backend/Dockerfile", import.meta.url), "utf8");
const dockerignore = await readFile(new URL("../.dockerignore", import.meta.url), "utf8");

test("后端镜像使用非 root 用户并配置就绪探针", () => {
  assert.match(dockerfile, /FROM python:3\.12-slim/);
  assert.match(dockerfile, /poppler-utils/);
  assert.match(dockerfile, /USER app/);
  assert.match(dockerfile, /\/health\/ready/);
  assert.match(dockerfile, /exec uvicorn app\.main:app --host 0\.0\.0\.0/);
});

test("镜像构建上下文排除密钥、个人资料和本地文件", () => {
  assert.match(dockerignore, /^\.env$/m);
  assert.match(dockerignore, /^\*\*\/\.env\.\*$/m);
  assert.match(dockerignore, /^private-data$/m);
  assert.match(dockerignore, /^uploads$/m);
  assert.match(dockerignore, /^启动命令$/m);
  assert.doesNotMatch(dockerfile, /COPY\s+\.\s+\./);
});
