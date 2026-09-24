import { http } from "@/utils/http";
import type {
  AnalyticsOverview,
  AuditLogItem,
  AuthorizationState,
  HealthProfile,
  HealthRecord,
  HealthReport,
  HealthPlan,
  PlanFrequency,
  PlanProgress,
  PlanStatus,
  PlanTaskType,
  ReminderKind,
  ReminderState,
  ReportSummary,
  AiProfileView,
  DailySummaryView,
  DailyTodayView,
  GoalProgressView,
  NormalizedDaily,
  SourceType,
  TodayPlan
} from "@/types/health";

/** 通用响应结构 */
type Result<T = unknown> = {
  code: number;
  message: string;
  data?: T;
};

/** 分页结果 */
type PageResult<T> = {
  list: T[];
  total?: number;
  pageSize?: number;
  currentPage?: number;
};

/** 读取个人档案 */
export const getHealthProfile = () => {
  return http.request<Result<HealthProfile | null>>(
    "get",
    "/api/health/profile"
  );
};

/** 更新个人档案 */
export const updateHealthProfile = (data: Partial<HealthProfile>) => {
  return http.request<Result<HealthProfile>>("put", "/api/health/profile", {
    data
  });
};

/** 分页查询健康记录（支持日期范围 + C2 来源筛选） */
export const getHealthRecords = (data?: {
  startDate?: string;
  endDate?: string;
  /** C2 来源筛选：manual / device / import（不传为全部） */
  sourceType?: SourceType;
  currentPage?: number;
  pageSize?: number;
}) => {
  return http.request<Result<PageResult<HealthRecord>>>(
    "get",
    "/api/health/records",
    { params: data }
  );
};

/**
 * 新增一条健康记录。
 * `time` 为 C2 测量时刻（HH:mm[:ss]），服务端与日期拼成 measuredAt 落库；
 * 来源固定为「手动录入」，质量标记由服务端按共享区间现算，前端传不了也不用传。
 */
export const addHealthRecord = (
  data: Omit<HealthRecord, "id"> & { time?: string }
) => {
  return http.request<Result<HealthRecord>>("post", "/api/health/records", {
    data
  });
};

/** 修改健康记录 */
export const updateHealthRecord = (id: string, data: Partial<HealthRecord>) => {
  return http.request<Result<HealthRecord>>(
    "put",
    `/api/health/records/${id}`,
    { data }
  );
};

/** 删除健康记录 */
export const deleteHealthRecord = (id: string) => {
  return http.request<Result<null>>("delete", `/api/health/records/${id}`);
};

/** 批量删除健康记录（P1-7；只删当前用户数据，返回实际删除条数） */
export const deleteHealthRecords = (ids: string[]) => {
  return http.request<Result<{ deleted: number }>>(
    "delete",
    "/api/health/records",
    { data: { ids } }
  );
};

/** 质量分布计数（C2：写入路径回传，供前端提示「N 条存疑 / M 条无效」） */
type QualityCount = {
  good: number;
  suspect: number;
  invalid: number;
};

/** 批量导入健康记录（返回成功/失败计数、行级错误明细与 C2 质量分布） */
export const importHealthRecords = (data: { list: Array<any> }) => {
  return http.request<
    Result<{
      success: number;
      fail: number;
      total: number;
      errors: Array<{ row: number; message: string }>;
      quality?: QualityCount;
    }>
  >("post", "/api/health/records/import", { data });
};

/** 导出健康记录（全量、不分页，供前端 xlsx 生成 Excel；支持日期范围 + 来源筛选） */
export const exportHealthRecords = (data?: {
  startDate?: string;
  endDate?: string;
  sourceType?: SourceType;
}) => {
  return http.request<Result<HealthRecord[]>>(
    "get",
    "/api/health/records/export",
    { params: data }
  );
};

// ---------- C2：数据来源 / 质量 / 模拟设备同步 ----------

/** 一条设备上报的测量值 */
type DeviceMeasurement = {
  /** 指标名：systolic / glucose / spo2 等别名，或中文名 */
  metric: string;
  /** 数值 */
  value: number;
  /** 测量时间：yyyy-MM-dd 或 yyyy-MM-dd HH:mm[:ss] */
  measuredAt: string;
};

/** 设备同步结果：按日期分组落库的记录 + 质量分布 + 逐条问题说明 */
export type DeviceSyncResult = {
  device: string;
  sourceType: string;
  saved: number;
  received: number;
  quality: QualityCount;
  /** 逐条质量问题（无问题时为空数组） */
  issues: Array<{
    date: string;
    device: string;
    qualityFlag: string;
    messages: string[];
  }>;
  /** 实际入库的记录（含 id / 来源 / 质量标记） */
  records: HealthRecord[];
};

/** 模拟设备同步：把一批测量值转成 device 来源的记录 */
export const syncDeviceMeasurements = (data: {
  device: string;
  measurements: DeviceMeasurement[];
}) => {
  return http.request<Result<DeviceSyncResult>>(
    "post",
    "/api/health/device/sync",
    { data }
  );
};

/** 当前用户的对话历史（服务端存储，供对话页恢复会话） */
export const getHealthChatHistory = () => {
  return http.request<Result<Array<{ role: string; text: string }>>>(
    "get",
    "/api/health/chat/history"
  );
};

/** 清空当前用户的对话历史（P1-6；清空后前端刷新会话） */
export const clearHealthChatHistory = () => {
  return http.request<Result<null>>("delete", "/api/health/chat/history");
};

/** 方案 B 可用性（Key 在服务端，前端只问「能不能用」，不下发 Key） */
export const getHealthChatConfig = () => {
  return http.request<Result<{ llmAvailable: boolean }>>(
    "get",
    "/api/health/chat/config"
  );
};

/** 一键生成 90 天演示数据 */
export const seedHealthRecords = () => {
  return http.request<Result<{ total: number }>>("post", "/api/health/seed");
};

/** 生成健康风险报告（入参时间段） */
export const generateHealthReport = (data?: {
  startDate?: string;
  endDate?: string;
}) => {
  return http.request<Result<HealthReport>>(
    "post",
    "/api/health/report/generate",
    { data }
  );
};

/** 报告历史摘要列表 */
export const getHealthReportHistory = () => {
  return http.request<Result<ReportSummary[]>>(
    "get",
    "/api/health/report/history"
  );
};

/** 查看某份报告 */
export const getHealthReport = (id: string) => {
  return http.request<Result<HealthReport>>("get", `/api/health/report/${id}`);
};

// ---------- C1：健康行动计划 / 打卡 ----------

/** 创建计划（含任务列表） */
export const createHealthPlan = (data: {
  title: string;
  riskKey: string;
  targetValue?: number | null;
  startDate: string;
  endDate: string;
  source?: "rule" | "manual";
  tasks: Array<{
    title: string;
    taskType: PlanTaskType;
    frequency: PlanFrequency;
  }>;
}) => {
  return http.request<Result<HealthPlan>>("post", "/api/health/plans", {
    data
  });
};

/** 计划列表（附实时进度） */
export const getHealthPlans = () => {
  return http.request<Result<HealthPlan[]>>("get", "/api/health/plans");
};

/** 今日待完成（首页用） */
export const getHealthPlansToday = () => {
  return http.request<Result<TodayPlan[]>>("get", "/api/health/plans/today");
};

/** 计划详情 */
export const getHealthPlan = (id: number | string) => {
  return http.request<Result<HealthPlan>>("get", `/api/health/plans/${id}`);
};

/** 更新计划（基础字段或状态） */
export const updateHealthPlan = (
  id: number | string,
  data: Partial<{
    title: string;
    riskKey: string;
    targetValue: number | null;
    startDate: string;
    endDate: string;
    status: PlanStatus;
  }>
) => {
  return http.request<Result<HealthPlan>>("put", `/api/health/plans/${id}`, {
    data
  });
};

/** 计划进度（与报告完成率同一口径） */
export const getHealthPlanProgress = (id: number | string) => {
  return http.request<Result<PlanProgress>>(
    "get",
    `/api/health/plans/${id}/progress`
  );
};

/** 任务打卡（同一任务同日仅一次） */
export const checkinPlanTask = (
  taskId: number | string,
  data?: { value?: string; note?: string; date?: string }
) => {
  return http.request<
    Result<{ taskId: number; checkedDate: string; streakDays: number }>
  >("post", `/api/health/tasks/${taskId}/checkin`, { data });
};

// ---------- C4：脱敏群体健康看板（admin 专属，common 调用返回 403） ----------

/**
 * 群体健康看板（脱敏聚合）。
 * 服务端已按小样本阈值隐藏分组（被隐藏的分组值为 null），前端只负责展示。
 */
export const getHealthAnalytics = () => {
  return http.request<Result<AnalyticsOverview>>(
    "get",
    "/api/health/analytics"
  );
};

/**
 * 导出群体看板（csv / json），服务端会写一条 audit_logs 留痕。
 * 以 blob 接收，避免 axios 把文件内容按 JSON 解析；导出内容与接口同口径（同样脱敏）。
 */
export const exportHealthAnalytics = (format: "csv" | "json" = "csv") => {
  return http.request<Blob>("get", "/api/health/analytics/export", {
    params: { format },
    responseType: "blob"
  });
};

// ---------- C5：审计日志（admin 专属）与授权中心（本人） ----------

/**
 * 分页查询审计日志（管理员；普通用户 403，前端也不下发菜单）。
 * detail 由服务端脱敏后下发，前端只做展示。
 */
export const getAuditLogs = (data?: {
  action?: string;
  username?: string;
  startDate?: string;
  endDate?: string;
  currentPage?: number;
  pageSize?: number;
}) => {
  return http.request<Result<PageResult<AuditLogItem>>>(
    "get",
    "/api/health/audit-logs",
    { params: data }
  );
};

/** 我的授权状态 + 数据访问范围清单（任何已登录用户，只能读自己） */
export const getAuthorizations = () => {
  return http.request<Result<AuthorizationState>>(
    "get",
    "/api/health/authorizations"
  );
};

/** 开启 / 关闭「允许他人查看我的健康数据」（服务端会留审计痕迹） */
export const updateAuthorization = (data: { allowShared: boolean }) => {
  return http.request<Result<AuthorizationState>>(
    "put",
    "/api/health/authorizations",
    { data }
  );
};

// ---------- C6：健康提醒（本人） ----------

/**
 * 我的提醒设置 + 今日站内提醒 + 渠道清单（任何已登录用户，只能读自己）。
 * 时刻是「每日定时」的唯一有效载荷，页面对它做即时校验用的是共享层同一个
 * `normalizeTimeOfDay`，因此前端放行的值服务端一定接受。
 */
export const getReminders = () => {
  return http.request<Result<ReminderState>>("get", "/api/health/reminders");
};

/** 开 / 关某类提醒并设置每日时刻（不传 time 则沿用库内已存值） */
export const updateReminder = (data: {
  kind: ReminderKind;
  enabled: boolean;
  time?: string;
}) => {
  return http.request<Result<ReminderState>>("put", "/api/health/reminders", {
    data
  });
};

// ---------- M2：每日健康记录（驾驶舱） ----------

/** 今日健康驾驶舱数据：今日记录 + 今日指数 + 近 7 天 AI 建议 */
export const getDailyToday = () => {
  return http.request<Result<DailyTodayView>>("get", "/api/health/daily/today");
};

/** 提交/更新今日（或指定日期）生活记录，同日 UPSERT */
export const submitDailyRecord = (
  data: Partial<NormalizedDaily> & { date?: string }
) => {
  return http.request<Result<NormalizedDaily & { date: string }>>(
    "post",
    "/api/health/daily",
    { data }
  );
};

// ---------- M4：AI 健康画像 ----------

/** 读取已有 AI 画像（无则 data=null） */
export const getAiProfile = () => {
  return http.request<Result<AiProfileView | null>>("get", "/api/ai/profile");
};

/** 重新分析并生成 AI 画像（UPSERT） */
export const generateAiProfile = () => {
  return http.request<Result<AiProfileView>>(
    "post",
    "/api/ai/profile/generate"
  );
};

// ---------- M5：AI 健康陪伴 ----------

/** 读今日总结 */
export const getDailySummary = () => {
  return http.request<Result<DailySummaryView | null>>(
    "get",
    "/api/ai/daily-summary"
  );
};

/** 生成今日总结（UPSERT） */
export const generateDailySummary = () => {
  return http.request<Result<DailySummaryView>>(
    "post",
    "/api/ai/daily-summary/generate"
  );
};

/** 目标进度 */
export const getGoalProgress = () => {
  return http.request<Result<GoalProgressView[]>>("get", "/api/ai/goals");
};

// ---------- V2.0 P0-1：学生健康画像 ----------

/** 学生健康画像（大学生亚健康建模输入） */
export type StudentProfile = {
  grade: string;
  major: string;
  isOffCampus: number;
  bedtime: string;
  wakeTime: string;
  sedentaryHours: number;
  studyHours: number;
};

/** 读取学生画像（无记录返回 null） */
export const getStudentProfile = () => {
  return http.request<Result<StudentProfile | null>>(
    "get",
    "/api/health/student-profile"
  );
};

/** 保存学生画像（UPSERT） */
export const updateStudentProfile = (data: Partial<StudentProfile>) => {
  return http.request<Result<StudentProfile>>(
    "put",
    "/api/health/student-profile",
    { data }
  );
};

// ---------- V2.0 P1-1B：ML 亚健康风险预测 ----------

export interface RiskShapFactor {
  feature: string;
  label: string;
  contribution: number;
  direction: string;
}

export interface RiskPredictView {
  source: "ml" | "rule";
  riskLevel: "low" | "medium" | "high";
  riskProbability: number;
  dataQuality: { level: string; filledRatio: number };
  shapFactors: RiskShapFactor[];
  modelVersion: string;
  healthType?: {
    type: string;
    name: string;
    description: string;
    confidence: number;
    factors: string[];
    suggestions: string[];
    source?: "cluster" | "rule";
    scores: { sleep: number; stress: number; exercise: number; diet: number };
  } | null;
  modelExplain?: {
    featureImportance: Array<{
      feature: string;
      label: string;
      value: number;
      direction: "risk_up" | "risk_down";
    }>;
  };
  features: Record<string, number>;
}

/** AI 亚健康风险预测（ML 优先，自动降级规则） */
export const getHealthRisk = () => {
  return http.request<Result<RiskPredictView>>("get", "/api/health/risk");
};

// ---------- V2.0 P2-1：AI 教练改善方案 ----------

export interface CoachGoal {
  name: string;
  reason?: string;
  action: string;
  duration?: string;
}

export interface CoachPlanView {
  source: "llm" | "template";
  title: string;
  summary: string;
  goals: CoachGoal[];
}

/** 一键生成个性化健康改善方案 */
export const getCoachPlan = () => {
  return http.request<Result<CoachPlanView>>("post", "/api/health/coach-plan");
};

/** 采纳 AI 方案 → 写入健康计划 */
export const confirmCoachPlan = (data: {
  title: string;
  summary: string;
  goals: CoachGoal[];
}) => {
  return http.request<Result<{ planId: number }>>(
    "post",
    "/api/health/coach-plan/confirm",
    { data }
  );
};

// ---------- V2.1 P1-1a/b：大学生健康调研 ----------

export interface HealthSurvey {
  id: number;
  surveyVersion: string;
  sleepHoursAvg: number | null;
  sleepQuality: number | null;
  stayUpFreq: number | null;
  studyPressure: number | null;
  examPressure: number | null;
  moodState: number | null;
  exerciseTimes: number | null;
  exerciseMin: number | null;
  breakfast: number | null;
  dietRegular: number | null;
  sedentaryHours: number | null;
  phoneHours: number | null;
  riskScore: number;
  lifestyleRiskLabel: "low" | "medium" | "high";
}

/** 最近一次调研 */
export const getLatestSurvey = () => {
  return http.request<
    Result<{ completed: boolean; data: HealthSurvey | null }>
  >("get", "/api/health/survey/latest");
};

/** 提交调研 */
export const submitSurvey = (data: Record<string, number>) => {
  return http.request<
    Result<{ score: number; label: "low" | "medium" | "high" }>
  >("post", "/api/health/survey", { data });
};

export interface HealthAgentAnalysis {
  summary: string;
  currentStatus: { riskLevel: string; healthType: string; description: string };
  keyProblems: Array<{ factor: string; reason: string; impact: string }>;
  suggestions: string[];
  source: "ai" | "rule";
}
export const getHealthAgentAnalysis = () => {
  return http.request<Result<HealthAgentAnalysis>>(
    "post",
    "/api/health/agent/analyze"
  );
};

export interface HealthAgentPlan {
  title: string;
  goals: Array<{ name: string; reason: string; target: string }>;
  tasks: Array<{
    day: number;
    title: string;
    category: string;
    action: string;
    duration: string;
  }>;
  source: "ai" | "rule";
}
export const getHealthAgentPlan = () => {
  return http.request<Result<HealthAgentPlan>>(
    "post",
    "/api/health/agent/plan"
  );
};

export interface HealthAgentReview {
  summary: string;
  completionRate: number;
  changes: Array<{
    metric: string;
    before: string;
    after: string;
    trend: "improve" | "stable" | "decline";
  }>;
  evaluation: string;
  nextSuggestions: string[];
  confidence: "high" | "low";
  source: "ai" | "rule";
}
export const getHealthAgentReview = (planId: number) => {
  return http.request<Result<HealthAgentReview>>(
    "post",
    "/api/health/agent/review",
    { data: { planId } }
  );
};
