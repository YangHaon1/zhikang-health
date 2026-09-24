/**
 * 把数据库清回「交付 / 演示基线」，用于回归测试之后恢复现场：
 *
 *   records 0 ／ reports 0 ／ chat_history 0 ／ users 2（仅 admin + common）
 *   ／ health_plans 0 ／ plan_tasks 0 ／ task_checkins 0（C1 计划与打卡一并清空）
 *   ／ audit_logs 0 ／ user_privacy 0（授权开关回到默认「关闭」）
 *   ／ user_reminders 0 ／ reminder_notices 0（提醒回到默认「未开启」）
 *   ／ admin 健康档案恢复演示态（全生活方式正常）／ 头像清空且上传目录清空
 *
 * 用法：
 *   node server/scripts/reset-demo-data.mjs
 *
 * ⚠️ 这是**破坏性**脚本：会删除健康记录、报告、对话历史、id>2 的用户与已上传头像文件。
 *    仅用于本机演示/回归后的现场恢复，**不要**对正式环境执行。
 *    服务可以保持运行（脚本直连 SQLite，无需停服）。
 */
import { DatabaseSync } from "node:sqlite";
import { readdirSync, rmSync } from "node:fs";
import path from "node:path";

const dataDir = path.resolve(import.meta.dirname, "../data");
const dbFile = path.join(dataDir, "zhikang.db");
const uploadsDir = path.join(dataDir, "uploads");

const db = new DatabaseSync(dbFile);
const count = t => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
const TABLES = [
  "users",
  "records",
  "reports",
  "chat_history",
  "profiles",
  // C7：C1 的计划 / 任务 / 打卡原先没被清，回归后会留下悬空数据，补上
  "health_plans",
  "plan_tasks",
  "task_checkins",
  // C5：审计与授权状态也属于「演示现场」，一并清回基线
  "audit_logs",
  "user_privacy",
  // C6：提醒设置与站内提醒同样属于「演示现场」
  "user_reminders",
  "reminder_notices"
];

const before = Object.fromEntries(TABLES.map(t => [t, count(t)]));

db.exec("BEGIN");
db.exec("DELETE FROM records");
db.exec("DELETE FROM reports");
db.exec("DELETE FROM chat_history");
// ⚠️ 删除顺序按外键依赖「子表在前」。node:sqlite 的 DatabaseSync 默认
// enableForeignKeyConstraints = true，顺序错了会直接 FOREIGN KEY constraint failed。
// C7：C1 的打卡 → 任务 → 计划（task_checkins 既指向 plan_tasks 也指向 users）
db.exec("DELETE FROM task_checkins");
db.exec("DELETE FROM plan_tasks");
db.exec("DELETE FROM health_plans");
// 审计日志先于用户删除（audit_logs.user_id 是 users 的外键）
db.exec("DELETE FROM audit_logs");
// 站内提醒先于提醒设置删除（reminder_notices / user_reminders 都指向 users）
db.exec("DELETE FROM reminder_notices");
db.exec("DELETE FROM user_reminders");
db.exec("DELETE FROM user_privacy");
db.exec("DELETE FROM users WHERE id > 2");
db.exec("UPDATE users SET avatar = ''");
// admin 档案恢复演示态：从不吸烟 / 从不饮酒 / 经常运动（全生活方式正常）
db.prepare(
  `UPDATE profiles SET name = @name, gender = @gender, birth_date = '', age = @age,
     height = @height, weight = @weight, waistline = @waistline,
     medical_history = '', family_history = '', allergy_history = '',
     smoking = @smoking, drinking = @drinking, exercise = @exercise,
     update_time = datetime('now','localtime')
   WHERE user_id = 1`
).run({
  name: "张健康",
  gender: "male",
  age: 30,
  height: 175,
  weight: 70,
  waistline: 80,
  smoking: 0,
  drinking: 0,
  exercise: 2
});
db.exec("COMMIT");

// 清理上传目录里的头像文件（仅本项目的 server/data/uploads）
let removed = 0;
try {
  for (const f of readdirSync(uploadsDir)) {
    rmSync(path.join(uploadsDir, f), { force: true });
    removed++;
  }
} catch {
  /* 目录不存在则跳过 */
}

console.log("清理前：", JSON.stringify(before));
console.log(
  "清理后：",
  JSON.stringify(Object.fromEntries(TABLES.map(t => [t, count(t)])))
);
console.log("删除上传文件：", removed, "个");
console.log(
  "users：",
  JSON.stringify(
    db.prepare("SELECT id, username, roles, avatar FROM users").all()
  )
);
console.log(
  "profile：",
  JSON.stringify(
    db
      .prepare(
        "SELECT name, age, height, weight, smoking, drinking, exercise FROM profiles WHERE user_id = 1"
      )
      .get()
  )
);
db.close();
