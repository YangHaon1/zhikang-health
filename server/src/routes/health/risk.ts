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
import { calculateBMI } from "../../../shared/health-score.js";

const router = Router();

/**
 * 年级文本 → 训练用的 grade_code（与合成数据的 1..6 对齐）。
 * 之前对所有用户硬编码 grade_code=3，属于凭空捏造的特征。
 */
const GRADE_CODE: Record<string, number> = {
  大一: 1,
  大二: 2,
  大三: 3,
  大四: 4,
  研一: 5,
  研二: 6,
  研三: 6
};

function gradeCodeOf(grade?: string | null): number | null {
  if (!grade) return null;
  return GRADE_CODE[grade] ?? null;
}

/** 近7天每日记录聚合 → ML 特征。同时返回记录天数，供数据充分度判断。 */
function buildFeatures(userId: number): {
  features: Record<string, number | null>;
  days: number;
} {
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
        is_off_campus: number | null;
        grade: string | null;
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
  // BMI 公式统一走 shared/health-score.calculateBMI（此前本文件内联了一份，是第 4 份实现）
  let bmi: number | null = null;
  if (profile?.height && (latestWeight || profile.weight)) {
    bmi = calculateBMI(profile.height, latestWeight || profile.weight);
  }

  return {
    features: {
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
      // 缺失一律传 null：由 ML 侧按训练集统计值填充。
      // 传 0 会被当成"极端行为"（就寝 0 点、BMI 0、久坐 0 小时），
      // 实测新用户（全 0）被判 high / 0.904，属于必须修的方向性错误。
      study_hours: sp?.study_hours ?? null,
      sedentary_hours: sp?.sedentary_hours ?? null,
      bedtime_hour: sp?.bedtime ? bedtimeHour : null,
      is_off_campus: sp?.is_off_campus ?? null,
      grade_code: gradeCodeOf(sp?.grade),
      bmi: bmi
    },
    days: days.length
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

/**
 * 归一化 SHAP 贡献 → 0~100 相对重要度（仅用于画条形图的长度）。
 * 方向与说明一律透传后端 SHAP 结果，这里不做任何方向判断。
 */
function toImportance(
  shapFactors: Array<{
    factor?: string;
    feature?: string;
    label: string;
    value?: number;
    contribution?: number;
    direction: string;
    description?: string;
  }>
) {
  const contrib = (f: (typeof shapFactors)[number]) =>
    Math.abs(f.value ?? f.contribution ?? 0);
  const abs = shapFactors.map(contrib);
  const max = Math.max(...abs, 0.0001);
  return shapFactors.map(f => ({
    // 保留真实特征键（前端用作 :key），不再退化成中文文案
    feature: f.factor ?? f.feature ?? f.label,
    label: f.label,
    value: Math.round((contrib(f) / max) * 100),
    // 真实贡献值，供前端展示，避免"只能看相对长度"
    shap: f.value ?? f.contribution ?? 0,
    // direction 必须原样透传。SHAP 降级路径返回的是 unknown（只有全局 gain 重要性、
    // 没有方向信息），若一律归成 risk_down，等于把「不知道」说成「降低风险」——
    // 正是本次要修的"伪装方向"问题。前端对 unknown 会显示"方向待定"。
    direction:
      f.direction === "raise_risk"
        ? "risk_up"
        : f.direction === "lower_risk"
          ? "risk_down"
          : "unknown",
    description: f.description ?? ""
  }));
}

router.get("/health/risk", authMiddleware, async (req, res) => {
  const userId = req.user!.id;
  const { features, days } = buildFeatures(userId);

  // 近 7 天没有任何每日记录 → 不做预测。
  // 空输入落在训练分布之外，模型会给出无意义的 high 风险（实测 0.904），
  // 直接返回"数据不足"，由前端引导用户先记录。
  if (days === 0) {
    res.json({
      code: 0,
      message: "数据不足，请先记录健康数据",
      data: {
        source: "insufficient",
        riskLevel: "unknown",
        riskProbability: 0,
        dataQuality: { level: "empty", filledRatio: 0 },
        shapFactors: [],
        modelVersion: "none",
        healthType: null,
        modelExplain: { featureImportance: [] },
        features
      }
    });
    return;
  }

  try {
    const ml = await predictRisk(features as Record<string, number>);

    // ML 侧判定数据不足（关键字段全缺）时，不把 unknown 当成真实结论展示
    if (ml.sufficient === false) {
      res.json({
        code: 0,
        message: ml.message ?? "数据不足，请补充健康记录",
        data: {
          source: "insufficient",
          riskLevel: "unknown",
          riskProbability: 0,
          dataQuality: ml.dataQuality,
          shapFactors: [],
          modelVersion: ml.modelVersion,
          healthType: analyzeHealthType(userId),
          modelExplain: { featureImportance: [] },
          features
        }
      });
      return;
    }

    saveSnapshot(userId, ml);
    let healthType = analyzeHealthType(userId);
    try {
      const cluster = await predictCluster(features as Record<string, number>);
      if (cluster.available && cluster.name && healthType) {
        healthType = {
          ...healthType,
          name: cluster.name,
          description: cluster.description ?? healthType.description,
          source: "cluster" as const,
          confidence: cluster.confidence ?? 0
        };
      }
    } catch (err) {
      // 聚类失败时保留规则分型，但必须留痕 ——
      // 否则现场会看到「行为画像」这一栏是规则兜底出来的却毫无提示
      console.warn("[risk] 聚类预测失败，保留规则分型:", err);
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
