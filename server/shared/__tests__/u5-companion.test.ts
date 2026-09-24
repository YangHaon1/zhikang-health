/** M5 每日总结 + 目标进度纯函数测试 */
import { describe, expect, it } from "vitest";
import { buildDailySummary, buildGoalProgress } from "../daily-summary.js";

describe("buildDailySummary", () => {
  it("昨日睡眠达标+有运动 → highlights 有内容", () => {
    const r = buildDailySummary({
      yesterday: { sleepHours: 7.5, exerciseMinutes: 30, moodScore: 3 },
      recent7: [
        { sleepHours: 7.5, exerciseMinutes: 30, moodScore: 3 },
        { sleepHours: 7, exerciseMinutes: 20, moodScore: 3 },
        { sleepHours: 8, exerciseMinutes: 0, moodScore: 2 }
      ],
      healthGoal: "改善睡眠",
      aiScore: 86
    });
    expect(r.healthScore).toBe(86);
    expect(r.highlights.some(h => h.includes("睡眠"))).toBe(true);
    expect(r.suggestions.length).toBeGreaterThan(0);
  });

  it("未打卡 → warnings 提示", () => {
    const r = buildDailySummary({
      yesterday: null,
      recent7: [],
      healthGoal: "",
      aiScore: null
    });
    expect(r.warnings.some(w => w.includes("打卡"))).toBe(true);
  });
});

describe("buildGoalProgress", () => {
  it("运动目标：2/3 天 → 66%", () => {
    const goals = buildGoalProgress("提升运动能力", [
      { exerciseMinutes: 20, sleepHours: 8 },
      { exerciseMinutes: 30, sleepHours: 7 },
      { exerciseMinutes: 0, sleepHours: 6 }
    ]);
    const ex = goals.find(g => g.goalType === "exercise");
    expect(ex?.progress).toBe(67);
  });

  it("无目标 → 空数组", () => {
    expect(buildGoalProgress("", [])).toHaveLength(0);
  });
});
