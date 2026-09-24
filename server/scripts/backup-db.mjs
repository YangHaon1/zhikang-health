/**
 * 数据库备份：把 server/data/zhikang.db 导出成带时间戳的单文件快照。
 *
 *   node server/scripts/backup-db.mjs
 *   → server/data/backups/zhikang-20260916-232926.db
 *
 * 实现说明（**不要**改成直接复制 .db 文件）：
 * - 库是 WAL 模式（见 src/db.ts 的 `journal_mode = WAL`），新写入先落在 `zhikang.db-wal`，
 *   主库文件可能长时间是空的。早期版本用 `copyFileSync` 复制单个 .db，
 *   实测备份出来的是「0 条记录的空库」——看着成功、实则毫无价值。
 * - 因此改用 SQLite 的 `VACUUM INTO`：它会读一份一致快照（含 WAL 中未合并的数据）写进新文件，
 *   顺带整理碎片，产出的就是可直接打开使用的完整库。
 * - 连接用 Node 内置的 `node:sqlite`，不引入任何新依赖；服务可以保持运行，无需停服。
 * - 时间戳取本机时间（与库里 `datetime('now','localtime')` 口径一致），
 *   同一秒内重复执行不会覆盖已有快照，会自动加 `-2`、`-3` 后缀。
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";

const dataDir = path.resolve(import.meta.dirname, "../data");
const dbFile = path.join(dataDir, "zhikang.db");
const backupDir = path.join(dataDir, "backups");

if (!existsSync(dbFile)) {
  console.error(`[backup] 数据库不存在：${dbFile}`);
  console.error("[backup] 请先启动一次服务（pnpm start:server）生成数据库。");
  process.exit(1);
}

mkdirSync(backupDir, { recursive: true });

/** 本机时间 → YYYYMMDD-HHmmss */
function stamp(d = new Date()) {
  const p = n => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

// 同一秒重复执行：找第一个没被占用的文件名，绝不覆盖已有快照
// （`VACUUM INTO` 遇到已存在的目标文件会直接报错，这里先挑好名字）
let target = path.join(backupDir, `zhikang-${stamp()}.db`);
for (let i = 2; existsSync(target); i++) {
  target = path.join(backupDir, `zhikang-${stamp()}-${i}.db`);
}

const db = new DatabaseSync(dbFile);
try {
  // 路径统一用正斜杠（Windows 下 SQLite 同样识别），单引号按 SQL 规则转义
  db.exec(`VACUUM INTO '${target.replace(/\\/g, "/").replace(/'/g, "''")}'`);
} finally {
  db.close();
}

const kb = (statSync(target).size / 1024).toFixed(1);
console.log(`[backup] 已备份 ${dbFile}`);
console.log(`[backup]     → ${target}（${kb} KB）`);
