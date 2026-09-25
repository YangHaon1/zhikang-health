/**
 * M4 AI 健康画像共享层（纯函数，前后端唯一源码）。
 *
 * 第一版不训练模型：**规则评分 + 规则文案**，断网可用、可复算、可解释。
 * LLM 只在生成时对文案做润色（见路由），评分/分级/问题清单永远来自这里。
 */
import type { HealthProfile } from "./health-engine.js";
import type { RecentDay } from "./daily-health.js";
import { calculateBMI } from "./health-score.js";

export interface AiProfileResult {
  /** 健康分 0-100（越高越好） */
  score: number;
  /** 低风险 / 中风险 / 高风险 */
  riskLevel: string;
  /** 画像类型：健康标杆型 / 体重管理型 / 睡眠改善型 / 运动提升型 / 轻度亚健康型 */
  healthType: string;
  /** 优势清单 */
  advantages: string[];
  /** 需要关注的问题清单 */
  problems: string[];
  /** 改善建议清单 */
  suggestions: string[];
  /** 一段总结文案 */
  aiSummary: string;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * 规则画像：基础健康分（100-风险分）± BMI / 近7天睡眠 / 运动 / 心情。
 * 所有加减分都在 problems 里留痕，保证「分数为什么是这样」可解释。
 */
export function buildAiProfile(
  profile: HealthProfile | null,
  daily7: RecentDay[],
  riskScore: number
): AiProfileResult {
  const advantages: string[] = [];
  const problems: string[] = [];
  const suggestions: string[] = [];

  let score = clamp(100 - riskScore, 0, 100);

  // BMI 统一走 health-score.calculateBMI（此前本文件内联了一份公式，是第 2 份实现）
  const bmi = calculateBMI(profile?.height ?? null, profile?.weight ?? null);
  if (bmi !== null) {
    if (bmi >= 28) {
      score -= 15;
      problems.push(`BMI ${bmi}，达到肥胖范围`);
      suggestions.push(
        "建议在医生/营养师指导下逐步减重，每周 150 分钟中等强度运动"
      );
    } else if (bmi >= 24) {
      score -= 8;
      problems.push(`BMI ${bmi}，略超重`);
      suggestions.push("控制每日总热量，减少含糖饮料与精制碳水");
    } else if (bmi < 18.5) {
      score -= 5;
      problems.push(`BMI ${bmi}，偏瘦`);
      suggestions.push("适当增加优质蛋白与主食，避免过度节食");
    } else {
      advantages.push(`BMI ${bmi}，体重保持正常`);
    }
  }

  // --- 近 7 天睡眠 ---
  const sleeps = daily7
    .map(d => d.sleepHours)
    .filter((h): h is number => h !== null);
  if (sleeps.length >= 3) {
    const avg = sleeps.reduce((s, h) => s + h, 0) / sleeps.length;
    if (avg < 7) {
      score -= 10;
      problems.push(
        `近 ${sleeps.length} 天平均睡眠 ${avg.toFixed(1)} 小时，偏少`
      );
      suggestions.push("固定起床时间，睡前 1 小时不看手机，目标每晚 7-9 小时");
    } else if (avg > 9) {
      score -= 3;
      problems.push(
        `近 ${sleeps.length} 天平均睡眠 ${avg.toFixed(1)} 小时，偏长`
      );
    } else {
      advantages.push("睡眠规律（平均 7-9 小时）");
    }
  }

  // --- 近 7 天运动 ---
  const exerciseDays = daily7.filter(d => (d.exerciseMinutes ?? 0) > 0).length;
  if (daily7.length > 0) {
    if (exerciseDays < 3) {
      score -= 10;
      problems.push(`近 ${daily7.length} 天仅 ${exerciseDays} 天有运动`);
      suggestions.push(
        "从每天 10 分钟快走开始，逐步达到每周 150 分钟中等强度运动"
      );
    } else {
      advantages.push(
        `近 ${daily7.length} 天运动 ${exerciseDays} 天，频率良好`
      );
    }
  }

  // --- 心情 ---
  const moods = daily7
    .map(d => d.moodScore)
    .filter((m): m is number => m !== null);
  if (moods.length >= 3) {
    const avg = moods.reduce((s, m) => s + m, 0) / moods.length;
    if (avg < 2) {
      score -= 8;
      problems.push("近期情绪偏低");
      suggestions.push("安排社交或户外活动，必要时与亲友倾诉或寻求心理支持");
    }
  }

  score = Math.round(clamp(score, 0, 100));

  // --- 风险等级 ---
  const riskLevel = score >= 80 ? "低风险" : score >= 60 ? "中风险" : "高风险";

  // --- 画像类型（按主要问题归类）---
  let healthType: string;
  if (problems.length === 0) {
    healthType = "健康标杆型";
  } else if (problems.some(p => p.includes("BMI"))) {
    healthType = "体重管理型";
  } else if (problems.some(p => p.includes("睡眠"))) {
    healthType = "睡眠改善型";
  } else if (problems.some(p => p.includes("运动"))) {
    healthType = "运动提升型";
  } else {
    healthType = "轻度亚健康型";
  }

  // --- 总结文案 ---
  const advText = advantages.length
    ? `你的优势是：${advantages.join("、")}。`
    : "";
  const probText = problems.length
    ? `需要关注：${problems.join("；")}。`
    : "各项指标均在健康范围，继续保持。";
  const aiSummary = `${advText}${probText}`.trim();

  return {
    score,
    riskLevel,
    healthType,
    advantages,
    problems,
    suggestions,
    aiSummary
  };
}
