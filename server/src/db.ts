import Database from "better-sqlite3";
import path from "node:path";
import bcrypt from "bcrypt";
import { dataDir, ensureDirs } from "./paths.js";

// 数据目录：server/data/zhikang.db（已在 .gitignore 中排除，不入库）
ensureDirs();

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
      sex           INTEGER DEFAULT 0,        -- 0 男 1 女（用户管理页）
      status        INTEGER DEFAULT 1,        -- 1 启用 0 停用
      dept_id       INTEGER DEFAULT 0,        -- 归属部门，数据见 src/data/depts.ts
      remark        TEXT DEFAULT '',
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
  migrateUsers();
  seedUsers();
}

/**
 * users 表最小迁移（幂等）：B1 建表时只有登录/账户设置需要的列，
 * B8 的用户管理页还要展示与编辑 性别/状态/归属部门/备注，缺哪列补哪列。
 */
function migrateUsers(): void {
  const columns = db
    .prepare("SELECT name FROM pragma_table_info('users')")
    .all() as Array<{ name: string }>;
  const existing = new Set(columns.map(c => c.name));
  const additions: Array<[string, string]> = [
    ["sex", "INTEGER DEFAULT 0"],
    ["status", "INTEGER DEFAULT 1"],
    ["dept_id", "INTEGER DEFAULT 0"],
    ["remark", "TEXT DEFAULT ''"]
  ];

  const added: Array<string> = [];
  for (const [name, ddl] of additions) {
    if (existing.has(name)) continue;
    // 列名来自上方常量白名单，非用户输入，无注入风险
    db.exec(`ALTER TABLE users ADD COLUMN ${name} ${ddl}`);
    added.push(name);
  }
  if (!added.length) return;
  console.log(`[db] users 表补列：${added.join(", ")}`);

  // dept_id 刚补出来时全为默认值 0，给两个演示账号回填部门。
  // 只在补列这一次执行，后续以库内值为准（管理员改过的部门不会被覆盖）。
  const backfill = db.prepare(
    "UPDATE users SET dept_id = ? WHERE username = ? AND dept_id = 0"
  );
  backfill.run(103, "admin");
  backfill.run(105, "common");
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
    `INSERT INTO users (username, password_hash, nickname, email, roles, sex, status, dept_id, remark)
     VALUES (@username, @password_hash, @nickname, @email, @roles, @sex, @status, @dept_id, @remark)`
  );
  const tx = db.transaction(() => {
    insert.run({
      username: "admin",
      password_hash: bcrypt.hashSync("admin123", 10),
      nickname: "管理员",
      email: "admin@zhikang.local",
      roles: "admin",
      sex: 0,
      status: 1,
      dept_id: 103,
      remark: "管理员"
    });
    insert.run({
      username: "common",
      password_hash: bcrypt.hashSync("common123", 10),
      nickname: "普通用户",
      email: "common@zhikang.local",
      roles: "common",
      sex: 1,
      status: 1,
      dept_id: 105,
      remark: "普通用户"
    });
  });
  tx();
}

export default db;
