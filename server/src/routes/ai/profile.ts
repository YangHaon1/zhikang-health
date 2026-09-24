/**
 * M4 AI 健康画像：`POST /api/ai/profile/generate`、`GET /api/ai/profile`。
 *
 * 评分/分级/问题清单全部来自共享层 `@shared/ai-profile`（规则、可复算、断网可用）；
 * 大模型只在生成时润色一段总结，失败则用规则文案，不阻塞主流程。
 * 结果 UPSERT 到 health_ai_profiles（user_id UNIQUE），前端刷新不重算。
 */
import { Router } from "express";
import db, { ensureHealthAiProfiles } from "../../db.js";
import { authMiddleware } from "../../middleware/auth.js";
import { analyzeHealth } from "../../../shared/health-engine.js";
import {
  buildAiProfile,
  type AiProfileResult
} from "../../../shared/ai-profile.js";
import { profileForEngine, recordsForEngine } from "../health/common.js";
import { llmAvailable, callLlm } from "../../llm.js";
import { calculateBMI } from "../../../shared/health-score.js";

const router = Router();
router.use(authMiddleware);

interface AiProfileRow {
  id: number;
  health_type: string;
  health_score: number;
  risk_level: string;
  advantages: string;
  problems: string;
  suggestions: string;
  ai_summary: string;
  created_at: string;
  updated_at: string;
}

function rowToView(row: AiProfileRow) {
  return {
    id: row.id,
    healthType: row.health_type,
    healthScore: row.health_score,
    riskLevel: row.risk_level,
    advantages: JSON.parse(row.advantages || "[]") as string[],
    problems: JSON.parse(row.problems || "[]") as string[],
    suggestions: JSON.parse(row.suggestions || "[]") as string[],
    aiSummary: row.ai_summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** 取近 7 天每日记录（算平均用） */
function recentDaily(userId: number) {
  ensureHealthAiProfiles();
  return db
    .prepare(
      `SELECT sleep_hours, exercise_minutes, mood_score FROM daily_health_records
       WHERE user_id = ? AND date >= date('now','localtime','-6 days') ORDER BY date ASC`
    )
    .all(userId) as Array<{
    sleep_hours: number | null;
    exercise_minutes: number | null;
    mood_score: number | null;
  }>;
}

/** GET /api/ai/profile —— 读已有画像（无则 null，前端引导用户点「生成」） */
router.get("/ai/profile", (req, res) => {
  const row = db
    .prepare("SELECT * FROM health_ai_profiles WHERE user_id = ?")
    .get(req.user!.id) as AiProfileRow | undefined;
  res.json({ code: 0, message: "ok", data: row ? rowToView(row) : null });
});

/** POST /api/ai/profile/generate —— 重新分析并覆盖保存 */
router.post("/ai/profile/generate", async (req, res) => {
  const userId = req.user!.id;
  ensureHealthAiProfiles();

  const profile = profileForEngine(userId);

  // M7.5-P1: 基础档案不完整时不生成空画像
  if (!profile || !profile.age || !profile.height || !profile.weight) {
    res.status(400).json({ code: 400, message: "请先完善基础健康档案" });
    return;
  }

  const records = recordsForEngine(userId);
  const risk = analyzeHealth(records, profile);
  const daily7 = recentDaily(userId).map(d => ({
    date: "",
    sleepHours: d.sleep_hours,
    exerciseMinutes: d.exercise_minutes,
    moodScore: d.mood_score
  }));

  const result: AiProfileResult = buildAiProfile(profile, daily7, risk.score);

  // LLM 只润色总结句，失败用规则文案（不阻塞）
  let summary = result.aiSummary;
  if (llmAvailable()) {
    const prompt = `用户健康数据：年龄${profile?.age ?? "未知"}，BMI ${calculateBMI(profile?.height, profile?.weight) ?? "未知"}；近7天平均睡眠${daily7.length ? daily7.filter(d => d.sleepHours).length : 0}天有记录。
规则结论：${result.aiSummary}
请用 2-3 句温暖、具体、可执行的中文重新总结（不要诊断疾病）。`;
    const llm = await callLlm([{ role: "user", content: prompt }]);
    if (llm.ok) summary = llm.text;
  }

  db.prepare(
    `INSERT INTO health_ai_profiles
       (user_id, health_type, health_score, risk_level, advantages, problems, suggestions, ai_summary, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
     ON CONFLICT(user_id) DO UPDATE SET
       health_type = excluded.health_type,
       health_score = excluded.health_score,
       risk_level = excluded.risk_level,
       advantages = excluded.advantages,
       problems = excluded.problems,
       suggestions = excluded.suggestions,
       ai_summary = excluded.ai_summary,
       updated_at = excluded.updated_at`
  ).run(
    userId,
    result.healthType,
    result.score,
    result.riskLevel,
    JSON.stringify(result.advantages),
    JSON.stringify(result.problems),
    JSON.stringify(result.suggestions),
    summary
  );

  const row = db
    .prepare("SELECT * FROM health_ai_profiles WHERE user_id = ?")
    .get(userId) as AiProfileRow;
  res.json({ code: 0, message: "ok", data: rowToView(row) });
});

export default router;
