/**
 * C6 健康提醒的**轻量调度器**。
 *
 * 运行方式：随服务进程启动（`server/src/index.ts` 在 `initDb()` 之后调用
 * `startReminderScheduler()`），`setInterval` 每 `REMINDER_SCAN_INTERVAL_MS`（30 秒）扫一次，
 * 不引入任何新依赖、不需要独立的守护进程或 cron。
 *
 * 为什么是「轮询 + 落库去重」而不是「到点定时器」：
 * 1. **重启不丢**：提醒设置存在库里，进程重启后下一次扫描就能重新覆盖，不需要在内存里
 *    维护一堆 setTimeout；内存定时器重启即丢，是更差的实现。
 * 2. **补发**：判定用 `isDueToday`（到点**或已过点**），服务在提醒时刻之后才启动也能补上
 *    当天那次，而不是整天不提醒。
 * 3. **幂等靠数据库**：`reminder_notices` 上的 `UNIQUE(user_id, kind, fire_date)` +
 *    `INSERT OR IGNORE`，重复扫描、并发扫描都不会产生第二条——去重逻辑放在约束里，
 *    不靠调度器的状态，因此扫描间隔调快调慢都不会出问题。
 *
 * 已知取舍（如实说明）：进程**未运行**的时段不会发提醒，恢复后按上面的补发规则当天补一次；
 * 这是「站内提醒」的合理语义，接真实推送时应在投递环节补上重试与离线队列。
 */
import db, { ensureReminders } from "./db.js";
import { logger } from "./logger.js";
import {
  REMINDER_SCAN_INTERVAL_MS,
  buildReminderNotice,
  dueReminders,
  localDateKey,
  normalizeReminders
} from "../shared/health-reminder.js";

interface EnabledReminderRow {
  user_id: number;
  kind: string;
  enabled: number;
  time_of_day: string;
}

/**
 * 扫描一次：给所有已到点、今天还没发过的提醒写站内提醒。返回本次**实际新增**的条数。
 *
 * 导出是为了让运维 / 演示脚本能主动触发一次（`npx tsx -e "…scanReminders()"`），
 * 不必等那 30 秒。
 */
export function scanReminders(now: Date = new Date()): number {
  ensureReminders();
  const rows = db
    .prepare(
      "SELECT user_id, kind, enabled, time_of_day FROM user_reminders WHERE enabled = 1"
    )
    .all() as EnabledReminderRow[];
  if (!rows.length) return 0;

  const date = localDateKey(now);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO reminder_notices (user_id, kind, title, content, fire_date)
     VALUES (@user_id, @kind, @title, @content, @fire_date)`
  );

  let fired = 0;
  const tx = db.transaction(() => {
    for (const row of rows) {
      // 复用共享层的 two-step（补齐两个类型 → 筛出到点的），保证与接口展示口径完全一致：
      // 这里传单行，另一类型会按默认值（关闭）补齐并因此被筛掉。
      const due = dueReminders(normalizeReminders([row]), now)[0];
      if (!due) continue;
      const notice = buildReminderNotice(due.kind, due.time);
      if (!notice) continue; // 类型不在目录内：不写库（数据脏，交由路由侧校验拦住新写入）
      const info = insert.run({
        user_id: row.user_id,
        kind: due.kind,
        title: notice.title,
        content: notice.content,
        fire_date: date
      });
      if (info.changes) fired += 1;
    }
  });
  tx();

  if (fired) logger.info(`[reminder] 写入站内提醒 ${fired} 条（${date}）`);
  return fired;
}

/**
 * 启动调度器：立即扫一次（补发用），随后按固定间隔轮询。
 * 定时器 `unref()`，不会拖住进程退出（`pnpm test` / 脚本里 import 本模块也不会有副作用，
 * 因为只有显式调用 `startReminderScheduler()` 才会起定时器）。
 */
export function startReminderScheduler(): NodeJS.Timeout {
  const safeScan = () => {
    try {
      scanReminders();
    } catch (err) {
      // 提醒失败不能影响主服务：记错误继续跑，下次扫描再试
      logger.error(`[reminder] 扫描失败：${(err as Error).message}`);
    }
  };

  safeScan();
  const timer = setInterval(safeScan, REMINDER_SCAN_INTERVAL_MS);
  timer.unref();
  logger.info(
    `[reminder] 调度器已启动：每 ${REMINDER_SCAN_INTERVAL_MS / 1000} 秒扫描一次（站内渠道）`
  );
  return timer;
}
