/** 健康档案 */
export type HealthProfile = {
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
  /** 创建时间 */
  createTime: string;
};

/** 健康记录（单项指标可选，允许单次只测部分指标） */
export type HealthRecord = {
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
