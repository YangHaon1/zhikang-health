/**
 * C1 竞赛优化：健康行动计划与打卡闭环单元测试。
 * 覆盖：风险→计划模板生成（buildPlanFromAnalysis）、完成率口径（planProgress/dueCountOf）、
 * 连续打卡天数（streakOf）、下周期建议（completionAdvice）。
 */
import { describe, expect, it } from "vitest";
import {
  addDays,
  buildPlanFromAnalysis,
  completionAdvice,
  dueCountOf,
  fmtDate,
  planProgress,
  streakOf
} from "../health-plan.js";
import { analyzeHealth } from "../health-engine.js";
import type { HealthRecord } from "../health-engine.js";

// ---------- 工具 ----------

function rec(partial: Partial<HealthRecord> & { date: string }): HealthRecord {
  return { id: "1", ...partial };
}

// ---------- buildPlanFromAnalysis ----------

describe("buildPlanFromAnalysis（风险 → 计划模板）", () => {
  it("血压异常 → 血压改善计划（含测量/饮食/运动/生活习惯任务）", () => {
    const r = rec({ date: "2026-09-20", systolic: 155, diastolic: 98 });
    const analyze = analyzeHealth([r], null);
    const plan = buildPlanFromAnalysis(analyze, "2026-09-20", "2026-10-04");
    expect(plan).not.toBeNull();
    expect(plan!.title).toBe("血压改善计划");
    expect(plan!.riskKey).toBe("bloodPressure");
    expect(plan!.tasks.length).toBeGreaterThanOrEqual(3);
    expect(plan!.tasks.some(t => t.taskType === "measure")).toBe(true);
  });

  it("血糖异常 → 血糖管理计划", () => {
    const r = rec({ date: "2026-09-20", fastingGlucose: 7.5 });
    const plan = buildPlanFromAnalysis(
      analyzeHealth([r], null),
      "2026-09-20",
      "2026-10-04"
    );
    expect(plan!.title).toBe("血糖管理计划");
    expect(plan!.riskKey).toBe("bloodGlucose");
  });

  it("血脂异常 → 血脂改善计划（血脂分类合并）", () => {
    const r = rec({ date: "2026-09-20", totalCholesterol: 6.8 });
    const plan = buildPlanFromAnalysis(
      analyzeHealth([r], null),
      "2026-09-20",
      "2026-10-04"
    );
    expect(plan!.riskKey).toBe("lipid");
  });

  it("仅生活方式风险 → lifestyle 计划", () => {
    const profile = {
      name: "t",
      gender: 1,
      age: 30,
      height: 175,
      weight: 70,
      waistline: 80,
      medicalHistory: "",
      familyHistory: "",
      allergyHistory: "",
      smoking: "经常",
      drinking: "从不",
      exercise: "几乎不运动",
      createTime: "2026-01-01 00:00:00"
    };
    const r = rec({
      date: "2026-09-20",
      systolic: 118,
      diastolic: 76,
      fastingGlucose: 5.0
    });
    const plan = buildPlanFromAnalysis(
      analyzeHealth([r], profile),
      "2026-09-20",
      "2026-10-04"
    );
    expect(plan).not.toBeNull();
    expect(plan!.riskKey).toBe("lifestyle");
  });

  it("完全无风险 → null（前端提示无需生成）", () => {
    const r = rec({
      date: "2026-09-20",
      systolic: 118,
      diastolic: 76,
      fastingGlucose: 5.0
    });
    const plan = buildPlanFromAnalysis(
      analyzeHealth([r], null),
      "2026-09-20",
      "2026-10-04"
    );
    expect(plan).toBeNull();
  });

  it("空数据 → null", () => {
    expect(
      buildPlanFromAnalysis(analyzeHealth([], null), "2026-09-20", "2026-10-04")
    ).toBeNull();
  });
});

// ---------- 完成率口径 ----------

describe("planProgress / dueCountOf（完成率唯一口径）", () => {
  const tasks = [
    { id: 1, frequency: "daily" as const, title: "每日测量血压" },
    { id: 2, frequency: "daily" as const, title: "低盐饮食" },
    { id: 3, frequency: "weekly" as const, title: "每周测一次体重" }
  ];

  it("daily 应打卡=窗口天数；weekly 应打卡=ceil(天数/7)", () => {
    expect(dueCountOf("daily", "2026-09-20", "2026-09-26")).toBe(7);
    expect(dueCountOf("weekly", "2026-09-20", "2026-09-26")).toBe(1);
    expect(dueCountOf("weekly", "2026-09-20", "2026-10-10")).toBe(3); // 21 天
  });

  it("7 天窗口全打卡 → 完成率 100%（报告与进度接口同口径的基础）", () => {
    const checkins = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays("2026-09-20", i);
      checkins.push(
        { taskId: 1, checkedDate: d },
        { taskId: 2, checkedDate: d }
      );
      if (i === 0) checkins.push({ taskId: 3, checkedDate: d });
    }
    const p = planProgress(
      1,
      tasks,
      checkins,
      "2026-09-20",
      "2026-09-26",
      "2026-09-26"
    );
    expect(p.dueCount).toBe(7 + 7 + 1);
    expect(p.doneCount).toBe(14 + 1);
    expect(p.rate).toBe(100);
    expect(p.perTask[0].due).toBe(7);
    expect(p.perTask[0].done).toBe(7);
  });

  it("部分打卡 → 完成率按实际/应打计算（如 7 天窗口只打 3 天血压）", () => {
    const checkins = [];
    for (let i = 0; i < 3; i++) {
      checkins.push({ taskId: 1, checkedDate: addDays("2026-09-20", i) });
    }
    const p = planProgress(
      1,
      tasks,
      checkins,
      "2026-09-20",
      "2026-09-26",
      "2026-09-26"
    );
    expect(p.dueCount).toBe(15);
    expect(p.doneCount).toBe(3);
    expect(p.rate).toBe(20);
  });

  it("窗口截断到今天（endDate 在未来）", () => {
    const checkins = [{ taskId: 1, checkedDate: "2026-09-20" }];
    const p = planProgress(
      1,
      tasks,
      checkins,
      "2026-09-20",
      "2026-10-10",
      "2026-09-22"
    );
    // 窗口 = 09-20 ~ 09-22 共 3 天；2×daily(3) + 1×weekly(1) = 7
    expect(p.dueCount).toBe(7);
    expect(p.doneCount).toBe(1);
  });

  it("无任务或空窗口安全返回", () => {
    const p = planProgress(1, [], [], "2026-09-20", "2026-09-26", "2026-09-26");
    expect(p.rate).toBe(0);
    expect(p.totalTasks).toBe(0);
  });
});

// ---------- 连续打卡 ----------

describe("streakOf（连续打卡天数）", () => {
  it("今天有打卡 → 从今天起算连续天数", () => {
    const s = new Set([
      "2026-09-20",
      "2026-09-19",
      "2026-09-18",
      "2026-09-16" // 09-17 断开
    ]);
    expect(streakOf(s, "2026-09-20")).toBe(3);
  });

  it("今天未打卡 → 从昨天起算（不因今天没打而中断历史连续）", () => {
    const s = new Set(["2026-09-19", "2026-09-18", "2026-09-17"]);
    expect(streakOf(s, "2026-09-20")).toBe(3);
  });

  it("无打卡 → 0", () => {
    expect(streakOf(new Set(), "2026-09-20")).toBe(0);
  });
});

// ---------- 下周期建议 ----------

describe("completionAdvice（下周期建议）", () => {
  it("无计划 → 引导生成计划", () => {
    expect(completionAdvice(false, 0, 0)).toContain("尚未制定行动计划");
  });
  it("高完成率 → 鼓励保持", () => {
    expect(completionAdvice(true, 85, 6)).toContain("保持节奏");
  });
  it("中完成率 → 建议精简", () => {
    expect(completionAdvice(true, 55, 4)).toContain("精简任务");
  });
  it("低完成率 → 建议重新评估", () => {
    expect(completionAdvice(true, 10, 1)).toContain("重新评估");
  });
});

// ---------- 日期工具 ----------

describe("日期工具", () => {
  it("fmtDate 输出本地 yyyy-MM-dd", () => {
    expect(fmtDate(new Date(2026, 8, 5))).toBe("2026-09-05");
  });
  it("addDays 跨月正确", () => {
    expect(addDays("2026-09-30", 2)).toBe("2026-10-02");
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
  });
});
