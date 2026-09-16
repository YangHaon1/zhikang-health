// 风险评估规则引擎（AI 方案 A 内核）
// 纯函数、禁 Node/DOM 依赖 —— mock 与前端共用这一份，切勿双写。
// 分级规则采用中国成人标准，常量集中在顶部，调整阈值只需改这里。
import type { HealthProfile, HealthRecord } from "@/types/health";

/** 单项分级等级：0 正常 / 1 警戒 / 2 异常 */
export type GradeLevel = 0 | 1 | 2;

/** 综合风险等级 */
export type RiskLevel = "低" | "中" | "高" | "极高";

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
  const bmi = Number((weightKg / Math.pow(heightCm / 100, 2)).toFixed(1));
  const base = { key: "bmi", name: "BMI", value: bmi };
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
  const base = { key: "systolic", name: "收缩压", value: v };
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
  const base = { key: "diastolic", name: "舒张压", value: v };
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
  const base = { key: "fastingGlucose", name: "空腹血糖", value: v };
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
    grade: "疑似糖尿病",
    desc: "血糖显著升高"
  };
}

/** 总胆固醇分级（mmol/L） */
export function gradeTotalCholesterol(v: number): IndicatorGrade {
  const base = { key: "totalCholesterol", name: "总胆固醇", value: v };
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
  const base = { key: "triglyceride", name: "甘油三酯", value: v };
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
  const base = { key: "ldl", name: "低密度脂蛋白", value: v };
  if (v < 3.4)
    return { ...base, level: 0, severity: 0, grade: "正常", desc: "LDL 正常" };
  if (v < 4.1)
    return { ...base, level: 1, severity: 1, grade: "警戒", desc: "边缘升高" };
  return { ...base, level: 2, severity: 2, grade: "升高", desc: "LDL 升高" };
}

/** HDL 分级（mmol/L，需性别：0 女 / 1 男） */
export function gradeHdl(v: number, gender: number): IndicatorGrade {
  const base = { key: "hdl", name: "高密度脂蛋白", value: v };
  const threshold = gender === 0 ? 1.3 : 1.0;
  if (v >= threshold)
    return { ...base, level: 0, severity: 0, grade: "正常", desc: "HDL 正常" };
  return { ...base, level: 2, severity: 2, grade: "偏低", desc: "HDL 偏低" };
}

// ---------- 综合评分 / 风险等级 / 建议 ----------

/** 风险等级映射：<30 低 / 30~59 中 / 60~79 高 / ≥80 极高 */
export function riskLevelOf(score: number): RiskLevel {
  if (score < 30) return "低";
  if (score < 60) return "中";
  if (score < 80) return "高";
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
        ? (gradeBmi(profile.height, latest.weight ?? profile.weight)?.level ??
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
  let score = 0;
  (Object.keys(WEIGHTS) as Array<keyof typeof WEIGHTS>).forEach(key => {
    const l = categories[key];
    if (l === null) return;
    score += WEIGHTS[key] * (l === 2 ? 1 : l === 1 ? 0.5 : 0);
  });
  score = Math.round(score);

  // 生活方式修正
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
