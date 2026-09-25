/**
 * P1-1 特征一致性治理：字段清单漂移守卫。
 *
 * 目的不是测某个函数，而是**让"两侧字段不一致"这件事在 CI 里直接红掉**。
 * 之前发生过两次真实漂移：
 *   1. `dataset._default_row` 的 `grade_code=1` 与 `feature.FEATURE_DEFAULTS` 的 `3` 不一致；
 *   2. 聚类侧自己写了一遍缺失判定，漏掉"0 只可能是没填"，与风险模型口径打架。
 * 断言全部对着 `server-ml/feature-spec.json` 这份唯一来源做，不复制字段清单。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  featureSpecFile,
  loadFeatureSpec,
  toModelFeatures,
  zeroValidFeatures
} from "../../src/services/featureSource.js";

const SERVER_ML = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "server-ml"
);

/** DB/接口侧实际构造的特征字段（与 risk.ts 的 buildFeatures 一一对应） */
const RISK_ROUTE_FEATURE_KEYS = [
  "sleep_hours_mean",
  "sleep_below7_days",
  "sleep_quality_avg",
  "exercise_min_sum",
  "exercise_days",
  "stress_avg",
  "stress_high_days",
  "diet_reg_ratio",
  "mood_avg",
  "study_hours",
  "sedentary_hours",
  "bedtime_hour",
  "is_off_campus",
  "grade_code",
  "bmi"
];

describe("P1-1 feature-spec.json 是唯一定义源", () => {
  it("spec 文件可定位（不依赖 cwd）", () => {
    const file = featureSpecFile();
    expect(fs.existsSync(file), `spec 文件不存在: ${file}`).toBe(true);
  });

  it("spec 与 server-ml 目录同源，且 15 个特征齐全、顺序稳定", () => {
    const spec = loadFeatureSpec();
    expect(spec.feature_order).toHaveLength(15);
    // 顺序即模型特征顺序：train/predict 必须一致，改顺序等于换模型
    expect(spec.feature_order).toEqual(RISK_ROUTE_FEATURE_KEYS);
    expect(spec.spec_version).toBe("feature-spec-v1");
  });

  it("每个特征都有标签、单位、默认值（缺一个就说明两侧会各自兜底）", () => {
    const spec = loadFeatureSpec();
    for (const key of spec.feature_order) {
      expect(spec.feature_labels[key], `${key} 缺中文标签`).toBeTruthy();
      expect(spec.feature_units[key], `${key} 缺单位`).toBeTruthy();
      expect(
        Number.isFinite(spec.feature_defaults[key]),
        `${key} 缺数值默认值`
      ).toBe(true);
    }
  });

  it("默认值不是 0（0 在训练分布里是极端值，缺失填 0 会把新用户判成高风险）", () => {
    const spec = loadFeatureSpec();
    const zeroDefaults = Object.entries(spec.feature_defaults).filter(
      ([, v]) => v === 0
    );
    // 只有 is_off_campus（0/1 类别特征）允许默认 0
    expect(zeroDefaults.map(([k]) => k)).toEqual(["is_off_campus"]);
  });

  it("zero_valid 只包含「0 是真实语义」的字段", () => {
    expect(new Set(zeroValidFeatures())).toEqual(
      new Set(["exercise_days", "sleep_below7_days", "is_off_campus"])
    );
  });

  it("默认值出处被如实记录（不再出现「注释说中位数、实际是生成均值」）", () => {
    const spec = loadFeatureSpec();
    const provenance = spec.defaults_provenance;
    expect(provenance.source).toContain("make_synth");
    expect(provenance.kind).toBe("generator_means");
    expect(provenance.caveat, "必须写明默认值不是严格中位数").toContain(
      "中位数"
    );
  });
});

describe("P1-1 Python 侧同样读这一份 spec", () => {
  const featurePy = fs.readFileSync(
    path.join(SERVER_ML, "feature.py"),
    "utf-8"
  );

  it("feature.py 从 feature-spec.json 读取，而不是再硬编码一份清单", () => {
    expect(featurePy).toContain('"feature-spec.json"');
    expect(featurePy).toContain("FEATURE_SPEC");
    // 硬编码的 15 项列表一旦回归，这里立刻失败
    expect(featurePy).not.toMatch(/"sleep_hours_mean",\s*#/);
  });

  it("Python 侧不再有第二份默认值表（dataset._default_row 复用 FEATURE_DEFAULTS）", () => {
    const datasetPy = fs.readFileSync(
      path.join(SERVER_ML, "dataset.py"),
      "utf-8"
    );
    expect(datasetPy).toContain("return dict(FEATURE_DEFAULTS)");
    expect(datasetPy).not.toMatch(/"grade_code":\s*1/);
  });

  it("聚类预测复用 build_features，不再自写缺失判定", () => {
    const clusterPy = fs.readFileSync(
      path.join(SERVER_ML, "cluster_predict.py"),
      "utf-8"
    );
    expect(clusterPy).toContain("build_features(raw)");
    expect(clusterPy).not.toContain("not in (None, ");
  });

  it("漂移基线产物描述的字段与 spec 完全一致（15 个，不多不少）", () => {
    const baselinePath = path.join(SERVER_ML, "model", "feature-baseline.json");
    const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf-8")) as {
      baseline_version: string;
      features: Array<{
        feature: string;
        bin_edges: number[];
        proportions: number[];
      }>;
    };
    const spec = loadFeatureSpec();
    expect(baseline.features.map(f => f.feature)).toEqual(spec.feature_order);
    for (const f of baseline.features) {
      expect(
        f.bin_edges.length,
        `${f.feature} 分箱边界太少`
      ).toBeGreaterThanOrEqual(2);
      expect(f.proportions).toHaveLength(f.bin_edges.length - 1);
      const sum = f.proportions.reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - 1), `${f.feature} 基线占比之和应为 1`).toBeLessThan(
        1e-6
      );
    }
  });
});

describe("P1-1 toModelFeatures：字段缺失立刻暴露", () => {
  it("字段齐全时原样透传，undefined 归一为 null", () => {
    const raw: Record<string, number | null> = {};
    for (const k of RISK_ROUTE_FEATURE_KEYS) raw[k] = 1;
    raw.bmi = null;
    const out = toModelFeatures(raw);
    expect(Object.keys(out)).toEqual(RISK_ROUTE_FEATURE_KEYS);
    expect(out.bmi).toBeNull();
    expect(out.sleep_hours_mean).toBe(1);
  });

  it("少字段直接抛错（而不是把 undefined 喂给模型）", () => {
    const raw: Record<string, number | null> = {};
    for (const k of RISK_ROUTE_FEATURE_KEYS.slice(1)) raw[k] = 1;
    expect(() => toModelFeatures(raw)).toThrow(/缺少字段.*sleep_hours_mean/);
  });

  it("不自己填默认值：填充口径只允许 Python 侧一处（避免第二个口径）", () => {
    const out = toModelFeatures({
      ...Object.fromEntries(RISK_ROUTE_FEATURE_KEYS.map(k => [k, 0])),
      sleep_quality_avg: 0
    } as Record<string, number | null>);
    // 原样保留 0，由 feature.build_features / is_missing 决定它是不是"没填"
    expect(out.sleep_quality_avg).toBe(0);
  });
});
