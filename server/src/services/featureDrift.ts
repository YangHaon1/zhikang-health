/**
 * P1-1 特征一致性治理 · TypeScript 侧（PSI 漂移判定）。
 *
 * 与 `server-ml/feature_drift.py` 使用同一套分箱与计算规则：
 * 分箱边界一律来自 `server-ml/model/feature-baseline.json`（由 feature_baseline.py 生成），
 * 本文件与 Python 都不自己造边界，因此两侧 PSI 数值可直接互相对照。
 *
 * 判定阈值（业界通用口径，非本项目自创）：
 *   PSI < 0.10        稳定
 *   0.10 ≤ PSI < 0.25 轻微漂移
 *   PSI ≥ 0.25        显著漂移
 *
 * ⚠️ 这是「输入分布」监控，不是精度监控。PSI 大只说明线上输入不再像训练数据，
 *    不代表预测一定错；PSI 小也不代表预测一定对。对外展示必须如实这么讲。
 */
import fs from "node:fs";
import { mlAssetPath } from "../paths.js";

export const PSI_STABLE_MAX = 0.1;
export const PSI_WATCH_MAX = 0.25;

/** 防止除零：任一侧占比为 0 时用极小值替代后仍可算出有限数值 */
const EPS = 1e-4;

export interface FeatureBaselineRef {
  feature: string;
  label: string;
  unit: string;
  bin_edges: number[];
  proportions: number[];
  reference_median: number;
  reference_mean: number;
  reference_min: number;
  reference_max: number;
}

export interface FeatureBaseline {
  baseline_version: string;
  feature_spec_version: string;
  provenance: {
    source: string;
    seed: number;
    samples: number;
    bins: number;
    caveat: string;
  };
  label_distribution: Record<string, number>;
  features: FeatureBaselineRef[];
}

/** 基线产物文件路径（不存在时返回首选候选，交由调用方 existsSync 判断） */
export const featureBaselineFile = (): string =>
  mlAssetPath("model", "feature-baseline.json");

/** 读取基线产物。读不到/格式不对一律返回 null，由调用方如实降级为「无基线」。 */
export function loadBaseline(): FeatureBaseline | null {
  const file = featureBaselineFile();
  try {
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(
      fs.readFileSync(file, "utf-8")
    ) as FeatureBaseline;
    if (!Array.isArray(parsed?.features) || parsed.features.length === 0) {
      return null;
    }
    return parsed;
  } catch {
    // 基线损坏时不猜、不缓存半个结果：返回 null，接口层显示"基线不可用"
    return null;
  }
}

/** 值 → 箱号。低于首边界归 0，高于末边界归最后一箱（越界本身就是重要信号）。 */
export function binIndex(value: number, edges: number[]): number {
  if (edges.length < 2) return 0;
  const inner = edges.slice(1, -1);
  let idx = 0;
  while (idx < inner.length && value >= inner[idx]) idx += 1;
  return idx;
}

/** 按 edges 分箱后的实际占比（与 Python actual_proportions 同一套规则） */
export function actualProportions(values: number[], edges: number[]): number[] {
  const nBins = Math.max(1, edges.length - 1);
  const counts = new Array<number>(nBins).fill(0);
  for (const v of values) counts[binIndex(v, edges)] += 1;
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 0) return new Array<number>(nBins).fill(0);
  return counts.map(c => c / total);
}

/** PSI = Σ (A% - E%) · ln(A% / E%)，两侧占比都做 EPS 截断 */
export function psi(reference: number[], actual: number[]): number {
  if (reference.length !== actual.length) {
    throw new Error(
      `分箱数不一致: reference=${reference.length} actual=${actual.length}`
    );
  }
  let total = 0;
  for (let i = 0; i < reference.length; i += 1) {
    const e = Math.max(reference[i], EPS);
    const a = Math.max(actual[i], EPS);
    total += (a - e) * Math.log(a / e);
  }
  return total;
}

export function psiLevel(value: number): "stable" | "watch" | "significant" {
  if (value >= PSI_WATCH_MAX) return "significant";
  if (value >= PSI_STABLE_MAX) return "watch";
  return "stable";
}

const round = (v: number, digits = 4) => Number(v.toFixed(digits));

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export interface FeatureDriftItem {
  feature: string;
  label: string;
  unit: string;
  psi: number | null;
  level: "stable" | "watch" | "significant" | "no_data";
  samples: number;
  actualMedian: number | null;
  referenceMedian: number | null;
}

export interface DriftReport {
  available: boolean;
  baselineVersion: string;
  trainedWith: string;
  /** 最差特征的等级，无任何数据时为 no_data */
  level: "stable" | "watch" | "significant" | "no_data";
  maxPsi: number | null;
  maxPsiFeature: string | null;
  samples: number;
  /** 样本量是否足以让 PSI 可信（少了就必须标注，不能拿十几个点当结论） */
  sufficient: boolean;
  thresholds: { stable: number; watch: number };
  /** 比对用的两份产物路径：让调用方能自己确认"基线到底是哪来的" */
  baselineFile: string;
  specFile: string;
  features: FeatureDriftItem[];
  disclaimer: string;
}

/** 无基线时的如实降级（不是 0 分，是「不知道」） */
export function unavailableReport(): DriftReport {
  return {
    available: false,
    baselineVersion: "none",
    trainedWith: "unknown",
    level: "no_data",
    maxPsi: null,
    maxPsiFeature: null,
    samples: 0,
    sufficient: false,
    thresholds: { stable: PSI_STABLE_MAX, watch: PSI_WATCH_MAX },
    baselineFile: featureBaselineFile(),
    specFile: mlAssetPath("feature-spec.json"),
    features: [],
    disclaimer: DISCLAIMER
  };
}

export const DISCLAIMER =
  "PSI 只反映「线上输入分布」与训练分布的偏离程度，不是模型精度指标；" +
  "PSI 低不代表预测正确，PSI 高也不代表预测错误。";

/**
 * 生成漂移报告。
 * @param live {特征名: 线上实测值数组}，缺失的特征在报告里标 no_data
 * @param minSamples 样本量下限，默认 30（低于此值 PSI 抖动大，必须标注不可信）
 */
export function driftReport(
  live: Record<string, number[]>,
  minSamples = 30,
  baseline: FeatureBaseline | null = loadBaseline()
): DriftReport {
  if (!baseline) return unavailableReport();

  let checked = 0;
  const features: FeatureDriftItem[] = baseline.features.map(ref => {
    const values = (live[ref.feature] ?? []).filter(v => Number.isFinite(v));
    checked = Math.max(checked, values.length);
    if (values.length === 0) {
      return {
        feature: ref.feature,
        label: ref.label,
        unit: ref.unit,
        psi: null,
        level: "no_data",
        samples: 0,
        actualMedian: null,
        referenceMedian: ref.reference_median
      };
    }
    const value = psi(
      ref.proportions,
      actualProportions(values, ref.bin_edges)
    );
    return {
      feature: ref.feature,
      label: ref.label,
      unit: ref.unit,
      psi: round(value),
      level: psiLevel(value),
      samples: values.length,
      actualMedian: round(median(values)),
      referenceMedian: ref.reference_median
    };
  });

  const scored = features.filter(
    (f): f is FeatureDriftItem & { psi: number } => f.psi !== null
  );
  const worst = scored.length
    ? scored.reduce((a, b) => (b.psi > a.psi ? b : a))
    : null;

  return {
    available: true,
    baselineVersion: baseline.baseline_version ?? "unknown",
    trainedWith: baseline.provenance?.source ?? "unknown",
    level: worst ? worst.level : "no_data",
    maxPsi: worst ? worst.psi : null,
    maxPsiFeature: worst ? worst.feature : null,
    samples: checked,
    sufficient: checked >= minSamples,
    thresholds: { stable: PSI_STABLE_MAX, watch: PSI_WATCH_MAX },
    baselineFile: featureBaselineFile(),
    specFile: mlAssetPath("feature-spec.json"),
    features,
    disclaimer: DISCLAIMER
  };
}
