/**
 * 日期工具唯一源码（服务端共享层）。
 *
 * 收敛背景：此前 `fmtDate` 在 health-plan.ts / health-reminder.ts（localDateKey） /
 * health-seed.ts（内联 fmt） / seedStudent.ts / auth.ts 各写一份，共 5 处重复实现，
 * 一旦口径变化只能改一处、其余静默不一致。
 *
 * 口径：按**本地时区**取日历日（用户看到的「今天」）；
 * 加减天在 UTC 上运算以避开时区/夏令时偏移；输入输出均为 `yyyy-MM-dd`。
 */

/** 本地日期 yyyy-MM-dd */
export function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** 「今天」的 yyyy-MM-dd（fmtDate(new Date()) 的语法糖） */
export function todayStr(): string {
  return fmtDate(new Date());
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
  const diff = (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000;
  return diff >= 0 ? Math.round(diff) + 1 : 0;
}

/** 本地日 key（与 fmtDate 同实现，语义化别名：提醒按本地日去重时使用） */
export const localDateKey = (now: Date): string => fmtDate(now);
