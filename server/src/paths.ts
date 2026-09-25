import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

/** 数据目录：server/data（已在 .gitignore 中排除，不入库） */
export const dataDir = path.resolve(import.meta.dirname, "../data");

/** 头像上传目录：server/data/uploads，通过 /uploads 静态托管（见 src/index.ts） */
export const uploadsDir = path.join(dataDir, "uploads");

/** 确保数据目录存在（启动时调用一次即可） */
export function ensureDirs(): void {
  mkdirSync(uploadsDir, { recursive: true });
}

/**
 * 定位 server-ml 下的模型产物（cluster-model/metadata.json 等）。
 *
 * 不能用 process.cwd()：旧写法 path.resolve(process.cwd(), "..", "server-ml", ...)
 * 只有 cwd = server/ 时才成立，从项目根目录（根 package.json 的 dev:all）启动就永远读不到，
 * 且被 try/catch 静默吞掉，表现为「聚类版本永远 unknown」。
 */
export function mlAssetPath(...segments: string[]): string {
  const here = import.meta.dirname; // server/src/
  const candidates = [
    path.resolve(here, "..", "..", "server-ml", ...segments), // server/server-ml ← 源码运行
    path.resolve(process.cwd(), "server-ml", ...segments), // <cwd>/server-ml ← 根目录启动
    path.resolve(here, "..", "..", "..", "server-ml", ...segments) // server/dist/ 下运行
  ];
  return candidates.find(p => existsSync(p)) ?? candidates[0];
}

/** cluster-model/metadata.json 绝对路径（不存在时返回首选候选，交由调用方 existsSync） */
export const clusterMetaFile = (): string =>
  mlAssetPath("cluster-model", "metadata.json");
