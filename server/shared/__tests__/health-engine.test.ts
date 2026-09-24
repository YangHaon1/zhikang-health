/**
 * 风险评估规则引擎单元测试（P1 vitest）。
 * 覆盖：单项分级边界（中国标准）、综合评分权重、生活方式修正、
 * 风险等级边界、就医提醒触发条件、取较严重一侧。
 */
import { describe, expect, it } from "vitest";
import {
  analyzeHealth,
  gradeBmi,
  gradeDiastolic,
  gradeFastingGlucose,
  gradeHdl,
  gradeLdl,
  gradeSystolic,
  gradeTotalCholesterol,
  gradeTriglyceride,
  riskLevelOf,
  worseGrade
} from "../health-engine.js";
import type { HealthProfile, HealthRecord } from "../health-engine.js";

// ---------- 工具 ----------

function record(
  partial: Partial<HealthRecord> & { date: string }
): HealthRecord {
  return { id: "1", ...partial };
}

function profile(partial: Partial<HealthProfile>): HealthProfile {
  return {
    name: "测试",
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
    createTime: "2026-01-01 00:00:00",
    ...partial
  };
}

// ---------- 单项分级：血压 ----------

describe("gradeSystolic（收缩压）", () => {
  it("<120 正常", () => {
    expect(gradeSystolic(119)).toMatchObject({
      level: 0,
      severity: 0,
      grade: "正常"
    });
  });
  it("120~139 警戒（level 1）", () => {
    expect(gradeSystolic(120)).toMatchObject({
      level: 1,
      severity: 1,
      grade: "警戒"
    });
    expect(gradeSystolic(139)).toMatchObject({ level: 1 });
  });
  it("140~159 一级高血压（level 2）", () => {
    expect(gradeSystolic(140)).toMatchObject({
      level: 2,
      severity: 2,
      grade: "一级高血压"
    });
    expect(gradeSystolic(159)).toMatchObject({ level: 2, severity: 2 });
  });
  it("160~179 二级、≥180 三级（severity 递增）", () => {
    expect(gradeSystolic(160)).toMatchObject({
      level: 2,
      severity: 3,
      grade: "二级高血压"
    });
    expect(gradeSystolic(180)).toMatchObject({
      level: 2,
      severity: 4,
      grade: "三级高血压"
    });
  });
});

describe("gradeDiastolic（舒张压）", () => {
  it("<80 正常 / 80~89 警戒", () => {
    expect(gradeDiastolic(79)).toMatchObject({ level: 0 });
    expect(gradeDiastolic(80)).toMatchObject({ level: 1 });
    expect(gradeDiastolic(89)).toMatchObject({ level: 1 });
  });
  it("90~99 一级 / 100~109 二级 / ≥110 三级", () => {
    expect(gradeDiastolic(90)).toMatchObject({ level: 2, severity: 2 });
    expect(gradeDiastolic(100)).toMatchObject({ level: 2, severity: 3 });
    expect(gradeDiastolic(110)).toMatchObject({ level: 2, severity: 4 });
  });
});

// ---------- 单项分级：血糖 / 血脂 / BMI ----------

describe("gradeFastingGlucose（空腹血糖）", () => {
  it("<3.9 低血糖（异常）", () => {
    expect(gradeFastingGlucose(3.8)).toMatchObject({
      level: 2,
      grade: "低血糖"
    });
  });
  it("3.9~6.0 正常 / 6.1~6.9 受损（警戒）/ ≥7.0 血糖升高风险", () => {
    expect(gradeFastingGlucose(5.5)).toMatchObject({ level: 0 });
    expect(gradeFastingGlucose(6.1)).toMatchObject({ level: 1, grade: "受损" });
    expect(gradeFastingGlucose(6.9)).toMatchObject({ level: 1 });
    expect(gradeFastingGlucose(7.0)).toMatchObject({
      level: 2,
      grade: "血糖升高风险"
    });
  });
});

describe("血脂三件 + BMI", () => {
  it("总胆固醇：<5.2 正常 / 5.2~6.1 警戒 / ≥6.2 升高", () => {
    expect(gradeTotalCholesterol(5.19)).toMatchObject({ level: 0 });
    expect(gradeTotalCholesterol(5.2)).toMatchObject({ level: 1 });
    expect(gradeTotalCholesterol(6.2)).toMatchObject({ level: 2 });
  });
  it("甘油三酯：<1.7 正常 / 1.7~2.2 警戒 / ≥2.3 升高", () => {
    expect(gradeTriglyceride(1.69)).toMatchObject({ level: 0 });
    expect(gradeTriglyceride(1.7)).toMatchObject({ level: 1 });
    expect(gradeTriglyceride(2.3)).toMatchObject({ level: 2 });
  });
  it("LDL：<3.4 正常 / 3.4~4.0 警戒 / ≥4.1 升高", () => {
    expect(gradeLdl(3.39)).toMatchObject({ level: 0 });
    expect(gradeLdl(3.4)).toMatchObject({ level: 1 });
    expect(gradeLdl(4.1)).toMatchObject({ level: 2 });
  });
  it("BMI：<18.5 偏瘦 / 18.5~23.9 正常 / 24~27.9 超重 / ≥28 肥胖", () => {
    // 175cm：18.4 → 56.3kg；18.5 → 56.7kg；24 → 73.5kg；28 → 85.75kg
    expect(gradeBmi(175, 56.3)).toMatchObject({ level: 1, grade: "偏瘦" });
    expect(gradeBmi(175, 56.7)).toMatchObject({ level: 0, grade: "正常" });
    expect(gradeBmi(175, 73.5)).toMatchObject({ level: 1, grade: "超重" });
    expect(gradeBmi(175, 85.8)).toMatchObject({ level: 2, grade: "肥胖" });
  });
  it("BMI 缺身高/体重返回 null", () => {
    expect(gradeBmi(0, 70)).toBeNull();
    expect(gradeBmi(175, 0)).toBeNull();
  });
});

describe("gradeHdl（HDL，性别阈值差异）", () => {
  it("女性阈值 1.3：1.29 偏低 / 1.3 正常", () => {
    expect(gradeHdl(1.29, 0)).toMatchObject({ level: 2, grade: "偏低" });
    expect(gradeHdl(1.3, 0)).toMatchObject({ level: 0 });
  });
  it("男性阈值 1.0：0.99 偏低 / 1.0 正常", () => {
    expect(gradeHdl(0.99, 1)).toMatchObject({ level: 2 });
    expect(gradeHdl(1.0, 1)).toMatchObject({ level: 0 });
  });
});

// ---------- 风险等级边界 ----------

describe("riskLevelOf（综合等级边界）", () => {
  it("30 / 60 / 80 为分界", () => {
    expect(riskLevelOf(0)).toBe("低");
    expect(riskLevelOf(29)).toBe("低");
    expect(riskLevelOf(30)).toBe("中");
    expect(riskLevelOf(59)).toBe("中");
    expect(riskLevelOf(60)).toBe("高");
    expect(riskLevelOf(79)).toBe("高");
    expect(riskLevelOf(80)).toBe("极高");
    expect(riskLevelOf(100)).toBe("极高");
  });
});

// ---------- 取较严重一侧 ----------

describe("worseGrade（取较严重分级）", () => {
  it("severity 高者胜出（一级 2 < 二级 3）", () => {
    const a = gradeSystolic(156); // 一级 severity 2
    const b = gradeDiastolic(100); // 二级 severity 3
    expect(worseGrade(a, b)).toBe(b);
  });
  it("null 侧让位", () => {
    const a = gradeSystolic(140);
    expect(worseGrade(a, null)).toBe(a);
    expect(worseGrade(null, null)).toBeNull();
  });
});

// ---------- analyzeHealth：综合评分 / 风险 / 建议 / 就医提醒 ----------

describe("analyzeHealth（综合分析）", () => {
  it("全部正常 → 0 分低风险、无风险点、无就医提醒", () => {
    const r = analyzeHealth(
      [
        record({
          date: "2026-09-01",
          systolic: 118,
          diastolic: 75,
          fastingGlucose: 5.2,
          totalCholesterol: 4.5,
          triglyceride: 1.2,
          ldl: 2.8,
          hdl: 1.4
        })
      ],
      profile({})
    );
    expect(r.score).toBe(0);
    expect(r.level).toBe("低");
    expect(r.risks).toHaveLength(0);
    expect(r.medicalAdvice).toBe("");
  });

  it("血压异常（155/95）→ 血压权重 25 分、风险点含收缩压/舒张压、建议非空", () => {
    const r = analyzeHealth(
      [record({ date: "2026-09-01", systolic: 155, diastolic: 95 })],
      profile({})
    );
    expect(r.score).toBeGreaterThanOrEqual(25);
    expect(r.risks.some(x => x.includes("收缩压"))).toBe(true);
    expect(r.suggestions.some(x => x.includes("收缩压偏高"))).toBe(true);
    expect(r.items.some(i => i.key === "systolic" && i.level === 2)).toBe(true);
  });

  it("生活方式修正：吸烟+5、饮酒+3、运动不足+5（指标全正常也累计 13 分）", () => {
    const r = analyzeHealth(
      [
        record({
          date: "2026-09-01",
          systolic: 110,
          diastolic: 70,
          fastingGlucose: 5.0
        })
      ],
      profile({ smoking: "经常", drinking: "偶尔", exercise: "几乎不运动" })
    );
    expect(r.score).toBe(13);
    expect(r.risks).toEqual(
      expect.arrayContaining(["吸烟", "饮酒", "运动不足"])
    );
  });

  it("近 3 次血压连续 ≥140/90 → 触发就医提醒；仅 2 次不触发", () => {
    const three = [
      record({ date: "2026-09-01", systolic: 145, diastolic: 95 }),
      record({ date: "2026-09-02", systolic: 150, diastolic: 92 }),
      record({ date: "2026-09-03", systolic: 142, diastolic: 90 })
    ];
    expect(analyzeHealth(three, profile({})).medicalAdvice).toContain("就医");

    const two = three.slice(0, 2);
    expect(analyzeHealth(two, profile({})).medicalAdvice).toBe("");
  });

  it("取最近一条记录做分级（日期倒序）", () => {
    const r = analyzeHealth(
      [
        record({ date: "2026-09-01", systolic: 180 }), // 旧：三级
        record({ date: "2026-09-02", systolic: 118 }) // 新：正常
      ],
      profile({})
    );
    expect(r.score).toBe(0);
    expect(r.items.find(i => i.key === "systolic")?.level).toBe(0);
  });

  it("全异常 + 生活方式 → 上限 100 分、极高", () => {
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
          weight: 95 // BMI = 95/(1.75^2) ≈ 31.0 肥胖（异常）
        })
      ],
      profile({ smoking: "经常", drinking: "经常", exercise: "几乎不运动" })
    );
    expect(r.score).toBe(100);
    expect(r.level).toBe("极高");
  });

  it("空记录数组也能安全返回（无数据不报错）", () => {
    const r = analyzeHealth([], profile({}));
    expect(r.score).toBe(0);
    expect(r.items).toHaveLength(0);
  });
});
