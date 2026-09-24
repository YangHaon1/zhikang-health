/**
 * 健康行动计划路由（C1：计划 / 任务 / 打卡闭环）。
 * 覆盖：GET/POST /api/health/plans、GET /api/health/plans/today、
 *      GET/PUT /api/health/plans/:id、GET /api/health/plans/:id/progress、
 *      POST /api/health/tasks/:id/checkin。
 * 数据隔离：所有查询均带 `user_id` 归属条件；任务与打卡的归属经 plan → user 链路校验，
 * 跨用户访问一律 404（不泄露存在性）。
 * 完成率口径唯一来源：server/shared/health-plan.ts 的 planProgress（与报告共用，保证一致）。
 */
import { Router } from "express";
import db from "../../db.js";
import { authMiddleware } from "../../middleware/auth.js";
import {
  PLAN_FREQUENCIES,
  PLAN_TASK_TYPES,
  planProgress,
  streakOf,
  completionAdvice,
  fmtDate,
  addDays
} from "../../../shared/health-plan.js";
import type {
  HealthPlan,
  HealthPlanTask,
  PlanCompletion,
  PlanFrequency,
  PlanStatus,
  PlanTaskType
} from "../../../shared/health-plan.js";
import { parseId, toText, toNumber } from "./common.js";

const router = Router();

// ---------- 行类型 ----------

interface PlanRow {
  id: number;
  user_id: number;
  title: string;
  risk_key: string;
  target_value: number | null;
  start_date: string;
  end_date: string;
  status: string;
  source: string;
  create_time: string | null;
}

interface TaskRow {
  id: number;
  plan_id: number;
  title: string;
  task_type: string;
  frequency: string;
  sort_order: number;
}

interface CheckinRow {
  id: number;
  task_id: number;
  value: string | null;
  note: string | null;
  checked_date: string;
}

/** 本地日期 yyyy-MM-dd */
function localToday(): string {
  return fmtDate(new Date());
}

/** 任务行 → 前端任务对象 */
function toTask(row: TaskRow): HealthPlanTask {
  return {
    id: row.id,
    title: row.title,
    taskType: row.task_type as PlanTaskType,
    frequency: row.frequency as PlanFrequency,
    sortOrder: row.sort_order
  };
}

/** 计划行 + 任务 + 打卡 → 前端计划对象（附进度） */
function toPlan(row: PlanRow, today: string): HealthPlan {
  const tasks = db
    .prepare(
      `SELECT id, plan_id, title, task_type, frequency, sort_order
       FROM plan_tasks WHERE plan_id = ? ORDER BY sort_order, id`
    )
    .all(row.id) as TaskRow[];

  const checkins = db
    .prepare(
      `SELECT id, task_id, value, note, checked_date FROM task_checkins
       WHERE user_id = ? AND task_id IN (${tasks.map(() => "?").join(",") || "NULL"})
       ORDER BY checked_date`
    )
    .all(row.user_id, ...tasks.map(t => t.id)) as CheckinRow[];

  const progress =
    tasks.length > 0
      ? planProgress(
          row.id,
          tasks.map(t => ({
            id: t.id,
            frequency: t.frequency as PlanFrequency,
            title: t.title
          })),
          checkins.map(c => ({
            taskId: c.task_id,
            checkedDate: c.checked_date
          })),
          row.start_date,
          row.end_date,
          today
        )
      : null;

  return {
    id: row.id,
    title: row.title,
    riskKey: row.risk_key,
    targetValue: row.target_value,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status as PlanStatus,
    source: row.source,
    createTime: row.create_time ?? "",
    tasks: tasks.map(toTask),
    progress
  };
}

/** 查询计划行（归属校验，查不到返回 undefined） */
function findPlan(id: number, userId: number): PlanRow | undefined {
  return db
    .prepare(
      `SELECT id, user_id, title, risk_key, target_value, start_date, end_date, status, source, create_time
       FROM health_plans WHERE id = ? AND user_id = ?`
    )
    .get(id, userId) as PlanRow | undefined;
}

/** 查询任务行（含归属校验：任务 → 计划 → 用户） */
function findOwnedTask(taskId: number, userId: number): TaskRow | undefined {
  return db
    .prepare(
      `SELECT t.id, t.plan_id, t.title, t.task_type, t.frequency, t.sort_order
       FROM plan_tasks t JOIN health_plans p ON p.id = t.plan_id
       WHERE t.id = ? AND p.user_id = ?`
    )
    .get(taskId, userId) as TaskRow | undefined;
}

// ---------- 创建计划（POST /api/health/plans） ----------

/**
 * POST /api/health/plans —— 创建行动计划（含任务列表，事务写入）。
 * 入参：{ title, riskKey, targetValue?, startDate, endDate, source?, tasks: [{title, taskType, frequency}] }
 * 校验：必填字段齐全、日期合法（start ≤ end）、任务 ≥1、枚举白名单。
 */
router.post("/health/plans", authMiddleware, (req, res) => {
  const userId = req.user!.id;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const title = toText(body.title).trim();
  const riskKey = toText(body.riskKey).trim();
  const startDate = toText(body.startDate).trim();
  const endDate = toText(body.endDate).trim();
  const source = ["manual", "ai_coach"].includes(toText(body.source))
    ? toText(body.source)
    : "rule";
  const targetValue =
    body.targetValue === null ||
    body.targetValue === undefined ||
    body.targetValue === ""
      ? null
      : toNumber(body.targetValue);

  const rawTasks = Array.isArray(body.tasks) ? body.tasks : [];
  if (!title || !riskKey || !startDate || !endDate) {
    res
      .status(400)
      .json({ code: 40001, message: "标题、风险类型、开始/结束日期为必填项" });
    return;
  }
  if (startDate > endDate) {
    res.status(400).json({ code: 40001, message: "开始日期不能晚于结束日期" });
    return;
  }
  if (rawTasks.length === 0) {
    res.status(400).json({ code: 40001, message: "至少需要一个任务" });
    return;
  }

  // ⚠️ C7 修：任务校验与后面的写库必须在**同一个 try** 里。原先 `try` 从 insertPlan 才开始，
  // 而这里的 `throw {code:40001}` 落在 try 之外，于是「任务类型/频率不合法」这种客户端错误
  // 会一路冒泡到兜底错误处理，返回 500「服务内部错误」，并在错误日志里留下一条假告警；
  // catch 里那段 `typeof e.code === "number" → 400` 也就成了永远走不到的死代码。
  try {
    const taskTypeSet = new Set<string>(PLAN_TASK_TYPES.map(t => t.value));
    const freqSet = new Set<string>(PLAN_FREQUENCIES.map(f => f.value));
    const tasks = rawTasks.slice(0, 30).map((t, i) => {
      const task = (t ?? {}) as Record<string, unknown>;
      const taskType = toText(task.taskType);
      const frequency = toText(task.frequency);
      if (!taskTypeSet.has(taskType) || !freqSet.has(frequency)) {
        throw { code: 40001, message: `任务 ${i + 1} 的类型或频率不合法` };
      }
      return {
        title: toText(task.title).trim() || `任务 ${i + 1}`,
        taskType: taskType as PlanTaskType,
        frequency: frequency as PlanFrequency,
        sortOrder: i
      };
    });

    const insertPlan = db.prepare(
      `INSERT INTO health_plans (user_id, title, risk_key, target_value, start_date, end_date, status, source, create_time)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, datetime('now','localtime'))`
    );
    const insertTask = db.prepare(
      `INSERT INTO plan_tasks (plan_id, title, task_type, frequency, sort_order)
       VALUES (?, ?, ?, ?, ?)`
    );
    const planId = db.transaction(() => {
      const info = insertPlan.run(
        userId,
        title,
        riskKey,
        targetValue,
        startDate,
        endDate,
        source
      );
      const pid = Number(info.lastInsertRowid);
      for (const t of tasks)
        insertTask.run(pid, t.title, t.taskType, t.frequency, t.sortOrder);
      return pid;
    })();

    const row = findPlan(planId, userId)!;
    res.json({ code: 0, message: "操作成功", data: toPlan(row, localToday()) });
  } catch (err) {
    const e = err as { code?: number; message?: string };
    if (typeof e.code === "number") {
      res
        .status(400)
        .json({ code: e.code, message: e.message ?? "参数不合法" });
      return;
    }
    throw err;
  }
});

// ---------- 计划列表 / 今日待完成 ----------

/**
 * GET /api/health/plans —— 当前用户的计划列表（按创建时间倒序，附实时进度）。
 * ⚠️ 必须注册在 /health/plans/:id 之前，否则会被 :id 抢走匹配。
 */
router.get("/health/plans", authMiddleware, (req, res) => {
  const userId = req.user!.id;
  const rows = db
    .prepare(
      `SELECT id, user_id, title, risk_key, target_value, start_date, end_date, status, source, create_time
       FROM health_plans WHERE user_id = ? ORDER BY id DESC`
    )
    .all(userId) as PlanRow[];
  const today = localToday();
  res.json({
    code: 0,
    message: "操作成功",
    data: rows.map(row => toPlan(row, today))
  });
});

/**
 * GET /api/health/plans/today —— 今日待完成：
 * 当前用户 active 且今天落在计划期内 → 返回每个任务及今日是否已打卡 + 连续打卡天数。
 * 前端首页「今日待完成」与「连续打卡」用这一个接口。
 */
router.get("/health/plans/today", authMiddleware, (req, res) => {
  const userId = req.user!.id;
  const today = localToday();
  const rows = db
    .prepare(
      `SELECT id, user_id, title, risk_key, target_value, start_date, end_date, status, source, create_time
       FROM health_plans
       WHERE user_id = ? AND status = 'active' AND start_date <= ? AND end_date >= ?
       ORDER BY id DESC`
    )
    .all(userId, today, today) as PlanRow[];

  const result = rows.map(row => {
    const tasks = db
      .prepare(
        `SELECT id, plan_id, title, task_type, frequency, sort_order
         FROM plan_tasks WHERE plan_id = ? ORDER BY sort_order, id`
      )
      .all(row.id) as TaskRow[];
    // 按任务分别记录打卡日期（避免「一个任务打卡后所有任务都显示已完成」）
    const checkinRows = db
      .prepare(
        `SELECT task_id, checked_date FROM task_checkins
         WHERE user_id = ? AND task_id IN (${tasks.map(() => "?").join(",") || "NULL"})`
      )
      .all(userId, ...tasks.map(t => t.id)) as Array<{
      task_id: number;
      checked_date: string;
    }>;
    const doneByTask = new Map<number, Set<string>>();
    for (const c of checkinRows) {
      const s = doneByTask.get(c.task_id) ?? new Set<string>();
      s.add(c.checked_date);
      doneByTask.set(c.task_id, s);
    }
    const progress = planProgress(
      row.id,
      tasks.map(t => ({
        id: t.id,
        frequency: t.frequency as PlanFrequency,
        title: t.title
      })),
      checkinRows.map(c => ({
        taskId: c.task_id,
        checkedDate: c.checked_date
      })),
      row.start_date,
      row.end_date,
      today
    );
    return {
      plan: toPlan(row, today),
      tasks: tasks.map(t => ({
        ...toTask(t),
        checkedToday: doneByTask.get(t.id)?.has(today) ?? false,
        lastCheckedDate: lastChecked(doneByTask.get(t.id) ?? new Set(), today)
      })),
      streakDays: progress.streakDays
    };
  });

  res.json({ code: 0, message: "操作成功", data: result });
});

/** 最近一次打卡日期（不含今天；今天已打卡则返回今天） */
function lastChecked(dateSet: Set<string>, today: string): string {
  if (dateSet.has(today)) return today;
  for (let i = 1; i <= 30; i++) {
    const d = addDays(today, -i);
    if (dateSet.has(d)) return d;
  }
  return "";
}

// ---------- 计划详情 / 更新 / 进度 ----------

/** GET /api/health/plans/:id —— 计划详情（含任务与进度；非本人 404） */
router.get("/health/plans/:id", authMiddleware, (req, res) => {
  const id = parseId(req.params.id);
  const row = id === null ? undefined : findPlan(id, req.user!.id);
  if (!row) {
    res.status(404).json({ code: 404, message: "计划不存在" });
    return;
  }
  res.json({ code: 0, message: "操作成功", data: toPlan(row, localToday()) });
});

/**
 * PUT /api/health/plans/:id —— 更新计划基础字段或状态。
 * 入参：{ title?, riskKey?, targetValue?, startDate?, endDate?, status? }（status: active|completed|stopped）
 * 任务列表不在此接口修改（避免误删打卡记录）；非本人 404。
 */
router.put("/health/plans/:id", authMiddleware, (req, res) => {
  const id = parseId(req.params.id);
  const row = id === null ? undefined : findPlan(id, req.user!.id);
  if (id === null || !row) {
    res.status(404).json({ code: 404, message: "计划不存在" });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const statusRaw = toText(body.status);
  const status =
    statusRaw && ["active", "completed", "stopped"].includes(statusRaw)
      ? (statusRaw as PlanStatus)
      : row.status;
  const title = toText(body.title).trim() || row.title;
  const riskKey = toText(body.riskKey).trim() || row.risk_key;
  const startDate = toText(body.startDate).trim() || row.start_date;
  const endDate = toText(body.endDate).trim() || row.end_date;
  const targetValue =
    body.targetValue === undefined
      ? row.target_value
      : body.targetValue === null || body.targetValue === ""
        ? null
        : toNumber(body.targetValue);

  if (startDate > endDate) {
    res.status(400).json({ code: 40001, message: "开始日期不能晚于结束日期" });
    return;
  }

  db.prepare(
    `UPDATE health_plans
     SET title = ?, risk_key = ?, target_value = ?, start_date = ?, end_date = ?, status = ?
     WHERE id = ? AND user_id = ?`
  ).run(
    title,
    riskKey,
    targetValue,
    startDate,
    endDate,
    status,
    id,
    req.user!.id
  );

  res.json({
    code: 0,
    message: "操作成功",
    data: toPlan(findPlan(id, req.user!.id)!, localToday())
  });
});

/** GET /api/health/plans/:id/progress —— 计划进度（与报告完成率同口径） */
router.get("/health/plans/:id/progress", authMiddleware, (req, res) => {
  const id = parseId(req.params.id);
  const row = id === null ? undefined : findPlan(id, req.user!.id);
  if (!row) {
    res.status(404).json({ code: 404, message: "计划不存在" });
    return;
  }
  const tasks = db
    .prepare(
      `SELECT id, plan_id, title, task_type, frequency, sort_order
       FROM plan_tasks WHERE plan_id = ? ORDER BY sort_order, id`
    )
    .all(row.id) as TaskRow[];
  const checkins = db
    .prepare(
      `SELECT id, task_id, value, note, checked_date FROM task_checkins
       WHERE user_id = ? AND task_id IN (${tasks.map(() => "?").join(",") || "NULL"})
       ORDER BY checked_date`
    )
    .all(req.user!.id, ...tasks.map(t => t.id)) as CheckinRow[];

  const progress = planProgress(
    row.id,
    tasks.map(t => ({
      id: t.id,
      frequency: t.frequency as PlanFrequency,
      title: t.title
    })),
    checkins.map(c => ({ taskId: c.task_id, checkedDate: c.checked_date })),
    row.start_date,
    row.end_date,
    localToday()
  );
  res.json({ code: 0, message: "操作成功", data: progress });
});

// ---------- 打卡（POST /api/health/tasks/:id/checkin） ----------

/**
 * POST /api/health/tasks/:id/checkin —— 任务打卡。
 * 入参：{ value?, note?, date? }（date 默认今天，禁止未来日期）。
 * 同一用户同一任务同一天只能打一次：UNIQUE(user_id, task_id, checked_date) 兜底，重复返回 40002。
 * 任务归属经 plan → user 链路校验，跨用户 404。
 */
router.post("/health/tasks/:id/checkin", authMiddleware, (req, res) => {
  const userId = req.user!.id;
  const taskId = parseId(req.params.id);
  const task = taskId === null ? undefined : findOwnedTask(taskId, userId);
  if (!task) {
    res.status(404).json({ code: 404, message: "任务不存在" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const today = localToday();
  const checkedDate = toText(body.date).trim() || today;
  if (checkedDate > today) {
    res.status(400).json({ code: 40001, message: "不能为未来日期打卡" });
    return;
  }

  const value = toText(body.value);
  const note = toText(body.note);
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO task_checkins (user_id, task_id, value, note, checked_date, create_time)
       VALUES (?, ?, ?, ?, ?, datetime('now','localtime'))`
    )
    .run(userId, taskId, value, note, checkedDate);

  if (info.changes === 0) {
    res.status(400).json({
      code: 40002,
      message: `该任务 ${checkedDate} 已完成打卡，不能重复打卡`
    });
    return;
  }

  res.json({
    code: 0,
    message: "操作成功",
    data: { taskId, checkedDate, streakDays: todayStreak(userId) }
  });
});

/** 当前用户整体连续打卡天数（跨计划、按天去重） */
function todayStreak(userId: number): number {
  const rows = db
    .prepare(
      `SELECT DISTINCT checked_date FROM task_checkins WHERE user_id = ?`
    )
    .all(userId) as Array<{ checked_date: string }>;
  return streakOf(new Set(rows.map(r => r.checked_date)), localToday());
}

/** 报告页用：按计划 + 时间窗口计算完成情况（与 progress 接口同一口径） */
export function planCompletionIn(
  userId: number,
  startDate: string,
  endDate: string,
  today: string
): PlanCompletion | null {
  const row = db
    .prepare(
      `SELECT id, user_id, title, risk_key, target_value, start_date, end_date, status, source, create_time
       FROM health_plans
       WHERE user_id = ? AND start_date <= ? AND end_date >= ?
       ORDER BY id DESC LIMIT 1`
    )
    .get(userId, endDate, startDate) as PlanRow | undefined;
  if (!row) {
    return {
      planId: 0,
      planTitle: "",
      rate: 0,
      streakDays: 0,
      advice: completionAdvice(false, 0, 0)
    };
  }
  const tasks = db
    .prepare(
      `SELECT id, plan_id, title, task_type, frequency, sort_order
       FROM plan_tasks WHERE plan_id = ? ORDER BY sort_order, id`
    )
    .all(row.id) as TaskRow[];
  const checkins = db
    .prepare(
      `SELECT id, task_id, value, note, checked_date FROM task_checkins
       WHERE user_id = ? AND task_id IN (${tasks.map(() => "?").join(",") || "NULL"})
       ORDER BY checked_date`
    )
    .all(userId, ...tasks.map(t => t.id)) as CheckinRow[];
  const progress = planProgress(
    row.id,
    tasks.map(t => ({
      id: t.id,
      frequency: t.frequency as PlanFrequency,
      title: t.title
    })),
    checkins.map(c => ({ taskId: c.task_id, checkedDate: c.checked_date })),
    row.start_date,
    row.end_date,
    today
  );
  return {
    planId: row.id,
    planTitle: row.title,
    rate: progress.rate,
    streakDays: progress.streakDays,
    advice: completionAdvice(true, progress.rate, progress.streakDays)
  };
}

export default router;
