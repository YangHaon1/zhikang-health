/**
 * V2.1 P0-1：生活方式健康类型分型。
 * 纯规则模块，基于近7天 daily + student_profile 判定生活方式倾向。
 * 不调用 LightGBM、不改 health-engine、不写库。输出全部为生活方式语言，无疾病诊断。
 */
import db from "../db.js";

export interface HealthTypeResult {
  type: "sleep" | "stress" | "sedentary" | "diet" | "balanced";
  name: string;
  description: string;
  confidence: number;
  factors: string[];
  suggestions: string[];
  source?: "rule" | "cluster";
  scores: {
    sleep: number;
    stress: number;
    exercise: number;
    diet: number;
  };
}

interface DayRow {
  sleep_hours: number | null;
  exercise_minutes: number | null;
  mood_score: number | null;
  sleep_quality: number | null;
  stress_level: number | null;
  diet_regularity: string | null;
}

/** 把 daily 的维度分换算成 0-100 风险分（越高越需关注） */
function scoreOf(
  sleepBelow7: number,
  avgStress: number,
  exerciseDays: number,
  goodDietRatio: number
) {
  return {
    sleep: Math.min(100, sleepBelow7 * 18),
    stress: Math.min(100, Math.round((avgStress / 3) * 100)),
    exercise: Math.min(100, Math.max(0, (3 - exerciseDays) * 28)),
    diet: Math.min(100, Math.round((1 - goodDietRatio) * 100))
  };
}

export function analyzeHealthType(userId: number): HealthTypeResult | null {
  const days = db
    .prepare(
      `SELECT sleep_hours, exercise_minutes, mood_score, sleep_quality, stress_level, diet_regularity
       FROM daily_health_records
       WHERE user_id = ? AND date >= date('now','localtime','-6 days')`
    )
    .all(userId) as DayRow[];
  if (!days.length) return null;

  const n = days.length;
  const sleepBelow7 = days.filter(d => (d.sleep_hours ?? 9) < 7).length;
  const stressDays = days.filter(d => d.stress_level === 3).length;
  const avgStress =
    days
      .filter(d => d.stress_level != null)
      .reduce((s, d) => s + (d.stress_level ?? 0), 0) /
    Math.max(1, days.filter(d => d.stress_level != null).length);
  const exerciseDays = days.filter(d => (d.exercise_minutes ?? 0) > 0).length;
  const goodDietRatio =
    days.filter(d => d.diet_regularity === "good").length / n;

  const sp = db
    .prepare("SELECT sedentary_hours FROM student_profile WHERE user_id = ?")
    .get(userId) as { sedentary_hours: number } | undefined;
  const sedentary = sp?.sedentary_hours ?? 0;

  const scores = scoreOf(sleepBelow7, avgStress, exerciseDays, goodDietRatio);

  // 按维度分排序，取最高且超过阈值的类型
  const candidates = [
    { type: "sleep" as const, score: scores.sleep, hit: sleepBelow7 >= 4 },
    { type: "stress" as const, score: scores.stress, hit: avgStress >= 2.5 },
    {
      type: "sedentary" as const,
      score: scores.exercise,
      hit: sedentary >= 8 && exerciseDays <= 2
    },
    { type: "diet" as const, score: scores.diet, hit: goodDietRatio < 0.4 }
  ].sort((a, b) => b.score - a.score);

  const top = candidates[0];
  const confidence = Math.round(Math.min(95, 40 + top.score * 0.5));

  if (!top.hit || top.score < 35) {
    return {
      type: "balanced",
      name: "健康平衡型",
      description: "近期作息、运动与饮食整体较为规律，继续保持当前生活节奏。",
      confidence,
      factors: [],
      suggestions: ["保持当前作息与运动习惯", "每周做一次健康复盘"],
      scores
    };
  }

  const meta: Record<
    string,
    {
      name: string;
      description: string;
      factors: string[];
      suggestions: string[];
    }
  > = {
    sleep: {
      name: "作息紊乱型",
      description: "近期睡眠时长偏短或入睡时间较晚，身体恢复可能不充分。",
      factors: [`近${n}天中 ${sleepBelow7} 天睡眠不足7小时`],
      suggestions: ["固定 23:30 前入睡", "周末不熬夜补觉超过2小时"]
    },
    stress: {
      name: "压力负荷型",
      description: "近期压力水平偏高，情绪恢复需要关注。",
      factors: [`平均压力 ${avgStress.toFixed(1)}/3，高压 ${stressDays} 天`],
      suggestions: ["每天10分钟放松或散步", "学习50分钟后起身活动5分钟"]
    },
    sedentary: {
      name: "久坐不足型",
      description: "久坐时间较长，日常运动量偏少。",
      factors: [`日均久坐约 ${sedentary} 小时，周运动 ${exerciseDays} 天`],
      suggestions: ["每节课间走动", "每周3次、每次30分钟快走"]
    },
    diet: {
      name: "饮食失衡型",
      description: "近期饮食规律度偏低，用餐时间不稳定。",
      factors: [`饮食规律天数占比 ${Math.round(goodDietRatio * 100)}%`],
      suggestions: ["固定三餐时间", "减少睡前加餐"]
    }
  };

  const m = meta[top.type];
  return {
    type: top.type,
    name: m.name,
    description: m.description,
    confidence,
    factors: m.factors,
    suggestions: m.suggestions,
    scores
  };
}
