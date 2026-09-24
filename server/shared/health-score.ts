/**
 * M7.4 统一健康评分共享层。
 * 之前 BMI/风险等级在 ai-profile.ts、companion.ts、profile.ts 各算一遍，
 * 抽到这里作为唯一源码，前后端可复用。
 */

/** BMI = weight(kg) / height(m)^2，null 表示数据不全 */
export function calculateBMI(
  heightCm: number | null | undefined,
  weightKg: number | null | undefined
): number | null {
  if (!heightCm || !weightKg) return null;
  return Number((weightKg / Math.pow(heightCm / 100, 2)).toFixed(1));
}

/** BMI 中文标签 */
export function bmiLabel(bmi: number | null): string {
  if (bmi === null) return "";
  if (bmi < 18.5) return "偏瘦";
  if (bmi < 24) return "正常";
  if (bmi < 28) return "超重";
  return "肥胖";
}

/** 风险等级：>=80 低风险，>=60 中风险，否则高风险 */
export function calculateRiskLevel(score: number): string {
  if (score >= 80) return "低风险";
  if (score >= 60) return "中风险";
  return "高风险";
}
