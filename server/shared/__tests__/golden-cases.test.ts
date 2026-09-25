/**
 * P1-3 黄金测试集：**手工标注的固定期望值**，不用引擎自身的输出充当期望。
 *
 * 为什么单独建一份：
 *   原来的测试大量用 `analyzeHealth` 的输出验证 `analyzeHealth` 的聚合（自证），
 *   于是「未测指标进了分母」这类方向性错误可以长期存活 —— 只要实现和断言一起错就没人发现。
 *   本文件每条期望值都能由**独立来源**手算：
 *
 *   (1) 分级阈值 —— 中国高血压防治指南 / 中国 2 型糖尿病防治指南 / 中国成人血脂异常防治指南
 *   (2) 评分公式 —— 加权得分 = Σ(分类权重 × 等级系数)，等级系数 正常 0 / 警戒 0.5 / 异常 1，
 *       再对【已测分类的权重之和】归一化后 ×100 取整；
 *       任一已测分类为「异常」时总分不低于 30；生活方式修正（吸烟 +5 / 饮酒 +3 / 几乎不运动 +5）
 *       只加分、不进分母；总分上限 100。等级边界：<30 低 / 30~59 中 / 60~79 高 / ≥80 极高。
 *   (3) 分类权重表（合计 100）：
 *       血压 25（收缩压与舒张压合并为一个分类，取较严重一侧）
 *       血糖 25 · BMI 15 · 总胆固醇 10 · 甘油三酯 10 · LDL 10 · HDL 5
 *
 *   ⚠️ 全部用例使用「完整档案」（身高 175 / 体重 70 → BMI 22.86 正常），
 *   因此档案派生的 BMI 分类始终参与分母（15 分）。这一点必须显式写出来：
 *   单测一项时的分数是「分子 / 40」而不是「分子 / 25」，
 *   历史上就是因为没写清楚，测试里才会出现「155/95 应该 ≥25 分」这类与实现永久冲突的弱断言。
 */
import { describe, expect, it } from "vitest";
import { analyzeHealth, checkEmergency } from "../health-engine.js";
import type { HealthProfile, HealthRecord } from "../health-engine.js";

function record(
  partial: Partial<HealthRecord> & { date: string }
): HealthRecord {
  return { id: "1", ...partial };
}

/** 完整档案：BMI 22.86 正常 → 每次分析都自带 15 分分母 */
const COMPLETE_PROFILE: HealthProfile = {
  name: "黄金用例",
  gender: 1,
  age: 30,
  height: 175,
  weight: 70,
  waistline: 80,
  medicalHistory: "",
  familyHistory: "",
  allergyHistory: "",
  smoking: "从不",
  drinking: "从不",
  exercise: "每周3-5次",
  createTime: "2026-01-01 00:00:00"
};

/** 手算辅助：分母 = 已测分类权重之和 */
const DENOM = {
  bpAlone: 25, // 血压 25
  bpPlusBmi: 40, // 血压 25 + 档案 BMI 15
  bgPlusBmi: 40, // 血糖 25 + 档案 BMI 15
  tcPlusBmi: 25, // 总胆固醇 10 + 档案 BMI 15
  tgPlusBmi: 25, // 甘油三酯 10 + 档案 BMI 15
  ldlPlusBmi: 25, // LDL 10 + 档案 BMI 15
  hdlPlusBmi: 20, // HDL 5 + 档案 BMI 15
  full: 100 // 七类齐全
} as const;

const analysis = (
  rec: Partial<HealthRecord> & { date: string },
  profile: HealthProfile | null = COMPLETE_PROFILE
) => analyzeHealth([record(rec)], profile);

/** 归一化期望值 = round(权重 × 系数 / 分母 × 100) */
const expectScore = (weight: number, factor: number, denom: number) =>
  Math.round(((weight * factor) / denom) * 100);

describe("黄金用例 · 单指标分级边界（分母含档案 BMI，见文件头说明）", () => {
  const cases: Array<{
    name: string;
    rec: Partial<HealthRecord> & { date: string };
    weight: number;
    factor: number;
    denom: number;
  }> = [
    // 血压：<140/90 警戒 → 系数 0.5；≥140/90 一级高血压异常 → 系数 1
    {
      name: "收缩压 139（警戒上沿）",
      rec: { date: "2026-09-01", systolic: 139 },
      weight: 25,
      factor: 0.5,
      denom: DENOM.bpPlusBmi
    },
    {
      name: "收缩压 140（一级高血压下沿）",
      rec: { date: "2026-09-01", systolic: 140 },
      weight: 25,
      factor: 1,
      denom: DENOM.bpPlusBmi
    },
    {
      name: "舒张压 89（警戒上沿）",
      rec: { date: "2026-09-01", diastolic: 89 },
      weight: 25,
      factor: 0.5,
      denom: DENOM.bpPlusBmi
    },
    {
      name: "舒张压 90（一级高血压下沿）",
      rec: { date: "2026-09-01", diastolic: 90 },
      weight: 25,
      factor: 1,
      denom: DENOM.bpPlusBmi
    },
    // 血糖：<6.1 正常 / 6.1~6.9 受损（警戒）/ ≥7.0 异常
    {
      name: "空腹血糖 6.0（正常上沿）",
      rec: { date: "2026-09-01", fastingGlucose: 6.0 },
      weight: 25,
      factor: 0,
      denom: DENOM.bgPlusBmi
    },
    {
      name: "空腹血糖 6.1（受损下沿）",
      rec: { date: "2026-09-01", fastingGlucose: 6.1 },
      weight: 25,
      factor: 0.5,
      denom: DENOM.bgPlusBmi
    },
    {
      name: "空腹血糖 7.0（异常下沿）",
      rec: { date: "2026-09-01", fastingGlucose: 7.0 },
      weight: 25,
      factor: 1,
      denom: DENOM.bgPlusBmi
    },
    // 总胆固醇：<5.2 正常 / 5.2~6.1 警戒 / ≥6.2 异常
    {
      name: "总胆固醇 5.19（正常上沿）",
      rec: { date: "2026-09-01", totalCholesterol: 5.19 },
      weight: 10,
      factor: 0,
      denom: DENOM.tcPlusBmi
    },
    {
      name: "总胆固醇 5.2（警戒下沿）",
      rec: { date: "2026-09-01", totalCholesterol: 5.2 },
      weight: 10,
      factor: 0.5,
      denom: DENOM.tcPlusBmi
    },
    {
      name: "总胆固醇 6.2（异常下沿）",
      rec: { date: "2026-09-01", totalCholesterol: 6.2 },
      weight: 10,
      factor: 1,
      denom: DENOM.tcPlusBmi
    },
    // 甘油三酯：<1.7 / 1.7~2.2 / ≥2.3
    {
      name: "甘油三酯 1.7（警戒下沿）",
      rec: { date: "2026-09-01", triglyceride: 1.7 },
      weight: 10,
      factor: 0.5,
      denom: DENOM.tgPlusBmi
    },
    {
      name: "甘油三酯 2.3（异常下沿）",
      rec: { date: "2026-09-01", triglyceride: 2.3 },
      weight: 10,
      factor: 1,
      denom: DENOM.tgPlusBmi
    },
    // LDL：<3.4 / 3.4~4.0 / ≥4.1
    {
      name: "LDL 3.4（警戒下沿）",
      rec: { date: "2026-09-01", ldl: 3.4 },
      weight: 10,
      factor: 0.5,
      denom: DENOM.ldlPlusBmi
    },
    {
      name: "LDL 4.1（异常下沿）",
      rec: { date: "2026-09-01", ldl: 4.1 },
      weight: 10,
      factor: 1,
      denom: DENOM.ldlPlusBmi
    },
    // HDL（男性阈值 1.0）：<1.0 异常，权重最小（5）
    {
      name: "HDL 0.99（男性偏低，触发高危保护）",
      rec: { date: "2026-09-01", hdl: 0.99 },
      weight: 5,
      factor: 1,
      denom: DENOM.hdlPlusBmi
    }
  ];

  for (const c of cases) {
    // 任一已测分类为「异常」时总分不低于 30（高危保护），期望值必须带上这条下限，
    // 否则又会变成一个"实现和断言一起错"的自证用例。
    const raw = expectScore(c.weight, c.factor, c.denom);
    const expected = c.factor === 1 ? Math.max(raw, 30) : raw;
    it(`${c.name} → ${expected} 分（${c.weight}×${c.factor}/${c.denom}）`, () => {
      const r = analysis(c.rec);
      expect(r.score).toBe(expected);
    });
  }

  it("BMI 分级边界（175cm，档案体重被记录体重覆盖）", () => {
    // 24 → 超重警戒：15×0.5/15 = 50
    expect(analysis({ date: "2026-09-01", weight: 73.5 }).score).toBe(50);
    // 28 → 肥胖异常：15×1/15 = 100
    expect(analysis({ date: "2026-09-01", weight: 85.8 }).score).toBe(100);
    // 23.9 → 正常：0 分
    expect(analysis({ date: "2026-09-01", weight: 73.2 }).score).toBe(0);
  });
});

describe("黄金用例 · 完整记录的手算总分", () => {
  it("全项正常 → 0 分「低」，无风险点、无就医提醒", () => {
    // 分子 0 / 分母 100 → 0
    const r = analysis({
      date: "2026-09-01",
      systolic: 118,
      diastolic: 75,
      fastingGlucose: 5.2,
      totalCholesterol: 4.5,
      triglyceride: 1.2,
      ldl: 2.8,
      hdl: 1.4
    });
    expect(r.score).toBe(0);
    expect(r.level).toBe("低");
    expect(r.risks).toHaveLength(0);
    expect(r.medicalAdvice).toBe("");
  });

  it("血压 155/95 + 其余正常 → 25×1/100 = 25 分，被高危保护抬到 30 分「中」", () => {
    // 血压是唯一得分项：25/100 = 25 分 < 30，靠高危保护抬到 30 才进「中」。
    // 这条同时固定住两件事：
    //   ① 归一化只解决"少测项被稀释"，解决不了"单一项异常被多项目正常稀释"——
    //      已测项越多，单项异常的占比天然越低，这是加权平均的数学后果；
    //   ② 高危保护的下限是「中」（30），**不是**「高」。
    //      一级高血压 + 全项正常 = 30 分「中」是否够，属于规则调参决策，不在本次改动范围；
    //      黄金用例只负责把这个事实钉死，不让它再被"≥25 分就算通过"的弱断言掩盖。
    const r = analysis({
      date: "2026-09-01",
      systolic: 155,
      diastolic: 95,
      fastingGlucose: 5.2,
      totalCholesterol: 4.5,
      triglyceride: 1.2,
      ldl: 2.8,
      hdl: 1.4
    });
    expect(r.score).toBe(30);
    expect(r.level).toBe("中");
    expect(r.risks.some(x => x.includes("收缩压"))).toBe(true);
  });

  it("血压 200/120（三级）+ 其余正常 → 25/100 = 25 分，被高危保护抬到 30 分「中」", () => {
    // 高危保护只保证"不低于中"，不保证"高" —— 这是当前明确的口径，
    // 因此这里断言 30 而不是 60，避免用"我觉得应该更高"当期望值。
    const r = analysis({
      date: "2026-09-01",
      systolic: 200,
      diastolic: 120,
      fastingGlucose: 5.2,
      totalCholesterol: 4.5,
      triglyceride: 1.2,
      ldl: 2.8,
      hdl: 1.4
    });
    expect(r.score).toBe(30);
    expect(r.level).toBe("中");
    expect(r.risks.some(x => x.includes("收缩压"))).toBe(true);
  });

  it("全项异常 + 三项生活方式 → 分子=分母 → 封顶 100 分「极高」", () => {
    const r = analyzeHealth(
      [
        record({
          date: "2026-09-01",
          systolic: 180,
          diastolic: 110,
          fastingGlucose: 7.5,
          totalCholesterol: 6.5,
          triglyceride: 2.5,
          ldl: 4.5,
          hdl: 0.8,
          weight: 95
        })
      ],
      {
        ...COMPLETE_PROFILE,
        smoking: "经常",
        drinking: "经常",
        exercise: "几乎不运动"
      }
    );
    expect(r.score).toBe(100);
    expect(r.level).toBe("极高");
  });

  it("生活方式修正只加分不进分母：指标全正常 + 三项不良习惯 = 13 分「低」", () => {
    // 5（吸烟）+ 3（饮酒）+ 5（几乎不运动）= 13，13 < 30 仍判「低」
    const r = analyzeHealth(
      [
        record({
          date: "2026-09-01",
          systolic: 110,
          diastolic: 70,
          fastingGlucose: 5.0
        })
      ],
      {
        ...COMPLETE_PROFILE,
        smoking: "经常",
        drinking: "偶尔",
        exercise: "几乎不运动"
      }
    );
    expect(r.score).toBe(13);
    expect(r.level).toBe("低");
    expect(r.risks).toEqual(
      expect.arrayContaining(["吸烟", "饮酒", "运动不足"])
    );
  });
});

describe("黄金用例 · 归一化：分母只算已测分类", () => {
  it("无档案时只测血压 155/95 → 25×1/25 = 100 分「极高」", () => {
    // 分母只有血压 25：一项异常就是把已测项全部占满
    const r = analysis(
      { date: "2026-09-01", systolic: 155, diastolic: 95 },
      null
    );
    expect(r.score).toBe(100);
    expect(r.level).toBe("极高");
  });

  it('无档案时只测血压 200/120 → 100 分「极高」，不因"没测别的"变低', () => {
    const r = analysis(
      { date: "2026-09-01", systolic: 200, diastolic: 120 },
      null
    );
    expect(r.score).toBe(100);
    expect(r.level).toBe("极高");
  });

  it("无档案时只测收缩压 139（警戒）→ 25×0.5/25 = 50 分「中」", () => {
    // 未归一化（旧实现）会得到 12.5 → 13 分「低」：单项警戒被稀释成"健康"
    const r = analysis({ date: "2026-09-01", systolic: 139 }, null);
    expect(r.score).toBe(50);
    expect(r.level).toBe("中");
  });

  it("已测项全是正常、其中一项为异常时，总分不低于 30（高危保护）", () => {
    const r = analysis({
      date: "2026-09-01",
      systolic: 115,
      diastolic: 75,
      fastingGlucose: 5.0,
      totalCholesterol: 4.0,
      triglyceride: 1.2,
      ldl: 2.5,
      hdl: 0.5 // HDL 异常，权重仅 5 → 5/100 = 5 分，必须被抬到 30
    });
    expect(r.score).toBe(30);
    expect(r.level).toBe("中");
    expect(r.risks.some(x => x.includes("高密度脂蛋白"))).toBe(true);
  });

  it("无任何记录时不报错：0 分「低」，指标项为空", () => {
    const r = analyzeHealth([], COMPLETE_PROFILE);
    expect(r.score).toBe(0);
    expect(r.level).toBe("低");
    expect(r.items).toHaveLength(0);
  });
});

describe("黄金用例 · 就医提醒的触发边界", () => {
  it("连续 3 次 ≥140/90 → 触发就医提醒", () => {
    const r = analyzeHealth(
      [
        record({ date: "2026-09-01", systolic: 145, diastolic: 95 }),
        record({ date: "2026-09-02", systolic: 150, diastolic: 92 }),
        record({ date: "2026-09-03", systolic: 142, diastolic: 90 })
      ],
      COMPLETE_PROFILE
    );
    expect(r.medicalAdvice).toContain("就医");
  });

  it("只有 2 次 → 不触发（避免过度提示）", () => {
    const r = analyzeHealth(
      [
        record({ date: "2026-09-01", systolic: 145, diastolic: 95 }),
        record({ date: "2026-09-02", systolic: 150, diastolic: 92 })
      ],
      COMPLETE_PROFILE
    );
    expect(r.medicalAdvice).toBe("");
  });

  it("最近 3 次里有一次正常 → 不触发", () => {
    const r = analyzeHealth(
      [
        record({ date: "2026-09-01", systolic: 150, diastolic: 95 }),
        record({ date: "2026-09-02", systolic: 118, diastolic: 75 }),
        record({ date: "2026-09-03", systolic: 142, diastolic: 90 })
      ],
      COMPLETE_PROFILE
    );
    expect(r.medicalAdvice).toBe("");
  });
});

describe("黄金用例 · 急症分流的阈值与否定语境边界", () => {
  it("空腹血糖 16.7（急性并发症阈值）触发急救卡", () => {
    expect(
      checkEmergency("我最近有点不舒服", { fastingGlucose: 16.7 } as never)
    ).not.toBeNull();
  });

  it("空腹血糖 16.6 不触发急救卡", () => {
    // 边界：急症阈值是 16.7，不是 33.3。33.3（高渗高血糖状态）另有一条更严重的同字段规则。
    expect(
      checkEmergency("我最近有点不舒服", { fastingGlucose: 16.6 } as never)
    ).toBeNull();
  });

  it("空腹血糖 33.3（高渗高血糖危象）同样必须触发", () => {
    expect(
      checkEmergency("我最近有点不舒服", { fastingGlucose: 33.3 } as never)
    ).not.toBeNull();
  });

  it("收缩压 90 与 91 的边界（≤90 提示休克/严重低血压）", () => {
    expect(
      checkEmergency("我有点头晕", { systolic: 90 } as never)
    ).not.toBeNull();
    expect(checkEmergency("我有点头晕", { systolic: 91 } as never)).toBeNull();
  });

  it("心率 39/131 触发、40/130 不触发", () => {
    expect(checkEmergency("心慌", { heartRate: 39 } as never)).not.toBeNull();
    expect(checkEmergency("心慌", { heartRate: 131 } as never)).not.toBeNull();
    expect(checkEmergency("心慌", { heartRate: 40 } as never)).toBeNull();
    expect(checkEmergency("心慌", { heartRate: 130 } as never)).toBeNull();
  });

  it("否定语境不触发，肯定表述触发", () => {
    expect(checkEmergency("我没有胸痛，就是有点累")).toBeNull();
    expect(checkEmergency("家人有抽搐史，我需要担心吗")).toBeNull();
    expect(checkEmergency("我现在胸痛得厉害")).not.toBeNull();
  });
});
