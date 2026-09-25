/**
 * 日期工具唯一源码（前端）。
 *
 * 收敛背景：此前 `fmtDate` 在 trend / report / import / dashboard 四个页面各写一份，
 * 与后端 `server/shared/date-utils.ts` 的实现逐字重复。口径要变（例如改 UTC）时
 * 必须同时改 5 处，漏一处就是静默的数据错位。
 *
 * 口径与后端保持一致：本地时区取日历日，加减天在 UTC 上运算，格式 `yyyy-MM-dd`。
 */

/** 本地日期 yyyy-MM-dd */
export function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** 「今天」的 yyyy-MM-dd */
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
  const diff = Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad);
  return diff < 0 ? 0 : Math.round(diff / 86400000) + 1;
}

/** 最近 n 天日期区间（含今天） */
export function lastNDays(n: number): [string, string] {
  const end = new Date();
  const start = new Date(Date.now() - (n - 1) * 86400000);
  return [fmtDate(start), fmtDate(end)];
}
