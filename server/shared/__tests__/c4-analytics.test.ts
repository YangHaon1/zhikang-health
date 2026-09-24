/**
 * C4 竞赛优化：脱敏群体健康看板单元测试。
 * 覆盖：聚合结果与「逐个用户 analyzeHealth 现算」完全一致、分桶边界、
 * 小样本隐藏（分母 / 分子）、全站降级、计划参与率、CSV 导出不绕过脱敏。
 */
import { describe, expect, it } from "vitest";
import {
  ANALYTICS_INDICATORS,
  ANALYTICS_MIN_SAMPLE,
  MASKED_TEXT,
  SCORE_BUCKETS,
  analyzeUserForAnalytics,
  analyticsToCsv,
  buildAnalyticsOverview
} from "../health-analytics.js";
import type { UserAnalyticsInput } from "../health-analytics.js";
import { analyzeHealth } from "../health-engine.js";
import type { HealthProfile, HealthRecord } from "../health-engine.js";

// ---------- 工具 ----------

let seq = 0;
/** 造一条记录 */
function rec(partial: Partial<HealthRecord> & { date: string }): HealthRecord {
  seq += 1;
  return { id: String(seq), ...partial } as HealthRecord;
}

/** 造一个聚合输入（默认有记录、无异常、低风险、**已授权共享**） */
function user(
  partial: Partial<UserAnalyticsInput> & { userId: number }
): UserAnalyticsInput {
  return {
    recordCount: 1,
    score: 0,
    level: "低",
    abnormalKeys: [],
    measuredKeys: ["systolic"],
    planParticipant: false,
    // C5：C4 的用例都在验证「聚合口径本身」，故默认全部已授权；
    // 授权开关的联动行为由 c5-privacy.test.ts 单独覆盖。
    allowShared: true,
    ...partial
  };
}

/** 批量造同一模板的用户 */
function many(count: number, partial: Partial<UserAnalyticsInput> = {}) {
  return Array.from({ length: count }, (_, i) =>
    user({ userId: i + 1, ...partial })
  );
}

// ---------- 聚合口径与规则引擎一致 ----------

describe("聚合结果 = 逐个用户 analyzeHealth 现算", () => {
  const profile: HealthProfile = {
    name: "张健康",
    gender: 1,
    age: 30,
    height: 175,
    weight: 70,
    smoking: "从不",
    drinking: "从不",
    exercise: "每周3-5次"
  } as HealthProfile;

  // 6 个用户：3 个血压异常、1 个血糖异常、2 个全正常
  const datasets: HealthRecord[][] = [
    [rec({ date: "2026-09-01", systolic: 165, diastolic: 100 })],
    [rec({ date: "2026-09-02", systolic: 162, diastolic: 99 })],
    [rec({ date: "2026-09-03", systolic: 158, diastolic: 97 })],
    [
      rec({
        date: "2026-09-04",
        systolic: 120,
        diastolic: 80,
        fastingGlucose: 8.2
      })
    ],
    [rec({ date: "2026-09-05", systolic: 118, diastolic: 76 })],
    [rec({ date: "2026-09-06", systolic: 115, diastolic: 74 })]
  ];

  // 末位参数是 C5 的共享授权：本组验证「聚合 = 引擎现算」，故 6 人全部已授权
  const inputs = datasets.map((records, i) =>
    analyzeUserForAnalytics(i + 1, records, profile, i < 2, true)
  );
  // 本组只验「聚合口径 = 引擎现算」：把阈值降到 1 关掉小样本隐藏，
  // 否则 6 人样本里的小分组会被隐藏，拿不到可对比的数值（隐藏规则见下方专组）。
  const overview = buildAnalyticsOverview(inputs, 1);

  it("每个用户的评分 / 等级都与 analyzeHealth 现算一致", () => {
    datasets.forEach((records, i) => {
      const engine = analyzeHealth(records, profile);
      expect(inputs[i].score).toBe(engine.score);
      expect(inputs[i].level).toBe(engine.level);
      expect(inputs[i].abnormalKeys.sort()).toEqual(
        engine.items
          .filter(it => it.level === 2)
          .map(it => it.key)
          .sort()
      );
      expect(inputs[i].measuredKeys.sort()).toEqual(
        engine.items.map(it => it.key).sort()
      );
    });
  });

  it("评分分布与手工按 analyzeHealth 分数分桶的结果一致", () => {
    for (const bucket of SCORE_BUCKETS) {
      const expected = inputs.filter(
        u => u.score >= bucket.min && u.score <= bucket.max
      ).length;
      const stat = overview.scoreDistribution.find(b => b.key === bucket.key)!;
      expect(stat.count).toBe(expected);
    }
  });

  it("风险等级分布与手工统计的 analyzeHealth 等级一致", () => {
    const expected = new Map<string, number>();
    for (const u of inputs)
      expected.set(u.level, (expected.get(u.level) ?? 0) + 1);
    for (const stat of overview.riskDistribution) {
      expect(stat.count).toBe(expected.get(stat.level) ?? 0);
    }
  });

  it("收缩压异常人数 = 引擎判为 level 2 的收缩压用户数", () => {
    const expected = inputs.filter(u =>
      u.abnormalKeys.includes("systolic")
    ).length;
    const stat = overview.indicatorAbnormal.find(s => s.key === "systolic")!;
    expect(stat.abnormalCount).toBe(expected);
    expect(stat.sampleSize).toBe(
      inputs.filter(u => u.measuredKeys.includes("systolic")).length
    );
    expect(stat.rate).toBe(
      Math.round((expected / stat.sampleSize!) * 1000) / 10
    );
  });

  it("总量指标：用户数 / 有记录数 / 计划参与率", () => {
    expect(overview.totals.userCount).toBe(6);
    expect(overview.totals.withRecords).toBe(6);
    expect(overview.totals.planParticipants).toBe(2);
    expect(overview.totals.planParticipationRate).toBe(33.3);
  });

  it("无记录用户不计入评分分布（引擎给无记录 0 分，混进来会把「没数据」显示成「很健康」）", () => {
    const o = buildAnalyticsOverview(
      [
        user({ userId: 50, score: 12, level: "低" }),
        user({ userId: 51, recordCount: 0, score: 0, level: "低" })
      ],
      1
    );
    expect(o.totals.userCount).toBe(2);
    expect(o.totals.withRecords).toBe(1);
    // 30 分以下这一桶只有 1 人：就是那个有记录的，无记录用户没有被算进来
    const low = o.scoreDistribution.find(b => b.key === "lt30")!;
    expect(low.count).toBe(1);
    expect(o.riskDistribution.find(s => s.level === "低")!.count).toBe(1);
  });
});

// ---------- 分桶边界 ----------

describe("评分分桶边界（与 riskLevelOf 的 30 / 60 / 80 一致）", () => {
  it.each([
    [0, "lt30"],
    [29, "lt30"],
    [30, "b30to59"],
    [59, "b30to59"],
    [60, "b60to79"],
    [79, "b60to79"],
    [80, "gte80"],
    [100, "gte80"]
  ])("分数 %i 落在 %s 桶，且只落一个桶", (score, key) => {
    const o = buildAnalyticsOverview(many(5, { score }));
    const hit = o.scoreDistribution.filter(b => b.count === 5);
    expect(hit).toHaveLength(1);
    expect(hit[0].key).toBe(key);
  });
});

// ---------- 小样本隐藏 ----------

describe("小样本隐藏（任一分组样本 < 5 → null）", () => {
  it("阈值常量为 5", () => {
    expect(ANALYTICS_MIN_SAMPLE).toBe(5);
  });

  it("分母不足：6 人中只有 4 人测了收缩压 → 该指标整组隐藏", () => {
    const users = [
      ...many(4, { measuredKeys: ["systolic"], abnormalKeys: ["systolic"] }),
      ...many(2, { measuredKeys: ["diastolic"] }).map((u, i) => ({
        ...u,
        userId: 10 + i
      }))
    ];
    const o = buildAnalyticsOverview(users);
    const stat = o.indicatorAbnormal.find(s => s.key === "systolic")!;
    expect(stat.sampleSize).toBeNull();
    expect(stat.abnormalCount).toBeNull();
    expect(stat.rate).toBeNull();
    expect(stat.masked).toBe(true);
  });

  it("分子不足：样本 20 人但异常只有 2 人 → 依然隐藏（否则能反推出小样本个体）", () => {
    const users = [
      ...many(2, { abnormalKeys: ["systolic"] }),
      ...many(18, {}).map((u, i) => ({ ...u, userId: 100 + i }))
    ];
    const o = buildAnalyticsOverview(users);
    const stat = o.indicatorAbnormal.find(s => s.key === "systolic")!;
    expect(stat.masked).toBe(true);
    expect(stat.abnormalCount).toBeNull();
    expect(stat.rate).toBeNull();
  });

  it("异常为 0 的空分组不算小样本，正常展示", () => {
    const o = buildAnalyticsOverview(many(8));
    const stat = o.indicatorAbnormal.find(s => s.key === "systolic")!;
    expect(stat.masked).toBe(false);
    expect(stat.abnormalCount).toBe(0);
    expect(stat.sampleSize).toBe(8);
    expect(stat.rate).toBe(0);
  });

  it("评分 / 等级分组人数 < 5 → 该桶隐藏，其余桶照常显示", () => {
    const o = buildAnalyticsOverview([
      ...many(6, { score: 10, level: "低" }),
      ...many(2, { score: 90, level: "极高" }).map((u, i) => ({
        ...u,
        userId: 200 + i
      }))
    ]);
    const low = o.scoreDistribution.find(b => b.key === "lt30")!;
    const extreme = o.scoreDistribution.find(b => b.key === "gte80")!;
    expect(low.masked).toBe(false);
    expect(low.count).toBe(6);
    expect(extreme.masked).toBe(true);
    expect(extreme.count).toBeNull();
    expect(extreme.ratio).toBeNull();
    const levelExtreme = o.riskDistribution.find(s => s.level === "极高")!;
    expect(levelExtreme.masked).toBe(true);
    expect(o.riskDistribution.find(s => s.level === "低")!.count).toBe(6);
  });

  it("分子分母都达标 → 正常给出百分比（保留 1 位小数）", () => {
    const users = [
      ...many(5, { abnormalKeys: ["systolic"] }),
      ...many(3, {}).map((u, i) => ({ ...u, userId: 300 + i }))
    ];
    const stat = buildAnalyticsOverview(users).indicatorAbnormal.find(
      s => s.key === "systolic"
    )!;
    expect(stat.masked).toBe(false);
    expect(stat.sampleSize).toBe(8);
    expect(stat.abnormalCount).toBe(5);
    expect(stat.rate).toBe(62.5);
  });
});

// ---------- 总量指标的小样本保护 ----------

describe("总量指标同样做小样本保护（userCount 除外）", () => {
  it("全站 6 人但只有 3 人有记录 → 有记录用户数隐藏（3 人在 6 人规模下可指认）", () => {
    const o = buildAnalyticsOverview([
      ...many(3, { recordCount: 1 }),
      ...many(3, { recordCount: 0 }).map((u, i) => ({ ...u, userId: 10 + i }))
    ]);
    expect(o.degraded).toBe(false);
    expect(o.totals.userCount).toBe(6);
    expect(o.totals.withRecords).toBeNull();
  });

  it("全站 6 人但只有 2 人参与计划 → 参与人数与参与率一起隐藏（只藏人数会从占比反推）", () => {
    const o = buildAnalyticsOverview([
      ...many(2, { planParticipant: true }),
      ...many(4, {}).map((u, i) => ({ ...u, userId: 20 + i }))
    ]);
    expect(o.totals.planParticipants).toBeNull();
    expect(o.totals.planParticipationRate).toBeNull();
  });

  it("0 人参与 / 0 人有记录不算小样本，正常显示 0", () => {
    const o = buildAnalyticsOverview(many(6));
    expect(o.totals.planParticipants).toBe(0);
    expect(o.totals.planParticipationRate).toBe(0);
    expect(o.totals.withRecords).toBe(6);
  });

  it("userCount 恒可见（账号总数不涉及个体属性，降级时也保留）", () => {
    expect(buildAnalyticsOverview(many(3)).totals.userCount).toBe(3);
    expect(buildAnalyticsOverview(many(3)).degraded).toBe(true);
  });
});

// ---------- 全站降级 ----------

describe("全站用户不足 5 人 → 整体降级", () => {
  it("degraded = true，分组与总量明细全部为 null，并给出降级说明", () => {
    const o = buildAnalyticsOverview(many(4, { abnormalKeys: ["systolic"] }));
    expect(o.degraded).toBe(true);
    expect(o.degradedReason).toContain("不足 5 人");
    expect(o.totals.userCount).toBe(4);
    expect(o.totals.withRecords).toBeNull();
    expect(o.totals.planParticipants).toBeNull();
    expect(o.totals.planParticipationRate).toBeNull();
    expect(o.scoreDistribution.every(b => b.count === null && b.masked)).toBe(
      true
    );
    expect(o.riskDistribution.every(b => b.count === null && b.masked)).toBe(
      true
    );
    expect(
      o.indicatorAbnormal.every(
        s => s.rate === null && s.sampleSize === null && s.masked
      )
    ).toBe(true);
  });

  it("刚好 5 人 → 不降级（分组仍按各自样本判断）", () => {
    const o = buildAnalyticsOverview(many(5, { planParticipant: true }));
    expect(o.degraded).toBe(false);
    expect(o.degradedReason).toBe("");
    expect(o.totals.withRecords).toBe(5);
    expect(o.totals.planParticipationRate).toBe(100);
  });

  it("0 用户也不抛错", () => {
    const o = buildAnalyticsOverview([]);
    expect(o.degraded).toBe(true);
    expect(o.totals.userCount).toBe(0);
    expect(o.scoreDistribution).toHaveLength(SCORE_BUCKETS.length);
    expect(o.indicatorAbnormal).toHaveLength(ANALYTICS_INDICATORS.length);
  });
});

// ---------- CSV 导出 ----------

describe("CSV 导出（脱敏值不会被导出成数字）", () => {
  const masked = buildAnalyticsOverview(
    many(4, { abnormalKeys: ["systolic"], planParticipant: true })
  );
  const shown = buildAnalyticsOverview([
    ...many(6, { score: 12, level: "低", planParticipant: true }),
    ...many(2, { score: 90, level: "极高" }).map((u, i) => ({
      ...u,
      userId: 400 + i
    }))
  ]);

  it("含各分组标题与指标名", () => {
    const csv = analyticsToCsv(shown);
    expect(csv).toContain("群体健康看板（脱敏聚合）");
    expect(csv).toContain("评分分布");
    expect(csv).toContain("风险等级分布");
    expect(csv).toContain("指标异常率");
    expect(csv).toContain("收缩压");
  });

  it("被隐藏的单元格输出隐藏文案，不出现 0 / 空值兜底", () => {
    const csv = analyticsToCsv(shown);
    expect(csv).toContain(MASKED_TEXT);
    // 「80 分及以上」只有 2 人被隐藏，不能出现裸数字 2
    const line = csv.split("\r\n").find(l => l.startsWith("80 分及以上"))!;
    expect(line).toBe(`80 分及以上,${MASKED_TEXT},${MASKED_TEXT}`);
  });

  it("降级时带上降级说明，且不含任何分组人数", () => {
    const csv = analyticsToCsv(masked);
    expect(csv).toContain("不足 5 人");
    const scoreLine = csv.split("\r\n").find(l => l.startsWith("30 分以下"))!;
    expect(scoreLine).toBe(`30 分以下,${MASKED_TEXT},${MASKED_TEXT}`);
  });

  it("正常分组导出为真实数值与百分比", () => {
    const csv = analyticsToCsv(shown);
    const low = csv.split("\r\n").find(l => l.startsWith("30 分以下"))!;
    expect(low).toBe("30 分以下,6,75%");
  });
});

// ---------- 可复算 ----------

describe("可复算性", () => {
  it("同一输入两次调用结果完全相同", () => {
    const users = many(6, {
      abnormalKeys: ["systolic"],
      planParticipant: true
    });
    expect(buildAnalyticsOverview(users)).toEqual(
      buildAnalyticsOverview(users)
    );
  });
});
