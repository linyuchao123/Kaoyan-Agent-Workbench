import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

function readEnvFile(filename) {
  try {
    return parseEnv(readFileSync(resolve(filename), "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return {};
    throw error;
  }
}

const genericFileEnv = { ...readEnvFile(".env"), ...readEnvFile(".env.local") };
const initialEnv = { ...genericFileEnv, ...process.env };
const appEnvironment = (initialEnv.NEXT_PUBLIC_APP_ENV ?? "development").trim().toLowerCase();
const modeFileEnv = {
  ...readEnvFile(`.env.${appEnvironment}`),
  ...readEnvFile(`.env.${appEnvironment}.local`),
};
const environment = { ...genericFileEnv, ...modeFileEnv, ...process.env };
const production = appEnvironment === "production";
const apiUrl = (environment.NEXT_PUBLIC_API_URL ?? "").trim();
const supabaseUrl = (environment.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
const supabaseAnonKey = (environment.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
const errors = [];

function parsedHttpUrl(name, value) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("unsupported protocol");
    return parsed;
  } catch {
    errors.push(`${name} 必须是完整的 HTTP(S) URL。`);
    return null;
  }
}

if (Boolean(supabaseUrl) !== Boolean(supabaseAnonKey)) {
  errors.push("NEXT_PUBLIC_SUPABASE_URL 与 NEXT_PUBLIC_SUPABASE_ANON_KEY 必须同时填写或同时留空。");
}

const parsedApiUrl = parsedHttpUrl("NEXT_PUBLIC_API_URL", apiUrl);
const parsedSupabaseUrl = parsedHttpUrl("NEXT_PUBLIC_SUPABASE_URL", supabaseUrl);

if (production) {
  if (!apiUrl) errors.push("生产构建必须填写 NEXT_PUBLIC_API_URL。");
  if (!supabaseUrl || !supabaseAnonKey) {
    errors.push("生产构建必须完整填写 Supabase 公开连接配置。");
  }
  for (const [name, parsed] of [["NEXT_PUBLIC_API_URL", parsedApiUrl], ["NEXT_PUBLIC_SUPABASE_URL", parsedSupabaseUrl]]) {
    if (!parsed) continue;
    if (parsed.protocol !== "https:") errors.push(`${name} 在生产环境必须使用 HTTPS。`);
    if (["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
      errors.push(`${name} 在生产环境不能指向本机。`);
    }
  }
}

if (errors.length) {
  console.error("前端部署环境校验失败：");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(production ? "前端生产环境校验通过。" : "前端开发/演示环境校验通过。");
