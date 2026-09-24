// 健康报告模板（AI 方案 A 内核的报告组装层）
// ★ 唯一源码：后端（server/src/routes/health.ts 的 /api/health/report/*）与前端（@shared 别名）共用这一份，切勿双写。
// 纯函数、禁 Node/DOM 依赖 —— 因此可同时被 Express 与浏览器加载。
//
// 分工：`buildReport` 只产出「报告内容」（不含 id / generateTime），
// 因为 id 与生成时间是存储层的事实：后端由 reports 表自增 id + create_time 决定，
// mock 由 genId() + new Date().toISOString() 决定，两边各自补齐后再返回给前端。

import { analyzeHealth, buildEvidence } from "./health-engine.js";
import type {
  HealthProfile,
  HealthRecord,
  RiskEvidence
} from "./health-engine.js";

/** 指标风险点（雷达图用） */
export interface RadarPoint {
  /** 指标名 */
  name: string;
  /** 风险值 0-100 */
  value: number;
}

/** 指标趋势点（近 N 次趋势图用） */
export interface TrendPoint {
  /** 记录日期 */
  date: string;
  /** 收缩压（mmHg） */
  systolic?: number;
  /** 舒张压（mmHg） */
  diastolic?: number;
  /** 空腹血糖（mmol/L） */
  fastingGlucose?: number;
}

/** 报告内容（前端 `HealthReport` = 本类型 + id + generateTime） */
export interface ReportContent {
  /** 统计时间段文案 */
  period: string;
  /** 起始日期 */
  startDate: string;
  /** 结束日期 */
  endDate: string;
  /** 综合评分 0-100 */
  score: number;
  /** 风险等级 */
  level: string;
  /** 总体评价 */
  summary: string;
  /** 各指标逐项分析 */
  itemAnalysis: string[];
  /** 风险点 */
  risks: string[];
  /** 建议 */
  suggestions: string[];
  /** 就医提醒（空串表示无需） */
  medicalAdvice: string;
  /** C0：逐项风险解释（规则版本 / 阈值 / 数据来源 / 限制） */
  evidence: RiskEvidence[];
  /** 指标风险雷达数据 */
  radar: RadarPoint[];
  /** 近 N 次指标趋势 */
  trend: TrendPoint[];
}

// ---------- C3：报告对比与效果评估（纯函数，前后端可共用一份口径） ----------

/** 风险分变化落在「持平」区间的阈值：|scoreDelta| ≤ 此值即视为持平（阈值明确、可复算） */
export const SCORE_STABLE_THRESHOLD = 3;

/** 风险点变化类型：本期新增 / 本期消失 / 两期持续 */
export type RiskDeltaKind = "new" | "gone" | "ongoing";

/** 单条风险点变化 */
export interface RiskDelta {
  /** 展示文案（新增/持续用本期原文，消失用上期原文） */
  risk: string;
  /** 变化类型 */
  kind: RiskDeltaKind;
}

/**
 * 对比结论方向。
 *
 * ⚠️ 方向口径由规则引擎的评分语义决定：`analyzeHealth` 的 `score` 是**风险分**
 * （各异常/警戒项按权重累加，0 分 = 无风险，越高越差），`riskLevelOf` 也是
 * 「分越高等级越重」（<30 低 / <60 中 / <80 高 / ≥80 极高）。
 * 因此 **scoreDelta > 0（风险分升高）＝ 恶化**，scoreDelta < 0 ＝ 好转。
 */
export type ComparisonDirection = "improved" | "worsened" | "stable";

/** 对比的一侧（本期由 buildReport 结果组装，上期从 reports 行读） */
export interface ComparisonSide {
  /** 报告 id（上期才有；本期尚未落库时为空串） */
  reportId?: string;
  /** 统计时间段文案 */
  period?: string;
  /** 生成时间（ISO，存储层事实，上期才有） */
  generateTime?: string;
  /** 综合评分 */
  score: number;
  /** 风险等级（由规则引擎给出，本文件不另立一套分级阈值） */
  level?: string;
  /** 风险点文案数组 */
  risks: string[];
  /** 计划完成率 0-100（无关联计划时为 null） */
  planRate: number | null;
}

/** 本期与上一份报告的对比结果（存进 summary JSON，可随时复算） */
export interface ReportComparison {
  /** 对比基准：上一份报告 */
  prevReportId: string;
  prevPeriod: string;
  prevGenerateTime: string;
  prevScore: number;
  prevLevel: string;
  /** 评分变化 = 本期 − 上期。注意评分是**风险分**（越高越差），故正数表示恶化 */
  scoreDelta: number;
  /** 结论方向（按 SCORE_STABLE_THRESHOLD 判定） */
  direction: ComparisonDirection;
  /** 结论文案 */
  conclusion: string;
  /** 风险点变化明细（本期新增 → 持续 → 消失） */
  riskDeltas: RiskDelta[];
  /** 本期新增风险点数量 */
  riskAdded: number;
  /** 本期消失风险点数量 */
  riskGone: number;
  /** 两期持续存在的风险点数量 */
  riskOngoing: number;
  /** 本周期计划完成率（无计划为 null） */
  planRateCurrent: number | null;
  /** 上周期计划完成率（无计划为 null） */
  planRatePrev: number | null;
  /** 完成率变化（百分点，仅两侧都有值时有） */
  planRateDelta: number | null;
  /** 计划完成率对比结论文案 */
  planConclusion: string;
}

/**
 * 风险点匹配键。
 *
 * 报告的 risks 文案里带具体测值（如「收缩压：偏高（155 mmHg）」），
 * 因此**不能**直接拿整串做集合差：同一个风险只要数值变了，就会被同时判成
 * 「新增 + 消失」，而「持续」几乎永远出不来。匹配只取稳定的指标名/生活方式名，
 * 展示仍用原文。
 */
export function riskKeyOf(risk: string): string {
  const head = risk.split(/[：:]/)[0]?.trim();
  return head || risk.trim();
}

/** 差值文案：正数带 +，负数自带 -，0 为 0 */
function fmtDelta(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/** 计划完成率对比结论文案 */
function planConclusionOf(
  current: number | null,
  prev: number | null,
  delta: number | null
): string {
  if (prev === null && current === null) {
    return "两个周期均未关联行动计划，无法对比计划完成率。";
  }
  if (prev === null) {
    return `本周期新增行动计划，完成率 ${current}%，暂无上周期数据可对比。`;
  }
  if (current === null) {
    return `上周期计划完成率 ${prev}%，本周期未关联行动计划，无法对比。`;
  }
  if (delta === 0) return `计划完成率与上周期持平，均为 ${current}%。`;
  return delta! > 0
    ? `计划完成率由上周期 ${prev}% 提升至 ${current}%（${fmtDelta(delta!)} 个百分点）。`
    : `计划完成率由上周期 ${prev}% 下降至 ${current}%（${fmtDelta(delta!)} 个百分点）。`;
}

/**
 * C3：生成本期报告与上一份报告的对比。
 *
 * 输入全部来自两份报告已有的字段（评分 / risks / planCompletion.rate），
 * 结果可复算：`buildReportComparison(本期, 上期)` 与落库时写入 summary 的值一致。
 * 上期为 null（第一份报告）时返回 null，由调用方/前端降级展示「暂无上周期报告」。
 */
export function buildReportComparison(
  current: ComparisonSide,
  prev: ComparisonSide | null
): ReportComparison | null {
  if (!prev) return null;

  // 风险分变化（分高 = 风险高，故「升高」是恶化，「下降」才是好转，见 ComparisonDirection 注释）
  const scoreDelta = current.score - prev.score;
  const direction: ComparisonDirection =
    scoreDelta > SCORE_STABLE_THRESHOLD
      ? "worsened"
      : scoreDelta < -SCORE_STABLE_THRESHOLD
        ? "improved"
        : "stable";

  // 风险点差集：按稳定键匹配，展示用原文（新增/持续取本期，消失取上期）
  const curKeys = new Map(current.risks.map(r => [riskKeyOf(r), r]));
  const prevKeys = new Map(prev.risks.map(r => [riskKeyOf(r), r]));
  const riskDeltas: RiskDelta[] = [
    ...current.risks
      .filter(r => !prevKeys.has(riskKeyOf(r)))
      .map(r => ({ risk: r, kind: "new" as const })),
    ...current.risks
      .filter(r => prevKeys.has(riskKeyOf(r)))
      .map(r => ({ risk: r, kind: "ongoing" as const })),
    ...prev.risks
      .filter(r => !curKeys.has(riskKeyOf(r)))
      .map(r => ({ risk: r, kind: "gone" as const }))
  ];
  const riskAdded = riskDeltas.filter(d => d.kind === "new").length;
  const riskGone = riskDeltas.filter(d => d.kind === "gone").length;
  const riskOngoing = riskDeltas.filter(d => d.kind === "ongoing").length;

  // 计划完成率对比
  const planRateCurrent = current.planRate;
  const planRatePrev = prev.planRate;
  const planRateDelta =
    planRateCurrent !== null && planRatePrev !== null
      ? planRateCurrent - planRatePrev
      : null;

  // 结论：方向 + 分值变化 + 风险点增减（两侧等级都有且不同时，一并说明等级变化）
  const levelText =
    prev.level && current.level && prev.level !== current.level
      ? `，风险等级由「${prev.level}」变为「${current.level}」`
      : "";
  const riskText =
    riskAdded || riskGone
      ? `，风险点新增 ${riskAdded} 项、减少 ${riskGone} 项`
      : "，风险点数量无变化";
  const conclusion =
    direction === "stable"
      ? `与上周期基本持平：评分 ${prev.score} → ${current.score} 分（变化 ${fmtDelta(scoreDelta)} 分，阈值 ±${SCORE_STABLE_THRESHOLD} 分内视为持平）${riskText}。`
      : direction === "improved"
        ? `较上周期好转：评分 ${prev.score} → ${current.score} 分（${fmtDelta(scoreDelta)} 分）${levelText}${riskText}。`
        : `较上周期恶化：评分 ${prev.score} → ${current.score} 分（${fmtDelta(scoreDelta)} 分）${levelText}${riskText}。`;

  return {
    prevReportId: prev.reportId ?? "",
    prevPeriod: prev.period ?? "",
    prevGenerateTime: prev.generateTime ?? "",
    prevScore: prev.score,
    prevLevel: prev.level ?? "",
    scoreDelta,
    direction,
    conclusion,
    riskDeltas,
    riskAdded,
    riskGone,
    riskOngoing,
    planRateCurrent,
    planRatePrev,
    planRateDelta,
    planConclusion: planConclusionOf(
      planRateCurrent,
      planRatePrev,
      planRateDelta
    )
  };
}

/** 风险等级 → 总体评价结尾文案 */
const LEVEL_SUMMARY: Record<string, string> = {
  低: "各项指标总体平稳，请继续保持健康的生活方式。",
  中: "部分指标处于警戒或异常，建议关注并调整生活方式。",
  高: "多项指标异常，风险较高，建议尽快就医评估并积极干预。",
  极高: "多项指标显著异常，风险极高，请立即就医接受专业诊治。"
};

/** 组装健康报告：调规则引擎 → 模板化拼接自然语言报告 */
export function buildReport(
  records: HealthRecord[],
  profile: HealthProfile | null,
  startDate: string,
  endDate: string
): ReportContent {
  const { score, level, items, risks, suggestions, medicalAdvice } =
    analyzeHealth(records, profile);

  // 总体评价
  const abnormalCount = items.filter(i => i.level === 2).length;
  const warnCount = items.filter(i => i.level === 1).length;
  let summary = `本次评估综合评分为 ${score} 分，风险等级为「${level}」。`;
  summary += items.length
    ? ` 共分析 ${items.length} 项指标，其中 ${abnormalCount} 项异常、${warnCount} 项警戒。`
    : " 该时间段内暂无健康指标记录。";
  summary += LEVEL_SUMMARY[level] ?? "";

  // 各指标逐项分析
  const itemAnalysis = items.map(
    it => `${it.name} ${it.value}：${it.grade}（${it.desc}）。`
  );

  // 雷达图数据：等级折算为风险值（正常 0 / 警戒 50 / 异常 100）
  const radar = items.map(it => ({
    name: it.name,
    value: it.level === 2 ? 100 : it.level === 1 ? 50 : 0
  }));

  // 近 10 次趋势（按日期升序取最近 N 次）
  const trend = [...records]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-10)
    .map(r => ({
      date: r.date,
      systolic: r.systolic,
      diastolic: r.diastolic,
      fastingGlucose: r.fastingGlucose
    }));

  const period =
    startDate && endDate ? `${startDate} ~ ${endDate}` : "全部记录";

  return {
    period,
    startDate,
    endDate,
    score,
    level,
    summary,
    itemAnalysis,
    risks,
    suggestions,
    medicalAdvice,
    evidence: buildEvidence(records, profile).items,
    radar,
    trend
  };
}
