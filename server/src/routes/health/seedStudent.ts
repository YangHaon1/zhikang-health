/**
 * V2.0 P1-2：学生演示数据（仅开发/演示用）。
 * POST /api/health/seed-student —— 给当前用户写一份 student_profile + 近7天 daily。
 * 幂等：重复调用覆盖。不写 records/，不影响生产数据。
 */
import { Router } from "express";
import db from "../../db.js";
import { authMiddleware } from "../../middleware/auth.js";
import { fmtDate } from "../../../shared/date-utils.js";

const router = Router();

router.post("/health/seed-student", authMiddleware, (req, res) => {
  const userId = req.user!.id;
  const today = new Date();
  const fmt = fmtDate;

  // student_profile
  db.prepare(
    `INSERT INTO student_profile (user_id, grade, major, is_off_campus, bedtime, wake_time, sedentary_hours, study_hours, update_time)
     VALUES (?,?,?,?,?,?,?,?,datetime('now','localtime'))
     ON CONFLICT(user_id) DO UPDATE SET grade=excluded.grade, major=excluded.major,
       sedentary_hours=excluded.sedentary_hours, study_hours=excluded.study_hours, update_time=excluded.update_time`
  ).run(userId, "大三", "计算机科学与技术", 0, "23:30", "07:00", 10, 8);

  // 近7天 daily：偏高压、睡眠偏少、运动少（便于展示 high 风险）
  const upsert = db.prepare(
    `INSERT INTO daily_health_records
       (user_id, date, sleep_hours, exercise_minutes, mood_score, diet_status, sleep_quality, stress_level, diet_regularity, update_time)
     VALUES (?,?,?,?,?,?,?,?,?,datetime('now','localtime'))
     ON CONFLICT(user_id, date) DO UPDATE SET
       sleep_hours=excluded.sleep_hours, exercise_minutes=excluded.exercise_minutes,
       mood_score=excluded.mood_score, sleep_quality=excluded.sleep_quality,
       stress_level=excluded.stress_level, diet_regularity=excluded.diet_regularity`
  );
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    upsert.run(userId, fmt(d), 5.8, 15, 2, "normal", 2, 3, "poor");
  }
  res.json({ code: 0, message: "学生演示数据已生成", data: { days: 7 } });
});

export default router;
