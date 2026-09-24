// C2 数据来源与质量：数值合理性校验 / 质量标记 / 无效数据过滤 / 模拟设备同步解析（唯一源码）。
// ★ 唯一源码：后端（server/src/routes/health/*.ts）与前端（@shared 别名）共用这一份，切勿双写。
// 纯函数、禁 Node/DOM 依赖 —— Express 与浏览器都能直接加载。
//
// 三层口径，别混：
//   1) 格式与硬上限（既有）：`health-import.ts` 的 IMPORT_FIELD_LIMITS，超出直接**拒绝入库**（导入行错误）；
//   2) 合理区间（本文件）：入库**保留**，但打 `suspect`（前端黄色提示），仍参与分析；
//   3) 明显异常值（本文件）：入库**保留**，但打 `invalid`，**不参与任何分析**（趋势/报告/评分/看板）。
// 因此「少数极端值」不会让整批数据报废，也不会污染分析结果。

import type { RecordQualityFlag, RecordSourceType } from "./health-engine.js";

/** 来源类型（与 records.source_type 一一对应；类型定义在 health-engine 的 HealthRecord 上） */
export const SOURCE_TYPES = [
  "manual",
  "device",
  "import"
] as const satisfies readonly RecordSourceType[];
export type SourceType = RecordSourceType;

/** 来源中文名（前端标签、接口返回共用） */
export const SOURCE_LABELS: Record<SourceType, string> = {
  manual: "手动录入",
  device: "设备同步",
  import: "批量导入"
};

/** 质量标记（与 records.quality_flag 一一对应） */
export const QUALITY_FLAGS = [
  "good",
  "suspect",
  "invalid"
] as const satisfies readonly RecordQualityFlag[];

/** 质量标记中文名 */
export const QUALITY_LABELS: Record<RecordQualityFlag, string> = {
  good: "正常",
  suspect: "存疑",
  invalid: "无效"
};

/** 单条数值的合理区间（闭区间），越界即标记 */
export interface QualityRange {
  /** HealthRecord 字段名 */
  key: string;
  /** 中文名 */
  label: string;
  /** 单位（提示文案用） */
  unit: string;
  /** 合理区间下限（含） */
  min: number;
  /** 合理区间上限（含） */
  max: number;
  /** 绝对不可能的下限：小于它 → invalid */
  invalidMin: number;
  /** 绝对不可能的上限：大于它 → invalid */
  invalidMax: number;
}

/**
 * 各指标的合理区间与「绝对不可能」边界。
 * 合理区间取临床常见可解释范围；invalid 边界取生理学上不可能出现的值
 * （如收缩压 0 / 999、血氧 >100）——这类值一定是设备故障或录入事故。
 */
export const QUALITY_RANGES: readonly QualityRange[] = [
  {
    key: "systolic",
    label: "收缩压",
    unit: "mmHg",
    invalidMin: 30,
    min: 50,
    max: 250,
    invalidMax: 300
  },
  {
    key: "diastolic",
    label: "舒张压",
    unit: "mmHg",
    invalidMin: 20,
    min: 30,
    max: 150,
    invalidMax: 200
  },
  {
    key: "fastingGlucose",
    label: "空腹血糖",
    unit: "mmol/L",
    invalidMin: 0.5,
    min: 1.1,
    max: 33.3,
    invalidMax: 50
  },
  {
    key: "postprandialGlucose",
    label: "餐后血糖",
    unit: "mmol/L",
    invalidMin: 0.5,
    min: 1.1,
    max: 40,
    invalidMax: 60
  },
  {
    key: "totalCholesterol",
    label: "总胆固醇",
    unit: "mmol/L",
    invalidMin: 0.5,
    min: 1.0,
    max: 20,
    invalidMax: 30
  },
  {
    key: "triglyceride",
    label: "甘油三酯",
    unit: "mmol/L",
    invalidMin: 0.1,
    min: 0.2,
    max: 20,
    invalidMax: 30
  },
  {
    key: "ldl",
    label: "低密度脂蛋白",
    unit: "mmol/L",
    invalidMin: 0.1,
    min: 0.3,
    max: 15,
    invalidMax: 25
  },
  {
    key: "hdl",
    label: "高密度脂蛋白",
    unit: "mmol/L",
    invalidMin: 0.1,
    min: 0.2,
    max: 5,
    invalidMax: 10
  },
  {
    key: "heartRate",
    label: "心率",
    unit: "次/分",
    invalidMin: 20,
    min: 30,
    max: 220,
    invalidMax: 300
  },
  {
    key: "bloodOxygen",
    label: "血氧",
    unit: "%",
    invalidMin: 20,
    min: 50,
    max: 100,
    invalidMax: 100
  },
  {
    key: "weight",
    label: "体重",
    unit: "kg",
    invalidMin: 0.1,
    min: 10,
    max: 300,
    invalidMax: 500
  }
];

/**
 * BMI 合理区间（派生指标，不落库）。
 * 由档案身高 + 本次体重推导，故在「有身高且本次填了体重」时才评估。
 */
export const BMI_QUALITY = {
  label: "BMI",
  min: 10,
  max: 60,
  invalidMin: 5,
  invalidMax: 100
} as const;

/** 单条质量问题的说明（前端 tooltip 直接展示） */
export interface QualityIssue {
  /** 字段名 */
  key: string;
  /** 中文名 */
  label: string;
  /** 触发问题的数值 */
  value: number;
  /** 问题等级：与 overall flag 同义 */
  flag: "suspect" | "invalid";
  /** 说明文案，如「收缩压 999 mmHg 超出合理区间 50-250」 */
  message: string;
}

/** 质量评估结果 */
export interface QualityAssessment {
  /** 综合标记：取所有问题里最重的一档 */
  flag: RecordQualityFlag;
  /** 问题明细（无问题时为空数组） */
  issues: QualityIssue[];
}

/** 数值格式化：整数不带小数点，小数最多保留 2 位（提示文案用） */
function fmtNum(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : String(Math.round(value * 100) / 100);
}

/** 评估单个指标数值 */
function assessValue(range: QualityRange, value: number): QualityIssue | null {
  if (value < range.invalidMin || value > range.invalidMax) {
    return {
      key: range.key,
      label: range.label,
      value,
      flag: "invalid",
      message: `${range.label} ${fmtNum(value)}${range.unit} 超出可测量范围（${range.invalidMin}-${range.invalidMax}），判定为无效数据，不参与分析`
    };
  }
  if (value < range.min || value > range.max) {
    return {
      key: range.key,
      label: range.label,
      value,
      flag: "suspect",
      message: `${range.label} ${fmtNum(value)}${range.unit} 超出合理区间（${range.min}-${range.max}），已保留但标记为存疑`
    };
  }
  return null;
}

/**
 * 评估一条记录的数值质量。
 *
 * 入参刻意放松为 object（内部逐字段做数值判读）：记录行、前端表单、设备上报的
 * 指标集合都能直接传，无需在调用方做类型搬运。校验本身就是本函数的职责。
 *
 * @param values 数值集合，字段名对齐 HealthRecord；未测（null/undefined/空串）跳过校验
 * @param height 档案身高（cm），用于推导 BMI；缺失则不做 BMI 校验
 */
export function assessQuality(
  values: object,
  height?: number
): QualityAssessment {
  const issues: QualityIssue[] = [];
  const bag = values as Record<string, unknown>;

  for (const range of QUALITY_RANGES) {
    const raw = bag[range.key];
    const n = typeof raw === "number" ? raw : Number(raw);
    // 未测（null/undefined/空串）不校验；非数字交给格式校验层处理
    if (raw === null || raw === undefined || raw === "" || !Number.isFinite(n))
      continue;
    const issue = assessValue(range, n);
    if (issue) issues.push(issue);
  }

  // BMI 是派生指标：需要档案身高 + 本次体重，缺一不可
  const h = typeof height === "number" ? height : Number(height);
  const w = Number(bag.weight);
  if (Number.isFinite(h) && h > 0 && Number.isFinite(w) && w > 0) {
    const bmi = w / Math.pow(h / 100, 2);
    const rounded = Math.round(bmi * 10) / 10;
    if (bmi < BMI_QUALITY.invalidMin || bmi > BMI_QUALITY.invalidMax) {
      issues.push({
        key: "bmi",
        label: BMI_QUALITY.label,
        value: rounded,
        flag: "invalid",
        message: `BMI ${rounded} 超出可测量范围（${BMI_QUALITY.invalidMin}-${BMI_QUALITY.invalidMax}），判定为无效数据，不参与分析`
      });
    } else if (bmi < BMI_QUALITY.min || bmi > BMI_QUALITY.max) {
      issues.push({
        key: "bmi",
        label: BMI_QUALITY.label,
        value: rounded,
        flag: "suspect",
        message: `BMI ${rounded} 超出合理区间（${BMI_QUALITY.min}-${BMI_QUALITY.max}），已保留但标记为存疑`
      });
    }
  }

  const flag: RecordQualityFlag = issues.some(i => i.flag === "invalid")
    ? "invalid"
    : issues.length
      ? "suspect"
      : "good";
  return { flag, issues };
}

/**
 * 该记录是否参与分析。
 * `invalid` 一律排除；`good` / `suspect` / 未标记（旧数据、未迁移）都算可用。
 */
export function isAnalyzable(record: {
  qualityFlag?: RecordQualityFlag | string;
}): boolean {
  return record.qualityFlag !== "invalid";
}

/** 过滤出参与分析的记录（趋势 / 报告 / 评分 / 看板统一走这里） */
export function filterAnalyzable<
  T extends { qualityFlag?: RecordQualityFlag | string }
>(records: T[]): T[] {
  return records.filter(isAnalyzable);
}

// ---------- 测量时间 ----------

/** 规范化后的测量时间：`yyyy-MM-dd HH:mm:ss` */
export interface NormalizedMeasuredAt {
  /** 测量时间（yyyy-MM-dd HH:mm:ss） */
  measuredAt: string;
  /** 记录日期（yyyy-MM-dd，取测量时间的日期部分） */
  date: string;
}

/** 时刻是否合法（25:99 这类越界时刻要挡掉，别把无意义的测量时间写进库） */
function validClock(hh: number, mi: number, ss: number): boolean {
  return hh >= 0 && hh <= 23 && mi >= 0 && mi <= 59 && ss >= 0 && ss <= 59;
}

/**
 * 规范化测量时间。
 * 接受 `yyyy-MM-dd`、`yyyy-MM-dd HH:mm[:ss]`、`yyyy-MM-ddTHH:mm[:ss]`（含末尾 Z/毫秒，按本地时间取字面量）；
 * 只给日期时按 `00:00:00` 处理（= 仅精确到日期，手动录入未填时刻的情形）。
 * 日期或时刻越界（如 2026-13-01、25:99）一律返回 null，由调用方决定是 400 还是回退。
 */
export function normalizeMeasuredAt(raw: unknown): NormalizedMeasuredAt | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  const m =
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(text);
  if (!m) return null;
  const [, y, mo, d, hh = "00", mi = "00", ss = "00"] = m;
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (!validClock(Number(hh), Number(mi), Number(ss))) return null;
  const date = `${y}-${mo}-${d}`;
  return { measuredAt: `${date} ${hh}:${mi}:${ss}`, date };
}

/** 记录日期 + 时刻 → 测量时间（时刻缺失或越界时回退 00:00:00，手动录入不因此失败） */
export function measuredAtOf(date: string, time?: string): string {
  const t = typeof time === "string" ? time.trim() : "";
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (m && validClock(Number(m[1]), Number(m[2]), Number(m[3] ?? "0"))) {
    return `${date} ${m[1]}:${m[2]}:${m[3] ?? "00"}`;
  }
  return `${date} 00:00:00`;
}

// ---------- 模拟设备同步 ----------

/**
 * 设备上报指标名的别名表：HealthRecord 字段 → 可接受的写法。
 * 归一化时统一小写并去掉空格/下划线，所以 `blood_oxygen`、`Blood Oxygen` 都能命中。
 */
export const DEVICE_METRIC_ALIASES: Readonly<
  Record<string, readonly string[]>
> = {
  systolic: ["systolic", "sbp", "sys", "收缩压"],
  diastolic: ["diastolic", "dbp", "dia", "舒张压"],
  fastingGlucose: [
    "fastingglucose",
    "glucose",
    "bloodglucose",
    "空腹血糖",
    "血糖"
  ],
  postprandialGlucose: ["postprandialglucose", "餐后血糖"],
  totalCholesterol: ["totalcholesterol", "cholesterol", "总胆固醇"],
  triglyceride: ["triglyceride", "triglycerides", "tg", "甘油三酯"],
  ldl: ["ldl", "ldlc", "低密度脂蛋白"],
  hdl: ["hdl", "hdlc", "高密度脂蛋白"],
  heartRate: ["heartrate", "hr", "pulse", "心率"],
  bloodOxygen: ["bloodoxygen", "spo2", "oxygen", "血氧"],
  weight: ["weight", "体重"]
};

/** 一个设备的测量值草稿（解析结果，尚未落库） */
export interface DeviceRecordDraft {
  /** 记录日期（yyyy-MM-dd） */
  date: string;
  /** 测量时间（yyyy-MM-dd HH:mm:ss，取该组内最晚一次） */
  measuredAt: string;
  /** 设备名 */
  device: string;
  /** 该组的指标值（HealthRecord 字段 → 数值） */
  metrics: Record<string, number>;
  /** 质量标记 */
  qualityFlag: RecordQualityFlag;
  /** 问题明细 */
  issues: QualityIssue[];
}

/** 设备解析结果 */
export interface DeviceParseResult {
  /** 按日期分组的记录草稿（成功时非空） */
  records: DeviceRecordDraft[];
  /** 错误文案（成功时为空串） */
  error: string;
}

/** 别名表展开成查表用的 Map（模块加载时构建一次） */
const METRIC_LOOKUP: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [field, names] of Object.entries(DEVICE_METRIC_ALIASES)) {
    for (const n of names) map.set(n, field);
  }
  return map;
})();

/** 指标名归一化 → HealthRecord 字段（未识别返回 null） */
export function deviceMetricField(metric: unknown): string | null {
  if (typeof metric !== "string") return null;
  const key = metric
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, "");
  return METRIC_LOOKUP.get(key) ?? null;
}

/**
 * 解析设备上报数据 → 待落库记录草稿。
 *
 * 规则：
 * - `measurements` 必须是数组且非空；
 * - 每条必须带可识别的 `metric`、数字 `value`、可解析的 `measuredAt`；
 *   任一条不合法 → 整批返回 error（调用方转 400），避免半批数据入库；
 * - 按 `measuredAt` 的**日期部分**分组（与 records 一天一条的口径一致），
 *   同一天同一指标重复上报时**后一条覆盖前一条**，`measuredAt` 取该组最晚一次；
 * - 每组按合理区间评估质量（`height` 用于 BMI 推导，可选）。
 */
export function buildDeviceRecords(
  device: unknown,
  measurements: unknown,
  height?: number
): DeviceParseResult {
  const deviceName = typeof device === "string" ? device.trim() : "";
  if (!deviceName) return { records: [], error: "字段 device 需为非空字符串" };
  if (!Array.isArray(measurements) || !measurements.length) {
    return { records: [], error: "字段 measurements 需为非空数组" };
  }

  // 日期 → 该日草稿（保持插入顺序稳定，便于测试与展示）
  const groups = new Map<string, DeviceRecordDraft>();

  for (let i = 0; i < measurements.length; i += 1) {
    const item = measurements[i] as Record<string, unknown> | null;
    const at = i + 1;
    if (!item || typeof item !== "object") {
      return { records: [], error: `第 ${at} 条测量数据格式错误` };
    }
    const field = deviceMetricField(item.metric);
    if (!field) {
      return {
        records: [],
        error: `第 ${at} 条测量的 metric「${String(item.metric ?? "")}」无法识别`
      };
    }
    const value = Number(item.value);
    if (
      item.value === null ||
      item.value === undefined ||
      item.value === "" ||
      !Number.isFinite(value)
    ) {
      return { records: [], error: `第 ${at} 条测量的 value 需为数字` };
    }
    const when = normalizeMeasuredAt(item.measuredAt);
    if (!when) {
      return {
        records: [],
        error: `第 ${at} 条测量的 measuredAt 需为 yyyy-MM-dd 或 yyyy-MM-dd HH:mm[:ss]`
      };
    }

    const draft = groups.get(when.date) ?? {
      date: when.date,
      measuredAt: when.measuredAt,
      device: deviceName,
      metrics: {},
      qualityFlag: "good" as RecordQualityFlag,
      issues: []
    };
    // 同指标后上报的覆盖先前的（设备重复上报取最新）
    draft.metrics[field] = value;
    // measuredAt 取该组内最晚一次（字符串即时间序）
    if (when.measuredAt > draft.measuredAt) draft.measuredAt = when.measuredAt;
    groups.set(when.date, draft);
  }

  const records = Array.from(groups.values()).map(draft => {
    const { flag, issues } = assessQuality(draft.metrics, height);
    return { ...draft, qualityFlag: flag, issues };
  });
  return { records, error: "" };
}
