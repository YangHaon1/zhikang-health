/**
 * P1-1 特征一致性治理 · TypeScript 侧读取唯一特征定义。
 *
 * 特征名/顺序/标签/默认值/填充口径的唯一定义源是 `server-ml/feature-spec.json`，
 * 本文件只负责按路径读它并做一致性自检，**不再在 TS 里抄一份字段清单**。
 *
 * 为什么要有这层：
 *   旧实现里 Python 的 FEATURE_ORDER、Node 的 buildFeatures、dataset._default_row
 *   各有一份「同一批特征」，已经实际漂移过（grade_code 1 vs 3；聚类侧漏掉 0 视为缺失）。
 *   现在字段名一旦对不上，接口直接抛错暴露，而不是静默把 undefined 喂给模型。
 */
import fs from "node:fs";
import { mlAssetPath } from "../paths.js";

export interface FeatureSpec {
  spec_version: string;
  feature_order: string[];
  feature_labels: Record<string, string>;
  feature_units: Record<string, string>;
  feature_defaults: Record<string, number>;
  zero_valid: string[];
  key_fields: string[];
  defaults_provenance: Record<string, string>;
}

export const featureSpecFile = (): string => mlAssetPath("feature-spec.json");

let cached: FeatureSpec | null = null;

/** 读取特征定义（带进程内缓存；文件缺失/不完整直接抛错，不静默降级）。 */
export function loadFeatureSpec(): FeatureSpec {
  if (cached) return cached;
  const file = featureSpecFile();
  const raw = fs.readFileSync(file, "utf-8");
  const spec = JSON.parse(raw) as FeatureSpec;
  if (!Array.isArray(spec.feature_order) || spec.feature_order.length === 0) {
    throw new Error(`feature-spec.json 缺少 feature_order: ${file}`);
  }
  for (const key of spec.feature_order) {
    if (!(key in spec.feature_defaults)) {
      throw new Error(`feature-spec.json 的 feature_defaults 缺少字段 ${key}`);
    }
    if (!(key in spec.feature_labels)) {
      throw new Error(`feature-spec.json 的 feature_labels 缺少字段 ${key}`);
    }
  }
  cached = spec;
  return spec;
}

/** 模型输入字段名的唯一清单（顺序即模型特征顺序） */
export const featureOrder = (): string[] => loadFeatureSpec().feature_order;

/** 合法取值为 0 的字段（「0 天」「不在校外」是真值，不能当没填） */
export const zeroValidFeatures = (): string[] => loadFeatureSpec().zero_valid;

/**
 * DB 聚合出的原始特征 dict → 送模型的输入 dict。
 *
 * ⚠️ 这里**故意不做 0→默认值 的填充**：填充统一由 Python 侧 `feature.build_features`
 *    完成（那里同时被风险模型与聚类模型复用）。Node 侧若再填一次，
 *    就会出现「两个地方都以为自己是对的」的第二份口径 —— 正是要根除的问题。
 *    本函数只做两件事：缺字段立刻报错、把 undefined 统一成 null。
 */
export function toModelFeatures(
  raw: Record<string, number | null | undefined>
): Record<string, number | null> {
  const spec = loadFeatureSpec();
  const missing = spec.feature_order.filter(k => !(k in raw));
  if (missing.length) {
    throw new Error(
      `特征构造与 feature-spec.json 不一致，缺少字段: ${missing.join(", ")}`
    );
  }
  const out: Record<string, number | null> = {};
  for (const key of spec.feature_order) {
    const v = raw[key];
    out[key] =
      v === undefined || Number.isNaN(v as number)
        ? null
        : (v as number | null);
  }
  return out;
}
