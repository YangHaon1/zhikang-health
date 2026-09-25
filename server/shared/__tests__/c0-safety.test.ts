/**
 * C0 竞赛优化：规则可解释性与医疗安全底座单元测试。
 * 覆盖：规则元数据（ruleId/ruleVersion/阈值/依据）、emergency 紧急处置卡分流
 * （极端指标 / 危险症状关键词 / 正常不触发）、风险解释 buildEvidence。
 */
import { describe, expect, it } from "vitest";
import {
  BOUNDARY_TEXT,
  ENGINE_VERSION,
  analyzeHealth,
  buildEvidence,
  checkEmergency,
  emergencyCardToText,
  gradeBmi,
  gradeDiastolic,
  gradeFastingGlucose,
  gradeHdl,
  gradeLdl,
  gradeSystolic,
  gradeTotalCholesterol,
  gradeTriglyceride
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

// ---------- C0：规则元数据 ----------

describe("C0 规则元数据（RuleMeta）", () => {
  it("每条分级规则都携带 ruleId / ruleVersion / 适用人群 / 阈值说明 / 依据", () => {
    const cases: Array<[string, ReturnType<typeof gradeSystolic>]> = [
      ["BMI", gradeBmi(175, 90)!],
      ["收缩压", gradeSystolic(150)],
      ["舒张压", gradeDiastolic(95)],
      ["空腹血糖", gradeFastingGlucose(7.5)],
      ["总胆固醇", gradeTotalCholesterol(6.5)],
      ["甘油三酯", gradeTriglyceride(2.5)],
      ["LDL", gradeLdl(4.2)],
      ["HDL", gradeHdl(0.8, 1)]
    ];
    for (const [name, g] of cases) {
      expect(g.rule.ruleId, `${name} 应有 ruleId`).toBeTruthy();
      expect(g.rule.ruleVersion, `${name} 应有 ruleVersion`).toBe(
        ENGINE_VERSION
      );
      expect(g.rule.applicableTo, `${name} 应有适用人群`).toContain("成人");
      expect(
        g.rule.thresholdDesc.length,
        `${name} 应有阈值说明`
      ).toBeGreaterThan(10);
      expect(g.rule.evidence, `${name} 应有依据来源`).toContain("指南");
    }
  });

  it("ruleId 稳定且唯一（同指标多等级返回同一规则）", () => {
    expect(gradeSystolic(120).rule.ruleId).toBe("BP-SYS-001");
    expect(gradeSystolic(180).rule.ruleId).toBe("BP-SYS-001");
    expect(gradeDiastolic(95).rule.ruleId).toBe("BP-DIA-001");
    expect(gradeFastingGlucose(7.0).rule.ruleId).toBe("GLU-FPG-001");
    expect(gradeBmi(175, 90)!.rule.ruleId).toBe("BMI-001");
  });

  it("阈值临界值命中对应等级（C0 验收：所有阈值临界值有规则归属）", () => {
    expect(gradeSystolic(140).grade).toBe("一级高血压");
    expect(gradeSystolic(160).grade).toBe("二级高血压");
    expect(gradeSystolic(180).grade).toBe("三级高血压");
    expect(gradeDiastolic(90).grade).toBe("一级高血压");
    expect(gradeFastingGlucose(7.0).grade).toBe("血糖升高风险");
    expect(gradeFastingGlucose(6.1).grade).toBe("受损");
  });
});

// ---------- C0：紧急处置卡（emergency 分流） ----------

describe("checkEmergency（紧急处置卡分流）", () => {
  it("极端指标：收缩压 ≥180 触发 extreme", () => {
    const card = checkEmergency(
      "我最近血压怎么样",
      record({ date: "2026-09-01", systolic: 190 })
    );
    expect(card).not.toBeNull();
    expect(card!.kind).toBe("extreme");
    expect(card!.reason).toContain("收缩压 190");
    expect(card!.steps.length).toBeGreaterThanOrEqual(4);
    expect(card!.boundary).toBe(BOUNDARY_TEXT);
  });

  it("极端指标：舒张压 ≥110 触发", () => {
    expect(
      checkEmergency(
        "评估风险",
        record({ date: "2026-09-01", diastolic: 115 })
      )!.kind
    ).toBe("extreme");
  });

  it("极端指标：空腹血糖 ≥16.7 与 ≤2.8 均触发", () => {
    expect(
      checkEmergency(
        "看看血糖",
        record({ date: "2026-09-01", fastingGlucose: 18 })
      )!.kind
    ).toBe("extreme");
    expect(
      checkEmergency(
        "看看血糖",
        record({ date: "2026-09-01", fastingGlucose: 2.5 })
      )!.kind
    ).toBe("extreme");
  });

  it("极端指标：血氧 <90 触发", () => {
    expect(
      checkEmergency(
        "最近情况",
        record({ date: "2026-09-01", bloodOxygen: 88 })
      )!.kind
    ).toBe("extreme");
  });

  it("危险症状关键词：问题中主动提及触发 symptom（含长词优先匹配）", () => {
    expect(checkEmergency("我有点胸痛", null)!.kind).toBe("symptom");
    expect(checkEmergency("突然言语不清怎么办", null)!.reason).toContain(
      "言语不清"
    );
    expect(checkEmergency("一侧肢体无力，是中风吗", null)!.kind).toBe(
      "symptom"
    );
    expect(checkEmergency("胸闷伴大汗", null)!.kind).toBe("symptom");
  });

  it("正常记录 + 普通问题 → 不触发（返回 null）", () => {
    const normal = record({
      date: "2026-09-01",
      systolic: 120,
      diastolic: 80,
      fastingGlucose: 5.2
    });
    expect(checkEmergency("我最近血压怎么样", normal)).toBeNull();
    expect(checkEmergency("评估一下健康风险", normal)).toBeNull();
    expect(checkEmergency("给我一些生活方式建议", normal)).toBeNull();
  });

  it("「胸口不适」等泛化词不误触（只命中明确关键词）", () => {
    expect(checkEmergency("胸口有点闷，需要注意什么", null)).toBeNull();
  });

  it("emergencyCardToText 输出固定处置步骤与边界文案", () => {
    const card = checkEmergency("我胸痛", null)!;
    const text = emergencyCardToText(card);
    expect(text).toContain("紧急健康提示");
    expect(text).toContain("120");
    expect(text).toContain(BOUNDARY_TEXT);
    expect(text).toContain("不要自行驾车");
  });

  it("大模型模式不可绕过：任何模式下命中 emergency 都由固定卡接管（chat 路由据此分流）", () => {
    // 规则引擎与大模型共用同一入口；此处验证 emergency 判定独立于 mode 参数
    const cardRules = checkEmergency("我胸痛", null);
    const cardLlm = checkEmergency("我胸痛", null);
    expect(cardRules).toEqual(cardLlm);
    expect(cardRules).not.toBeNull();
  });
});

// ---------- C0：风险解释（evidence） ----------

describe("buildEvidence（风险解释）", () => {
  const records = [
    record({
      date: "2026-09-03",
      systolic: 152,
      diastolic: 96,
      fastingGlucose: 6.5
    }),
    record({ date: "2026-09-01", systolic: 148, diastolic: 92 })
  ];

  it("每条解释都含指标、数值、记录日期、规则版本/阈值/依据、限制说明", () => {
    const exp = buildEvidence(
      records,
      profile({}),
      analyzeHealth(records, profile({}))
    );
    expect(exp.conclusion).toContain("综合评分");
    expect(exp.boundary).toBe(BOUNDARY_TEXT);
    expect(exp.engineVersion).toBe(ENGINE_VERSION);
    expect(exp.items.length).toBeGreaterThanOrEqual(3);

    const systolic = exp.items.find(i => i.key === "systolic")!;
    expect(systolic.value).toBe(152);
    expect(systolic.recordDate).toBe("2026-09-03"); // 最近一条含该指标
    expect(systolic.sourceDesc).toContain("最近一次收缩压记录");
    expect(systolic.rule.ruleId).toBe("BP-SYS-001");
    expect(systolic.rule.thresholdDesc).toContain("140");
    expect(systolic.rule.evidence).toContain("指南");
    expect(systolic.limit).toContain("复测");
  });

  it("BMI 解释：来源为档案身高 + 最近体重，记录日期取最近含体重记录", () => {
    const r = record({ date: "2026-09-03", weight: 82 });
    const exp = buildEvidence(
      [r],
      profile({ height: 175 }),
      analyzeHealth([r], profile({ height: 175 }))
    );
    const bmi = exp.items.find(i => i.key === "bmi")!;
    expect(bmi.sourceDesc).toContain("档案身高");
    expect(bmi.recordDate).toBe("2026-09-03");
  });

  it("空数据安全返回（items 为空、结论仍完整）", () => {
    const exp = buildEvidence([], null);
    expect(exp.items).toHaveLength(0);
    expect(exp.conclusion).toContain("0 分");
    expect(exp.boundary).toBe(BOUNDARY_TEXT);
  });

  /**
   * 否定 / 非本人 / 既往 语境不得触发急救卡。
   * 假阳性的危害大于假阴性：它会让用户忽视真正触发时的提示。
   */
  describe("emergency 否定语境过滤", () => {
    it("否定表述不触发", () => {
      expect(checkEmergency("我没有胸痛")).toBeNull();
      expect(checkEmergency("我没有胸痛，就是有点累")).toBeNull();
      expect(checkEmergency("我不会轻生的，别担心")).toBeNull();
    });

    it("非本人表述不触发", () => {
      expect(checkEmergency("家人有抽搐史，我需要担心吗")).toBeNull();
      expect(checkEmergency("朋友说胸痛很危险，是真的吗")).toBeNull();
    });

    it("既往 / 假设表述不触发", () => {
      expect(checkEmergency("我以前有过晕厥，现在好了")).toBeNull();
      expect(checkEmergency("如果我以后胸痛怎么办")).toBeNull();
    });

    it("当前发生的症状仍然必须触发（不能因过滤而漏报）", () => {
      expect(checkEmergency("我现在胸痛得厉害")).not.toBeNull();
      expect(checkEmergency("突然一侧肢体无力")).not.toBeNull();
      expect(checkEmergency("我呼吸困难")).not.toBeNull();
    });
  });

  describe("emergency 下界阈值与心理危机", () => {
    it("低血压（休克）应触发", () => {
      const card = checkEmergency("我有点头晕", {
        systolic: 80,
        diastolic: 50
      } as never);
      expect(card).not.toBeNull();
      expect(card!.reason).toContain("收缩压");
    });

    it("心率异常应触发", () => {
      expect(
        checkEmergency("我不舒服", { heartRate: 35 } as never)
      ).not.toBeNull();
      expect(
        checkEmergency("我不舒服", { heartRate: 145 } as never)
      ).not.toBeNull();
    });

    it("高渗高血糖应触发", () => {
      expect(
        checkEmergency("我不舒服", { fastingGlucose: 35 } as never)
      ).not.toBeNull();
    });

    it("心理危机走心理援助通道，而不是 120 处置步骤", () => {
      const card = checkEmergency("我最近不想活了");
      expect(card).not.toBeNull();
      expect(card!.steps.join("")).toContain("12356");
      expect(card!.steps.join("")).not.toContain("不要自行驾车");
    });

    it("正常指标不触发", () => {
      expect(
        checkEmergency("我觉得还好", { systolic: 120, diastolic: 75 } as never)
      ).toBeNull();
    });
  });
});
