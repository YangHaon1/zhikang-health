import { mkdirSync } from "node:fs";
import path from "node:path";

/** 数据目录：server/data（已在 .gitignore 中排除，不入库） */
export const dataDir = path.resolve(import.meta.dirname, "../data");

/** 头像上传目录：server/data/uploads，通过 /uploads 静态托管（见 src/index.ts） */
export const uploadsDir = path.join(dataDir, "uploads");

/** 确保数据目录存在（启动时调用一次即可） */
export function ensureDirs(): void {
  mkdirSync(uploadsDir, { recursive: true });
}
