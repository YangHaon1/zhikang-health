import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcrypt";

// 数据目录：server/data/zhikang.db（已在 .gitignore 中排除，不入库）
const dataDir = path.resolve(import.meta.dirname, "../data");
mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "zhikang.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

/**
 * 初始化数据库：建表 + 种子数据。
 * 幂等：users 表为空时才插入种子账号，重复启动不会重复插入。
 */
export function initDb(): void {
  db.exec(`
    -- 用户表
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,            -- bcrypt
      nickname      TEXT DEFAULT '',
      email         TEXT DEFAULT '',
      phone         TEXT DEFAULT '',
      description   TEXT DEFAULT '',
      avatar        TEXT DEFAULT '',
      roles         TEXT DEFAULT 'common',    -- 'admin' | 'common'
      create_time   TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 健康档案（一用户一条）
    CREATE TABLE IF NOT EXISTS profiles (
      user_id    INTEGER PRIMARY KEY REFERENCES users(id),
      name       TEXT DEFAULT '',
      gender     TEXT DEFAULT 'male',        -- male | female
      birth_date TEXT DEFAULT '',
      height     REAL,                        -- cm
      weight     REAL,                        -- kg
      smoking    INTEGER DEFAULT 0,           -- 0否 1是
      drinking   INTEGER DEFAULT 0,           -- 0否 1偶尔 2经常
      exercise   INTEGER DEFAULT 0,           -- 0不足 1一般 2良好
      update_time TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 健康记录（指标）
    CREATE TABLE IF NOT EXISTS records (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id            INTEGER NOT NULL REFERENCES users(id),
      record_date        TEXT NOT NULL,       -- yyyy-MM-dd
      systolic           INTEGER,             -- 收缩压
      diastolic          INTEGER,             -- 舒张压
      fasting_glucose    REAL,                -- 空腹血糖
      postprandial_glucose REAL,              -- 餐后血糖
      total_cholesterol  REAL,                -- 总胆固醇
      triglycerides      REAL,                -- 甘油三酯
      ldl                REAL,                -- 低密度脂蛋白
      hdl                REAL,                -- 高密度脂蛋白
      heart_rate         INTEGER,             -- 心率
      blood_oxygen       INTEGER,             -- 血氧
      weight             REAL,                -- 体重
      note               TEXT DEFAULT '',
      create_time        TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_records_user_date ON records(user_id, record_date DESC);

    -- 报告
    CREATE TABLE IF NOT EXISTS reports (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL REFERENCES users(id),
      period_start  TEXT,
      period_end    TEXT,
      score         INTEGER,
      level         TEXT,
      summary       TEXT,                     -- JSON：总体评价/分项分析/风险点/建议/就医提醒
      radar         TEXT,                     -- JSON：雷达图数据
      trend         TEXT,                     -- JSON：趋势图数据
      create_time   TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 对话历史
    CREATE TABLE IF NOT EXISTS chat_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      role        TEXT NOT NULL,              -- 'user' | 'assistant'
      content     TEXT NOT NULL,
      create_time TEXT DEFAULT (datetime('now','localtime'))
    );
  `);

  migrateProfiles();
  seedUsers();
}

/**
 * profiles 表最小迁移（幂等）：B1 建表时只有 name/gender(男male|女female)/birth_date/
 * height/weight + 整数枚举的生活习惯列，B3 前端表单还需要年龄/腰围/既往病史/家族史/过敏史。
 * 用 pragma_table_info 检查缺列，缺哪列补哪列，老库新库都能直接启动。
 */
function migrateProfiles(): void {
  const columns = db
    .prepare("SELECT name FROM pragma_table_info('profiles')")
    .all() as Array<{ name: string }>;
  const existing = new Set(columns.map(c => c.name));
  const additions: Array<[string, string]> = [
    ["age", "INTEGER DEFAULT 0"],
    ["waistline", "REAL DEFAULT 0"],
    ["medical_history", "TEXT DEFAULT ''"],
    ["family_history", "TEXT DEFAULT ''"],
    ["allergy_history", "TEXT DEFAULT ''"]
  ];

  const added: Array<string> = [];
  for (const [name, ddl] of additions) {
    if (existing.has(name)) continue;
    // 列名来自上方常量白名单，非用户输入，无注入风险
    db.exec(`ALTER TABLE profiles ADD COLUMN ${name} ${ddl}`);
    added.push(name);
  }
  if (added.length) console.log(`[db] profiles 表补列：${added.join(", ")}`);
}

/** 种子账号：admin/admin123（管理员）、common/common123（普通用户），密码 bcrypt 哈希入库 */
function seedUsers(): void {
  const { c } = db.prepare("SELECT COUNT(*) AS c FROM users").get() as {
    c: number;
  };
  if (c > 0) return;

  const insert = db.prepare(
    "INSERT INTO users (username, password_hash, nickname, email, roles) VALUES (?, ?, ?, ?, ?)"
  );
  const tx = db.transaction(() => {
    insert.run(
      "admin",
      bcrypt.hashSync("admin123", 10),
      "管理员",
      "admin@zhikang.local",
      "admin"
    );
    insert.run(
      "common",
      bcrypt.hashSync("common123", 10),
      "普通用户",
      "common@zhikang.local",
      "common"
    );
  });
  tx();
}

export default db;
