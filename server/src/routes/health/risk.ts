/**
 * V2.0 P1-1B：亚健康风险预测路由。
 * GET /api/health/risk —— 先调 ML 服务，失败自动降级规则引擎；前端无感知。
 * 每次 ML 成功预测写入 risk_predictions 快照。
 */
import { Router } from "express";
import db from "../../db.js";
import { authMiddleware } from "../../middleware/auth.js";
import { analyzeHealth } from "../../../shared/health-engine.js";
import { profileForEngine, recordsForEngine } from "./common.js";
import { predictRisk, predictCluster } from "../../services/ml-client.js";
import { analyzeHealthType } from "../../services/health-type.js";

const router = Router();

/** 近7天每日记录聚合 → ML 特征 */
function buildFeatures(userId: number): Record<string, number> {
  const days = db
    .prepare(
      `SELECT sleep_hours, exercise_minutes, mood_score, sleep_quality, stress_level, diet_regularity
       FROM daily_health_records
       WHERE user_id = ? AND date >= date('now','localtime','-6 days')`
    )
    .all(userId) as Array<{
    sleep_hours: number | null;
    exercise_minutes: number | null;
    mood_score: number | null;
    sleep_quality: number | null;
    stress_level: number | null;
    diet_regularity: string | null;
  }>;

  const _n = days.length || 1;
  const avg = (arr: Array<number | null>) =>
    arr.filter((x): x is number => x != null).reduce((a, b) => a + b, 0) /
    (arr.filter(x => x != null).length || 1);

  const sp = db
    .prepare("SELECT * FROM student_profile WHERE user_id = ?")
    .get(userId) as
    | {
        sedentary_hours: number;
        study_hours: number;
        bedtime: string;
      }
    | undefined;

  // 就寝时间 HH:mm → 小时（23:30 → 23.5）
  let bedtimeHour = 0;
  if (sp?.bedtime) {
    const [h, m] = sp.bedtime.split(":").map(Number);
    bedtimeHour = h + (m || 0) / 60;
    if (bedtimeHour < 12) bedtimeHour += 24; // 凌晨算前一天深夜
  }

  // BMI
  const profile = profileForEngine(userId);
  const recs = recordsForEngine(userId);
  const latestWeight = recs[0]?.weight;
  let bmi = 0;
  if (profile?.height && (latestWeight || profile.weight)) {
    const w = latestWeight || profile.weight;
    bmi = Math.round((w / Math.pow(profile.height / 100, 2)) * 10) / 10;
  }

  return {
    sleep_hours_mean: Number(avg(days.map(d => d.sleep_hours)).toFixed(2)),
    sleep_below7_days: days.filter(d => (d.sleep_hours ?? 9) < 7).length,
    sleep_quality_avg: Number(avg(days.map(d => d.sleep_quality)).toFixed(2)),
    exercise_min_sum: days.reduce((s, d) => s + (d.exercise_minutes ?? 0), 0),
    exercise_days: days.filter(d => (d.exercise_minutes ?? 0) > 0).length,
    stress_avg: Number(avg(days.map(d => d.stress_level)).toFixed(2)),
    stress_high_days: days.filter(d => d.stress_level === 3).length,
    diet_reg_ratio:
      days.filter(d => d.diet_regularity === "good").length /
      (days.length || 1),
    mood_avg: Number(avg(days.map(d => d.mood_score)).toFixed(2)),
    study_hours: sp?.study_hours ?? 0,
    sedentary_hours: sp?.sedentary_hours ?? 0,
    bedtime_hour: bedtimeHour,
    is_off_campus: 0,
    grade_code: 3,
    bmi
  };
}

function saveSnapshot(
  userId: number,
  r: Awaited<ReturnType<typeof predictRisk>>
) {
  db.prepare(
    `INSERT INTO risk_predictions
       (user_id, risk_level, risk_probability, data_quality, shap_factors, model_version)
     VALUES (?,?,?,?,?,?)`
  ).run(
    userId,
    r.riskLevel,
    r.riskProbability,
    r.dataQuality.level,
    JSON.stringify(r.shapFactors),
    r.modelVersion
  );
}

/** 归一化 SHAP 贡献 → 0~100 相对重要度 */
function toImportance(
  shapFactors: Array<{ label: string; contribution: number; direction: string }>
) {
  const abs = shapFactors.map(f => Math.abs(f.contribution));
  const max = Math.max(...abs, 0.0001);
  return shapFactors.map(f => ({
    feature: f.label,
    label: f.label,
    value: Math.round((Math.abs(f.contribution) / max) * 100),
    direction: f.direction === "raise_risk" ? "risk_up" : "risk_down"
  }));
}

router.get("/health/risk", authMiddleware, async (req, res) => {
  const userId = req.user!.id;
  const features = buildFeatures(userId);
  try {
    const ml = await predictRisk(features);
    saveSnapshot(userId, ml);
    let healthType = analyzeHealthType(userId);
    try {
      const cluster = await predictCluster(features);
      if (cluster.available && cluster.name && healthType) {
        healthType = {
          ...healthType,
          name: cluster.name,
          description: cluster.description ?? healthType.description,
          source: "cluster" as const,
          confidence: cluster.confidence ?? 0
        };
      }
    } catch {
      /* cluster 失败保留规则分型 */
    }
    res.json({
      code: 0,
      message: "操作成功",
      data: {
        source: "ml",
        ...ml,
        healthType,
        modelExplain: { featureImportance: toImportance(ml.shapFactors) },
        features
      }
    });
  } catch {
    // 降级：规则引擎
    const result = analyzeHealth(
      recordsForEngine(userId),
      profileForEngine(userId)
    );
    res.json({
      code: 0,
      message: "规则引擎降级",
      data: {
        source: "rule",
        riskLevel:
          result.level === "低"
            ? "low"
            : result.level === "中"
              ? "medium"
              : "high",
        riskProbability: result.score / 100,
        dataQuality: { level: "rule", filledRatio: 0 },
        shapFactors: [],
        modelVersion: "rule-engine",
        healthType: analyzeHealthType(userId),
        modelExplain: { featureImportance: [] },
        features
      }
    });
  }
});

export default router;
