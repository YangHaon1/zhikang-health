/**
 * M7.4 统一健康评分共享层。
 * 之前 BMI 在 ai-profile.ts / health-engine.ts / risk.ts 各算一遍，
 * 抽到这里作为唯一源码，前后端可复用。
 *
 * 注意：本文件的「分数」语义与 health-engine.ts 一致 —— 分数越高越危险。
 * 早期版本里的 `calculateRiskLevel(score)`（>=80 判为「低风险」）方向相反，
 * 且全项目零调用，属于会被误用的地雷，已删除；分级请统一用 riskLevelOf()。
 */

/** BMI = weight(kg) / height(m)^2，null 表示数据不全 */
export function calculateBMI(
  heightCm: number | null | undefined,
  weightKg: number | null | undefined
): number | null {
  if (!heightCm || !weightKg) return null;
  return Number((weightKg / Math.pow(heightCm / 100, 2)).toFixed(1));
}
