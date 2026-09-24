/**
 * V2.0 P0-1：学生健康画像路由。
 * GET /api/health/student-profile  读取（无记录返回 null）
 * PUT /api/health/student-profile  upsert 保存
 * 字段面向大学生亚健康建模：年级/专业/作息/久坐/学习时长。
 */
import { Router } from "express";
import db from "../../db.js";
import { authMiddleware } from "../../middleware/auth.js";

const router = Router();

type StudentRow = {
  user_id: number;
  grade: string;
  major: string;
  is_off_campus: number;
  bedtime: string;
  wake_time: string;
  sedentary_hours: number;
  study_hours: number;
};

/** 行转前端驼峰 */
function toStudent(r: StudentRow) {
  return {
    grade: r.grade ?? "",
    major: r.major ?? "",
    isOffCampus: r.is_off_campus ?? 0,
    bedtime: r.bedtime ?? "",
    wakeTime: r.wake_time ?? "",
    sedentaryHours: r.sedentary_hours ?? 0,
    studyHours: r.study_hours ?? 0
  };
}

router.get("/health/student-profile", authMiddleware, (req, res) => {
  const row = db
    .prepare("SELECT * FROM student_profile WHERE user_id = ?")
    .get(req.user!.id) as StudentRow | undefined;
  res.json({ code: 0, message: "操作成功", data: row ? toStudent(row) : null });
});

router.put("/health/student-profile", authMiddleware, (req, res) => {
  const userId = req.user!.id;
  const b = (req.body ?? {}) as Record<string, unknown>;
  const num = (v: unknown, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const text = (v: unknown, fallback = "") =>
    typeof v === "string" ? v : fallback;

  db.prepare(
    `INSERT INTO student_profile
       (user_id, grade, major, is_off_campus, bedtime, wake_time, sedentary_hours, study_hours, update_time)
     VALUES
       (@user_id, @grade, @major, @is_off_campus, @bedtime, @wake_time, @sedentary_hours, @study_hours, datetime('now','localtime'))
     ON CONFLICT(user_id) DO UPDATE SET
       grade = excluded.grade,
       major = excluded.major,
       is_off_campus = excluded.is_off_campus,
       bedtime = excluded.bedtime,
       wake_time = excluded.wake_time,
       sedentary_hours = excluded.sedentary_hours,
       study_hours = excluded.study_hours,
       update_time = excluded.update_time`
  ).run({
    user_id: userId,
    grade: text(b.grade),
    major: text(b.major),
    is_off_campus: b.isOffCampus ? 1 : 0,
    bedtime: text(b.bedtime),
    wake_time: text(b.wakeTime),
    sedentary_hours: num(b.sedentaryHours),
    study_hours: num(b.studyHours)
  });

  const row = db
    .prepare("SELECT * FROM student_profile WHERE user_id = ?")
    .get(userId) as StudentRow;
  res.json({ code: 0, message: "操作成功", data: toStudent(row) });
});

export default router;
