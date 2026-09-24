/**
 * 演示数据一键初始化（比赛现场用）。
 * 只给 common 体验账号灌数据，不动 admin。幂等：重复跑用 UPSERT。
 *
 * 用法：node server/scripts/seed-demo.mjs
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const dbFile = path.resolve(import.meta.dirname, "../data/zhikang.db");
const db = new DatabaseSync(dbFile);

// 确保表存在（和后端 DDL 对齐）
db.exec(`
  CREATE TABLE IF NOT EXISTS daily_health_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    sleep_hours REAL, exercise_minutes REAL, mood_score INTEGER,
    UNIQUE(user_id, date)
  );
  CREATE TABLE IF NOT EXISTS health_ai_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    health_type TEXT, health_score INTEGER, risk_level TEXT,
    advantages TEXT, problems TEXT, suggestions TEXT, ai_summary TEXT,
    updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS health_daily_summary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, summary_date TEXT,
    health_score INTEGER, summary TEXT,
    highlights TEXT, warnings TEXT, suggestions TEXT,
    UNIQUE(user_id, summary_date)
  );
`);

const user = db.prepare("SELECT id FROM users WHERE username='common'").get();
if (!user) {
  console.error("未找到 common 账号，请先启动服务让种子用户建好");
  process.exit(1);
}
const uid = user.id;

// 1. 基础档案
db.prepare(
  `INSERT INTO profiles (user_id, name, gender, age, height, weight, health_goal, sleep_habit, exercise_habit, diet_habit)
   VALUES (?, '体验用户', 1, 28, 175, 72, '改善睡眠,提升运动能力', '基本规律', '偶尔运动', '规律')
   ON CONFLICT(user_id) DO UPDATE SET
     name=excluded.name, age=excluded.age, height=excluded.height, weight=excluded.weight,
     health_goal=excluded.health_goal`
).run(uid);
console.log("✓ 档案已写入");

// 2. 近 7 天每日记录
const days = [
  { sleep: 6.5, exercise: 20, mood: 3 },
  { sleep: 7.0, exercise: 0, mood: 2 },
  { sleep: 6.0, exercise: 30, mood: 3 },
  { sleep: 7.5, exercise: 15, mood: 4 },
  { sleep: 6.5, exercise: 0, mood: 2 },
  { sleep: 7.0, exercise: 40, mood: 4 },
  { sleep: 6.5, exercise: 25, mood: 3 }
];
const insertDaily = db.prepare(
  `INSERT INTO daily_health_records (user_id, date, sleep_hours, exercise_minutes, mood_score)
   VALUES (?, date('now','localtime',?), ?, ?, ?)
   ON CONFLICT(user_id, date) DO UPDATE SET
     sleep_hours=excluded.sleep_hours, exercise_minutes=excluded.exercise_minutes, mood_score=excluded.mood_score`
);
days.forEach((d, i) => {
  insertDaily.run(uid, `-${6 - i} days`, d.sleep, d.exercise, d.mood);
});
console.log("✓ 7 天每日记录已写入");

// 3. AI 画像
db.prepare(
  `INSERT INTO health_ai_profiles (user_id, health_type, health_score, risk_level, advantages, problems, suggestions, ai_summary, updated_at)
   VALUES (?, '轻度亚健康型', 78, '中风险',
     '["BMI 23.5 正常","情绪总体稳定"]',
     '["近 7 天平均睡眠 6.7 小时，略低于 7 小时","近 7 天有 2 天未运动"]',
     '["固定作息，目标每晚 7-9 小时","从每天 10 分钟快走开始，逐步达到每周 150 分钟"]',
     '你的 BMI 保持正常，情绪也比较稳定；需要关注的是最近睡眠略偏少、运动频率可以再规律一些。保持打卡，我们一起逐步改善。',
     datetime('now','localtime'))
   ON CONFLICT(user_id) DO UPDATE SET
     health_type=excluded.health_type, health_score=excluded.health_score,
     risk_level=excluded.risk_level, advantages=excluded.advantages,
     problems=excluded.problems, suggestions=excluded.suggestions,
     ai_summary=excluded.ai_summary, updated_at=excluded.updated_at`
).run(uid);
console.log("✓ AI 画像已写入");

// 4. 今日总结
db.prepare(
  `INSERT INTO health_daily_summary (user_id, summary_date, health_score, summary, highlights, warnings, suggestions)
   VALUES (?, date('now','localtime'), 78,
     '早上好！今日健康指数 78，状态一般。昨天你走了 25 分钟，继续保持；睡眠还差 0.5 小时达标，今晚试试提前半小时躺下。',
     '["昨日运动 25 分钟","情绪平稳"]',
     '["近 7 天有 2 天未运动"]',
     '["固定作息，目标每晚 7-9 小时","安排 30 分钟快走"]')
   ON CONFLICT(user_id, summary_date) DO UPDATE SET
     health_score=excluded.health_score, summary=excluded.summary,
     highlights=excluded.highlights, warnings=excluded.warnings, suggestions=excluded.suggestions`
).run(uid);
console.log("✓ 今日总结已写入");

console.log("\n完成。用 common / common123 登录即可看到完整 M1-M5 闭环。");
