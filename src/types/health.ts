// 档案与记录的类型定义已随规则引擎迁到唯一源码 `server/shared/health-engine.ts`（前后端共用一份），
// 这里 re-export 是为了保持前端既有导入路径 `@/types/health` 不变。
import type { RiskEvidence } from "@shared/health-engine";
// C5：本地定义 AuditLogItem / AuthorizationState 时要用到这两个类型，
// 而 `export type { ... } from` 只做转发、不引入本地作用域，故另起一行 import。
import type { AccessScope, AuditDetail } from "@shared/health-privacy";
import type { ReportComparison } from "@shared/health-report";
// C6：本地定义 ReminderSettingState / ReminderState 时要用到这两个类型，
// 而 `export type { ... } from` 只做转发、不引入本地作用域，故另起一行 import（同 C5）。
import type { ReminderChannel, ReminderSetting } from "@shared/health-reminder";
import type {
  HealthPlan,
  HealthPlanTask,
  PlanCompletion
} from "@shared/health-plan";

export type {
  HealthProfile,
  HealthRecord,
  RecordQualityFlag,
  RecordSourceType,
  RiskEvidence,
  RiskExplanation,
  RuleMeta,
  EmergencyCard
} from "@shared/health-engine";
export { BOUNDARY_TEXT, ENGINE_VERSION } from "@shared/health-engine";

// C2：来源 / 质量校验同样来自唯一源码 `@shared/health-quality` —— 前端只用它做展示与
// 实时提示（`assessQuality` 与后端入参校验是同一个函数），过滤口径也共用 `isAnalyzable`。
export type {
  DeviceRecordDraft,
  QualityAssessment,
  QualityIssue,
  QualityRange,
  SourceType
} from "@shared/health-quality";
export {
  BMI_QUALITY,
  QUALITY_FLAGS,
  QUALITY_LABELS,
  QUALITY_RANGES,
  SOURCE_LABELS,
  SOURCE_TYPES,
  assessQuality,
  filterAnalyzable,
  isAnalyzable,
  normalizeMeasuredAt
} from "@shared/health-quality";

// C1：计划 / 任务 / 打卡类型同样来自唯一源码 `@shared/health-plan`，避免前后端双写。
export type {
  HealthPlan,
  HealthPlanTask,
  PlanCompletion,
  PlanDraft,
  PlanFrequency,
  PlanProgress,
  PlanStatus,
  PlanTaskType,
  PerTaskProgress
} from "@shared/health-plan";
export { PLAN_TASK_TYPES, PLAN_FREQUENCIES } from "@shared/health-plan";

// C3：报告对比类型同样来自唯一源码 `@shared/health-report`，避免前后端双写。
export type {
  ComparisonDirection,
  ComparisonSide,
  ReportComparison,
  RiskDelta,
  RiskDeltaKind
} from "@shared/health-report";
export { SCORE_STABLE_THRESHOLD } from "@shared/health-report";

// C4：群体看板聚合类型同样来自唯一源码 `@shared/health-analytics`，避免前后端双写。
// 前端只取类型与展示常量，聚合与脱敏口径一律由服务端算好下发。
export type {
  AnalyticsOverview,
  AnalyticsTotals,
  IndicatorStat,
  MaskedStat,
  RiskLevelStat,
  ScoreBucketKey,
  ScoreBucketStat,
  UserAnalyticsInput
} from "@shared/health-analytics";
export {
  ANALYTICS_INDICATORS,
  ANALYTICS_MIN_SAMPLE,
  MASKED_TEXT,
  RISK_LEVELS,
  SCORE_BUCKETS
} from "@shared/health-analytics";

// C5：审计目录 / 授权范围清单同样来自唯一源码 `@shared/health-privacy`。
// 前端只用它渲染筛选项、文案与只读清单；审计写入与脱敏一律在服务端完成。
export type {
  AccessScope,
  AuditAction,
  AuditDetail,
  AuditDetailEntry,
  AuditDetailValue
} from "@shared/health-privacy";
export {
  AUDIT_ACTIONS,
  AUDIT_ACTION_LABELS,
  AUDIT_ACTION_OPTIONS,
  ACCESS_SCOPES,
  DEFAULT_ALLOW_SHARED,
  SHARING_NOTE,
  auditActionLabel,
  canViewAuditLogs
} from "@shared/health-privacy";

/** 审计页一行（GET /api/health/audit-logs 的列表项） */
export type AuditLogItem = {
  id: string;
  /** 操作人 user_id（登录失败且账号不存在时为 null） */
  userId: string | null;
  /** 账号名（账号已删除时退回操作人登录名） */
  username: string;
  action: string;
  actionLabel: string;
  actorName: string;
  actorIp: string;
  detail: AuditDetail;
  createTime: string;
};

/** 授权中心响应（GET / PUT /api/health/authorizations） */
export type AuthorizationState = {
  allowShared: boolean;
  /** 是否设置过（false = 从未设置，当前为默认关闭） */
  configured: boolean;
  updateTime: string;
  scopes: AccessScope[];
  note: string;
  /** PUT 返回：本次是否真的发生了变化（未变化则不写审计） */
  changed?: boolean;
};

// C6：提醒类型目录 / 默认值 / 时刻校验 / 渠道清单 / 站内提醒文案同样来自唯一源码
// `@shared/health-reminder`。前端只用它渲染选项、做即时校验与展示说明；
// 「到点判定」与调度都由服务端用同一份函数完成。
export type {
  ReminderChannel,
  ReminderKind,
  ReminderNoticeDraft,
  ReminderSetting
} from "@shared/health-reminder";
export {
  ACTIVE_REMINDER_CHANNEL,
  DEFAULT_REMINDER_ENABLED,
  DEFAULT_REMINDER_TIMES,
  REMINDER_CHANNELS,
  REMINDER_DESCRIPTIONS,
  REMINDER_KINDS,
  REMINDER_KIND_OPTIONS,
  REMINDER_LABELS,
  REMINDER_NOTE,
  REMINDER_SCHEDULE_NOTE,
  TIME_OF_DAY_HINT,
  nextFireText,
  normalizeTimeOfDay
} from "@shared/health-reminder";

// C6：可访问性口径（表单标签、变化方向的文字与符号）同样来自唯一源码
// `@shared/health-a11y`。标签收在这里是为了「新增指标必然带标签」，符号与文字收在这里
// 是为了「颜色不作唯一信息载体」这条口径只有一份实现。
export {
  GRADE_MARKS,
  MOBILE_BREAKPOINT,
  MOBILE_BREAKPOINT_NOTE,
  PLAN_ARIA_FIELDS,
  PLAN_FIELD_LABELS,
  RECORD_FIELD_LABELS,
  RECORD_LABELED_FIELDS,
  RISK_DELTA_MARKS,
  RISK_DELTA_TEXT,
  SCORE_DIRECTION_HINT,
  SCORE_DIRECTION_MARKS,
  SCORE_DIRECTION_TEXT,
  gradeMark,
  riskDeltaMark,
  riskDeltaText,
  scoreDirectionMark,
  scoreDirectionText
} from "@shared/health-a11y";

/** 提醒设置一条（GET /api/health/reminders 的 settings 项，含服务端算好的展示字段） */
export type ReminderSettingState = ReminderSetting & {
  /** 今日是否已提醒（已提醒时页面不再报「下次」时间） */
  firedToday: boolean;
  /** 下次提醒时刻文案（今日 20:00 / 明日 08:00） */
  nextFireText: string;
};

/** 一条站内提醒（reminder_notices 行） */
export type ReminderNotice = {
  id: number;
  kind: string;
  title: string;
  content: string;
  /** 触发日 yyyy-MM-dd（本地日） */
  fireDate: string;
  createTime: string;
};

/** 提醒设置响应（GET / PUT /api/health/reminders） */
export type ReminderState = {
  settings: ReminderSettingState[];
  /** 今日站内提醒（站内渠道） */
  notices: ReminderNotice[];
  channels: ReminderChannel[];
  activeChannel: string;
  /** 是否设置过（false = 从未设置，当前为默认关闭） */
  configured: boolean;
  updateTime: string;
  /** 服务端本地时刻 HH:mm（演示时用来对齐「为什么现在会/不会触发」） */
  serverTime: string;
  note: string;
  scheduleNote: string;
  timeHint: string;
  /** PUT 返回：本次是否真的发生了变化 */
  changed?: boolean;
};

/** 今日待完成（GET /api/health/plans/today 的单项） */
export type TodayPlan = {
  /** 计划摘要 */
  plan: HealthPlan;
  /** 今日任务（含今日是否已打卡） */
  tasks: Array<
    HealthPlanTask & { checkedToday: boolean; lastCheckedDate: string }
  >;
  /** 连续打卡天数 */
  streakDays: number;
};

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
  /** C0：逐项风险解释（规则版本 / 阈值 / 数据来源 / 限制） */
  evidence: RiskEvidence[];
  /** C1：本周期计划完成情况（无计划时 advice 为引导文案） */
  planCompletion: PlanCompletion | null;
  /** C3：与上一份报告的对比（第一份报告为 null，前端降级展示） */
  comparison: ReportComparison | null;
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

// M2：每日健康记录类型同样来自唯一源码 `@shared/daily-health`，前端只做展示。
import type { NormalizedDaily } from "@shared/daily-health";

export {
  DIET_STATUS_TO_TEXT,
  DIET_STATUSES,
  MOOD_SCORE_TO_TEXT
} from "@shared/daily-health";
export type {
  DailyInput,
  DietStatus,
  NormalizedDaily,
  RecentDay
} from "@shared/daily-health";

/** GET /api/health/daily?days=N 返回的单日记录（五维画像数据源） */
export type DailyTrendItem = {
  date: string;
  sleepHours: number | null;
  exerciseMinutes: number | null;
  moodScore: number | null;
  sleepQuality?: number | null;
  stressLevel?: number | null;
  dietRegularity?: string | null;
};

/** GET /api/health/daily/today 返回的完整视图 */
export type DailyTodayView = {
  today: NormalizedDaily & { date: string };
  index: {
    score: number;
    levelText: string;
    delta: number | null;
    adjustments: Array<{ label: string; delta: number }>;
  };
  advice: string[];
};

/** M4：AI 健康画像结果（GET /api/ai/profile） */
export type AiProfileView = {
  id: number;
  healthType: string;
  healthScore: number;
  riskLevel: string;
  advantages: string[];
  problems: string[];
  suggestions: string[];
  aiSummary: string;
  createdAt: string;
  updatedAt: string;
};

/** M5：每日 AI 健康总结 */
export type DailySummaryView = {
  id: number;
  summaryDate: string;
  healthScore: number;
  summary: string;
  highlights: string[];
  warnings: string[];
  suggestions: string[];
};

/** M5：目标进度 */
export type GoalProgressView = {
  goalType: string;
  label: string;
  target: string;
  current: string;
  progress: number;
};
