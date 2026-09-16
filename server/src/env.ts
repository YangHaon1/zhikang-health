// 环境变量集中加载：显式指向 server/.env
// 说明：脚本在仓库根目录执行（pnpm dev:server），dotenv 默认只读根目录 .env，
// 因此这里显式指定 server/.env 路径。server/.env 不入库，由 .env.example 复制生成。
import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(import.meta.dirname, "../.env") });

const jwtSecret = (process.env.JWT_SECRET ?? "").trim();

if (!jwtSecret) {
  console.warn(
    "[env] 未读取到 JWT_SECRET（请从 server/.env.example 复制生成 server/.env），已临时使用开发占位密钥"
  );
}

export const env = {
  PORT: Number(process.env.PORT) || 3000,
  /** 生产环境必须替换为足够长的随机串 */
  JWT_SECRET: jwtSecret || "zhikang-dev-only-insecure-secret",
  /** 方案 B 真实大模型 API Key，留空则仅走方案 A 规则引擎 */
  LLM_API_KEY: process.env.LLM_API_KEY || ""
};
