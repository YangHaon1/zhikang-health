// 档案与记录的类型定义已随规则引擎迁到唯一源码 `server/shared/health-engine.ts`（前后端共用一份），
// 这里 re-export 是为了保持前端既有导入路径 `@/types/health` 不变。
export type { HealthProfile, HealthRecord } from "@shared/health-engine";

/** 指标风险点（雷达图用） */
export type RadarPoint = {
  /** 指标名 */
  name: string;
  /** 风险值 0-100 */
  value: number;
};

/** 指标趋势点（近 N 次趋势图用） */
export type TrendPoint = {
  /** 记录日期 */
  date: string;
  /** 收缩压（mmHg） */
  systolic?: number;
  /** 舒张压（mmHg） */
  diastolic?: number;
  /** 空腹血糖（mmol/L） */
  fastingGlucose?: number;
};

/** 健康风险报告 */
export type HealthReport = {
  /** 报告 ID */
  id: string;
  /** 生成时间（ISO） */
  generateTime: string;
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
};

/** 报告历史摘要 */
export type ReportSummary = {
  /** 报告 ID */
  id: string;
  /** 生成时间 */
  generateTime: string;
  /** 统计时间段文案 */
  period: string;
  /** 综合评分 */
  score: number;
  /** 风险等级 */
  level: string;
};

/** 对话消息 */
export type ChatMessage = {
  /** 角色 user/assistant */
  role: "user" | "assistant";
  /** 内容 */
  content: string;
  /** 时间 */
  time: string;
};
