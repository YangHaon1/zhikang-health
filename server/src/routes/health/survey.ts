/**
 * V2.1 P1-1a：大学生生活方式调研路由。
 * GET  /api/health/survey/latest 最近一次问卷
 * POST /api/health/survey          提交问卷并打规则标签
 * 标签仅用于模型冷启动训练，不构成医学诊断。
 */
import { Router } from "express";
import db from "../../db.js";
import { authMiddleware } from "../../middleware/auth.js";
import { labelSurvey } from "../../services/survey-label.js";

const router = Router();

interface SurveyRow {
  id: number;
  user_id: number;
  survey_version: string;
  sleep_hours_avg: number | null;
  sleep_quality: number | null;
  stay_up_freq: number | null;
  study_pressure: number | null;
  exam_pressure: number | null;
  mood_state: number | null;
  exercise_times: number | null;
  exercise_min: number | null;
  breakfast: number | null;
  diet_regular: number | null;
  sedentary_hours: number | null;
  phone_hours: number | null;
  risk_score: number;
  lifestyle_risk_label: string;
  is_anonymous: number;
  created_at: string;
}

const NUM = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

router.get("/health/survey/latest", authMiddleware, (req, res) => {
  const row = db
    .prepare(
      "SELECT * FROM health_survey WHERE user_id = ? ORDER BY id DESC LIMIT 1"
    )
    .get(req.user!.id) as SurveyRow | undefined;
  res.json({
    code: 0,
    message: "操作成功",
    data: { completed: !!row, data: row ?? null }
  });
});

router.post("/health/survey", authMiddleware, (req, res) => {
  const userId = req.user!.id;
  const b = (req.body ?? {}) as Record<string, unknown>;

  const input = {
    sleep_hours_avg: NUM(b.sleep_hours_avg),
    stay_up_freq: NUM(b.stay_up_freq),
    study_pressure: NUM(b.study_pressure),
    exercise_times: NUM(b.exercise_times),
    diet_regular: NUM(b.diet_regular),
    sedentary_hours: NUM(b.sedentary_hours)
  };
  const { score, label } = labelSurvey(input);

  db.prepare(
    `INSERT INTO health_survey
      (user_id, survey_version, sleep_hours_avg, sleep_quality, stay_up_freq,
       study_pressure, exam_pressure, mood_state, exercise_times, exercise_min,
       breakfast, diet_regular, sedentary_hours, phone_hours,
       risk_score, lifestyle_risk_label, is_anonymous)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    userId,
    "v1",
    input.sleep_hours_avg,
    NUM(b.sleep_quality),
    input.stay_up_freq,
    input.study_pressure,
    NUM(b.exam_pressure),
    NUM(b.mood_state),
    input.exercise_times,
    NUM(b.exercise_min),
    NUM(b.breakfast),
    input.diet_regular,
    input.sedentary_hours,
    NUM(b.phone_hours),
    score,
    label,
    b.is_anonymous ? 1 : 0
  );

  res.json({
    code: 0,
    message: "感谢参与健康调研",
    data: { score, label }
  });
});

export default router;
