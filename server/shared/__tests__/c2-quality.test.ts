/**
 * C2 竞赛优化：数据来源 / 质量标记 / 无效数据过滤 / 模拟设备同步解析单元测试。
 * 覆盖：全部指标的合理区间与「绝对不可能」边界、最重档优先级、未测字段跳过、
 * BMI 派生判定、invalid 过滤口径、测量时间规范化、设备上报解析与错误分支。
 *
 * 说明：「来源落库」（manual / device / import 三种来源写进 records.source_type）
 * 属数据库行为，由接口实测与 server/scripts/regress-api.mjs 覆盖，
 * 共享层单测只覆盖纯函数口径（vitest 只加载 server/shared）。
 */
import { describe, expect, it } from "vitest";
import {
  BMI_QUALITY,
  DEVICE_METRIC_ALIASES,
  QUALITY_FLAGS,
  QUALITY_LABELS,
  QUALITY_RANGES,
  SOURCE_LABELS,
  SOURCE_TYPES,
  assessQuality,
  buildDeviceRecords,
  deviceMetricField,
  filterAnalyzable,
  isAnalyzable,
  measuredAtOf,
  normalizeMeasuredAt
} from "../health-quality.js";

// ---------- 工具 ----------

/** 只取一个指标值的质量标记（避免其它字段干扰） */
function flagOf(key: string, value: number) {
  return assessQuality({ [key]: value }).flag;
}

/** 区间表的表格化数据：[key, label, min, max, invalidMin, invalidMax] */
const RANGE_CASES = QUALITY_RANGES.map(r => [
  r.key,
  r.label,
  r.min,
  r.max,
  r.invalidMin,
  r.invalidMax
]);

// ---------- 区间边界 ----------

describe("合理区间边界（闭区间内 good，越界 suspect，绝无可能 invalid）", () => {
  it("区间表覆盖 11 项指标，且 invalid 边界一定比合理区间更宽", () => {
    expect(QUALITY_RANGES).toHaveLength(11);
    for (const r of QUALITY_RANGES) {
      expect(r.invalidMin).toBeLessThanOrEqual(r.min);
      expect(r.invalidMax).toBeGreaterThanOrEqual(r.max);
    }
  });

  it.each(RANGE_CASES)(
    "%s（%s）：min=%d max=%d invalidMin=%d invalidMax=%d 的上下界行为正确",
    (key, _label, min, max, invalidMin, invalidMax) => {
      // 区间端点本身正常
      expect(flagOf(key as string, min as number)).toBe("good");
      expect(flagOf(key as string, max as number)).toBe("good");

      // 刚好越出合理区间：仍可解释 → suspect（若连绝对范围也出了 → invalid）
      const below = (min as number) - 1;
      expect(flagOf(key as string, below)).toBe(
        below < (invalidMin as number) ? "invalid" : "suspect"
      );
      const above = (max as number) + 1;
      expect(flagOf(key as string, above)).toBe(
        above > (invalidMax as number) ? "invalid" : "suspect"
      );
    }
  );

  it.each([
    ["systolic", 50, "good"],
    ["systolic", 49, "suspect"],
    ["systolic", 30, "suspect"],
    ["systolic", 29, "invalid"],
    ["systolic", 0, "invalid"],
    ["systolic", 250, "good"],
    ["systolic", 251, "suspect"],
    ["systolic", 300, "suspect"],
    ["systolic", 301, "invalid"],
    ["systolic", 999, "invalid"],
    ["diastolic", 30, "good"],
    ["diastolic", 29, "suspect"],
    ["diastolic", 19, "invalid"],
    ["fastingGlucose", 1.1, "good"],
    ["fastingGlucose", 1.0, "suspect"],
    ["fastingGlucose", 0.4, "invalid"],
    ["fastingGlucose", 33.3, "good"],
    ["fastingGlucose", 34, "suspect"],
    ["bloodOxygen", 100, "good"],
    ["bloodOxygen", 101, "invalid"],
    ["bloodOxygen", 49, "suspect"],
    ["bloodOxygen", 19, "invalid"],
    ["weight", 10, "good"],
    ["weight", 9, "suspect"],
    ["weight", 0.05, "invalid"]
  ])(
    "%s = %d → %s（方案点名的收缩压 0 / 999 均判 invalid）",
    (key, value, flag) => {
      expect(flagOf(key, value)).toBe(flag);
    }
  );
});

// ---------- 综合标记 ----------

describe("综合标记取最重一档", () => {
  it("多项都在合理区间 → good，且无问题明细", () => {
    const r = assessQuality({
      systolic: 120,
      diastolic: 80,
      fastingGlucose: 5.2,
      heartRate: 72,
      bloodOxygen: 98
    });
    expect(r.flag).toBe("good");
    expect(r.issues).toEqual([]);
  });

  it("一项 suspect → suspect，说明文案含「合理区间」与数值", () => {
    const r = assessQuality({ systolic: 120, fastingGlucose: 40 });
    expect(r.flag).toBe("suspect");
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].key).toBe("fastingGlucose");
    expect(r.issues[0].value).toBe(40);
    expect(r.issues[0].message).toContain("合理区间");
    expect(r.issues[0].message).toContain("40");
  });

  it("suspect + invalid 同时存在 → 取 invalid（最重），问题明细两条都在", () => {
    const r = assessQuality({ systolic: 999, diastolic: 29 });
    expect(r.flag).toBe("invalid");
    expect(r.issues.map(i => i.flag).sort()).toEqual(["invalid", "suspect"]);
    expect(r.issues.find(i => i.flag === "invalid")!.message).toContain(
      "不参与分析"
    );
  });

  it("未测字段（null / undefined / 空串）跳过校验，不算问题", () => {
    const r = assessQuality({
      systolic: null,
      diastolic: undefined,
      fastingGlucose: ""
    });
    expect(r.flag).toBe("good");
    expect(r.issues).toEqual([]);
  });

  it("非数字垃圾值不算质量问题（交给格式校验层返回 400）", () => {
    expect(assessQuality({ systolic: "abc" }).flag).toBe("good");
    expect(assessQuality({}).flag).toBe("good");
  });

  it("只报越界的项，正常项不产生噪音", () => {
    const r = assessQuality({ systolic: 260, diastolic: 100, heartRate: 72 });
    expect(r.issues.map(i => i.key)).toEqual(["systolic"]);
  });

  it("合理区间内的高血压值不算质量问题（suspect 指「不可信」，不是「不健康」）", () => {
    // 165/100 是二级高血压，但完全可能是真实测量值 —— 分级交给规则引擎，质量层不标记
    const r = assessQuality({ systolic: 165, diastolic: 100 });
    expect(r.flag).toBe("good");
    expect(r.issues).toEqual([]);
  });
});

// ---------- BMI 派生判定 ----------

describe("BMI 由档案身高 + 本次体重推导", () => {
  it("身高 170 + 体重 60 → BMI 20.8 正常", () => {
    expect(assessQuality({ weight: 60 }, 170).flag).toBe("good");
  });

  it("身高 170 + 体重 190 → BMI 65.7 超出合理区间 → suspect", () => {
    const r = assessQuality({ weight: 190 }, 170);
    expect(r.flag).toBe("suspect");
    expect(r.issues[0].key).toBe("bmi");
    expect(r.issues[0].value).toBe(65.7);
  });

  it("身高 170 + 体重 300 → BMI 103.8 超出可测量范围 → invalid", () => {
    const r = assessQuality({ weight: 300 }, 170);
    expect(r.flag).toBe("invalid");
    expect(r.issues[0].key).toBe("bmi");
  });

  it("缺身高 或 缺体重 时不做 BMI 判定（不误报）", () => {
    expect(assessQuality({ weight: 300 }).issues).toEqual([]);
    expect(assessQuality({ systolic: 120 }, 170).issues).toEqual([]);
    expect(assessQuality({ weight: 300 }, 0).issues).toEqual([]);
  });

  it("BMI 与体重问题可叠加，且 invalid 优先", () => {
    const r = assessQuality({ weight: 400 }, 170);
    expect(r.flag).toBe("invalid");
    // 体重 400 超合理区间(10-300) 但未超绝对上限(500) → suspect；BMI 超绝对范围 → invalid
    expect(r.issues.map(i => i.flag).sort()).toEqual(["invalid", "suspect"]);
  });

  it("BMI 区间常量与说明一致", () => {
    expect(BMI_QUALITY.min).toBe(10);
    expect(BMI_QUALITY.max).toBe(60);
  });
});

// ---------- invalid 过滤 ----------

describe("invalid 过滤（趋势 / 报告 / 评分 / 看板统一口径）", () => {
  const records = [
    { id: "1", date: "2026-09-01", qualityFlag: "good" },
    { id: "2", date: "2026-09-02", qualityFlag: "suspect" },
    { id: "3", date: "2026-09-03", qualityFlag: "invalid" },
    { id: "4", date: "2026-09-04" }
  ];

  it("isAnalyzable：仅 invalid 被排除；good / suspect / 缺字段（旧数据）都保留", () => {
    expect(records.map(isAnalyzable)).toEqual([true, true, false, true]);
  });

  it("filterAnalyzable 保留原顺序与对象引用", () => {
    const kept = filterAnalyzable(records);
    expect(kept.map(r => r.id)).toEqual(["1", "2", "4"]);
    expect(kept[0]).toBe(records[0]);
  });

  it("空数组与全 invalid 不抛错", () => {
    expect(filterAnalyzable([])).toEqual([]);
    expect(
      filterAnalyzable([{ qualityFlag: "invalid" }]).map(r => r.qualityFlag)
    ).toEqual([]);
  });
});

// ---------- 测量时间 ----------

describe("测量时间规范化", () => {
  it.each([
    ["2026-09-20", "2026-09-20 00:00:00"],
    ["2026-09-20 07:30", "2026-09-20 07:30:00"],
    ["2026-09-20 07:30:15", "2026-09-20 07:30:15"],
    ["2026-09-20T07:30:15", "2026-09-20 07:30:15"],
    ["2026-09-20T07:30:15.123Z", "2026-09-20 07:30:15"],
    ["  2026-09-20 07:30  ", "2026-09-20 07:30:00"]
  ])("%s → %s", (raw, expected) => {
    expect(normalizeMeasuredAt(raw)?.measuredAt).toBe(expected);
  });

  it("日期部分即记录日期（不做时区换算）", () => {
    expect(normalizeMeasuredAt("2026-09-20T23:59:59Z")?.date).toBe(
      "2026-09-20"
    );
  });

  it.each([
    null,
    undefined,
    20260920,
    "",
    "bad-date",
    "2026-13-01",
    "2026-09-32",
    "2026-09-20 25:99",
    "2026-09-20 24:00:00",
    "2026-09-20 12:60:00",
    "2026-09-20 12:00:60"
  ])("无法解析的 %s → null（越界时刻也挡住，不写无意义时间）", raw => {
    expect(normalizeMeasuredAt(raw)).toBeNull();
  });

  it("记录日期 + 时刻 → 测量时间；时刻缺失或非法按 00:00:00", () => {
    expect(measuredAtOf("2026-09-20", "07:30")).toBe("2026-09-20 07:30:00");
    expect(measuredAtOf("2026-09-20", "07:30:15")).toBe("2026-09-20 07:30:15");
    expect(measuredAtOf("2026-09-20")).toBe("2026-09-20 00:00:00");
    expect(measuredAtOf("2026-09-20", "25:99")).toBe("2026-09-20 00:00:00");
    expect(measuredAtOf("2026-09-20", "")).toBe("2026-09-20 00:00:00");
  });
});

// ---------- 来源 / 质量常量 ----------

describe("来源与质量常量", () => {
  it("三者来源都有中文标签，质量标记三档齐全", () => {
    expect([...SOURCE_TYPES]).toEqual(["manual", "device", "import"]);
    for (const s of SOURCE_TYPES) expect(SOURCE_LABELS[s]).toBeTruthy();
    expect([...QUALITY_FLAGS]).toEqual(["good", "suspect", "invalid"]);
    expect(Object.keys(QUALITY_LABELS).sort()).toEqual([
      "good",
      "invalid",
      "suspect"
    ]);
  });
});

// ---------- 设备上报解析 ----------

describe("设备指标名识别", () => {
  it.each([
    ["systolic", "systolic"],
    ["SBP", "systolic"],
    ["收缩压", "systolic"],
    ["diastolic", "diastolic"],
    ["dbp", "diastolic"],
    ["glucose", "fastingGlucose"],
    ["空腹血糖", "fastingGlucose"],
    ["blood_oxygen", "bloodOxygen"],
    ["Blood Oxygen", "bloodOxygen"],
    ["SpO2", "bloodOxygen"],
    ["TG", "triglyceride"],
    ["heart-rate", "heartRate"],
    ["PULSE", "heartRate"],
    ["体重", "weight"]
  ])("%s → %s", (metric, field) => {
    expect(deviceMetricField(metric)).toBe(field);
  });

  it.each([["unknown"], ["血糖值"], [""], [null], [123]])(
    "无法识别 %s → null",
    metric => {
      expect(deviceMetricField(metric)).toBeNull();
    }
  );

  it("别名表里每个字段都能被自己的别名解析回来（无拼写漂移）", () => {
    for (const [field, names] of Object.entries(DEVICE_METRIC_ALIASES)) {
      for (const n of names) expect(deviceMetricField(n)).toBe(field);
    }
  });
});

describe("设备上报 → 记录草稿", () => {
  const device = "智康智能血压计 BP-200";

  it("一天多条指标合并成一条记录，带上设备名与来源时间", () => {
    const r = buildDeviceRecords(device, [
      { metric: "systolic", value: 128, measuredAt: "2026-09-20 07:30:00" },
      { metric: "diastolic", value: 82, measuredAt: "2026-09-20 07:30:00" },
      { metric: "spo2", value: 98, measuredAt: "2026-09-20 07:31:00" }
    ]);
    expect(r.error).toBe("");
    expect(r.records).toHaveLength(1);
    const [draft] = r.records;
    expect(draft.date).toBe("2026-09-20");
    expect(draft.device).toBe(device);
    expect(draft.metrics).toEqual({
      systolic: 128,
      diastolic: 82,
      bloodOxygen: 98
    });
    // measuredAt 取该组内最晚一次
    expect(draft.measuredAt).toBe("2026-09-20 07:31:00");
    expect(draft.qualityFlag).toBe("good");
    expect(draft.issues).toEqual([]);
  });

  it("跨天自动分组，各组日期与时间互不影响（按上传顺序稳定输出）", () => {
    const r = buildDeviceRecords(device, [
      { metric: "heartRate", value: 70, measuredAt: "2026-09-18 06:00:00" },
      { metric: "heartRate", value: 72, measuredAt: "2026-09-19 06:00:00" },
      { metric: "systolic", value: 130, measuredAt: "2026-09-18 06:05:00" }
    ]);
    expect(r.error).toBe("");
    expect(r.records.map(d => d.date)).toEqual(["2026-09-18", "2026-09-19"]);
    expect(r.records[0].metrics).toEqual({ heartRate: 70, systolic: 130 });
    expect(r.records[0].measuredAt).toBe("2026-09-18 06:05:00");
    expect(r.records[1].metrics).toEqual({ heartRate: 72 });
  });

  it("同一天同一指标重复上报 → 后一条覆盖前一条", () => {
    const r = buildDeviceRecords(device, [
      { metric: "systolic", value: 120, measuredAt: "2026-09-20 07:00:00" },
      { metric: "systolic", value: 145, measuredAt: "2026-09-20 20:00:00" }
    ]);
    expect(r.records).toHaveLength(1);
    expect(r.records[0].metrics.systolic).toBe(145);
    expect(r.records[0].measuredAt).toBe("2026-09-20 20:00:00");
  });

  it("设备上报同样做质量校验：越界标 suspect / invalid 并给出说明", () => {
    const r = buildDeviceRecords(device, [
      { metric: "systolic", value: 260, measuredAt: "2026-09-20 07:00:00" },
      { metric: "spo2", value: 120, measuredAt: "2026-09-20 07:00:00" }
    ]);
    const [draft] = r.records;
    expect(draft.qualityFlag).toBe("invalid");
    expect(draft.issues.map(i => i.key).sort()).toEqual([
      "bloodOxygen",
      "systolic"
    ]);
    expect(draft.issues.every(i => i.message)).toBe(true);
  });

  it("传入身高时设备记录也判定 BMI", () => {
    const r = buildDeviceRecords(
      device,
      [{ metric: "weight", value: 190, measuredAt: "2026-09-20" }],
      170
    );
    expect(r.records[0].qualityFlag).toBe("suspect");
    expect(r.records[0].issues[0].key).toBe("bmi");
  });

  it("只给日期（无时刻）时按 00:00:00 处理", () => {
    const r = buildDeviceRecords(device, [
      { metric: "weight", value: 70, measuredAt: "2026-09-20" }
    ]);
    expect(r.records[0].measuredAt).toBe("2026-09-20 00:00:00");
  });
});

describe("设备上报格式错误（调用方转 400，且整批不落库）", () => {
  const device = "智康智能血压计 BP-200";
  const good = { metric: "systolic", value: 120, measuredAt: "2026-09-20" };

  it.each([
    ["device 为空串", "", [good]],
    ["device 缺失", undefined, [good]],
    ["device 非字符串", 123, [good]],
    ["measurements 缺失", device, undefined],
    ["measurements 非数组", device, { metric: "systolic" }],
    ["measurements 空数组", device, []],
    ["测量项不是对象", device, [null]],
    ["metric 无法识别", device, [{ ...good, metric: "unknown" }]],
    ["metric 缺失", device, [{ value: 120, measuredAt: "2026-09-20" }]],
    ["value 非数字", device, [{ ...good, value: "abc" }]],
    ["value 为空串", device, [{ ...good, value: "" }]],
    ["value 缺失", device, [{ metric: "systolic", measuredAt: "2026-09-20" }]],
    ["measuredAt 无法解析", device, [{ ...good, measuredAt: "bad" }]],
    ["measuredAt 缺失", device, [{ metric: "systolic", value: 120 }]],
    [
      "一条合法 + 一条非法（整批拒绝）",
      device,
      [good, { metric: "systolic", value: 999 }]
    ]
  ])("%s → error 非空且 records 为空", (_desc, dev, measurements) => {
    const r = buildDeviceRecords(dev, measurements);
    expect(r.error).not.toBe("");
    expect(r.records).toEqual([]);
  });

  it("错误文案指出第几条出错（便于设备端排查）", () => {
    const r = buildDeviceRecords(device, [
      good,
      { ...good, metric: "systolic" },
      { metric: "unknown", value: 1, measuredAt: "2026-09-20" }
    ]);
    expect(r.error).toContain("第 3 条");
  });

  it("同一输入两次解析结果相同（可复算）", () => {
    const input = [
      good,
      { metric: "spo2", value: 98, measuredAt: "2026-09-20" }
    ];
    expect(buildDeviceRecords(device, input)).toEqual(
      buildDeviceRecords(device, input)
    );
  });
});
