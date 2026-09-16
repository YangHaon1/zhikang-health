// 环境变量集中加载：显式指向 server/.env
// 说明：脚本在仓库根目录执行（pnpm dev:server），dotenv 默认只读根目录 .env，
// 因此这里显式指定 server/.env 路径。server/.env 不入库，由 .env.example 复制生成。
import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(import.meta.dirname, "../.env") });

const jwtSecret = (process.env.JWT_SECRET ?? "").trim();

/** 弱/占位密钥清单：等于这些值时视为「未改」，需要醒目告警 */
const WEAK_JWT_SECRETS = [
  "", // 未配置
  "zhikang-dev-only-insecure-secret", // env.ts 兜底占位
  "zhikang-compose-change-me-please", // docker-compose.yml 默认值
  "please-change-me-to-a-long-random-string" // server/.env.example 模板值
];

/** PORT 解析：非法值回退 3000（不阻断启动），由 checkEnv() 统一告警 */
function resolvePort(): { port: number; error?: string } {
  const raw = (process.env.PORT ?? "").trim();
  if (!raw) return { port: 3000 };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    return {
      port: 3000,
      error: `PORT="${raw}" 不是合法端口号（需为 1~65535 的整数），已回退为 3000`
    };
  }
  return { port: n };
}

const resolvedPort = resolvePort();

export const env = {
  PORT: resolvedPort.port,
  /** 运行环境：production 时 Express 托管 dist/ 前端产物（见 src/index.ts） */
  NODE_ENV: process.env.NODE_ENV ?? "development",
  /** 生产环境必须替换为足够长的随机串 */
  JWT_SECRET: jwtSecret || "zhikang-dev-only-insecure-secret",
  /** 方案 B 真实大模型 API Key，留空则仅走方案 A 规则引擎 */
  LLM_API_KEY: (process.env.LLM_API_KEY ?? "").trim(),
  /** 方案 B 模型名与网关地址（可留空走默认值：火山方舟豆包） */
  LLM_MODEL: process.env.LLM_MODEL || "doubao-1-5-pro-32k-250115",
  LLM_BASE_URL:
    process.env.LLM_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3"
};

/**
 * 启动时校验关键环境变量（由 src/index.ts 在监听前调用）。
 *
 * 口径：**只告警、不阻断**——本机比赛演示用默认值完全没问题，
 * 但上云 / 进 Docker 前必须替换 JWT_SECRET，否则任何人拿到源码都能伪造令牌。
 */
export function checkEnv(): void {
  if (WEAK_JWT_SECRETS.includes(jwtSecret)) {
    const reason = jwtSecret
      ? `当前值为占位/模板值 "${jwtSecret}"`
      : "当前未配置（server/.env 缺失或未填 JWT_SECRET）";
    console.warn(
      [
        "",
        "⚠️  ============ 安全告警：JWT_SECRET 未设置为随机密钥 ============",
        `  ${reason}`,
        "  影响：JWT_SECRET 是令牌签名密钥，公开的默认值可被用来伪造任意用户令牌。",
        "  本机演示 / 离线比赛：可忽略本条告警，功能不受影响。",
        "  上云 / Docker 部署：必须在 server/.env 或环境变量中替换为足够长的随机串，例如",
        "    node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"",
        "=========================================================================",
        ""
      ].join("\n")
    );
  }

  if (resolvedPort.error) {
    console.warn(`[env] ${resolvedPort.error}`);
  }
}
