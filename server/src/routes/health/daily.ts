/**
 * M1 每日健康记录：`POST /api/health/daily`、`GET /api/health/daily/today`、
 * `GET /api/health/daily?days=N`。
 *
 * 面向用户自己（只能读写自己的每日记录，无 user_id 入参）：
 * - POST：提交/更新某一天（默认今天）的睡眠/运动/心情/饮食，同日 UPSERT；
 * - today：今日记录 + 今日健康指数（基础健康分 ± 今日生活习惯调整）+ 近 7 天 AI 建议；
 * - 列表：近 N 天记录（驾驶舱趋势用）。
 *
 * 校验、文案映射、指数与建议口径全部来自共享层 `@shared/daily-health`，
 * 本文件只负责读写库与拼响应。
 *
 * V2.0 P0-1：新增 sleep_quality / stress_level / diet_regularity 三个亚健康核心字段，
 * 路由层直接接收并落库，不改共享层校验口径。
 */
import { Router } from "express";
import db, { ensureDailyHealth } from "../../db.js";
import { authMiddleware } from "../../middleware/auth.js";
import { localDateKey } from "../../../shared/health-reminder.js";
import {
  buildDailyAdvice,
  buildTodayIndex,
  validateDailyInput,
  type NormalizedDaily
} from "../../../shared/daily-health.js";
import { analyzeHealth } from "../../../shared/health-engine.js";
import { profileForEngine, recordsForEngine } from "./common.js";

const router = Router();
router.use(authMiddleware);

interface DailyRow {
  id: number;
  date: string;
  sleep_hours: number | null;
  exercise_minutes: number | null;
  mood_score: number | null;
  diet_status: string;
  note: string;
  ai_summary: string;
  sleep_quality: number | null;
  stress_level: number | null;
  diet_regularity: string;
  update_time: string;
}

function rowToView(row: DailyRow | undefined) {
  if (!row) return null;
  return {
    date: row.date,
    sleepHours: row.sleep_hours,
    exerciseMinutes: row.exercise_minutes,
    moodScore: row.mood_score,
    dietStatus: (row.diet_status || "") as NormalizedDaily["dietStatus"],
    sleepQuality: row.sleep_quality ?? 0,
    stressLevel: row.stress_level ?? 0,
    dietRegularity: row.diet_regularity || "",
    note: row.note
  };
}

function findRow(userId: number, date: string): DailyRow | undefined {
  return db
    .prepare(
      "SELECT * FROM daily_health_records WHERE user_id = ? AND date = ?"
    )
    .get(userId, date) as DailyRow | undefined;
}

/** 近 N 天记录（日期升序，给趋势/建议用；无记录的日期不出现） */
function recentRows(userId: number, days: number): DailyRow[] {
  ensureDailyHealth();
  return db
    .prepare(
      `SELECT * FROM daily_health_records
       WHERE user_id = ? AND date >= date(?, ?)
       ORDER BY date ASC`
    )
    .all(userId, localDateKey(new Date()), `-${days - 1} days`) as DailyRow[];
}

// ---------- POST /api/health/daily ----------
router.post("/health/daily", (req, res) => {
  const userId = req.user!.id;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const date = String(body.date ?? localDateKey(new Date()));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ code: 40001, message: "日期格式需为 yyyy-MM-dd" });
    return;
  }
  const { value, error } = validateDailyInput(body);
  if (error) {
    res.status(400).json({ code: 40001, message: error });
    return;
  }
  ensureDailyHealth();

  // V2.0 亚健康新字段：路由层直接接收，带安全默认值与白名单
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const sleepQuality = num(body.sleepQuality);
  const stressLevel = num(body.stressLevel);
  const dietRegularity =
    typeof body.dietRegularity === "string" &&
    ["good", "normal", "poor"].includes(body.dietRegularity)
      ? body.dietRegularity
      : "";

  db.prepare(
    `INSERT INTO daily_health_records
       (user_id, date, sleep_hours, exercise_minutes, mood_score, diet_status, note,
        sleep_quality, stress_level, diet_regularity, update_time)
     VALUES (@user_id, @date, @sleep_hours, @exercise_minutes, @mood_score, @diet_status, @note,
        @sleep_quality, @stress_level, @diet_regularity, datetime('now','localtime'))
     ON CONFLICT(user_id, date) DO UPDATE SET
       sleep_hours = excluded.sleep_hours,
       exercise_minutes = excluded.exercise_minutes,
       mood_score = excluded.mood_score,
       diet_status = excluded.diet_status,
       note = excluded.note,
       sleep_quality = excluded.sleep_quality,
       stress_level = excluded.stress_level,
       diet_regularity = excluded.diet_regularity,
       update_time = datetime('now','localtime')`
  ).run({
    user_id: userId,
    date,
    sleep_hours: value.sleepHours,
    exercise_minutes: value.exerciseMinutes,
    mood_score: value.moodScore,
    diet_status: value.dietStatus,
    note: value.note,
    sleep_quality: sleepQuality,
    stress_level: stressLevel,
    diet_regularity: dietRegularity
  });
  res.json({
    code: 0,
    message: "已保存今日记录",
    data: rowToView(findRow(userId, date))
  });
});

// ---------- GET /api/health/daily/today ----------
router.get("/health/daily/today", (req, res) => {
  const userId = req.user!.id;
  const today = rowToView(findRow(userId, localDateKey(new Date()))) ?? {
    date: localDateKey(new Date()),
    sleepHours: null,
    exerciseMinutes: null,
    moodScore: null,
    dietStatus: "",
    sleepQuality: 0,
    stressLevel: 0,
    dietRegularity: "",
    note: ""
  };
  // 基础风险分：与报告/分析同一口径（recordsForEngine 已过滤 invalid）
  const result = analyzeHealth(
    recordsForEngine(userId),
    profileForEngine(userId)
  );
  const index = buildTodayIndex(result.score, today);
  const recent = recentRows(userId, 7).map(r => ({
    date: r.date,
    sleepHours: r.sleep_hours,
    exerciseMinutes: r.exercise_minutes,
    moodScore: r.mood_score
  }));
  res.json({
    code: 0,
    message: "ok",
    data: { today, index, advice: buildDailyAdvice(recent) }
  });
});

// ---------- GET /api/health/daily?days=7 ----------
router.get("/health/daily", (req, res) => {
  const userId = req.user!.id;
  const days = Math.max(1, Math.min(90, Number(req.query.days ?? 7) || 7));
  const rows = recentRows(userId, days);
  // 画像需要睡眠质量 / 压力 / 饮食规律三个亚健康维度，
  // 这里一并返回（buildDailyAdvice 只用前三项，多给不影响既有逻辑）。
  const list = rows.map(r => ({
    date: r.date,
    sleepHours: r.sleep_hours,
    exerciseMinutes: r.exercise_minutes,
    moodScore: r.mood_score,
    sleepQuality: r.sleep_quality,
    stressLevel: r.stress_level,
    dietRegularity: r.diet_regularity || null
  }));
  res.json({ code: 0, message: "ok", data: list });
});

export default router;
