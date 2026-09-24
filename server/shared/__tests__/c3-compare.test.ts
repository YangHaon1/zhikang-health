/**
 * C3 竞赛优化：报告对比与效果评估单元测试。
 * 覆盖：无历史降级、评分变化与方向阈值、风险点差集（新增/消失/持续）、
 * 计划完成率对比、对比结论文案，以及「结果可复算」（落库读回一致）。
 */
import { describe, expect, it } from "vitest";
import {
  SCORE_STABLE_THRESHOLD,
  buildReportComparison,
  riskKeyOf
} from "../health-report.js";
import type { ComparisonSide } from "../health-report.js";

// ---------- 工具 ----------

/** 造一侧对比输入（默认无风险点、无计划） */
function side(
  partial: Partial<ComparisonSide> & { score: number }
): ComparisonSide {
  return { risks: [], planRate: null, ...partial };
}

/** 一份「上期」样例 */
function prevSide(over: Partial<ComparisonSide> = {}): ComparisonSide {
  return side({
    reportId: "7",
    period: "2026-08-01 ~ 2026-08-31",
    generateTime: "2026-08-31T02:00:00.000Z",
    score: 70,
    level: "中",
    risks: ["收缩压：一级高血压（155）", "舒张压：一级高血压（98）", "吸烟"],
    planRate: 60,
    ...over
  });
}

// ---------- 无历史 → 降级 ----------

describe("buildReportComparison（无上期报告）", () => {
  it("上期为 null → 返回 null（前端据此降级展示「暂无上周期报告」）", () => {
    expect(buildReportComparison(side({ score: 88 }), null)).toBeNull();
  });
});

// ---------- scoreDelta 与方向 ----------

describe("scoreDelta 与结论方向", () => {
  it("风险分升高 → 正差值 + worsened（分高即风险高）", () => {
    const c = buildReportComparison(
      side({ score: 85 }),
      prevSide({ score: 70 })
    )!;
    expect(c.scoreDelta).toBe(15);
    // 引擎的 score 是风险分（越高越差），升高即恶化
    expect(c.direction).toBe("worsened");
  });

  it("风险分下降 → 负差值 + improved", () => {
    const c = buildReportComparison(
      side({ score: 55 }),
      prevSide({ score: 70 })
    )!;
    expect(c.scoreDelta).toBe(-15);
    expect(c.direction).toBe("improved");
  });

  it("风险分与风险等级方向一致（分越高级别越重）", () => {
    // 与 health-engine 的 riskLevelOf 同向：分高 → 等级重
    const better = buildReportComparison(
      side({ score: 20, level: "低" }),
      prevSide({ score: 90, level: "极高" })
    )!;
    expect(better.direction).toBe("improved");
    expect(better.conclusion).toContain("好转");
    const worse = buildReportComparison(
      side({ score: 90, level: "极高" }),
      prevSide({ score: 20, level: "低" })
    )!;
    expect(worse.direction).toBe("worsened");
    expect(worse.conclusion).toContain("恶化");
  });

  it("阈值内（±3 分）视为持平", () => {
    expect(SCORE_STABLE_THRESHOLD).toBe(3);
    for (const delta of [-3, -1, 0, 2, 3]) {
      const c = buildReportComparison(
        side({ score: 70 + delta }),
        prevSide({ score: 70 })
      )!;
      expect(c.scoreDelta).toBe(delta);
      expect(c.direction).toBe("stable");
    }
  });

  it("刚好越过阈值（±4 分）即判定方向", () => {
    expect(
      buildReportComparison(side({ score: 74 }), prevSide({ score: 70 }))!
        .direction
    ).toBe("worsened");
    expect(
      buildReportComparison(side({ score: 66 }), prevSide({ score: 70 }))!
        .direction
    ).toBe("improved");
  });
});

// ---------- 风险点差集 ----------

describe("riskDeltas 差集（新增 / 消失 / 持续）", () => {
  it("三类齐全，且顺序为 新增 → 持续 → 消失", () => {
    const c = buildReportComparison(
      side({
        score: 80,
        risks: [
          "收缩压：一级高血压（148）", // 上期也有（键相同）→ 持续
          "空腹血糖：疑似糖尿病（7.4）", // 上期没有 → 新增
          "吸烟" // 上期也有 → 持续
        ]
      }),
      prevSide()
    )!;

    expect(c.riskDeltas.map(d => d.kind)).toEqual([
      "new",
      "ongoing",
      "ongoing",
      "gone"
    ]);
    expect(c.riskAdded).toBe(1);
    expect(c.riskOngoing).toBe(2);
    expect(c.riskGone).toBe(1);
    // 消失的那条用上期原文（本期已经没有它了）
    expect(c.riskDeltas.find(d => d.kind === "gone")!.risk).toBe(
      "舒张压：一级高血压（98）"
    );
  });

  it("同一指标的测值变化只算「持续」，不误判成新增+消失", () => {
    // 报告 risks 文案里带具体测值，若按整串比对，155 → 148 会同时进 new 与 gone
    const c = buildReportComparison(
      side({ score: 80, risks: ["收缩压：一级高血压（148）"] }),
      prevSide({ risks: ["收缩压：一级高血压（155）"] })
    )!;

    expect(c.riskAdded).toBe(0);
    expect(c.riskGone).toBe(0);
    expect(c.riskOngoing).toBe(1);
    // 展示用本期原文（最新的测值）
    expect(c.riskDeltas[0]).toEqual({
      risk: "收缩压：一级高血压（148）",
      kind: "ongoing"
    });
  });

  it("分级文案变化（警戒 → 异常）仍算持续：同一指标就是同一个风险", () => {
    const c = buildReportComparison(
      side({ score: 60, risks: ["收缩压：二级高血压（170）"] }),
      prevSide({ risks: ["收缩压：一级高血压（155）"] })
    )!;
    expect(c.riskAdded).toBe(0);
    expect(c.riskOngoing).toBe(1);
  });

  it("无冒号的生活方式风险按整串匹配", () => {
    const c = buildReportComparison(
      side({ score: 80, risks: ["吸烟", "饮酒"] }),
      prevSide({ risks: ["吸烟"] })
    )!;
    expect(c.riskAdded).toBe(1);
    expect(c.riskOngoing).toBe(1);
    expect(c.riskDeltas.find(d => d.kind === "new")!.risk).toBe("饮酒");
  });

  it("两期风险点相同 → 全部持续，无增减", () => {
    const risks = ["吸烟", "运动不足"];
    const c = buildReportComparison(
      side({ score: 80, risks }),
      prevSide({ risks })
    )!;
    expect(c.riskAdded).toBe(0);
    expect(c.riskGone).toBe(0);
    expect(c.riskOngoing).toBe(2);
  });

  it("本期无风险点 → 上期全部标记消失", () => {
    const c = buildReportComparison(
      side({ score: 95, risks: [] }),
      prevSide({ risks: ["吸烟", "饮酒"] })
    )!;
    expect(c.riskAdded).toBe(0);
    expect(c.riskGone).toBe(2);
    expect(c.riskOngoing).toBe(0);
  });
});

describe("riskKeyOf（匹配键口径）", () => {
  it("取「：」前的指标名", () => {
    expect(riskKeyOf("收缩压：一级高血压（155）")).toBe("收缩压");
    expect(riskKeyOf("空腹血糖：疑似糖尿病（7.4）")).toBe("空腹血糖");
  });

  it("无冒号（生活方式类）返回整串", () => {
    expect(riskKeyOf("吸烟")).toBe("吸烟");
    expect(riskKeyOf("运动不足")).toBe("运动不足");
  });

  it("兼容半角冒号与首尾空白", () => {
    expect(riskKeyOf("低密度脂蛋白: 升高（4.3）")).toBe("低密度脂蛋白");
    expect(riskKeyOf("  吸烟  ")).toBe("吸烟");
  });
});

// ---------- 计划完成率对比 ----------

describe("planDeltas（计划完成率对比）", () => {
  it("两侧都有完成率 → 差值按百分点计算（正=提升）", () => {
    const c = buildReportComparison(
      side({ score: 80, planRate: 85 }),
      prevSide({ planRate: 60 })
    )!;
    expect(c.planRateCurrent).toBe(85);
    expect(c.planRatePrev).toBe(60);
    expect(c.planRateDelta).toBe(25);
    expect(c.planConclusion).toContain("提升");
    expect(c.planConclusion).toContain("85%");
  });

  it("完成率下降 → 文案为「下降」", () => {
    const c = buildReportComparison(
      side({ score: 80, planRate: 40 }),
      prevSide({ planRate: 75 })
    )!;
    expect(c.planRateDelta).toBe(-35);
    expect(c.planConclusion).toContain("下降");
  });

  it("两侧都无计划 → 差值为 null，文案说明无法对比", () => {
    const c = buildReportComparison(
      side({ score: 80, planRate: null }),
      prevSide({ planRate: null })
    )!;
    expect(c.planRateDelta).toBeNull();
    expect(c.planConclusion).toContain("无法对比");
  });

  it("上期无计划 → 差值为 null，文案说明本周期新增计划", () => {
    const c = buildReportComparison(
      side({ score: 80, planRate: 70 }),
      prevSide({ planRate: null })
    )!;
    expect(c.planRateDelta).toBeNull();
    expect(c.planConclusion).toContain("新增行动计划");
  });

  it("本期无计划 → 差值为 null，文案说明本周期未关联", () => {
    const c = buildReportComparison(
      side({ score: 80, planRate: null }),
      prevSide({ planRate: 70 })
    )!;
    expect(c.planRateDelta).toBeNull();
    expect(c.planConclusion).toContain("未关联行动计划");
  });

  it("完成率持平 → 文案说明持平", () => {
    const c = buildReportComparison(
      side({ score: 80, planRate: 70 }),
      prevSide({ planRate: 70 })
    )!;
    expect(c.planRateDelta).toBe(0);
    expect(c.planConclusion).toContain("持平");
  });
});

// ---------- 结论文案与字段透传 ----------

describe("对比结论文案", () => {
  it("好转：风险分下降 20 分、等级变轻，含「好转」与负分值", () => {
    const c = buildReportComparison(
      side({ score: 50, level: "低", risks: [] }),
      prevSide({ score: 70, level: "中" })
    )!;
    expect(c.conclusion).toContain("好转");
    expect(c.conclusion).toContain("-20");
    expect(c.conclusion).toContain("风险等级由「中」变为「低」");
  });

  it("恶化：风险分升高 20 分、等级变重，含「恶化」与正分值", () => {
    const c = buildReportComparison(
      side({ score: 90, level: "极高" }),
      prevSide({ score: 70, level: "中" })
    )!;
    expect(c.conclusion).toContain("恶化");
    expect(c.conclusion).toContain("+20");
    expect(c.conclusion).toContain("风险等级由「中」变为「极高」");
  });

  it("持平：含「持平」并注明阈值", () => {
    const c = buildReportComparison(
      side({ score: 71, level: "中" }),
      prevSide({ score: 70, level: "中" })
    )!;
    expect(c.conclusion).toContain("持平");
    expect(c.conclusion).toContain("阈值");
  });

  it("结论包含风险点增减数量", () => {
    const c = buildReportComparison(
      side({ score: 72, risks: ["吸烟", "饮酒"] }),
      prevSide({ score: 70, risks: ["吸烟"] })
    )!;
    expect(c.conclusion).toContain("风险点新增 1 项");
    expect(c.conclusion).toContain("减少 0 项");
  });
});

describe("上期字段透传", () => {
  it("prev* 字段全部来自上期报告", () => {
    const c = buildReportComparison(side({ score: 80 }), prevSide())!;
    expect(c.prevReportId).toBe("7");
    expect(c.prevPeriod).toBe("2026-08-01 ~ 2026-08-31");
    expect(c.prevGenerateTime).toBe("2026-08-31T02:00:00.000Z");
    expect(c.prevScore).toBe(70);
    expect(c.prevLevel).toBe("中");
  });

  it("上期字段缺省时给空串（不抛错）", () => {
    const c = buildReportComparison(side({ score: 80 }), side({ score: 70 }))!;
    expect(c.prevReportId).toBe("");
    expect(c.prevPeriod).toBe("");
    expect(c.prevGenerateTime).toBe("");
  });
});

describe("可复算（落库 JSON 往返一致）", () => {
  it("同样输入两次调用结果一致，且 JSON 往返后不丢信息", () => {
    const cur = side({
      score: 80,
      level: "中",
      risks: ["收缩压：一级高血压（148）", "吸烟"],
      planRate: 75
    });
    const prev = prevSide();
    const a = buildReportComparison(cur, prev)!;
    const b = buildReportComparison(cur, prev)!;
    expect(b).toEqual(a);
    // 存进 summary JSON 再读回来，与重新计算的结果完全一致
    expect(JSON.parse(JSON.stringify(a))).toEqual(
      buildReportComparison(cur, prev)
    );
  });
});
