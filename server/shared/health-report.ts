// 健康报告模板（AI 方案 A 内核的报告组装层）
// ★ 唯一源码：后端（server/src/routes/health.ts 的 /api/health/report/*）与前端（@shared 别名）共用这一份，切勿双写。
// 纯函数、禁 Node/DOM 依赖 —— 因此可同时被 Express 与浏览器加载。
//
// 分工：`buildReport` 只产出「报告内容」（不含 id / generateTime），
// 因为 id 与生成时间是存储层的事实：后端由 reports 表自增 id + create_time 决定，
// mock 由 genId() + new Date().toISOString() 决定，两边各自补齐后再返回给前端。

import { analyzeHealth } from "./health-engine.js";
import type { HealthProfile, HealthRecord } from "./health-engine.js";

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
  /** 指标风险雷达数据 */
  radar: RadarPoint[];
  /** 近 N 次指标趋势 */
  trend: TrendPoint[];
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
    radar,
    trend
  };
}
