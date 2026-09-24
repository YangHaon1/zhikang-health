/**
 * M5 AI 健康陪伴：每日总结 + 目标进度。
 * 评分/进度全部来自共享层规则；LLM 只润色总结句，断网不阻塞。
 */
import { Router } from "express";
import db, { ensureDailySummary, ensureHealthGoals } from "../../db.js";
import { authMiddleware } from "../../middleware/auth.js";
import { profileForEngine } from "../health/common.js";
import {
  buildDailySummary,
  buildGoalProgress
} from "../../../shared/daily-summary.js";
import { callLlm, llmAvailable } from "../../llm.js";

const router = Router();
router.use(authMiddleware);

interface SummaryRow {
  id: number;
  summary_date: string;
  health_score: number;
  summary: string;
  highlights: string;
  warnings: string;
  suggestions: string;
  created_at: string;
}

function rowToView(row: SummaryRow) {
  return {
    id: row.id,
    summaryDate: row.summary_date,
    healthScore: row.health_score,
    summary: row.summary,
    highlights: JSON.parse(row.highlights || "[]") as string[],
    warnings: JSON.parse(row.warnings || "[]") as string[],
    suggestions: JSON.parse(row.suggestions || "[]") as string[]
  };
}

/** 拉近 7 天 daily 记录 + 昨日 */
function loadDaily(userId: number) {
  const rows = db
    .prepare(
      `SELECT sleep_hours, exercise_minutes, mood_score, date FROM daily_health_records
       WHERE user_id = ? ORDER BY date DESC LIMIT 7`
    )
    .all(userId) as Array<{
    sleep_hours: number | null;
    exercise_minutes: number | null;
    mood_score: number | null;
    date: string;
  }>;
  return {
    yesterday: rows[0]
      ? {
          sleepHours: rows[0].sleep_hours,
          exerciseMinutes: rows[0].exercise_minutes,
          moodScore: rows[0].mood_score
        }
      : null,
    recent7: rows.map(r => ({
      sleepHours: r.sleep_hours,
      exerciseMinutes: r.exercise_minutes,
      moodScore: r.mood_score
    }))
  };
}

/** GET /api/ai/daily-summary —— 读今日总结（无则 null） */
router.get("/ai/daily-summary", (req, res) => {
  ensureDailySummary();
  const row = db
    .prepare(
      "SELECT * FROM health_daily_summary WHERE user_id = ? AND summary_date = date('now','localtime')"
    )
    .get(req.user!.id) as SummaryRow | undefined;
  res.json({ code: 0, message: "ok", data: row ? rowToView(row) : null });
});

/** POST /api/ai/daily-summary/generate —— 生成今日总结（UPSERT） */
router.post("/ai/daily-summary/generate", async (req, res) => {
  const userId = req.user!.id;
  ensureDailySummary();
  ensureHealthGoals();

  const profile = profileForEngine(userId);
  const { yesterday, recent7 } = loadDaily(userId);

  const aiRow = db
    .prepare("SELECT health_score FROM health_ai_profiles WHERE user_id = ?")
    .get(userId) as { health_score: number } | undefined;

  const result = buildDailySummary({
    yesterday,
    recent7,
    healthGoal: (profile as { healthGoal?: string } | null)?.healthGoal ?? "",
    aiScore: aiRow?.health_score ?? null
  });

  let summary = result.summary;
  if (llmAvailable()) {
    const llm = await callLlm([
      {
        role: "user",
        content: `基于用户昨日数据（${yesterday ? `睡眠${yesterday.sleepHours ?? "无"}h、运动${yesterday.exerciseMinutes ?? "无"}min` : "未打卡"}），
用 2 句温暖中文生成今日健康问候，引用实际数据，不要诊断。`
      }
    ]);
    if (llm.ok) summary = llm.text;
  }

  db.prepare(
    `INSERT INTO health_daily_summary
       (user_id, summary_date, health_score, summary, highlights, warnings, suggestions)
     VALUES (?, date('now','localtime'), ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, summary_date) DO UPDATE SET
       health_score = excluded.health_score,
       summary = excluded.summary,
       highlights = excluded.highlights,
       warnings = excluded.warnings,
       suggestions = excluded.suggestions`
  ).run(
    userId,
    result.healthScore,
    summary,
    JSON.stringify(result.highlights),
    JSON.stringify(result.warnings),
    JSON.stringify(result.suggestions)
  );

  const row = db
    .prepare(
      "SELECT * FROM health_daily_summary WHERE user_id = ? AND summary_date = date('now','localtime')"
    )
    .get(userId) as SummaryRow;
  res.json({ code: 0, message: "ok", data: rowToView(row) });
});

/** GET /api/ai/goals —— 目标进度（从 healthGoal + 近 7 天现算） */
router.get("/ai/goals", (req, res) => {
  const userId = req.user!.id;
  ensureHealthGoals();
  const profile = profileForEngine(userId);
  const { recent7 } = loadDaily(userId);
  const goals = buildGoalProgress(
    (profile as { healthGoal?: string } | null)?.healthGoal ?? "",
    recent7
  );
  res.json({ code: 0, message: "ok", data: goals });
});

export default router;
