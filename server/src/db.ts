import Database from "better-sqlite3";
import path from "node:path";
import bcrypt from "bcrypt";
import { dataDir, ensureDirs } from "./paths.js";
import { logger } from "./logger.js";

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
      measured_at        TEXT DEFAULT '',     -- C2 测量时间 yyyy-MM-dd HH:mm:ss
      source_type        TEXT DEFAULT 'manual', -- C2 manual | device | import
      quality_flag       TEXT DEFAULT 'good',   -- C2 good | suspect | invalid
      device_name        TEXT DEFAULT '',     -- C2 设备名（source_type=device 时有值）
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

    CREATE INDEX IF NOT EXISTS idx_reports_user_time ON reports(user_id, create_time DESC);

    -- 对话历史
    CREATE TABLE IF NOT EXISTS chat_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      role        TEXT NOT NULL,              -- 'user' | 'assistant'
      content     TEXT NOT NULL,
      create_time TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_chat_user_time ON chat_history(user_id, create_time DESC);

    -- 健康行动计划（C1）
    CREATE TABLE IF NOT EXISTS health_plans (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id),
      title        TEXT NOT NULL,
      risk_key     TEXT NOT NULL,               -- 对应 health-engine 指标 key / 分类
      target_value REAL,                        -- 目标值（可选）
      start_date   TEXT NOT NULL,               -- yyyy-MM-dd
      end_date     TEXT NOT NULL,               -- yyyy-MM-dd
      status       TEXT NOT NULL DEFAULT 'active',  -- active | completed | stopped
      source       TEXT NOT NULL DEFAULT 'rule',    -- rule | manual
      create_time  TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_plans_user ON health_plans(user_id, status);

    -- 计划任务（一计划多任务）
    CREATE TABLE IF NOT EXISTS plan_tasks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id    INTEGER NOT NULL REFERENCES health_plans(id),
      title      TEXT NOT NULL,
      task_type  TEXT NOT NULL,                 -- measure | exercise | diet | lifestyle | other
      frequency  TEXT NOT NULL,                 -- daily | weekly
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_plan ON plan_tasks(plan_id);

    -- 任务打卡（同一用户同一任务同一天只能打一次，UNIQUE 兜底）
    CREATE TABLE IF NOT EXISTS task_checkins (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id),
      task_id      INTEGER NOT NULL REFERENCES plan_tasks(id),
      value        TEXT DEFAULT '',
      note         TEXT DEFAULT '',
      checked_date TEXT NOT NULL,               -- yyyy-MM-dd
      create_time  TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(user_id, task_id, checked_date)
    );

    CREATE INDEX IF NOT EXISTS idx_checkins_task_date ON task_checkins(task_id, checked_date);
  `);

  ensureUserPrivacy();
  ensureReminders();
  ensureAuditLogs();
  ensureDailyHealth();
  ensureHealthAiProfiles();
  ensureDailySummary();
  ensureHealthGoals();
  migrateProfiles();
  migrateUsers();
  migrateRecords();
  seedUsers();
}

/**
 * C5 隐私授权表：一行一个用户的共享授权偏好。
 *
 * 为什么单独建表而不是给 profiles 加列：
 * 1. **语义不同**：这是「用户的同意记录」，不是健康档案的一部分；档案行是懒创建的，
 *    没有档案的用户同样应该有（且必须有）自己的授权偏好。
 * 2. **不会被无关写路径重置**：`PUT /health/profile` 与一键演示数据都是整行 upsert/写入档案，
 *    把同意状态混进 profiles，一次无关的档案编辑就可能把用户的隐私选择改掉 ——
 *    授权只能由用户在授权中心显式改动。
 * 3. **老数据零迁移**：缺失行即「未授权」，与默认关闭（DEFAULT_ALLOW_SHARED = false）一致，
 *    不需要给既有用户回填。
 */
const USER_PRIVACY_DDL = `
  CREATE TABLE IF NOT EXISTS user_privacy (
    user_id      INTEGER PRIMARY KEY REFERENCES users(id),
    allow_shared INTEGER NOT NULL DEFAULT 0,   -- 0 关闭（默认）| 1 开启
    update_time  TEXT DEFAULT (datetime('now','localtime'))
  );
`;

/**
 * 每日健康记录（M1 用户体验升级）：一行 = 一个用户 × 一天的高频生活数据。
 *
 * 与 profiles（长期档案：身高/年龄/基础指标）、records（医学指标：血压/血糖）**刻意分开**：
 * 睡眠时长、运动分钟、心情是每天变化的生活方式数据，和「半年不变的档案」生命周期不同；
 * （user_id, date）唯一，同日重复提交 = UPSERT（覆盖当天），不产生重复行。
 */
const DAILY_HEALTH_RECORDS_DDL = `
  CREATE TABLE IF NOT EXISTS daily_health_records (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER NOT NULL REFERENCES users(id),
    date              TEXT    NOT NULL,              -- yyyy-MM-dd（本地日期）
    sleep_hours       REAL,                          -- 睡眠时长（小时）
    exercise_minutes  INTEGER,                       -- 运动分钟
    mood_score        INTEGER,                       -- 心情 1 差 | 2 一般 | 3 好
    diet_status       TEXT    DEFAULT '',            -- 饮食：good 良好 | normal 一般 | poor 不佳
    note              TEXT    DEFAULT '',
    ai_summary        TEXT    DEFAULT '',            -- AI 每日总结（规则生成，断网可用）
    update_time       TEXT    DEFAULT (datetime('now','localtime')),
    UNIQUE(user_id, date)
  );
  CREATE INDEX IF NOT EXISTS idx_daily_user_date
    ON daily_health_records(user_id, date DESC);
`;

/** 幂等创建每日健康记录表（initDb 启动时调用，路由使用前也会再兜一次） */
export function ensureDailyHealth(): void {
  db.exec(DAILY_HEALTH_RECORDS_DDL);
}

/**
 * M4 AI 健康画像结果表：与 profiles（用户填的档案）**刻意分开**——
 * profiles 是用户输入，health_ai_profiles 是系统分析产物（可重新生成、会过期）。
 * user_id UNIQUE：同一用户只有一份画像，重新分析 = UPSERT 覆盖。
 */
const HEALTH_AI_PROFILES_DDL = `
  CREATE TABLE IF NOT EXISTS health_ai_profiles (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL UNIQUE REFERENCES users(id),
    health_type  TEXT    DEFAULT '',
    health_score INTEGER DEFAULT 0,
    risk_level   TEXT    DEFAULT '',
    advantages   TEXT    DEFAULT '',   -- JSON 数组
    problems     TEXT    DEFAULT '',   -- JSON 数组
    suggestions  TEXT    DEFAULT '',   -- JSON 数组
    ai_summary   TEXT    DEFAULT '',
    created_at   TEXT    DEFAULT (datetime('now','localtime')),
    updated_at   TEXT    DEFAULT (datetime('now','localtime'))
  );
`;

/** 幂等创建 AI 画像结果表（initDb 启动时调用，路由使用前也会再兜一次） */
export function ensureHealthAiProfiles(): void {
  db.exec(HEALTH_AI_PROFILES_DDL);
}

/**
 * M5 每日 AI 健康总结表：(user_id, summary_date) UNIQUE，一天一份避免重复调 AI。
 */
const HEALTH_DAILY_SUMMARY_DDL = `
  CREATE TABLE IF NOT EXISTS health_daily_summary (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    summary_date TEXT    NOT NULL,           -- YYYY-MM-DD（本地时区）
    health_score INTEGER DEFAULT 0,
    summary      TEXT    DEFAULT '',
    highlights   TEXT    DEFAULT '',          -- JSON 数组
    warnings     TEXT    DEFAULT '',           -- JSON 数组
    suggestions  TEXT    DEFAULT '',           -- JSON 数组
    created_at   TEXT    DEFAULT (datetime('now','localtime')),
    UNIQUE(user_id, summary_date)
  );
`;

/** M5 目标追踪表（每周运动次数等可量化目标） */
const HEALTH_GOALS_DDL = `
  CREATE TABLE IF NOT EXISTS health_goals (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    goal_type    TEXT    NOT NULL,            -- exercise / sleep / weight / stress
    target_value TEXT    DEFAULT '',
    current_value TEXT   DEFAULT '',
    progress     INTEGER DEFAULT 0,           -- 0-100
    status       TEXT    DEFAULT 'active',    -- active / done
    created_at   TEXT    DEFAULT (datetime('now','localtime')),
    UNIQUE(user_id, goal_type)
  );
`;

export function ensureDailySummary(): void {
  db.exec(HEALTH_DAILY_SUMMARY_DDL);
}

export function ensureHealthGoals(): void {
  db.exec(HEALTH_GOALS_DDL);
}

/** 幂等创建隐私授权表（initDb 启动时调用，读写授权前也会再兜一次） */
export function ensureUserPrivacy(): void {
  db.exec(USER_PRIVACY_DDL);
}

/**
 * C6 健康提醒设置表：一行一个「用户 × 提醒类型」。
 *
 * 为什么是**独立新表**（而不是 user_preferences 式的单行 JSON、也不是复用 user_privacy）：
 * 1. **缺行 = 未开启**，与 `DEFAULT_REMINDER_ENABLED = false` 严格一致，老数据零迁移
 *    （与 C5 `user_privacy` 同一思路）。
 * 2. **主键就是 (user_id, kind)**：新增提醒类型只多写一行，不动表结构；user_id 天然是
 *    隔离键，查询与写入都带上它，不存在跨用户读写的路径。
 * 3. **能被 SQL 直接筛**：调度器需要「所有已开启的提醒」这一个查询
 *    （`idx_reminders_enabled`），把类型塞进一列 JSON 就没法这么查了。
 * 4. 与隐私授权**语义不同**：授权是同意记录、提醒是偏好设置，两者生命周期与
 *    违规后果都不一样，混在一张表里会让「谁能读」这条边界变模糊。
 */
const USER_REMINDERS_DDL = `
  CREATE TABLE IF NOT EXISTS user_reminders (
    user_id      INTEGER NOT NULL REFERENCES users(id),
    kind         TEXT    NOT NULL,                        -- measure | checkin
    enabled      INTEGER NOT NULL DEFAULT 0,              -- 0 关闭（默认）| 1 开启
    time_of_day  TEXT    NOT NULL DEFAULT '08:00',        -- 每日提醒时刻 HH:mm
    update_time  TEXT DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (user_id, kind)
  );

  CREATE INDEX IF NOT EXISTS idx_reminders_enabled ON user_reminders(enabled, kind);
`;

/**
 * C6 站内提醒表：调度器到点后写入的一条提醒（演示用「站内信」）。
 *
 * `UNIQUE(user_id, kind, fire_date)` 是**幂等的唯一依据**：调度器按分钟扫描、还会补发，
 * 没有这个约束就会刷屏。写入一律用 `INSERT OR IGNORE`，重复扫描不会产生第二条。
 * `fire_date` 用**本地日**（与共享层 `localDateKey` 同口径），跨时区不共用一条。
 */
const REMINDER_NOTICES_DDL = `
  CREATE TABLE IF NOT EXISTS reminder_notices (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    kind        TEXT    NOT NULL,                         -- measure | checkin
    title       TEXT    NOT NULL,
    content     TEXT    NOT NULL,
    fire_date   TEXT    NOT NULL,                         -- yyyy-MM-dd（本地日）
    create_time TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE (user_id, kind, fire_date)
  );

  CREATE INDEX IF NOT EXISTS idx_notices_user_date ON reminder_notices(user_id, fire_date DESC);
`;

/** 幂等创建提醒相关两张表（initDb 启动时调用，路由与调度器使用前也会再兜一次） */
export function ensureReminders(): void {
  db.exec(USER_REMINDERS_DDL);
  db.exec(REMINDER_NOTICES_DDL);
}

/**
 * 审计日志表（C4 建立，C5 扩成体系）。
 * DDL 单独抽出来导出，供「表不存在随本次幂等创建」的场景复用（老库首次写入也不会缺表）。
 *
 * C5 变化：
 * - `user_id` 改为**可空**：登录失败时账号可能根本不存在，而 `foreign_keys = ON` 让 user_id=0
 *   这样的「哨兵值」写不进去。审计行不能伪造归属，故按标准做法重建表放开非空约束。
 * - 新增 `actor_name` / `actor_ip`：登录失败等「没有合法 user_id」的场景仍要记下是谁/从哪尝试。
 */
const AUDIT_LOGS_DDL = `
  CREATE TABLE IF NOT EXISTS audit_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER REFERENCES users(id),  -- 可空：账号不存在（登录失败）时为 NULL
    action      TEXT NOT NULL,              -- 审计动作，见 @shared/health-privacy 的动作目录
    actor_name  TEXT DEFAULT '',            -- 操作人登录名（登录失败时为「尝试的用户名」）
    actor_ip    TEXT DEFAULT '',            -- 来源 IP
    detail      TEXT DEFAULT '',            -- JSON：动作上下文（已脱敏，不含个体健康数据）
    create_time TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE INDEX IF NOT EXISTS idx_audit_user_time ON audit_logs(user_id, create_time DESC);
  CREATE INDEX IF NOT EXISTS idx_audit_action_time ON audit_logs(action, create_time DESC);
`;

/** 幂等创建审计日志表（initDb 启动时调用，审计写入前也会再兜一次） */
export function ensureAuditLogs(): void {
  db.exec(AUDIT_LOGS_DDL);
  migrateAuditLogs();
}

/**
 * C4 老库的 audit_logs 是 `user_id INTEGER NOT NULL` 且没有 actor_name / actor_ip。
 * 列的非空约束改不动（SQLite 不支持 ALTER COLUMN），只能按官方推荐的「建新表 → 搬数据 →
 * 换名」重建；没有任何表引用 audit_logs，所以重建不影响其它表。
 * 幂等：已经是新结构（actor_name 存在且 user_id 可空）时直接返回。
 */
function migrateAuditLogs(): void {
  // 用 db.pragma 而非 `SELECT ... FROM pragma_table_info`：结果里的 `notnull` 是 SQLite 关键字
  // （NOTNULL），写成 SELECT 时列名与别名都要额外加引号，用 pragma 接口可以绕开这个坑。
  const columns = db.pragma("table_info(audit_logs)") as Array<{
    name: string;
    notnull: number;
  }>;
  if (!columns.length) return; // 表还没建出来（ensureAuditLogs 已建，不会走到这里）
  const names = new Set(columns.map(c => c.name));
  const userIdNullable = columns.find(c => c.name === "user_id")?.notnull === 0;
  if (names.has("actor_name") && userIdNullable) return;

  const hasActor = names.has("actor_name");
  const hasIp = names.has("actor_ip");
  // 搬数据期间关掉外键：老库里若存在指向已删除用户的审计行，也要原样保留（审计不丢行）
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      db.exec("ALTER TABLE audit_logs RENAME TO audit_logs_c4");
      // 索引会跟着被重命名的表走并占住名字，先删掉，否则下面 IF NOT EXISTS 建不出来
      db.exec("DROP INDEX IF EXISTS idx_audit_user_time");
      db.exec("DROP INDEX IF EXISTS idx_audit_action_time");
      db.exec(AUDIT_LOGS_DDL);
      db.exec(`
        INSERT INTO audit_logs (id, user_id, action, actor_name, actor_ip, detail, create_time)
        SELECT id, user_id, action,
               ${hasActor ? "actor_name" : "''"},
               ${hasIp ? "actor_ip" : "''"},
               detail, create_time
        FROM audit_logs_c4`);
      db.exec("DROP TABLE audit_logs_c4");
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }
  logger.info("[db] audit_logs 表已重建（user_id 可空 + actor_name/actor_ip）");
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
  logger.info(`[db] users 表补列：${added.join(", ")}`);

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
    ["allergy_history", "TEXT DEFAULT ''"],
    ["health_goal", "TEXT DEFAULT ''"],
    ["sleep_habit", "TEXT DEFAULT ''"],
    ["exercise_habit", "TEXT DEFAULT ''"],
    ["diet_habit", "TEXT DEFAULT ''"],
    ["sleep_hours", "REAL DEFAULT 0"],
    ["exercise_frequency", "INTEGER DEFAULT 0"],
    ["goal_description", "TEXT DEFAULT ''"]
  ];

  const added: Array<string> = [];
  for (const [name, ddl] of additions) {
    if (existing.has(name)) continue;
    // 列名来自上方常量白名单，非用户输入，无注入风险
    db.exec(`ALTER TABLE profiles ADD COLUMN ${name} ${ddl}`);
    added.push(name);
  }
  if (added.length) logger.info(`[db] profiles 表补列：${added.join(", ")}`);
}

/**
 * records 表最小迁移（C2 数据来源与质量，幂等）：老库的 records 没有来源/质量/测量时间列，
 * 用 pragma_table_info 检查缺列、缺哪列补哪列（ADD COLUMN 带默认值，SQLite 会为既有行
 * 填上默认值，因此**旧数据零破坏**：来源=manual、质量=good，分析口径完全不变）。
 *
 * 选「补列」而不是「建新表迁移」：records 已被报告/计划/看板等多处按列名引用，
 * 建新表要连带迁移索引与外键，收益为零；补列是原地、幂等、可回滚（成本最低）。
 *
 * measured_at 例外：ADD COLUMN 的默认值是空串，语义上不如「按记录日期补 00:00:00」，
 * 因此仅在**本次刚补出该列**时回填一次，之后以库内值为准。
 */
function migrateRecords(): void {
  const columns = db
    .prepare("SELECT name FROM pragma_table_info('records')")
    .all() as Array<{ name: string }>;
  const existing = new Set(columns.map(c => c.name));
  const additions: Array<[string, string]> = [
    ["measured_at", "TEXT DEFAULT ''"],
    ["source_type", "TEXT DEFAULT 'manual'"],
    ["quality_flag", "TEXT DEFAULT 'good'"],
    ["device_name", "TEXT DEFAULT ''"]
  ];

  const added: Array<string> = [];
  for (const [name, ddl] of additions) {
    if (existing.has(name)) continue;
    // 列名来自上方常量白名单，非用户输入，无注入风险
    db.exec(`ALTER TABLE records ADD COLUMN ${name} ${ddl}`);
    added.push(name);
  }
  if (!added.length) return;
  logger.info(`[db] records 表补列：${added.join(", ")}`);

  // 旧数据只有日期没有时刻：按当天 00:00:00 回填，保证历史页/趋势页永远拿得到测量时间
  const filled = db
    .prepare(
      "UPDATE records SET measured_at = record_date || ' 00:00:00' WHERE measured_at IS NULL OR measured_at = ''"
    )
    .run();
  if (filled.changes)
    logger.info(`[db] records 回填 measured_at：${filled.changes} 行`);
}

/**
 * 种子账号：admin/admin123（管理员）、common/common123（普通用户），密码 bcrypt 哈希入库。
 *
 * V1.5 安全开关：用环境变量 SEED_DEMO_ACCOUNTS 控制是否自动种演示账号。
 * - 显式 SEED_DEMO_ACCOUNTS=true/false 优先；
 * - 未设置时：生产环境（NODE_ENV=production）默认不种，开发/演示环境默认种。
 * 避免生产环境长期存在弱口令默认账号。
 */
function shouldSeedDemoAccounts(): boolean {
  const v = process.env.SEED_DEMO_ACCOUNTS;
  if (v === "true") return true;
  if (v === "false") return false;
  return process.env.NODE_ENV !== "production";
}

function seedUsers(): void {
  if (!shouldSeedDemoAccounts()) {
    logger.info("[db] SEED_DEMO_ACCOUNTS 关闭，跳过演示账号初始化");
    return;
  }
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
