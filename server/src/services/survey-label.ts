/**
 * V2.1 P1-1a：问卷生活方式风险标签。
 * 规则打分生成 low/medium/high，用于未来 LightGBM 真实标签冷启动。
 * ⚠️ 仅为生活方式风险标签，不构成医学诊断。
 */

export interface SurveyInput {
  sleep_hours_avg?: number | null;
  stay_up_freq?: number | null;
  study_pressure?: number | null;
  exercise_times?: number | null;
  diet_regular?: number | null;
  sedentary_hours?: number | null;
}

export interface SurveyLabelResult {
  score: number;
  label: "low" | "medium" | "high";
  factors: string[];
}

export function labelSurvey(s: SurveyInput): SurveyLabelResult {
  let score = 0;
  const factors: string[] = [];
  const num = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  if (num(s.sleep_hours_avg) != null && (s.sleep_hours_avg as number) < 7) {
    score += 1;
    factors.push("睡眠不足7小时");
  }
  if (num(s.stay_up_freq) != null && (s.stay_up_freq as number) >= 3) {
    score += 1;
    factors.push("每周熬夜≥3天");
  }
  if (num(s.study_pressure) != null && (s.study_pressure as number) >= 3) {
    score += 1;
    factors.push("学习压力偏高");
  }
  if (num(s.exercise_times) != null && (s.exercise_times as number) <= 2) {
    score += 1;
    factors.push("每周运动≤2次");
  }
  if (num(s.diet_regular) != null && (s.diet_regular as number) <= 1) {
    score += 1;
    factors.push("饮食不规律");
  }
  if (num(s.sedentary_hours) != null && (s.sedentary_hours as number) >= 8) {
    score += 1;
    factors.push("久坐≥8小时");
  }

  const label: "low" | "medium" | "high" =
    score >= 4 ? "high" : score >= 2 ? "medium" : "low";
  return { score, label, factors };
}
