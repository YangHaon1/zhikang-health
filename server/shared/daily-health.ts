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

// ---------- 五维健康画像（唯一源码，前后端共用） ----------

/** 画像维度输入：近 N 天真实记录 + 学生画像 */
export interface DimensionDay {
  date?: string;
  sleepHours?: number | null;
  exerciseMinutes?: number | null;
  moodScore?: number | null;
  sleepQuality?: number | null;
  stressLevel?: number | null;
  dietRegularity?: string | null;
}

export interface DimensionProfile {
  bedtime?: string | null;
  wakeTime?: string | null;
  sedentaryHours?: number | null;
}

export interface HealthDimension {
  key: string;
  label: string;
  /** 0-100，null 表示该维度暂无数据（前端展示"暂未记录"，不得渲染成 0 分） */
  value: number | null;
  color: string;
  /** 依据说明，用于向用户交代分数是怎么来的 */
  basis: string;
}

/** 采样不足时的最小天数：低于此值不产出该维度分数 */
const MIN_SAMPLES = 3;

function avg(values: Array<number | null | undefined>): number | null {
  const valid = values.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v)
  );
  if (valid.length < MIN_SAMPLES) return null;
  return valid.reduce((s, v) => s + v, 0) / valid.length;
}

/** 线性映射并夹到 0-100：value=good 得 100，value=bad 得 0 */
function scale(v: number, good: number, bad: number): number {
  const r = ((v - bad) / (good - bad)) * 100;
  return Math.max(0, Math.min(100, Math.round(r)));
}

/**
 * 五维健康画像。
 *
 * 与旧实现的区别：旧版在前端用**单日**数据 + 一组写死的档位（85/60/35、88/62/35、固定 75）
 * 估算，既不是真实统计也不是引擎口径。这里改为：
 *   · 取近 N 天有效采样求平均（不足 3 天则该维度返回 null，而不是编一个数）
 *   · 作息规律按真实就寝时刻偏离 23:00 的程度计算，而不是"有记录就给 75"
 *   · 每维附带 basis 说明，让分数可追溯
 *
 * 仅反映近期生活习惯，不做疾病诊断。
 */
export function buildHealthDimensions(
  recent: DimensionDay[],
  profile: DimensionProfile = {}
): HealthDimension[] {
  const days = recent ?? [];
  const n = days.length;

  // 睡眠：时长为主（7.5h 满分、4h 零分），睡眠质量作为 ±10 的修正
  const sleepAvg = avg(days.map(d => d.sleepHours));
  const qualityAvg = avg(days.map(d => d.sleepQuality));
  let sleep: number | null = null;
  let sleepBasis = "暂无足够睡眠记录";
  if (sleepAvg != null) {
    sleep = scale(sleepAvg, 7.5, 4);
    if (qualityAvg != null) {
      // 质量 1差/2一般/3好 → -10 / 0 / +10
      sleep = Math.max(
        0,
        Math.min(100, sleep + Math.round((qualityAvg - 2) * 10))
      );
    }
    sleepBasis = `近 ${n} 天平均睡眠 ${sleepAvg.toFixed(1)} 小时${
      qualityAvg != null ? `，质量自评 ${qualityAvg.toFixed(1)}/3` : ""
    }`;
  }

  // 运动：按日均分钟（30min 满分），同时参考有效运动天数占比
  const exAvg = avg(days.map(d => d.exerciseMinutes));
  let exercise: number | null = null;
  let exBasis = "暂无足够运动记录";
  if (exAvg != null) {
    exercise = scale(exAvg, 30, 0);
    const activeDays = days.filter(d => (d.exerciseMinutes ?? 0) >= 10).length;
    exBasis = `日均运动 ${Math.round(exAvg)} 分钟，${n} 天中 ${activeDays} 天有活动`;
  }

  // 压力：1小=好(100) 3大=差(0)，取近 N 天平均
  const stressAvg = avg(days.map(d => d.stressLevel));
  let stress: number | null = null;
  let stressBasis = "暂无足够压力记录";
  if (stressAvg != null) {
    stress = scale(stressAvg, 1, 3);
    stressBasis = `近 ${n} 天平均压力 ${stressAvg.toFixed(1)}/3`;
  }

  // 饮食：规律(good)天数占比 → 0-100
  const dietDays = days.filter(
    d =>
      d.dietRegularity === "good" ||
      d.dietRegularity === "normal" ||
      d.dietRegularity === "poor"
  );
  let diet: number | null = null;
  let dietBasis = "暂无足够饮食记录";
  if (dietDays.length >= MIN_SAMPLES) {
    const good = dietDays.filter(d => d.dietRegularity === "good").length;
    const normal = dietDays.filter(d => d.dietRegularity === "normal").length;
    // good 记 1 分，normal 记 0.6 分
    const ratio = (good + normal * 0.6) / dietDays.length;
    diet = Math.max(0, Math.min(100, Math.round(ratio * 100)));
    dietBasis = `${dietDays.length} 天中 ${good} 天规律、${normal} 天一般`;
  }

  // 作息：就寝时刻越接近 23:00 越高，偏离越多越低（不再"有记录就给 75"）
  let routine: number | null = null;
  let routineBasis = "未填写作息时间";
  const bedtime = profile.bedtime;
  if (bedtime) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(bedtime.trim());
    if (m) {
      let hour = Number(m[1]) + Number(m[2]) / 60;
      if (hour < 12) hour += 24; // 凌晨算前一天深夜
      // 23:00 满分；每偏离 1 小时扣 20 分；偏离 ≥5 小时为 0
      const diff = Math.abs(hour - 23);
      routine = Math.max(0, Math.min(100, Math.round(100 - diff * 20)));
      routineBasis = `日常就寝 ${bedtime}${profile.wakeTime ? `，起床 ${profile.wakeTime}` : ""}`;
    }
  }

  return [
    {
      key: "sleep",
      label: "睡眠健康",
      value: sleep,
      color: "#6366f1",
      basis: sleepBasis
    },
    {
      key: "exercise",
      label: "运动健康",
      value: exercise,
      color: "#16a34a",
      basis: exBasis
    },
    {
      key: "stress",
      label: "压力状态",
      value: stress,
      color: "#f59e0b",
      basis: stressBasis
    },
    {
      key: "diet",
      label: "饮食规律",
      value: diet,
      color: "#0ea5e9",
      basis: dietBasis
    },
    {
      key: "routine",
      label: "作息规律",
      value: routine,
      color: "#8b5cf6",
      basis: routineBasis
    }
  ];
}
