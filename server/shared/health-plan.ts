// 健康行动计划共享层（C1 唯一源码）
// ★ 后端（server/src/routes/health/plans.ts、report.ts）与前端（@shared 别名）共用这一份，切勿双写。
// 纯函数、禁 Node/DOM 依赖 —— 因此可同时被 Express 与浏览器加载。
//
// 职责：风险→计划模板映射（buildPlanFromAnalysis）、打卡进度与完成率计算（planProgress）、
// 连续打卡天数（streakOf）、下周期建议（completionAdvice）。
// 完成率口径固定为「窗口内实际打卡次数 / 窗口内应打卡次数」，计划详情页与报告共用同一函数，保证一致。

import type { AnalyzeResult } from "./health-engine.js";

// ---------- 类型 ----------

/** 任务类型（前端标签与图标按此区分） */
export type PlanTaskType =
  "measure" | "exercise" | "diet" | "lifestyle" | "other";

/** 打卡频率：daily 每天 1 次 / weekly 每周 1 次 */
export type PlanFrequency = "daily" | "weekly";

/** 计划状态 */
export type PlanStatus = "active" | "completed" | "stopped";

/** 计划任务（前端与 plans 接口共用） */
export interface HealthPlanTask {
  id: number;
  title: string;
  taskType: PlanTaskType;
  frequency: PlanFrequency;
  sortOrder: number;
}

/** 计划（前端与 plans 接口共用） */
export interface HealthPlan {
  id: number;
  title: string;
  riskKey: string;
  targetValue?: number | null;
  startDate: string;
  endDate: string;
  status: PlanStatus;
  source: string;
  createTime: string;
  tasks: HealthPlanTask[];
  /** 进度摘要（列表 / 详情接口附带；无任务时为 null） */
  progress?: PlanProgress | null;
}

/** 单任务进度 */
export interface PerTaskProgress {
  taskId: number;
  title: string;
  frequency: PlanFrequency;
  /** 窗口内应打卡次数 */
  due: number;
  /** 窗口内实际打卡次数 */
  done: number;
  /** 完成率 0-100 */
  rate: number;
}

/** 计划进度（完成率口径唯一来源：progress 接口与报告共用） */
export interface PlanProgress {
  planId: number;
  /** 任务数 */
  totalTasks: number;
  /** 应打卡次数（全部任务合计） */
  dueCount: number;
  /** 实际打卡次数（窗口内） */
  doneCount: number;
  /** 完成率 0-100（截断到窗口内应打卡，避免超100） */
  rate: number;
  /** 连续打卡天数（含今天；今天未打卡则从昨天起算） */
  streakDays: number;
  /** 分任务进度 */
  perTask: PerTaskProgress[];
}

/** 报告中的计划完成情况（summary JSON 内嵌，C1） */
export interface PlanCompletion {
  planId: number;
  planTitle: string;
  /** 完成率 0-100 */
  rate: number;
  /** 连续打卡天数 */
  streakDays: number;
  /** 下周期建议（固定文案） */
  advice: string;
}

/** 计划草稿（从风险分析生成 / 创建接口入参共用结构） */
export interface PlanDraft {
  title: string;
  riskKey: string;
  targetValue?: number | null;
  tasks: Array<{
    title: string;
    taskType: PlanTaskType;
    frequency: PlanFrequency;
  }>;
}

// ---------- 日期工具（本地时区字符串，UTC 运算避免时区偏移） ----------

/** 本地日期 yyyy-MM-dd */
export function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** 日期字符串 ± n 天（UTC 运算，输入须为 yyyy-MM-dd） */
export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** 窗口天数（含首尾，b 必须 ≥ a，非法返回 0） */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  if (!ay || !by) return 0;
  const diff = Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad);
  return diff < 0 ? 0 : Math.round(diff / 86400000) + 1;
}

// ---------- 任务类型元信息（前端标签/图标与后端校验共用） ----------

export const PLAN_TASK_TYPES: Array<{ value: PlanTaskType; label: string }> = [
  { value: "measure", label: "测量记录" },
  { value: "exercise", label: "运动" },
  { value: "diet", label: "饮食" },
  { value: "lifestyle", label: "生活习惯" },
  { value: "other", label: "其他" }
];

export const PLAN_FREQUENCIES: Array<{ value: PlanFrequency; label: string }> =
  [
    { value: "daily", label: "每日" },
    { value: "weekly", label: "每周" }
  ];

// ---------- 风险 → 计划模板表（C1：计划生成唯一来源） ----------

interface PlanTemplate extends Omit<PlanDraft, "targetValue"> {
  targetDesc: string;
}

/** 各风险 key 对应的计划模板（riskKey 对齐 health-engine 的 IndicatorGrade.key） */
const PLAN_TEMPLATES: Record<string, PlanTemplate> = {
  bloodPressure: {
    title: "血压改善计划",
    riskKey: "bloodPressure",
    targetDesc: "收缩压 <140 且舒张压 <90 mmHg",
    tasks: [
      {
        title: "每日定时测量血压并记录",
        taskType: "measure",
        frequency: "daily"
      },
      {
        title: "低盐饮食（每日食盐 <5g）",
        taskType: "diet",
        frequency: "daily"
      },
      {
        title: "每日 30 分钟中等强度有氧运动",
        taskType: "exercise",
        frequency: "daily"
      },
      { title: "戒烟限酒、避免熬夜", taskType: "lifestyle", frequency: "daily" }
    ]
  },
  bloodGlucose: {
    title: "血糖管理计划",
    riskKey: "bloodGlucose",
    targetDesc: "空腹血糖降至 6.1 mmol/L 以下",
    tasks: [
      {
        title: "每日晨起测量空腹血糖并记录",
        taskType: "measure",
        frequency: "daily"
      },
      { title: "控制精制碳水与含糖饮料", taskType: "diet", frequency: "daily" },
      { title: "餐后散步 30 分钟", taskType: "exercise", frequency: "daily" }
    ]
  },
  bmi: {
    title: "体重管理计划",
    riskKey: "bmi",
    targetDesc: "BMI 降至 24 以下",
    tasks: [
      { title: "每日晨起记录体重", taskType: "measure", frequency: "daily" },
      { title: "均衡饮食、控制总热量", taskType: "diet", frequency: "daily" },
      {
        title: "每周 ≥150 分钟有氧运动",
        taskType: "exercise",
        frequency: "daily"
      }
    ]
  },
  lipid: {
    title: "血脂改善计划",
    riskKey: "lipid",
    targetDesc: "总胆固醇 <5.2、甘油三酯 <1.7 mmol/L",
    tasks: [
      { title: "低脂低胆固醇饮食", taskType: "diet", frequency: "daily" },
      {
        title: "每周 ≥150 分钟中等强度运动",
        taskType: "exercise",
        frequency: "daily"
      },
      { title: "控制体重与腰围", taskType: "lifestyle", frequency: "daily" },
      { title: "戒烟限酒", taskType: "lifestyle", frequency: "daily" }
    ]
  },
  hdl: {
    title: "HDL 提升计划",
    riskKey: "hdl",
    targetDesc: "HDL 达到 1.0（男）/1.3（女）mmol/L 以上",
    tasks: [
      {
        title: "每周 ≥3 次有氧运动",
        taskType: "exercise",
        frequency: "weekly"
      },
      {
        title: "增加不饱和脂肪（坚果、深海鱼）",
        taskType: "diet",
        frequency: "daily"
      },
      { title: "戒烟", taskType: "lifestyle", frequency: "daily" }
    ]
  },
  lifestyle: {
    title: "生活方式改善计划",
    riskKey: "lifestyle",
    targetDesc: "建立规律作息与运动习惯",
    tasks: [
      {
        title: "每日记录吸烟/饮酒情况",
        taskType: "measure",
        frequency: "daily"
      },
      {
        title: "每周 ≥150 分钟中等强度运动",
        taskType: "exercise",
        frequency: "daily"
      },
      { title: "保证 7~8 小时睡眠", taskType: "lifestyle", frequency: "daily" }
    ]
  },
  maintain: {
    title: "健康维持计划",
    riskKey: "maintain",
    targetDesc: "保持各项指标在正常范围",
    tasks: [
      {
        title: "每周测量一次血压并记录",
        taskType: "measure",
        frequency: "weekly"
      },
      { title: "每周测量一次体重", taskType: "measure", frequency: "weekly" },
      {
        title: "每日 30 分钟中等强度运动",
        taskType: "exercise",
        frequency: "daily"
      },
      { title: "均衡饮食、多蔬果少油盐", taskType: "diet", frequency: "daily" }
    ]
  }
};

/** 异常项 key → 计划模板 key（血压/血糖取分类，血脂合并） */
const RISK_KEY_TO_TEMPLATE: Record<string, string> = {
  systolic: "bloodPressure",
  diastolic: "bloodPressure",
  fastingGlucose: "bloodGlucose",
  bmi: "bmi",
  totalCholesterol: "lipid",
  triglyceride: "lipid",
  ldl: "lipid",
  hdl: "hdl"
};

/** 按模板 key 取模板（供手动创建/展示目标值描述） */
export function planTemplateOf(templateKey: string): PlanTemplate | undefined {
  return PLAN_TEMPLATES[templateKey];
}

/**
 * 从风险分析结果生成计划草稿（C1「风险用户计划生成率 100%」的内核）。
 * 规则：取首个异常项（level 2）按优先级映射模板；无异常项但存在生活方式风险 → lifestyle；
 * 完全无风险返回 null（由前端提示无需制定计划）。
 */
export function buildPlanFromAnalysis(
  analyze: AnalyzeResult | null,
  startDate: string,
  endDate: string
):
  | (PlanDraft & { targetDesc: string; startDate: string; endDate: string })
  | null {
  if (!analyze) return null;

  // 异常项优先级：血压 → 血糖 → BMI → 血脂 → HDL
  const priority = [
    "systolic",
    "diastolic",
    "fastingGlucose",
    "bmi",
    "totalCholesterol",
    "triglyceride",
    "ldl",
    "hdl"
  ];
  let templateKey: string | null = null;
  for (const key of priority) {
    const item = analyze.items.find(i => i.key === key);
    if (item && item.level === 2) {
      templateKey = RISK_KEY_TO_TEMPLATE[key];
      break;
    }
  }

  // 无异常项 → 生活方式风险
  if (!templateKey) {
    const lifestyleRisk =
      (analyze.risks.includes("吸烟") ||
        analyze.risks.includes("饮酒") ||
        analyze.risks.includes("运动不足")) &&
      analyze.risks.length > 0;
    if (lifestyleRisk) templateKey = "lifestyle";
  }

  if (!templateKey) return null;
  const t = PLAN_TEMPLATES[templateKey];
  return {
    title: t.title,
    riskKey: t.riskKey,
    targetDesc: t.targetDesc,
    startDate,
    endDate,
    tasks: t.tasks.map(task => ({ ...task }))
  };
}

// ---------- 进度 / 完成率 / 连续打卡（唯一口径） ----------

/** 打卡记录入参（来自 task_checkins 行或接口入参） */
export interface CheckinLike {
  taskId: number;
  checkedDate: string;
}

/** 任务入参（progress 计算只需 id / frequency） */
export interface TaskLike {
  id: number;
  frequency: PlanFrequency;
}

/** 单任务应打卡次数（daily 每天 1 次 / weekly 每 7 天 1 次，向上取整） */
export function dueCountOf(
  frequency: PlanFrequency,
  startDate: string,
  endDate: string
): number {
  const days = daysBetween(startDate, endDate);
  if (days <= 0) return 0;
  return frequency === "daily" ? days : Math.ceil(days / 7);
}

/**
 * 计算计划进度（C1 唯一口径，plans/progress 接口与报告共用）。
 * 窗口：startDate ~ min(endDate, today)；today 由调用方按本地日期传入。
 */
export function planProgress(
  planId: number,
  tasks: TaskLike[],
  checkins: CheckinLike[],
  startDate: string,
  endDate: string,
  today: string
): PlanProgress {
  const windowEnd = endDate < today ? endDate : today;
  const windowDays = daysBetween(startDate, windowEnd);
  const checkinMap = new Map<number, number>();
  const dateSet = new Set<string>();
  for (const c of checkins) {
    if (c.checkedDate >= startDate && c.checkedDate <= windowEnd) {
      checkinMap.set(c.taskId, (checkinMap.get(c.taskId) ?? 0) + 1);
    }
    if (c.checkedDate >= startDate && c.checkedDate <= windowEnd) {
      dateSet.add(c.checkedDate);
    }
  }

  let dueCount = 0;
  let doneCount = 0;
  const perTask: PerTaskProgress[] = tasks.map(t => {
    const due =
      windowDays > 0 ? dueCountOf(t.frequency, startDate, windowEnd) : 0;
    const done = checkinMap.get(t.id) ?? 0;
    dueCount += due;
    doneCount += done;
    return {
      taskId: t.id,
      title: (t as TaskLike & { title?: string }).title ?? "",
      frequency: t.frequency,
      due,
      done,
      rate: due > 0 ? Math.min(100, Math.round((done / due) * 100)) : 0
    };
  });

  return {
    planId,
    totalTasks: tasks.length,
    dueCount,
    doneCount,
    rate:
      dueCount > 0
        ? Math.min(100, Math.round((doneCount / dueCount) * 100))
        : 0,
    streakDays: streakOf(dateSet, today),
    perTask
  };
}

/** 连续打卡天数：从今天（今天未打卡则从昨天）向前数连续有打卡的天数 */
export function streakOf(checkinDates: Set<string>, today: string): number {
  let n = 0;
  let cursor = checkinDates.has(today) ? today : addDays(today, -1);
  while (checkinDates.has(cursor)) {
    n += 1;
    cursor = addDays(cursor, -1);
  }
  return n;
}

/** 下周期建议（报告与计划详情共用；完成率口径与 planProgress 一致） */
export function completionAdvice(
  hasPlan: boolean,
  rate: number,
  streakDays: number
): string {
  if (!hasPlan) {
    return "尚未制定行动计划，建议基于当前风险生成计划，形成「识别 → 干预 → 打卡 → 复评」闭环。";
  }
  if (rate >= 70) {
    return `本周期计划完成率 ${rate}%，执行情况良好（连续打卡 ${streakDays} 天）。下周期建议保持节奏，并逐步增加运动强度或频次。`;
  }
  if (rate >= 40) {
    return `本周期计划完成率 ${rate}%（连续打卡 ${streakDays} 天）。下周期建议精简任务数量、降低单日负担，提升可坚持性。`;
  }
  return `本周期计划完成率仅 ${rate}%（连续打卡 ${streakDays} 天）。下周期建议重新评估目标合理性，从 1~2 个最核心任务开始。`;
}
