/**
 * C6 健康提醒：**唯一源码**（纯函数，禁 Node / DOM 依赖）。
 *
 * 分工：
 * - `REMINDER_KINDS` / `REMINDER_LABELS` / `REMINDER_KIND_OPTIONS`：提醒类型目录与中文文案。
 *   后端只接受目录内的类型，前端表单的选项与文案都取自这里（加类型只改这一处）。
 * - `normalizeTimeOfDay` / `isValidTimeOfDay` / `minutesOfDay`：每日定时时刻的**校验与归一化**。
 *   接受 `8:00` / `08:00` / 全角冒号，统一存成 `HH:mm`；非法返回 null（路由据此 400）。
 * - `isDueToday` / `nextFireAt` / `nextFireText` / `dueReminders`：调度口径。**同一份判定**既给
 *   服务端调度器选行用，也给前端展示「今日是否已到点 / 下次何时提醒」用，两端不会各算一套。
 * - `buildReminderNotice`：站内提醒的标题与正文文案（纯函数，可单测）。
 * - `REMINDER_CHANNELS`：投递渠道清单。站内已开通，邮件 / 短信**声明为未开通**——这就是
 *   「未来接真实推送的接口位」：接入时新增一个渠道实现即可，设置数据与接口形状都不用改。
 *
 * 前端经 `@shared` 别名引用，后端经相对路径引用。
 */

// ---------- 提醒类型目录 ----------

/** 提醒类型（顺序即前端表单顺序） */
export const REMINDER_KINDS = ["measure", "checkin"] as const;

export type ReminderKind = (typeof REMINDER_KINDS)[number];

/** 类型 → 中文文案 */
export const REMINDER_LABELS: Record<ReminderKind, string> = {
  measure: "测量提醒",
  checkin: "打卡提醒"
};

/** 类型 → 用途说明（前端表单里的一句话解释） */
export const REMINDER_DESCRIPTIONS: Record<ReminderKind, string> = {
  measure: "每天到点提醒你测量并记录血压、血糖等指标",
  checkin: "每天到点提醒你完成健康行动计划的打卡"
};

/** 是否为目录内的合法类型 */
export function isReminderKind(kind: string): kind is ReminderKind {
  return (REMINDER_KINDS as readonly string[]).includes(kind);
}

/** 前端表单 / 筛选用的类型选项 */
export const REMINDER_KIND_OPTIONS = REMINDER_KINDS.map(value => ({
  value,
  label: REMINDER_LABELS[value]
}));

/** 提醒默认值：**关闭**（缺失行 = 未开启，故老数据零迁移） */
export const DEFAULT_REMINDER_ENABLED = false;

/** 各类型的默认时刻（仅在用户从未设置过、又直接开启时作为初值） */
export const DEFAULT_REMINDER_TIMES: Record<ReminderKind, string> = {
  measure: "08:00",
  checkin: "20:00"
};

/** 默认时刻的兜底值（类型未知时用） */
export const DEFAULT_REMINDER_TIME = "08:00";

// ---------- 每日定时时刻：校验与归一化 ----------

/**
 * 时刻的合法形式：1~2 位小时 + 冒号 + 2 位分钟。
 * 冒号同时接受半角 `:` 与全角 `：`（移动端中文输入法容易打出全角，直接报错体验差）。
 */
const TIME_OF_DAY_RE = /^(\d{1,2})\s*[:：]\s*(\d{2})$/;

/**
 * 归一到 `HH:mm`；非法返回 null。
 * 合法范围：00:00 ~ 23:59（`24:00` 视为非法——它不是一天中的某个时刻）。
 */
export function normalizeTimeOfDay(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = TIME_OF_DAY_RE.exec(value.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** 时刻是否合法（前端即时校验、路由入参校验共用同一判定） */
export function isValidTimeOfDay(value: unknown): boolean {
  return normalizeTimeOfDay(value) !== null;
}

/** 时刻的合法区间文案（错误提示里直接引用，避免文案与实现脱节） */
export const TIME_OF_DAY_HINT = "00:00 ~ 23:59，形如 08:00";

/** 一天中的分钟数（用于比较排序）；非法返回 null */
export function minutesOfDay(value: unknown): number | null {
  const t = normalizeTimeOfDay(value);
  if (!t) return null;
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m);
}

// ---------- 本地日 / 时刻口径 ----------

/** 本地日期 yyyy-MM-dd（站内提醒按**本地日**去重，跨时区不共用一条） */
export function localDateKey(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
}

/** 本地时刻 HH:mm（与 `normalizeTimeOfDay` 输出同口径，可直接比较） */
export function localTimeKey(now: Date): string {
  return `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes()
  ).padStart(2, "0")}`;
}

/**
 * 今天是否已到点。
 *
 * 口径是「**到点或已过点**」（`<=` 而非 `==`）：调度器按分钟扫描，用相等判定会漏掉
 * 服务在提醒时刻之后才启动的情况。补发语义与去重约束（同一天同一类型一条）配合，
 * 既不会重复提醒，也不会整天不提醒。详见 `REMINDER_SCHEDULE_NOTE`。
 */
export function isDueToday(time: unknown, now: Date = new Date()): boolean {
  const target = minutesOfDay(time);
  if (target === null) return false;
  const current = minutesOfDay(localTimeKey(now));
  return current !== null && target <= current;
}

/** 下一次触发时刻：今日未到点取今日，已过点取明日 */
export function nextFireAt(time: unknown, now: Date = new Date()): Date | null {
  const target = minutesOfDay(time);
  if (target === null) return null;
  const at = new Date(now);
  at.setHours(Math.floor(target / 60), target % 60, 0, 0);
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  return at;
}

/** 下次触发时刻的展示文案（`今日 20:00` / `明日 08:00`；非法时刻返回空串） */
export function nextFireText(time: unknown, now: Date = new Date()): string {
  const t = normalizeTimeOfDay(time);
  if (!t) return "";
  return `${isDueToday(t, now) ? "明日" : "今日"} ${t}`;
}

// ---------- 提醒设置 ----------

/** 单条提醒设置（一个用户每个类型一条） */
export interface ReminderSetting {
  kind: ReminderKind;
  /** 是否开启（默认 false） */
  enabled: boolean;
  /** 每日提醒时刻 HH:mm */
  time: string;
}

/** 设置行的库内形状（由路由 / 调度器组装；本文件不碰数据库） */
export interface ReminderSettingRow {
  kind: string;
  enabled?: number | boolean | null;
  time_of_day?: string | null;
}

/** 库内取值口径化：1 / "1" / true 视为开启，其余（含 null）视为关闭 */
function enabledOf(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

/**
 * 把库行拼成**完整的**两条设置：缺失的类型按默认值补齐（关闭 + 各类型默认时刻）。
 *
 * 这样前端永远拿到两个类型，不需要自己补空行；同时「没有行 = 未开启」与
 * `DEFAULT_REMINDER_ENABLED = false` 严格一致，老库新库都能直接读。
 */
export function normalizeReminders(
  rows: readonly ReminderSettingRow[] = []
): ReminderSetting[] {
  const byKind = new Map<string, ReminderSettingRow>();
  for (const row of rows) {
    if (isReminderKind(row.kind)) byKind.set(row.kind, row);
  }
  return REMINDER_KINDS.map(kind => {
    const row = byKind.get(kind);
    return {
      kind,
      enabled: row ? enabledOf(row.enabled) : DEFAULT_REMINDER_ENABLED,
      time: normalizeTimeOfDay(row?.time_of_day) ?? DEFAULT_REMINDER_TIMES[kind]
    };
  });
}

/** 已到点、需要发提醒的设置（调度器选行用；纯函数，可单测） */
export function dueReminders(
  settings: readonly ReminderSetting[],
  now: Date = new Date()
): ReminderSetting[] {
  return settings.filter(s => s.enabled && isDueToday(s.time, now));
}

// ---------- 站内提醒文案 ----------

/** 一条站内提醒（写入前由 `buildReminderNotice` 生成，标题正文都在共享层） */
export interface ReminderNoticeDraft {
  title: string;
  content: string;
}

/** 站内提醒的标题与正文（纯函数；类型未知时返回 null，调用方不写库） */
export function buildReminderNotice(
  kind: string,
  time: unknown
): ReminderNoticeDraft | null {
  if (!isReminderKind(kind)) return null;
  const t = normalizeTimeOfDay(time) ?? DEFAULT_REMINDER_TIME;
  const body =
    kind === "measure"
      ? "记得测量并记录今天的血压、血糖等指标，数据连续才有趋势可看。"
      : "记得完成今天的行动计划打卡，连续打卡会体现在报告的计划完成率里。";
  return {
    title: `${REMINDER_LABELS[kind]}（${t}）`,
    content: `到点提醒：${body}`
  };
}

// ---------- 投递渠道（未来接真实推送的接口位） ----------

/** 一条投递渠道 */
export interface ReminderChannel {
  key: string;
  label: string;
  /** 当前是否可用（未开通的渠道在页面上如实标注，不假装能收到） */
  available: boolean;
  description: string;
}

/**
 * 渠道清单。**站内渠道已开通**；邮件 / 短信声明为未开通并说明依赖。
 *
 * 这就是「未来接真实推送的接口位」：接入时把对应渠道的 `available` 改为 true 并实现投递，
 * 提醒设置的数据结构、读写接口与页面形状都不需要改动。
 */
export const REMINDER_CHANNELS: readonly ReminderChannel[] = [
  {
    key: "station",
    label: "站内提醒",
    available: true,
    description: "到点后写入站内提醒，登录后在行动计划的提醒设置区可见"
  },
  {
    key: "email",
    label: "邮件提醒",
    available: false,
    description: "需接入邮件发送服务，当前未开通"
  },
  {
    key: "sms",
    label: "短信提醒",
    available: false,
    description: "需接入短信网关，当前未开通"
  }
];

/** 当前唯一已开通的渠道 */
export const ACTIVE_REMINDER_CHANNEL = "station";

/** 调度扫描间隔（毫秒）。与 `REMINDER_SCHEDULE_NOTE` 的文案保持一致 */
export const REMINDER_SCAN_INTERVAL_MS = 30_000;

/** 渠道与演示口径说明（页面直接展示，说明「这是演示用站内提醒」） */
export const REMINDER_NOTE =
  "演示用站内提醒：提醒到点后由服务端写入一条站内提醒记录，登录后在下方「今日提醒」区可见。当前仅开通站内渠道，邮件与短信渠道已在渠道清单中预留；接入真实推送时只需实现对应渠道的投递，提醒设置与接口形状都不变。";

/** 调度语义说明（诚实交代扫描方式与补发行为） */
export const REMINDER_SCHEDULE_NOTE =
  "提醒由服务端轻量调度器随服务进程扫描（每 30 秒一次）：到点后写入一条站内提醒。若服务在提醒时刻之后才启动，会在当天首次扫描时补发一次——同一用户、同一类型、同一天只会有一条提醒，不会重复。";
