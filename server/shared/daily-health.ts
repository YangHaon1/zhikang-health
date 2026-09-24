/**
 * M1 用户体验升级：每日健康记录共享层（前后端唯一源码）。
 *
 * 数据定位：daily_health_records 是「每天高频变化的生活方式数据」
 * （睡眠 / 运动分钟 / 心情 / 饮食），与 profiles（长期档案）、records（医学指标）解耦。
 * 本文件只放纯函数（无 Node / DOM 依赖）：校验、文案映射、今日状态汇总、
 * 今日健康指数、近 7 天 AI 建议——路由只负责读写库，前端驾驶舱直接复用同一套口径。
 */

// ---------- 枚举与文案 ----------

/** 心情评分：1 较差 | 2 一般 | 3 很好（与任务书 QuickRecord 的 emoji 三档对应） */
export const MOOD_SCORE_TO_TEXT: Readonly<Record<number, string>> = {
  1: "较差",
  2: "一般",
  3: "很好"
};

/** 饮食状态：good 良好 | normal 一般 | poor 不佳 */
export const DIET_STATUS_TO_TEXT: Readonly<Record<string, string>> = {
  good: "良好",
  normal: "一般",
  poor: "不佳"
};

export const DIET_STATUSES = ["good", "normal", "poor"] as const;
export type DietStatus = (typeof DIET_STATUSES)[number];

// ---------- 输入校验 ----------

export interface DailyInput {
  sleepHours?: number | null;
  exerciseMinutes?: number | null;
  moodScore?: number | null;
  dietStatus?: string | null;
  note?: string | null;
}

export interface NormalizedDaily {
  sleepHours: number | null;
  exerciseMinutes: number | null;
  moodScore: number | null;
  dietStatus: DietStatus | "";
  note: string;
}

/**
 * 校验并归一化一条每日记录。任一非法字段返回错误文案（路由回 400）。
 * 空字段一律视作「今天还没记录这项」（null），不要求全填。
 */
export function validateDailyInput(raw: DailyInput): {
  value: NormalizedDaily;
  error: string | null;
} {
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };

  const sleepHours = num(raw.sleepHours);
  if (Number.isNaN(sleepHours))
    return { value: emptyNormalized(), error: "睡眠时长需为数字" };
  if (sleepHours !== null && (sleepHours < 0 || sleepHours > 24))
    return { value: emptyNormalized(), error: "睡眠时长需在 0-24 小时之间" };

  const exerciseMinutes = num(raw.exerciseMinutes);
  if (Number.isNaN(exerciseMinutes))
    return { value: emptyNormalized(), error: "运动分钟需为数字" };
  if (
    exerciseMinutes !== null &&
    (exerciseMinutes < 0 || exerciseMinutes > 1440)
  )
    return { value: emptyNormalized(), error: "运动分钟需在 0-1440 之间" };

  const moodScore =
    raw.moodScore === null ||
    raw.moodScore === undefined ||
    String(raw.moodScore).trim() === ""
      ? null
      : Number(raw.moodScore);
  if (
    moodScore !== null &&
    !(moodScore === 1 || moodScore === 2 || moodScore === 3)
  )
    return {
      value: emptyNormalized(),
      error: "心情评分只能是 1（较差）/ 2（一般）/ 3（很好）"
    };

  const dietRaw =
    raw.dietStatus === null || raw.dietStatus === undefined
      ? ""
      : String(raw.dietStatus).trim();
  const dietStatus: DietStatus | "" =
    dietRaw === ""
      ? ""
      : (DIET_STATUSES as readonly string[]).includes(dietRaw)
        ? (dietRaw as DietStatus)
        : "";
  if (dietRaw !== "" && !(DIET_STATUSES as readonly string[]).includes(dietRaw))
    return {
      value: emptyNormalized(),
      error: "饮食状态只能是 good / normal / poor"
    };

  const note = String(raw.note ?? "")
    .trim()
    .slice(0, 200);

  return {
    value: {
      sleepHours,
      exerciseMinutes:
        exerciseMinutes === null ? null : Math.round(exerciseMinutes),
      moodScore,
      dietStatus,
      note
    },
    error: null
  };
}

function emptyNormalized(): NormalizedDaily {
  return {
    sleepHours: null,
    exerciseMinutes: null,
    moodScore: null,
    dietStatus: "",
    note: ""
  };
}

// ---------- 今日健康指数（规则：基础健康分 ± 今日生活习惯调整） ----------

export interface DailyIndex {
  /** 今日健康指数 0-100 */
  score: number;
  /** 良好 / 不错 / 一般 / 需要关注 */
  levelText: string;
  /** 相比上周同日（或 7 天前）的变化分，无数据时为 null */
  delta: number | null;
  /** 各调整项明细（前端展示用） */
  adjustments: Array<{ label: string; delta: number }>;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** 今日生活数据对健康指数的调整（返回正数加分、负数扣分） */
export function todayAdjustments(
  d: NormalizedDaily
): Array<{ label: string; delta: number }> {
  const out: Array<{ label: string; delta: number }> = [];
  if (d.sleepHours !== null) {
    if (d.sleepHours >= 7 && d.sleepHours <= 9)
      out.push({ label: "睡眠适中", delta: 3 });
    else if (d.sleepHours < 6) out.push({ label: "睡眠不足", delta: -5 });
    else if (d.sleepHours > 10) out.push({ label: "睡眠过长", delta: -2 });
  }
  if (d.exerciseMinutes !== null) {
    if (d.exerciseMinutes >= 30) out.push({ label: "达到运动量", delta: 4 });
    else if (d.exerciseMinutes >= 10) out.push({ label: "轻度活动", delta: 1 });
    else out.push({ label: "久坐少动", delta: -2 });
  }
  if (d.moodScore !== null) {
    if (d.moodScore === 3) out.push({ label: "心情良好", delta: 2 });
    else if (d.moodScore === 1) out.push({ label: "情绪偏低", delta: -3 });
  }
  if (d.dietStatus !== "") {
    if (d.dietStatus === "good") out.push({ label: "饮食规律", delta: 1 });
    else if (d.dietStatus === "poor")
      out.push({ label: "饮食不规律", delta: -2 });
  }
  return out;
}

/**
 * 今日健康指数 = 基础健康分（100 - 风险分，风险分口径见 health-engine）
 *                + 今日生活习惯调整，钳制在 0-100。
 * 风险分越高健康分越差，与 C3 修正后的方向一致。
 */
export function buildTodayIndex(
  riskScore: number,
  today: NormalizedDaily
): DailyIndex {
  const base = clamp(100 - riskScore, 0, 100);
  const adjustments = todayAdjustments(today);
  const score = clamp(
    Math.round(base + adjustments.reduce((s, a) => s + a.delta, 0)),
    0,
    100
  );
  return {
    score,
    levelText:
      score >= 85
        ? "良好"
        : score >= 70
          ? "不错"
          : score >= 50
            ? "一般"
            : "需要关注",
    delta: null,
    adjustments
  };
}

// ---------- 近 7 天 AI 建议（规则生成，断网可用） ----------

export interface RecentDay {
  date: string;
  sleepHours: number | null;
  exerciseMinutes: number | null;
  moodScore: number | null;
}

/** 根据近 7 天生活数据生成 1-3 条 AI 健康建议（规则文案，可复算） */
export function buildDailyAdvice(recent: RecentDay[]): string[] {
  const advice: string[] = [];
  const sleeps = recent
    .map(d => d.sleepHours)
    .filter((h): h is number => h !== null);
  const exercises = recent
    .map(d => d.exerciseMinutes)
    .filter((m): m is number => m !== null);
  const activeDays = recent.filter(d => (d.exerciseMinutes ?? 0) >= 10).length;

  if (sleeps.length >= 3) {
    const avg = sleeps.reduce((s, h) => s + h, 0) / sleeps.length;
    if (avg < 7)
      advice.push(
        `近 ${sleeps.length} 天平均睡眠 ${avg.toFixed(1)} 小时，略偏少。建议今晚提前 30 分钟休息，固定起床时间。`
      );
    else if (avg > 9)
      advice.push(
        `近 ${sleeps.length} 天平均睡眠 ${avg.toFixed(1)} 小时，偏长。可适度调整作息，白天增加活动。`
      );
  }
  if (recent.length > 0) {
    if (activeDays < 3)
      advice.push(
        `近 ${recent.length} 天只有 ${activeDays} 天有活动记录，运动频率偏低。建议每周累计 150 分钟中等强度活动，从每天 10 分钟开始。`
      );
    else if (
      exercises.reduce((s, m) => s + m, 0) / Math.max(activeDays, 1) <
      20
    )
      advice.push(
        `运动天数达标，但单次时长偏短。建议每次连续运动 30 分钟，效果更好。`
      );
  }
  if (advice.length === 0)
    advice.push(
      "最近作息与运动都比较规律，继续保持。记得每周测量一次血压/血糖并记录。"
    );
  return advice;
}
