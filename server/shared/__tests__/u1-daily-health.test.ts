/** M1 每日健康记录共享层测试：校验、今日指数、近7天建议 */
import { describe, expect, it } from "vitest";
import {
  buildDailyAdvice,
  buildTodayIndex,
  validateDailyInput,
  type NormalizedDaily
} from "../daily-health.js";

const empty: NormalizedDaily = {
  sleepHours: null,
  exerciseMinutes: null,
  moodScore: null,
  dietStatus: "",
  note: ""
};

describe("validateDailyInput", () => {
  it("空输入全部为 null（今天还没记录这项）", () => {
    const { value, error } = validateDailyInput({});
    expect(error).toBeNull();
    expect(value).toEqual(empty);
  });

  it("正常输入归一化", () => {
    const { value, error } = validateDailyInput({
      sleepHours: 7.5,
      exerciseMinutes: 30.4,
      moodScore: 3,
      dietStatus: "good",
      note: "  今天不错  "
    });
    expect(error).toBeNull();
    expect(value.sleepHours).toBe(7.5);
    expect(value.exerciseMinutes).toBe(30); // 取整
    expect(value.moodScore).toBe(3);
    expect(value.dietStatus).toBe("good");
    expect(value.note).toBe("今天不错");
  });

  it.each([
    [{ sleepHours: 25 }, "睡眠时长需在 0-24"],
    [{ sleepHours: -1 }, "睡眠时长需在 0-24"],
    [{ sleepHours: "abc" }, "睡眠时长需为数字"],
    [{ exerciseMinutes: 2000 }, "运动分钟需在 0-1440"],
    [{ moodScore: 4 }, "心情评分只能是"],
    [{ dietStatus: "great" }, "饮食状态只能是"]
  ])("非法输入报错：%#", (input, msg) => {
    const { error } = validateDailyInput(input as never);
    expect(error).toBeTruthy();
    expect(error).toContain(msg);
  });
});

describe("buildTodayIndex", () => {
  it("风险分 0 + 良好生活习惯 → 高分", () => {
    const idx = buildTodayIndex(0, {
      ...empty,
      sleepHours: 8,
      exerciseMinutes: 40,
      moodScore: 3,
      dietStatus: "good"
    });
    expect(idx.score).toBeGreaterThanOrEqual(95);
    expect(idx.levelText).toBe("良好");
    expect(idx.adjustments.length).toBe(4);
  });

  it("高风险分 + 熬夜久坐情绪差 → 低分钳制到 0 以上", () => {
    const idx = buildTodayIndex(95, {
      ...empty,
      sleepHours: 5,
      exerciseMinutes: 0,
      moodScore: 1,
      dietStatus: "poor"
    });
    expect(idx.score).toBeLessThanOrEqual(10);
    expect(idx.score).toBeGreaterThanOrEqual(0);
    expect(idx.levelText).toBe("需要关注");
  });

  it("无今日记录 → 只看基础健康分", () => {
    const idx = buildTodayIndex(20, empty);
    expect(idx.score).toBe(80);
    expect(idx.adjustments).toEqual([]);
    expect(idx.levelText).toBe("不错");
  });

  it("得分钳制不超过 100", () => {
    const idx = buildTodayIndex(0, {
      ...empty,
      sleepHours: 8,
      exerciseMinutes: 40,
      moodScore: 3,
      dietStatus: "good"
    });
    expect(idx.score).toBeLessThanOrEqual(100);
  });
});

describe("buildDailyAdvice", () => {
  it("连续睡眠偏少 → 睡眠建议", () => {
    const advice = buildDailyAdvice(
      [1, 2, 3, 4, 5].map(day => ({
        date: `2026-09-${day}`,
        sleepHours: 5.5,
        exerciseMinutes: 0,
        moodScore: 2
      }))
    );
    expect(advice.some(a => a.includes("睡眠"))).toBe(true);
  });

  it("运动天数不足 → 运动建议", () => {
    const advice = buildDailyAdvice(
      [1, 2, 3, 4, 5, 6, 7].map(day => ({
        date: `2026-09-${day}`,
        sleepHours: 8,
        exerciseMinutes: 0,
        moodScore: 3
      }))
    );
    expect(advice.some(a => a.includes("运动"))).toBe(true);
  });

  it("作息规律 → 保持建议", () => {
    const advice = buildDailyAdvice(
      [1, 2, 3, 4, 5, 6, 7].map(day => ({
        date: `2026-09-${day}`,
        sleepHours: 8,
        exerciseMinutes: 30,
        moodScore: 3
      }))
    );
    expect(advice[0]).toContain("保持");
  });

  it("空数据 → 兜底建议", () => {
    const advice = buildDailyAdvice([]);
    expect(advice.length).toBeGreaterThan(0);
  });
});
