// 风险评估规则引擎（AI 方案 A 内核）
// ★ 唯一源码：后端（server/src/routes/health.ts）与前端（录入页实时分级、首页总览）共用这一份，切勿双写。
// 纯函数、禁 Node/DOM 依赖 —— 因此可同时被 Express 与浏览器加载。
// 分级规则采用中国成人标准，常量集中在顶部，调整阈值只需改这里。
//
// 入参口径：与 API 层一致（camelCase + 中文生活方式枚举 + gender 0 女/1 男），
// 后端由 routes/health.ts 的映射表把 DB 整数枚举转成这个口径后再喂给引擎。
import { calculateBMI } from "./health-score.js";

/** 健康档案（与前端 `src/types/health.ts` 的 HealthProfile 同源，前端直接 re-export 本类型） */
export interface HealthProfile {
  /** 姓名 */
  name: string;
  /** 性别：0 女 / 1 男 */
  gender: number;
  /** 年龄（岁） */
  age: number;
  /** 身高（cm） */
  height: number;
  /** 体重（kg） */
  weight: number;
  /** 腰围（cm） */
  waistline: number;
  /** 既往病史 */
  medicalHistory: string;
  /** 家族史 */
  familyHistory: string;
  /** 过敏史 */
  allergyHistory: string;
  /** 吸烟习惯 */
  smoking: string;
  /** 饮酒习惯 */
  drinking: string;
  /** 运动频率 */
  exercise: string;
  /** M3：睡眠情况（'' | irregular | regular | good） */
  sleepHabit?: string;
  /** M3：运动习惯（'' | rare | occasional | regular） */
  exerciseHabit?: string;
  /** M3：饮食偏好（'' | poor | normal | good） */
  dietHabit?: string;
  /** M3：健康目标（逗号分隔：weight/sleep/exercise/stress/keep） */
  healthGoal?: string;
  sleepHours?: number;
  exerciseFrequency?: number;
  goalDescription?: string;
  /** 创建时间 */
  createTime: string;
}

/**
 * 记录来源（C2）：manual 手动录入 / device 设备同步 / import 批量导入。
 * 与 records.source_type 一一对应；规则引擎本身**不关心**来源，仅供展示与筛选。
 */
export type RecordSourceType = "manual" | "device" | "import";

/**
 * 记录质量（C2）：good 正常 / suspect 存疑（保留但黄色提示）/ invalid 无效（不参与分析）。
 * 与 records.quality_flag 一一对应；判定规则在 shared/health-quality.ts（唯一源码）。
 */
export type RecordQualityFlag = "good" | "suspect" | "invalid";

/** 健康记录（单项指标可选，允许单次只测部分指标） */
export interface HealthRecord {
  /** 记录 id */
  id: string;
  /** 记录日期（yyyy-MM-dd） */
  date: string;
  /** 收缩压（mmHg） */
  systolic?: number;
  /** 舒张压（mmHg） */
  diastolic?: number;
  /** 空腹血糖（mmol/L） */
  fastingGlucose?: number;
  /** 餐后血糖（mmol/L） */
  postprandialGlucose?: number;
  /** 总胆固醇（mmol/L） */
  totalCholesterol?: number;
  /** 甘油三酯（mmol/L） */
  triglyceride?: number;
  /** 低密度脂蛋白 LDL（mmol/L） */
  ldl?: number;
  /** 高密度脂蛋白 HDL（mmol/L） */
  hdl?: number;
  /** 心率（次/分） */
  heartRate?: number;
  /** 血氧（%） */
  bloodOxygen?: number;
  /** 体重（kg） */
  weight?: number;
  /** 备注 */
  remark?: string;
  /**
   * 测量时间（yyyy-MM-dd HH:mm:ss）。仅精确到日期时为当天 00:00:00。
   * 只作展示与排序依据，**不参与**评分。
   */
  measuredAt?: string;
  /** 数据来源（C2）。旧数据缺省视为 manual */
  sourceType?: RecordSourceType;
  /** 质量标记（C2）。旧数据缺省视为 good */
  qualityFlag?: RecordQualityFlag;
  /** 设备名（sourceType 为 device 时记录，用于展示与排查） */
  deviceName?: string;
}

/** 单项分级等级：0 正常 / 1 警戒 / 2 异常 */
export type GradeLevel = 0 | 1 | 2;

/** 综合风险等级 */
export type RiskLevel = "低" | "中" | "高" | "极高";

/** 规则可解释元数据（C0：每条分级规则携带，供风险解释接口与前端展示） */
export interface RuleMeta {
  /** 规则 ID（稳定标识，用于解释接口与前端展示） */
  ruleId: string;
  /** 规则版本（随引擎发布递增，与 ENGINE_VERSION 保持一致） */
  ruleVersion: string;
  /** 适用人群 */
  applicableTo: string;
  /** 阈值说明（含单位） */
  thresholdDesc: string;
  /** 依据来源（指南 / 标准名称） */
  evidence: string;
}

/** 单项分级结果 */
export interface IndicatorGrade {
  /** 指标 key（对齐 HealthRecord 字段；bmi 为派生项） */
  key: string;
  /** 指标中文名 */
  name: string;
  /** 数值 */
  value: number;
  /** 分级文案，如「正常」「警戒」「一级高血压」 */
  grade: string;
  /** 等级（0 正常 / 1 警戒 / 2 异常） */
  level: GradeLevel;
  /** 严重度数值（同指标内越大越严重，用于「取较严重一侧」等排序比较） */
  severity: number;
  /** 说明 */
  desc: string;
  /** C0：规则可解释元数据 */
  rule: RuleMeta;
}

/** 综合分析结果 */
export interface AnalyzeResult {
  /** 综合评分 0-100 */
  score: number;
  /** 风险等级 */
  level: RiskLevel;
  /** 分项分级（基于最近一条记录，含派生 BMI） */
  items: IndicatorGrade[];
  /** 风险点（异常项 + 生活方式风险） */
  risks: string[];
  /** 建议（每异常项一条 + 生活方式建议） */
  suggestions: string[];
  /** 就医提醒（空串表示无需就医） */
  medicalAdvice: string;
}

// ---------- C0 常量：引擎版本 / 边界文案 ----------

/** 规则引擎版本（C0 起随规则修订递增，写入每条 RuleMeta 与报告/解释输出） */
export const ENGINE_VERSION = "2026.1";

/** 固定边界文案：报告、AI 对话与风险页统一展示（C0 验收要求） */
export const BOUNDARY_TEXT =
  "健康管理提示：本系统仅提供健康风险提示与健康管理建议，不能替代医生诊断，如有不适请及时就医。";

// ---------- C0 规则元数据表（所有分级规则共享，调整阈值只改这里与各 grade 函数） ----------

const RULE_META: Record<string, RuleMeta> = {
  BMI: {
    ruleId: "BMI-001",
    ruleVersion: ENGINE_VERSION,
    applicableTo: "18 岁以上成人",
    thresholdDesc:
      "BMI <18.5 偏瘦；18.5~23.9 正常；24~27.9 超重；≥28 肥胖（kg/m²）",
    evidence: "《中国成人超重和肥胖症预防控制指南》（WS/T 428-2013）"
  },
  SYSTOLIC: {
    ruleId: "BP-SYS-001",
    ruleVersion: ENGINE_VERSION,
    applicableTo: "18 岁以上成人",
    thresholdDesc:
      "收缩压 <120 正常；120~139 正常高值；140~159 一级；160~179 二级；≥180 三级（mmHg）",
    evidence: "《中国高血压防治指南（2024 年修订版）》"
  },
  DIASTOLIC: {
    ruleId: "BP-DIA-001",
    ruleVersion: ENGINE_VERSION,
    applicableTo: "18 岁以上成人",
    thresholdDesc:
      "舒张压 <80 正常；80~89 正常高值；90~99 一级；100~109 二级；≥110 三级（mmHg）",
    evidence: "《中国高血压防治指南（2024 年修订版）》"
  },
  FASTING_GLUCOSE: {
    ruleId: "GLU-FPG-001",
    ruleVersion: ENGINE_VERSION,
    applicableTo: "18 岁以上成人",
    thresholdDesc:
      "空腹血糖 <3.9 低血糖；3.9~6.0 正常；6.1~6.9 受损（糖尿病前期）；≥7.0 疑似糖尿病（mmol/L）",
    evidence: "《中国2型糖尿病防治指南（2020 年版）》"
  },
  TOTAL_CHOLESTEROL: {
    ruleId: "LIP-TC-001",
    ruleVersion: ENGINE_VERSION,
    applicableTo: "18 岁以上成人",
    thresholdDesc: "总胆固醇 <5.2 正常；5.2~6.1 边缘升高；≥6.2 升高（mmol/L）",
    evidence: "《中国成人血脂异常防治指南（2016 年修订版）》"
  },
  TRIGLYCERIDE: {
    ruleId: "LIP-TG-001",
    ruleVersion: ENGINE_VERSION,
    applicableTo: "18 岁以上成人",
    thresholdDesc: "甘油三酯 <1.7 正常；1.7~2.2 边缘升高；≥2.3 升高（mmol/L）",
    evidence: "《中国成人血脂异常防治指南（2016 年修订版）》"
  },
  LDL: {
    ruleId: "LIP-LDL-001",
    ruleVersion: ENGINE_VERSION,
    applicableTo: "18 岁以上成人",
    thresholdDesc: "LDL <3.4 正常；3.4~4.0 边缘升高；≥4.1 升高（mmol/L）",
    evidence: "《中国成人血脂异常防治指南（2016 年修订版）》"
  },
  HDL: {
    ruleId: "LIP-HDL-001",
    ruleVersion: ENGINE_VERSION,
    applicableTo: "18 岁以上成人",
    thresholdDesc: "HDL 男 <1.0、女 <1.3 偏低，其余正常（mmol/L）",
    evidence: "《中国成人血脂异常防治指南（2016 年修订版）》"
  }
};

// ---------- 综合评分权重（合计 100） ----------
const WEIGHTS = {
  /** 血压（收缩压 + 舒张压，取较严重者） */
  bloodPressure: 25,
  /** 血糖（空腹血糖） */
  bloodGlucose: 25,
  bmi: 15,
  totalCholesterol: 10,
  triglyceride: 10,
  ldl: 10,
  hdl: 5
} as const;

// ---------- 生活方式修正分 ----------
const LIFESTYLE = { smoking: 5, drinking: 3, exercise: 5 } as const;

// ---------- 单项分级（中国标准） ----------

/** BMI 分级（身高 cm、体重 kg） */
export function gradeBmi(
  heightCm: number,
  weightKg: number
): IndicatorGrade | null {
  if (!heightCm || !weightKg) return null;
  // BMI 公式统一走 health-score.calculateBMI（此前本文件内联了一份，是第 3 份实现）
  const bmi = calculateBMI(heightCm, weightKg)!;
  const base = { key: "bmi", name: "BMI", value: bmi, rule: RULE_META.BMI };
  if (bmi < 18.5)
    return { ...base, level: 1, severity: 1, grade: "偏瘦", desc: "体重过低" };
  if (bmi < 24)
    return {
      ...base,
      level: 0,
      severity: 0,
      grade: "正常",
      desc: "体重在正常范围"
    };
  if (bmi < 28)
    return { ...base, level: 1, severity: 1, grade: "超重", desc: "体重超标" };
  return { ...base, level: 2, severity: 2, grade: "肥胖", desc: "肥胖" };
}

/** 收缩压分级（mmHg） */
export function gradeSystolic(v: number): IndicatorGrade {
  const base = {
    key: "systolic",
    name: "收缩压",
    value: v,
    rule: RULE_META.SYSTOLIC
  };
  if (v < 120)
    return { ...base, level: 0, severity: 0, grade: "正常", desc: "血压正常" };
  if (v < 140)
    return {
      ...base,
      level: 1,
      severity: 1,
      grade: "警戒",
      desc: "正常高值，注意监测"
    };
  if (v < 160)
    return {
      ...base,
      level: 2,
      severity: 2,
      grade: "一级高血压",
      desc: "轻度高血压"
    };
  if (v < 180)
    return {
      ...base,
      level: 2,
      severity: 3,
      grade: "二级高血压",
      desc: "中度高血压"
    };
  return {
    ...base,
    level: 2,
    severity: 4,
    grade: "三级高血压",
    desc: "重度高血压"
  };
}

/** 舒张压分级（mmHg） */
export function gradeDiastolic(v: number): IndicatorGrade {
  const base = {
    key: "diastolic",
    name: "舒张压",
    value: v,
    rule: RULE_META.DIASTOLIC
  };
  if (v < 80)
    return { ...base, level: 0, severity: 0, grade: "正常", desc: "血压正常" };
  if (v < 90)
    return {
      ...base,
      level: 1,
      severity: 1,
      grade: "警戒",
      desc: "正常高值，注意监测"
    };
  if (v < 100)
    return {
      ...base,
      level: 2,
      severity: 2,
      grade: "一级高血压",
      desc: "轻度高血压"
    };
  if (v < 110)
    return {
      ...base,
      level: 2,
      severity: 3,
      grade: "二级高血压",
      desc: "中度高血压"
    };
  return {
    ...base,
    level: 2,
    severity: 4,
    grade: "三级高血压",
    desc: "重度高血压"
  };
}

/** 空腹血糖分级（mmol/L） */
export function gradeFastingGlucose(v: number): IndicatorGrade {
  const base = {
    key: "fastingGlucose",
    name: "空腹血糖",
    value: v,
    rule: RULE_META.FASTING_GLUCOSE
  };
  if (v < 3.9)
    return {
      ...base,
      level: 2,
      severity: 2,
      grade: "低血糖",
      desc: "血糖过低"
    };
  if (v < 6.1)
    return { ...base, level: 0, severity: 0, grade: "正常", desc: "血糖正常" };
  if (v < 7.0)
    return {
      ...base,
      level: 1,
      severity: 1,
      grade: "受损",
      desc: "空腹血糖受损，属糖尿病前期"
    };
  return {
    ...base,
    level: 2,
    severity: 2,
    grade: "血糖升高风险",
    desc: "血糖明显升高，建议就医复查确认"
  };
}

/** 总胆固醇分级（mmol/L） */
export function gradeTotalCholesterol(v: number): IndicatorGrade {
  const base = {
    key: "totalCholesterol",
    name: "总胆固醇",
    value: v,
    rule: RULE_META.TOTAL_CHOLESTEROL
  };
  if (v < 5.2)
    return {
      ...base,
      level: 0,
      severity: 0,
      grade: "正常",
      desc: "总胆固醇正常"
    };
  if (v < 6.2)
    return { ...base, level: 1, severity: 1, grade: "警戒", desc: "边缘升高" };
  return {
    ...base,
    level: 2,
    severity: 2,
    grade: "升高",
    desc: "总胆固醇升高"
  };
}

/** 甘油三酯分级（mmol/L） */
export function gradeTriglyceride(v: number): IndicatorGrade {
  const base = {
    key: "triglyceride",
    name: "甘油三酯",
    value: v,
    rule: RULE_META.TRIGLYCERIDE
  };
  if (v < 1.7)
    return {
      ...base,
      level: 0,
      severity: 0,
      grade: "正常",
      desc: "甘油三酯正常"
    };
  if (v < 2.3)
    return { ...base, level: 1, severity: 1, grade: "警戒", desc: "边缘升高" };
  return {
    ...base,
    level: 2,
    severity: 2,
    grade: "升高",
    desc: "甘油三酯升高"
  };
}

/** LDL 分级（mmol/L） */
export function gradeLdl(v: number): IndicatorGrade {
  const base = {
    key: "ldl",
    name: "低密度脂蛋白",
    value: v,
    rule: RULE_META.LDL
  };
  if (v < 3.4)
    return { ...base, level: 0, severity: 0, grade: "正常", desc: "LDL 正常" };
  if (v < 4.1)
    return { ...base, level: 1, severity: 1, grade: "警戒", desc: "边缘升高" };
  return { ...base, level: 2, severity: 2, grade: "升高", desc: "LDL 升高" };
}

/** HDL 分级（mmol/L，需性别：0 女 / 1 男） */
export function gradeHdl(v: number, gender: number): IndicatorGrade {
  const base = {
    key: "hdl",
    name: "高密度脂蛋白",
    value: v,
    rule: RULE_META.HDL
  };
  const threshold = gender === 0 ? 1.3 : 1.0;
  if (v >= threshold)
    return { ...base, level: 0, severity: 0, grade: "正常", desc: "HDL 正常" };
  return { ...base, level: 2, severity: 2, grade: "偏低", desc: "HDL 偏低" };
}

// ---------- 综合评分 / 风险等级 / 建议 ----------

/**
 * 风险等级阈值。抽成常量是为了让「高危保护」与 riskLevelOf 共用同一套分界，
 * 避免两处硬编码 30 导致保底值与等级判定漂移。
 */
const RISK_LEVEL_THRESHOLD = {
  low: 0,
  medium: 30,
  high: 60,
  extreme: 80
} as const;

/** 风险等级映射：<30 低 / 30~59 中 / 60~79 高 / ≥80 极高 */
export function riskLevelOf(score: number): RiskLevel {
  if (score < RISK_LEVEL_THRESHOLD.medium) return "低";
  if (score < RISK_LEVEL_THRESHOLD.high) return "中";
  if (score < RISK_LEVEL_THRESHOLD.extreme) return "高";
  return "极高";
}

/** 异常项对应的医学建议文案 */
const SUGGESTIONS: Record<string, string> = {
  bmi: "控制体重：均衡饮食 + 规律运动，将 BMI 维持在 18.5~23.9。",
  systolic:
    "收缩压偏高：限盐（每日 <5g）、规律有氧运动、避免熬夜与精神紧张，并每日监测血压。",
  diastolic:
    "舒张压偏高：限盐（每日 <5g）、戒烟限酒、控制体重，并每日监测血压。",
  fastingGlucose: "血糖异常：控制碳水摄入、规律运动，持续监测空腹与餐后血糖。",
  totalCholesterol:
    "血脂偏高：低脂低胆固醇饮食，增加膳食纤维摄入，必要时就医。",
  triglyceride: "甘油三酯偏高：减少油脂与酒精摄入，控制体重，规律运动。",
  ldl: "LDL 偏高：减少饱和脂肪与反式脂肪摄入，必要时就医。",
  hdl: "HDL 偏低：增加有氧运动、戒烟、控制体重以提升 HDL。"
};

/** 取较严重的等级 */
function worse(a: GradeLevel | null, b: GradeLevel | null): GradeLevel | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b) as GradeLevel;
}

/** 取较严重的分级对象（按 severity 数值比较，用于「血压取较严重一侧」等展示场景） */
export function worseGrade(
  a: IndicatorGrade | null,
  b: IndicatorGrade | null
): IndicatorGrade | null {
  if (a === null) return b;
  if (b === null) return a;
  return a.severity >= b.severity ? a : b;
}

/** 对一条记录逐项分级（含派生 BMI），返回存在的指标分级数组 */
export function gradeRecord(
  record: HealthRecord,
  profile?: HealthProfile | null
): IndicatorGrade[] {
  const items: IndicatorGrade[] = [];
  const push = (g: IndicatorGrade | null) => {
    if (g) items.push(g);
  };

  if (record.systolic != null) push(gradeSystolic(record.systolic));
  if (record.diastolic != null) push(gradeDiastolic(record.diastolic));
  if (record.fastingGlucose != null)
    push(gradeFastingGlucose(record.fastingGlucose));
  if (record.totalCholesterol != null)
    push(gradeTotalCholesterol(record.totalCholesterol));
  if (record.triglyceride != null) push(gradeTriglyceride(record.triglyceride));
  if (record.ldl != null) push(gradeLdl(record.ldl));
  if (record.hdl != null) push(gradeHdl(record.hdl, profile?.gender ?? 1));

  // BMI：身高取档案，体重优先记录体重、其次档案体重
  const weight = record.weight ?? profile?.weight;
  if (profile?.height && weight) push(gradeBmi(profile.height, weight));

  return items;
}

/**
 * 综合分析：输入记录数组 → 分级 + 综合评分 + 风险点 + 建议
 * 取最近一条记录做单项分级，评分按各分类等级折算后加权求和，再叠加生活方式修正。
 */
export function analyzeHealth(
  records: HealthRecord[],
  profile?: HealthProfile | null
): AnalyzeResult {
  const sorted = [...records].sort((a, b) =>
    a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1
  );
  const latest = sorted[0];

  const items = latest ? gradeRecord(latest, profile) : [];

  // 各分类等级（未测为 null）
  const categories = {
    bloodPressure: worse(
      latest?.systolic != null ? gradeSystolic(latest.systolic).level : null,
      latest?.diastolic != null ? gradeDiastolic(latest.diastolic).level : null
    ),
    bloodGlucose:
      latest?.fastingGlucose != null
        ? gradeFastingGlucose(latest.fastingGlucose).level
        : null,
    bmi:
      profile?.height && (latest?.weight ?? profile?.weight)
        ? (gradeBmi(profile.height, latest?.weight ?? profile.weight)?.level ??
          null)
        : null,
    totalCholesterol:
      latest?.totalCholesterol != null
        ? gradeTotalCholesterol(latest.totalCholesterol).level
        : null,
    triglyceride:
      latest?.triglyceride != null
        ? gradeTriglyceride(latest.triglyceride).level
        : null,
    ldl: latest?.ldl != null ? gradeLdl(latest.ldl).level : null,
    hdl:
      latest?.hdl != null
        ? gradeHdl(latest.hdl, profile?.gender ?? 1).level
        : null
  };

  // 加权得分：正常 0、警戒 50%、异常 100%
  //
  // 分母只累计【已测量】指标的权重，未测指标既不贡献分子也不进分母。
  // 若不做归一化，「只测了血压」的用户最多只能拿到 25/100，会被判成低风险 ——
  // 三级高血压（200/120）因此被标成「低」，属于方向性错误。
  // 归一化后：测的项目越少，分数只反映已测项的严重程度，不会因为"没测"而显得健康。
  let weighted = 0;
  let measured = 0;
  (Object.keys(WEIGHTS) as Array<keyof typeof WEIGHTS>).forEach(key => {
    const l = categories[key];
    if (l === null) return;
    measured += WEIGHTS[key];
    weighted += WEIGHTS[key] * (l === 2 ? 1 : l === 1 ? 0.5 : 0);
  });
  let score = measured > 0 ? Math.round((weighted / measured) * 100) : 0;

  // 高危保护：任一单项达到「异常」(level 2) 时，总评不得低于「中」的阈值。
  // 避免单个危急值被其它正常项稀释成「低风险」。
  const hasSevere = Object.values(categories).some(l => l === 2);
  if (hasSevere) score = Math.max(score, RISK_LEVEL_THRESHOLD.medium);

  // 生活方式修正（只加分，不参与归一化）
  if (profile) {
    if (profile.smoking === "偶尔" || profile.smoking === "经常")
      score += LIFESTYLE.smoking;
    if (profile.drinking === "偶尔" || profile.drinking === "经常")
      score += LIFESTYLE.drinking;
    if (profile.exercise === "几乎不运动") score += LIFESTYLE.exercise;
  }
  score = Math.min(100, score);

  const level = riskLevelOf(score);

  // 风险点与建议：异常项（等级 2）逐项 + 生活方式
  const risks: string[] = [];
  const suggestions: string[] = [];
  items.forEach(it => {
    if (it.level !== 2) return;
    risks.push(`${it.name}：${it.grade}（${it.value}）`);
    suggestions.push(
      SUGGESTIONS[it.key] ?? `建议关注${it.name}，调整生活方式并定期复查。`
    );
  });

  if (profile?.smoking === "偶尔" || profile?.smoking === "经常") {
    risks.push("吸烟");
    suggestions.push("建议戒烟：吸烟显著增加心脑血管疾病风险。");
  }
  if (profile?.drinking === "偶尔" || profile?.drinking === "经常") {
    risks.push("饮酒");
    suggestions.push("建议限制饮酒：男性每日酒精 <25g，女性 <15g。");
  }
  if (profile?.exercise === "几乎不运动") {
    risks.push("运动不足");
    suggestions.push("建议每周 ≥150 分钟中等强度有氧运动。");
  }

  // 就医提醒：最近连续 3 次血压 ≥140/90 建议就医
  let medicalAdvice = "";
  const recent3 = sorted.slice(0, 3);
  if (
    recent3.length >= 3 &&
    recent3.every(
      r =>
        (r.systolic != null && r.systolic >= 140) ||
        (r.diastolic != null && r.diastolic >= 90)
    )
  ) {
    medicalAdvice = "血压连续多次 ≥140/90，建议尽快就医复查。";
  }

  return { score, level, items, risks, suggestions, medicalAdvice };
}

// ---------- C0：紧急处置卡（emergency 规则，固定安全提示，不交由大模型自由回答） ----------

/** 紧急处置卡（C0：命中极端指标或危险症状关键词时返回的固定安全提示） */
export interface EmergencyCard {
  /** 触发类型：extreme（极端指标）/ symptom（危险症状） */
  kind: "extreme" | "symptom";
  /** 触发原因描述（如「收缩压 190 mmHg（≥180）」） */
  reason: string;
  /** 处置步骤（固定文案） */
  steps: string[];
  /** 边界文案（固定） */
  boundary: string;
}

/** 危险症状关键词（用户问题中主动提及即触发；先匹配长词，避免子串误伤） */
const EMERGENCY_SYMPTOMS: Array<[string, string]> = [
  ["一侧肢体无力", "一侧肢体无力是脑卒中的典型表现之一"],
  ["胸闷伴大汗", "胸闷伴大汗可能提示急性冠脉综合征"],
  ["言语不清", "言语不清是脑卒中的典型表现之一"],
  ["口角歪斜", "口角歪斜是脑卒中的典型表现之一"],
  ["呼吸困难", "突发呼吸困难可能提示肺栓塞、急性心衰等急症"],
  ["剧烈头痛", "剧烈头痛可能提示脑出血等急症"],
  ["意识模糊", "意识模糊可能提示脑卒中、低血糖危象等急症"],
  ["胸痛", "胸痛可能提示急性心肌梗死等急症"],
  ["晕厥", "晕厥（短暂意识丧失）需立即急诊评估"],
  ["抽搐", "抽搐（惊厥）需急诊处理"],
  ["呕血", "呕血提示消化道出血，需急诊处理"],
  ["黑便", "黑便提示消化道出血，需急诊处理"]
];

/**
 * 否定 / 非当前 / 非本人 语境词。
 *
 * 「我没有胸痛，就是有点累」「家人有抽搐史，我需要担心吗」这类表述
 * 描述的并不是「正在发生的急症」。直接命中会同时造成两个危害：
 *   1. 用户被误导，产生不必要的恐慌；
 *   2. 真正触发急症卡时，用户已经不再相信这条提示 —— 假阳性比假阴性更危险。
 *
 * 因此命中关键词后，还要回看关键词**前面**的一小段窗口是否带这些词。
 */
const NEGATION_HINTS = [
  "没有",
  "没出现",
  "没觉得",
  "不是",
  "不会",
  "绝不",
  "不存在",
  "未出现",
  "已缓解",
  "已经好了",
  "已好转",
  "已恢复",
  "以前",
  "曾经",
  "去年",
  "之前",
  "小时候",
  "家人",
  "朋友",
  "同学",
  "同事",
  "邻居",
  "担心",
  "会不会",
  "预防",
  "害怕",
  "科普",
  "假如",
  "如果"
];

/** 关键词前 N 个字符内出现否定/非本人语境 → 判定为非当前急症 */
const NEGATION_WINDOW = 8;
function isNegated(q: string, word: string): boolean {
  const idx = q.indexOf(word);
  if (idx < 0) return false;
  const before = q.slice(Math.max(0, idx - NEGATION_WINDOW), idx);
  return NEGATION_HINTS.some(h => before.includes(h));
}

/**
 * 心理危机关键词。
 * 处置路径与躯体急症不同（心理援助热线优先于 120），因此单独走一个分支，
 * 不能复用 EMERGENCY_STEPS（那套是"拨打 120/不要自行驾车"）。
 */
const CRISIS_SYMPTOMS = ["不想活", "轻生", "自杀", "结束生命", "活着没意思"];
const CRISIS_STEPS = [
  "1. 请立刻联系身边可信任的人（家人、朋友、辅导员），不要独自承受；",
  "2. 拨打全国 24 小时心理援助热线 12356，或当地心理危机干预热线；",
  "3. 联系学校心理咨询中心预约紧急面谈；",
  "4. 若已有自伤计划或行为，请立即拨打 120 或前往急诊。"
];

/** 极端指标阈值（最新记录命中即触发；与规则引擎同一份数据口径） */
const EMERGENCY_INDICATORS: Array<{
  key: keyof HealthRecord;
  name: string;
  check: (v: number) => boolean;
  reason: (v: number) => string;
}> = [
  {
    key: "systolic",
    name: "收缩压",
    check: v => v >= 180,
    reason: v => `收缩压 ${v} mmHg（≥180）`
  },
  {
    key: "diastolic",
    name: "舒张压",
    check: v => v >= 110,
    reason: v => `舒张压 ${v} mmHg（≥110）`
  },
  {
    key: "fastingGlucose",
    name: "空腹血糖",
    check: v => v >= 16.7,
    reason: v => `空腹血糖 ${v} mmol/L（≥16.7）`
  },
  {
    key: "fastingGlucose",
    name: "空腹血糖",
    check: v => v <= 2.8,
    reason: v => `空腹血糖 ${v} mmol/L（≤2.8）`
  },
  {
    key: "bloodOxygen",
    name: "血氧饱和度",
    check: v => v < 90,
    reason: v => `血氧饱和度 ${v}%（<90）`
  },
  // —— 以下为补齐的下界阈值 ——
  // 原实现只有上界：收缩压 80/50（休克血压）完全不触发，是明显的覆盖缺口。
  {
    key: "systolic",
    name: "收缩压",
    check: v => v <= 90,
    reason: v => `收缩压 ${v} mmHg（≤90，提示休克或严重低血压）`
  },
  {
    key: "diastolic",
    name: "舒张压",
    check: v => v <= 60,
    reason: v => `舒张压 ${v} mmHg（≤60，提示休克或严重低血压）`
  },
  {
    key: "heartRate",
    name: "心率",
    check: v => v < 40 || v > 130,
    reason: v => `心率 ${v} 次/分（<40 或 >130）`
  },
  {
    key: "fastingGlucose",
    name: "空腹血糖",
    check: v => v >= 33.3,
    reason: v => `空腹血糖 ${v} mmol/L（≥33.3，提示高渗高血糖状态）`
  }
];

/** 紧急处置步骤（固定文案，不随用户/模型变化） */
const EMERGENCY_STEPS = [
  "1. 立即停止活动，保持安静，采取舒适的坐位或卧位；",
  "2. 请身边的人协助，立即拨打 120 急救电话，或前往最近医院的急诊科；",
  "3. 如患有高血压、糖尿病等已知疾病，请随身携带病历资料并告知急救人员；",
  "4. 不要自行驾车前往医院。"
];

/**
 * 检查是否命中紧急处置规则（C0 emergency 分流）。
 * - 先查最新记录的极端指标（客观数据危险）；
 * - 再查用户问题中的危险症状关键词（用户主动提及）。
 * 命中即返回固定处置卡；两条都不命中返回 null。
 */
export function checkEmergency(
  question: string,
  latestRecord?: HealthRecord | null
): EmergencyCard | null {
  const q = (question ?? "").trim();

  // 1) 极端指标（数据驱动，优先）
  if (latestRecord) {
    for (const item of EMERGENCY_INDICATORS) {
      const v = latestRecord[item.key];
      if (typeof v === "number" && item.check(v)) {
        return {
          kind: "extreme",
          reason: `您最近的健康记录显示：${item.reason(v)}，已达到紧急危险阈值。`,
          steps: EMERGENCY_STEPS,
          boundary: BOUNDARY_TEXT
        };
      }
    }
  }

  // 2) 心理危机：处置路径与躯体急症不同，走心理援助通道而非 120
  const crisis = CRISIS_SYMPTOMS.find(w => q.includes(w) && !isNegated(q, w));
  if (crisis) {
    return {
      kind: "symptom",
      reason: `您的问题中提到「${crisis}」，提示您可能正处于心理危机中，需要及时获得支持。`,
      steps: CRISIS_STEPS,
      boundary: BOUNDARY_TEXT
    };
  }

  // 3) 危险症状关键词（用户主动提及，且不是否定/非本人语境）
  for (const [word, why] of EMERGENCY_SYMPTOMS) {
    if (q.includes(word) && !isNegated(q, word)) {
      return {
        kind: "symptom",
        reason: `您的问题中提到「${word}」：${why}，属于需要紧急处置的情况。`,
        steps: EMERGENCY_STEPS,
        boundary: BOUNDARY_TEXT
      };
    }
  }

  return null;
}

/** 处置卡 → 对话文本（chat 路由统一用这一份，避免文案漂移） */
export function emergencyCardToText(card: EmergencyCard): string {
  return [
    "⚠️ 紧急健康提示",
    card.reason,
    "请立即采取以下措施：",
    ...card.steps,
    card.boundary
  ].join("\n");
}

// ---------- C0：风险解释（evidence，返回本次结论使用的指标、记录日期、阈值、建议与限制） ----------

/** 单条风险的解释信息（C0 风险解释接口与前端「规则依据」面板共用） */
export interface RiskEvidence {
  /** 指标 key */
  key: string;
  /** 指标中文名 */
  name: string;
  /** 当前数值 */
  value: number;
  /** 分级文案 */
  grade: string;
  /** 等级（0 正常 / 1 警戒 / 2 异常） */
  level: GradeLevel;
  /** 数据来源记录日期（yyyy-MM-dd） */
  recordDate: string;
  /** 数据来源说明 */
  sourceDesc: string;
  /** 规则元数据（版本 / 阈值 / 依据） */
  rule: RuleMeta;
  /** 限制说明（单次测量仅参考，需复测确认） */
  limit: string;
}

/** 风险解释结果（C0：POST /api/health/analyze/explain 返回结构） */
export interface RiskExplanation {
  /** 引擎版本 */
  engineVersion: string;
  /** 结论（综合评分与等级） */
  conclusion: string;
  /** 逐项解释（本次结论使用的全部指标项） */
  items: RiskEvidence[];
  /** 就医提醒 */
  medicalAdvice: string;
  /** 固定边界文案 */
  boundary: string;
}

/** 限制说明（按等级） */
const LIMIT_BY_LEVEL: Record<GradeLevel, string> = {
  0: "单次测量正常，建议保持定期监测。",
  1: "单次测量处于警戒范围，建议复测并调整生活方式后持续观察。",
  2: "单次测量异常，建议复测确认，并尽早就医接受专业评估。"
};

/** 查找最近一条含指定指标的记录日期（倒序） */
function latestRecordDateOf(
  key: string,
  records: HealthRecord[]
): string | null {
  for (const r of [...records].sort((a, b) => (a.date < b.date ? 1 : -1))) {
    if (r[key as keyof HealthRecord] != null) return r.date;
  }
  return null;
}

/**
 * 组装风险解释（C0）：为分析结果的每个指标项补充
 * 数据来源日期、规则版本、阈值说明、依据与限制说明。
 */
export function buildEvidence(
  records: HealthRecord[],
  profile: HealthProfile | null,
  result: AnalyzeResult = analyzeHealth(records, profile)
): RiskExplanation {
  const items: RiskEvidence[] = result.items.map(it => {
    // BMI 的「数据来源」取最近含体重/档案的记录日期
    let recordDate = latestRecordDateOf(it.key, records);
    let sourceDesc = `数据来源：最近一次${it.name}记录`;
    if (it.key === "bmi") {
      sourceDesc = "数据来源：档案身高 + 最近体重计算";
      recordDate = latestRecordDateOf("weight", records);
    }
    if (!recordDate) {
      // 无记录时（如仅档案有身高体重）退化为档案时间
      recordDate = (profile?.createTime ?? "").slice(0, 10) || "档案建立时";
      if (it.key !== "bmi") sourceDesc = "数据来源：档案";
    }

    return {
      key: it.key,
      name: it.name,
      value: it.value,
      grade: it.grade,
      level: it.level,
      recordDate,
      sourceDesc,
      rule: it.rule,
      limit: LIMIT_BY_LEVEL[it.level]
    };
  });

  return {
    engineVersion: ENGINE_VERSION,
    conclusion: `综合评分 ${result.score} 分，风险等级「${result.level}」。`,
    items,
    medicalAdvice: result.medicalAdvice,
    boundary: BOUNDARY_TEXT
  };
}
