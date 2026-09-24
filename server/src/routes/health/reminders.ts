/**
 * C6 健康提醒：`GET/PUT /api/health/reminders`。
 *
 * 面向**用户自己**（任何已登录用户，只能读写自己的提醒，无 user_id 入参）：
 * - GET 返回两个提醒类型（测量 / 打卡）的设置、今日已发的站内提醒、投递渠道清单与口径说明；
 * - PUT 按类型开/关并设置每日时刻，校验通过后写 `user_reminders`。
 *
 * 时刻校验、默认值、到点判定与站内提醒文案**全部来自共享层** `@shared/health-reminder`，
 * 本文件只负责读写库与拼响应；调度器（`server/src/reminder-scheduler.ts`）用的是同一份
 * `dueReminders` / `buildReminderNotice`，两端不会各算一套。
 *
 * 提醒属于个人偏好，**不在 C5 点名的六类关键操作之内，因此不写审计日志**：
 * 审计目录（`AUDIT_ACTIONS`）是「关键操作」的白名单，把偏好类设置混进去会稀释审计页的
 * 筛选价值，也会让目录随功能增加而无限膨胀。
 */
import { Router } from "express";
import db, { ensureReminders } from "../../db.js";
import { authMiddleware } from "../../middleware/auth.js";
import {
  ACTIVE_REMINDER_CHANNEL,
  DEFAULT_REMINDER_TIMES,
  REMINDER_CHANNELS,
  REMINDER_NOTE,
  REMINDER_SCHEDULE_NOTE,
  TIME_OF_DAY_HINT,
  isReminderKind,
  localDateKey,
  localTimeKey,
  nextFireText,
  normalizeReminders,
  normalizeTimeOfDay
} from "../../../shared/health-reminder.js";

const router = Router();

interface ReminderRow {
  kind: string;
  enabled: number;
  time_of_day: string;
  update_time: string | null;
}

/** 站内提醒行（列名在这里就转成 camelCase，前端与审计页的字段风格保持一致） */
interface NoticeRow {
  id: number;
  kind: string;
  title: string;
  content: string;
  fireDate: string;
  createTime: string;
}

/** 读该用户的提醒设置行（缺行 = 未开启，由共享层 `normalizeReminders` 补齐两个类型） */
function settingRows(userId: number): ReminderRow[] {
  ensureReminders();
  return db
    .prepare(
      "SELECT kind, enabled, time_of_day, update_time FROM user_reminders WHERE user_id = ?"
    )
    .all(userId) as ReminderRow[];
}

/** 读该用户某一天的站内提醒（user_id + 日期双重限定，不存在跨用户读取路径） */
function noticeRows(userId: number, date: string): NoticeRow[] {
  ensureReminders();
  return db
    .prepare(
      `SELECT id, kind, title, content,
              fire_date AS fireDate, create_time AS createTime
       FROM reminder_notices
       WHERE user_id = ? AND fire_date = ?
       ORDER BY id DESC`
    )
    .all(userId, date) as NoticeRow[];
}

/** 提醒设置响应（GET / PUT 同结构，前端 PUT 后可直接用返回值刷新页面） */
function reminderPayload(userId: number, now: Date = new Date()) {
  const rows = settingRows(userId);
  const today = localDateKey(now);
  const notices = noticeRows(userId, today);
  const firedKinds = new Set(notices.map(n => n.kind));

  return {
    settings: normalizeReminders(rows).map(s => ({
      ...s,
      /** 今日是否已提醒（页面对已开启项显示「今日已提醒」而不是再报下次时间） */
      firedToday: s.enabled && firedKinds.has(s.kind),
      /** 下次提醒时刻文案：未到点=今日，已过点=明日 */
      nextFireText: nextFireText(s.time, now)
    })),
    /** 今日站内提醒（站内渠道，按时间倒序） */
    notices,
    channels: REMINDER_CHANNELS,
    /** 当前唯一已开通的渠道 */
    activeChannel: ACTIVE_REMINDER_CHANNEL,
    /** 是否从未设置过（前端据此说明「当前为默认关闭」） */
    configured: rows.length > 0,
    updateTime: rows.reduce(
      (latest: string, r) =>
        r.update_time && r.update_time > latest ? r.update_time : latest,
      ""
    ),
    /** 服务端本地时刻：演示时用来对齐「为什么现在会/不会触发」 */
    serverTime: localTimeKey(now),
    note: REMINDER_NOTE,
    scheduleNote: REMINDER_SCHEDULE_NOTE,
    timeHint: TIME_OF_DAY_HINT
  };
}

/** GET /api/health/reminders —— 我的提醒设置 + 今日站内提醒 + 渠道清单 */
router.get("/health/reminders", authMiddleware, (req, res) => {
  res.json({
    code: 0,
    message: "操作成功",
    data: reminderPayload(req.user!.id)
  });
});

/**
 * PUT /api/health/reminders —— 开 / 关某类提醒并设置每日时刻。
 *
 * 入参：`{ kind, enabled, time? }`
 * - `kind` 必须是 measure / checkin，否则 400（不静默忽略未知类型）；
 * - `enabled` 必须是布尔（也接受 1 / 0 / "1" / "0"），缺失或非法 → 400（不静默按 false 处理）；
 * - `time` 可省略（沿用库内值，没有则用该类型默认时刻）；给了就必须是合法的 `HH:mm`，
 *   否则 400 —— 时刻是提醒的唯一有效载荷，存进非法值等于这条提醒永远不会触发。
 */
router.put("/health/reminders", authMiddleware, (req, res) => {
  const userId = req.user!.id;
  const body = (req.body ?? {}) as Record<string, unknown>;

  // 越权防护：本接口只操作 token 身份的数据，不接受指定归属。显式传入他人 id 时按
  // 「资源不存在」处理（404 而非 403 —— 不用状态码泄露该 id 究竟是否存在）。
  const rawOwner = body.userId ?? body.user_id ?? body.userid;
  if (rawOwner !== undefined && String(rawOwner) !== String(userId)) {
    res.status(404).json({ code: 404, message: "提醒设置不存在" });
    return;
  }

  const kind = body.kind;
  if (typeof kind !== "string" || !isReminderKind(kind)) {
    res
      .status(400)
      .json({ code: 40001, message: "字段 kind 需为 measure / checkin" });
    return;
  }

  if (!Object.prototype.hasOwnProperty.call(body, "enabled")) {
    res.status(400).json({ code: 40001, message: "字段 enabled 不能为空" });
    return;
  }
  const rawEnabled = body.enabled;
  const acceptableEnabled =
    typeof rawEnabled === "boolean" ||
    rawEnabled === 0 ||
    rawEnabled === 1 ||
    rawEnabled === "0" ||
    rawEnabled === "1";
  if (!acceptableEnabled) {
    res.status(400).json({ code: 40001, message: "字段 enabled 需为布尔值" });
    return;
  }
  const enabled = rawEnabled === true || rawEnabled === 1 || rawEnabled === "1";

  const current = settingRows(userId).find(r => r.kind === kind);
  const rawTime = body.time;
  let time: string;
  if (rawTime === undefined || rawTime === null || rawTime === "") {
    time =
      normalizeTimeOfDay(current?.time_of_day) ?? DEFAULT_REMINDER_TIMES[kind];
  } else {
    const parsed = normalizeTimeOfDay(rawTime);
    if (!parsed) {
      res.status(400).json({
        code: 40001,
        message: `字段 time 需为合法时刻（${TIME_OF_DAY_HINT}）`
      });
      return;
    }
    time = parsed;
  }

  const before = current
    ? { enabled: current.enabled === 1, time: current.time_of_day }
    : null;
  const changed = !before || before.enabled !== enabled || before.time !== time;

  if (changed) {
    ensureReminders();
    db.prepare(
      `INSERT INTO user_reminders (user_id, kind, enabled, time_of_day, update_time)
       VALUES (@user_id, @kind, @enabled, @time_of_day, datetime('now','localtime'))
       ON CONFLICT(user_id, kind) DO UPDATE SET
         enabled = excluded.enabled,
         time_of_day = excluded.time_of_day,
         update_time = excluded.update_time`
    ).run({
      user_id: userId,
      kind,
      enabled: enabled ? 1 : 0,
      time_of_day: time
    });
  }

  res.json({
    code: 0,
    message: "操作成功",
    data: { ...reminderPayload(userId), changed }
  });
});

export default router;
