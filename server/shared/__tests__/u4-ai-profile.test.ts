/** M4 AI 画像规则纯函数测试 */
import { describe, expect, it } from "vitest";
import { buildAiProfile } from "../ai-profile.js";
import type { HealthProfile } from "../health-engine.js";
import type { RecentDay } from "../daily-health.js";

const baseProfile: HealthProfile = {
  name: "测试",
  gender: 1,
  age: 30,
  height: 170,
  weight: 65,
  waistline: 0,
  medicalHistory: "",
  familyHistory: "",
  allergyHistory: "",
  smoking: "",
  drinking: "",
  exercise: "",
  createTime: ""
};

describe("buildAiProfile", () => {
  it("无风险 + 生活规律 → 健康标杆型", () => {
    const daily: RecentDay[] = [1, 2, 3, 4, 5].map(d => ({
      date: `2026-09-${d}`,
      sleepHours: 8,
      exerciseMinutes: 30,
      moodScore: 3
    }));
    const r = buildAiProfile(baseProfile, daily, 0);
    expect(r.healthType).toBe("健康标杆型");
    expect(r.problems).toHaveLength(0);
    expect(r.score).toBeGreaterThanOrEqual(85);
    expect(r.riskLevel).toBe("低风险");
  });

  it("BMI 28+ 睡眠少 → 体重管理型 + 扣分可解释", () => {
    const p = { ...baseProfile, weight: 95 };
    const daily: RecentDay[] = [1, 2, 3, 4, 5].map(d => ({
      date: `2026-09-${d}`,
      sleepHours: 6,
      exerciseMinutes: 0,
      moodScore: 2
    }));
    const r = buildAiProfile(p, daily, 30);
    expect(r.problems.some(x => x.includes("BMI"))).toBe(true);
    expect(r.problems.some(x => x.includes("睡眠"))).toBe(true);
    expect(r.healthType).toBe("体重管理型");
    expect(r.suggestions.length).toBeGreaterThan(0);
  });

  it("无每日记录时不崩，仍出结论", () => {
    const r = buildAiProfile(baseProfile, [], 20);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.aiSummary).toBeTruthy();
  });

  it("高分段低风险，低分段高风险", () => {
    const good = buildAiProfile(baseProfile, [], 0);
    const bad = buildAiProfile(baseProfile, [], 90);
    expect(good.riskLevel).toBe("低风险");
    expect(bad.riskLevel).toBe("高风险");
    expect(good.score).toBeGreaterThan(bad.score);
  });
});
