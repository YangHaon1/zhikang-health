// C4 脱敏群体健康看板：聚合口径唯一源码（纯函数，禁 Node/DOM 依赖）。
// ★ 唯一源码：后端（server/src/routes/health/analytics.ts）与前端（@shared 别名只取类型）共用这一份。
//
// 分工：评分 / 等级一律由 `analyzeHealth` **现算**（本文件不重写任何分级阈值），
// `analyzeUserForAnalytics` 把引擎输出收敛成聚合输入，`buildAnalyticsOverview` 只做
// 分桶、求占比与**小样本隐藏**（k-匿名），因此结果与「逐个用户跑规则引擎」永远可复算。

import { analyzeHealth } from "./health-engine.js";
import { isShared } from "./health-privacy.js";
import type {
  HealthProfile,
  HealthRecord,
  RiskLevel
} from "./health-engine.js";

/** 小样本隐藏阈值（k-匿名）：任一分组样本数 < 此值 → 该分组不返回任何数值 */
export const ANALYTICS_MIN_SAMPLE = 5;

/** 评分分桶（边界与 health-engine 的 riskLevelOf 完全一致：<30 低 / 30-59 中 / 60-79 高 / ≥80 极高） */
export const SCORE_BUCKETS = [
  { key: "lt30", label: "30 分以下", min: 0, max: 29 },
  { key: "b30to59", label: "30-59 分", min: 30, max: 59 },
  { key: "b60to79", label: "60-79 分", min: 60, max: 79 },
  { key: "gte80", label: "80 分及以上", min: 80, max: 100 }
] as const;

export type ScoreBucketKey = (typeof SCORE_BUCKETS)[number]["key"];

/** 风险等级顺序（集合与规则引擎 RiskLevel 一致，顺序即由轻到重，本文件不另立分级） */
export const RISK_LEVELS: readonly RiskLevel[] = ["低", "中", "高", "极高"];

/** 看板关注的指标（key 对齐 health-engine 的 IndicatorGrade.key；「异常」= 引擎 level === 2） */
export const ANALYTICS_INDICATORS = [
  { key: "systolic", name: "收缩压" },
  { key: "diastolic", name: "舒张压" },
  { key: "fastingGlucose", name: "空腹血糖" },
  { key: "bmi", name: "BMI" },
  { key: "totalCholesterol", name: "总胆固醇" },
  { key: "triglyceride", name: "甘油三酯" },
  { key: "ldl", name: "低密度脂蛋白" }
] as const;

/** 单个用户的聚合输入（评分 / 等级 / 异常指标均由规则引擎现算得出） */
export interface UserAnalyticsInput {
  userId: number;
  /** 该用户记录数（0 = 无记录，不参与评分与等级分布） */
  recordCount: number;
  /** 综合评分（引擎口径：风险分，越高风险越大） */
  score: number;
  /** 风险等级 */
  level: RiskLevel;
  /** 异常指标 key（level === 2） */
  abnormalKeys: string[];
  /** 已测指标 key（该指标有分级结果） */
  measuredKeys: string[];
  /** 是否参与行动计划（有 active / completed 计划） */
  planParticipant: boolean;
  /**
   * C5：该用户是否**已授权**参与群体聚合（user_privacy.allow_shared）。
   * 必填：聚合函数只统计 `allowShared === true` 的用户，漏传即视为未授权（保守口径见 `isShared`）。
   */
  allowShared: boolean;
}

/** 单个用户的脱敏聚合输入（唯一入口：记录 + 档案 → 引擎现算 → 聚合可用结构） */
export function analyzeUserForAnalytics(
  userId: number,
  records: HealthRecord[],
  profile: HealthProfile | null,
  planParticipant: boolean,
  /** C5 共享授权；缺省 **false**（未授权），调用方必须显式传入用户偏好 */
  allowShared: boolean = false
): UserAnalyticsInput {
  const { score, level, items } = analyzeHealth(records, profile);
  return {
    userId,
    recordCount: records.length,
    score,
    level,
    abnormalKeys: items.filter(it => it.level === 2).map(it => it.key),
    measuredKeys: items.map(it => it.key),
    planParticipant,
    allowShared: allowShared === true
  };
}

/** 分组统计的通用形状：样本不足时 count / ratio 一律为 null */
export interface MaskedStat {
  /** 人数（被隐藏时为 null） */
  count: number | null;
  /** 占比 %（被隐藏时为 null） */
  ratio: number | null;
  /** 是否因小样本被隐藏 */
  masked: boolean;
}

/** 评分分桶统计 */
export interface ScoreBucketStat extends MaskedStat {
  key: ScoreBucketKey;
  label: string;
}

/** 风险等级统计 */
export interface RiskLevelStat extends MaskedStat {
  level: RiskLevel;
}

/** 指标异常率统计（分子分母都做小样本保护） */
export interface IndicatorStat {
  key: string;
  name: string;
  /** 该指标的有效样本数（已测人数，被隐藏时为 null） */
  sampleSize: number | null;
  /** 异常人数（被隐藏时为 null） */
  abnormalCount: number | null;
  /** 异常率 %（被隐藏时为 null） */
  rate: number | null;
  /** 是否因小样本被隐藏 */
  masked: boolean;
}

/** 总量指标 */
export interface AnalyticsTotals {
  /**
   * 全站有效用户数（启用账号）。
   * 唯一**不做小样本隐藏**的总量：它就是用户管理页的账号总数，不涉及任何个体属性。
   */
  userCount: number;
  /**
   * C5：参与统计的用户数（已开启共享授权）。
   * 它是分组统计的真实分母；只有 1~4 人会暴露「谁开了共享」，故与分组同一套小样本规则。
   */
  sharedCount: number | null;
  /**
   * C5：因关闭共享被排除出统计的人数。
   * 同样走小样本隐藏——「恰好有 1 人关闭共享」在人数很少时等同于指认个体。
   */
  excludedByPrivacy: number | null;
  /** 有记录用户数（评分 / 等级分布的分母，限已授权用户；小样本或降级时为 null） */
  withRecords: number | null;
  /** 参与行动计划人数（active / completed，限已授权用户；小样本或降级时为 null） */
  planParticipants: number | null;
  /** 计划参与率 %（分母为已授权用户数；与 planParticipants 同隐藏；降级时为 null） */
  planParticipationRate: number | null;
}

/** 群体看板聚合结果（脱敏后） */
export interface AnalyticsOverview {
  /** 小样本阈值（前端据此解释「样本不足，已隐藏」） */
  minSample: number;
  /** 参与统计的用户不足阈值 → 整体降级，只提示不展示分组数值 */
  degraded: boolean;
  /** 降级说明（未降级时为空串） */
  degradedReason: string;
  totals: AnalyticsTotals;
  scoreDistribution: ScoreBucketStat[];
  riskDistribution: RiskLevelStat[];
  indicatorAbnormal: IndicatorStat[];
}

/** 占比：保留 1 位小数的百分数 */
function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

/**
 * 分组是否隐藏：分母不足阈值、或**分子本身是 1~4 的小样本**都会暴露个体，一律隐藏。
 * 分子为 0 的空分组不涉及个体，正常展示。
 */
function shouldMask(count: number, base: number, minSample: number): boolean {
  return base < minSample || (count > 0 && count < minSample);
}

/**
 * 组装脱敏群体看板。
 *
 * 口径说明：
 * - **C5：只统计已授权用户**——`allowShared !== true` 的用户整体排除出统计（连人数都不计入分母），
 *   授权开关是唯一入口，且有单测锁定。
 * - 评分 / 等级分布只统计**有记录用户**——引擎对「无记录」给的是 0 分（无风险），
 *   混进分布会把「没数据」显示成「很健康」，也会冲淡真实风险占比。
 * - 参与统计的用户 < minSample → 整体降级（degraded），分组与总量明细一律不返回数值。
 * - 总量里的分子（有记录用户数 / 计划参与人数）与分组同一套小样本规则；只有
 *   userCount 恒可见（它就是账号总数，不涉及个体属性）。
 */
export function buildAnalyticsOverview(
  users: UserAnalyticsInput[],
  minSample: number = ANALYTICS_MIN_SAMPLE
): AnalyticsOverview {
  // C5：先按授权开关切分。未授权用户既不进分组统计，也不做任何「未授权者有 N 人」以外的呈现。
  const shared = users.filter(isShared);
  const userCount = users.length;
  const sharedCount = shared.length;
  const excludedByPrivacy = userCount - sharedCount;
  const degraded = sharedCount < minSample;
  const withRecords = shared.filter(u => u.recordCount > 0);
  const scoredBase = withRecords.length;

  const scoreDistribution: ScoreBucketStat[] = SCORE_BUCKETS.map(bucket => {
    const count = withRecords.filter(
      u => u.score >= bucket.min && u.score <= bucket.max
    ).length;
    const masked = degraded || shouldMask(count, scoredBase, minSample);
    return {
      key: bucket.key,
      label: bucket.label,
      count: masked ? null : count,
      ratio: masked ? null : pct(count, scoredBase),
      masked
    };
  });

  const riskDistribution: RiskLevelStat[] = RISK_LEVELS.map(level => {
    const count = withRecords.filter(u => u.level === level).length;
    const masked = degraded || shouldMask(count, scoredBase, minSample);
    return {
      level,
      count: masked ? null : count,
      ratio: masked ? null : pct(count, scoredBase),
      masked
    };
  });

  const indicatorAbnormal: IndicatorStat[] = ANALYTICS_INDICATORS.map(ind => {
    const measured = withRecords.filter(u => u.measuredKeys.includes(ind.key));
    const abnormal = measured.filter(u =>
      u.abnormalKeys.includes(ind.key)
    ).length;
    const sampleSize = measured.length;
    const masked = degraded || shouldMask(abnormal, sampleSize, minSample);
    return {
      key: ind.key,
      name: ind.name,
      sampleSize: masked ? null : sampleSize,
      abnormalCount: masked ? null : abnormal,
      rate: masked ? null : pct(abnormal, sampleSize),
      masked
    };
  });

  const planParticipants = shared.filter(u => u.planParticipant).length;

  // 总量里的「分子」同样是 1~4 的小样本口径：3 个有记录用户 / 2 个计划参与者
  // 在 5 人的规模下已经足以指认个体，与分组用同一套 shouldMask 规则。
  // 分母用 sharedCount 而非 userCount：占比的基数必须是真正参与统计的人（否则占比会被人为压小）。
  const maskWithRecords =
    degraded || shouldMask(scoredBase, sharedCount, minSample);
  const maskParticipants =
    degraded || shouldMask(planParticipants, sharedCount, minSample);
  const maskShared = degraded || shouldMask(sharedCount, userCount, minSample);
  const maskExcluded =
    degraded || shouldMask(excludedByPrivacy, userCount, minSample);

  return {
    minSample,
    degraded,
    degradedReason: degraded
      ? `参与统计的用户不足 ${minSample} 人（当前 ${sharedCount} 人），为避免小样本泄露个体信息，群体看板暂不展示分组统计。`
      : "",
    totals: {
      userCount,
      sharedCount: maskShared ? null : sharedCount,
      excludedByPrivacy: maskExcluded ? null : excludedByPrivacy,
      withRecords: maskWithRecords ? null : scoredBase,
      planParticipants: maskParticipants ? null : planParticipants,
      planParticipationRate: maskParticipants
        ? null
        : pct(planParticipants, sharedCount)
    },
    scoreDistribution,
    riskDistribution,
    indicatorAbnormal
  };
}

/** 被隐藏分组的展示占位（CSV 与前端共用同一句文案） */
export const MASKED_TEXT = "样本不足，已隐藏";

/** 数值 → CSV 单元格（null 一律显示为隐藏文案，避免导出绕过脱敏） */
function cell(value: number | null, suffix = ""): string {
  return value === null ? MASKED_TEXT : `${value}${suffix}`;
}

/**
 * 看板 → CSV 文本（导出与接口同口径：脱敏后的 null 单元格不会导出成 0 或空）。
 * 首行以 BOM 开头由调用方补（Excel 识别 UTF-8 中文）。
 */
export function analyticsToCsv(data: AnalyticsOverview): string {
  const rows: string[][] = [];
  rows.push(["群体健康看板（脱敏聚合）"]);
  rows.push([`小样本阈值`, `分组样本 < ${data.minSample} 人一律隐藏`]);
  rows.push([`共享授权`, `仅统计已开启「允许他人查看我的健康数据」的用户`]);
  rows.push([]);
  rows.push(["总量指标", "数值"]);
  rows.push(["有效用户数", String(data.totals.userCount)]);
  rows.push(["参与统计用户数（已授权）", cell(data.totals.sharedCount)]);
  rows.push(["关闭共享被排除人数", cell(data.totals.excludedByPrivacy)]);
  rows.push(["有记录用户数", cell(data.totals.withRecords)]);
  rows.push(["计划参与人数", cell(data.totals.planParticipants)]);
  rows.push([
    "计划参与率",
    cell(
      data.totals.planParticipationRate,
      data.totals.planParticipationRate === null ? "" : "%"
    )
  ]);
  rows.push([]);
  rows.push(["评分分布", "人数", "占比"]);
  for (const s of data.scoreDistribution) {
    rows.push([
      s.label,
      cell(s.count),
      cell(s.ratio, s.ratio === null ? "" : "%")
    ]);
  }
  rows.push([]);
  rows.push(["风险等级分布", "人数", "占比"]);
  for (const s of data.riskDistribution) {
    rows.push([
      s.level,
      cell(s.count),
      cell(s.ratio, s.ratio === null ? "" : "%")
    ]);
  }
  rows.push([]);
  rows.push(["指标异常率", "有效样本", "异常人数", "异常率"]);
  for (const s of data.indicatorAbnormal) {
    rows.push([
      s.name,
      cell(s.sampleSize),
      cell(s.abnormalCount),
      cell(s.rate, s.rate === null ? "" : "%")
    ]);
  }
  if (data.degraded) {
    rows.push([]);
    rows.push([data.degradedReason]);
  }
  return rows.map(r => r.map(csvField).join(",")).join("\r\n");
}

/** CSV 字段转义：含逗号/引号/换行时用双引号包裹并把引号翻倍 */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
