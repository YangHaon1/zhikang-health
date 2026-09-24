/**
 * C5 审计体系：统一写入助手 + 管理端审计日志查询接口。
 *
 * 写入：`writeAudit(action, detail, actor)` —— 各路由唯一入口。动作目录、脱敏规则、
 * 可见性口径全部在共享层 `@shared/health-privacy`（前端审计页用同一份目录与文案）。
 * 本文件只做两件事：把共享层构造好的审计行落库；把审计行按查询条件分页吐给管理员。
 *
 * 权限：`GET /health/audit-logs` 为 adminOnly（普通用户 403，前端也不下发菜单）。
 * 内容：detail 在**写入时**已脱敏；读取时再脱一次（老库里的历史行由 C4 的本地写入产生，
 *       没有经过脱敏），保证接口出口永远不含个体健康数据。
 */
import { Router } from "express";
import type { Request } from "express";
import db, { ensureAuditLogs } from "../../db.js";
import { adminOnly, authMiddleware } from "../../middleware/auth.js";
import { logger } from "../../logger.js";
import {
  auditActionLabel,
  buildAuditRecord,
  isAuditAction,
  sanitizeAuditDetail
} from "../../../shared/health-privacy.js";
import type {
  AuditActor,
  AuditDetail
} from "../../../shared/health-privacy.js";
import { toNumber, toText } from "./common.js";

const router = Router();

/** 审计查询默认 / 最大页大小 */
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;

/** 从请求里取操作人（登录接口没有 req.user，故各字段都可缺省） */
export function actorOf(req: Request): AuditActor {
  return {
    userId: req.user?.id ?? null,
    username: req.user?.username ?? "",
    ip: req.ip ?? ""
  };
}

/**
 * 写一条审计日志。
 *
 * - 动作不在目录内 → 丢弃并记警告（调用方只应使用共享层的动作常量，出现未知动作即代码缺陷）；
 * - **不抛异常**：审计是业务的副产物，写审计失败不应把一次已经成功的操作变成 500。
 *   失败会打 error 日志，便于发现「审计静默失效」。
 * - `detail` 由共享层脱敏，调用方无法绕过。
 */
export function writeAudit(
  action: string,
  detail: unknown,
  actor: AuditActor = {}
): void {
  const row = buildAuditRecord(action, detail, actor);
  if (!row) {
    logger.warn(`[audit] 未知审计动作，未写入：${action}`);
    return;
  }
  try {
    ensureAuditLogs();
    db.prepare(
      `INSERT INTO audit_logs (user_id, action, actor_name, actor_ip, detail, create_time)
       VALUES (@user_id, @action, @actor_name, @actor_ip, @detail, datetime('now','localtime'))`
    ).run(row);
  } catch (err) {
    logger.error(`[audit] 写入失败（action=${action}）：${String(err)}`);
  }
}

/** audit_logs 查询行（LEFT JOIN users 拿账号名；账号已删除时为 null） */
interface AuditRow {
  id: number;
  user_id: number | null;
  action: string;
  actor_name: string | null;
  actor_ip: string | null;
  detail: string | null;
  create_time: string | null;
  account_username: string | null;
}

/** detail JSON → 对象（坏 JSON 一律当空对象，不让历史脏数据把接口打挂），再脱敏一次 */
function parseDetail(raw: string | null): AuditDetail {
  if (!raw) return {};
  try {
    return sanitizeAuditDetail(JSON.parse(raw));
  } catch {
    return {};
  }
}

/** SELECT 片段（列表与计数共用，避免两处口径漂移） */
const AUDIT_SELECT = `
  SELECT a.id, a.user_id, a.action, a.actor_name, a.actor_ip, a.detail, a.create_time,
         u.username AS account_username
  FROM audit_logs a
  LEFT JOIN users u ON u.id = a.user_id`;

/**
 * GET /api/health/audit-logs —— 分页查询审计日志（管理员）。
 *
 * 筛选：action（精确，需为目录内动作，非法值 400，避免拼错时静默返回全部）、
 *       username（账号名或操作人名模糊）、startDate / endDate（按操作日期）。
 * 列表项：操作人（userId + 用户名）、时间、动作（原文 + 中文文案）、来源 IP、脱敏 detail。
 */
router.get("/health/audit-logs", authMiddleware, adminOnly, (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const action = toText(q.action).trim();
  if (action && !isAuditAction(action)) {
    res.status(400).json({ code: 40001, message: `未知的审计动作：${action}` });
    return;
  }

  const where: Array<string> = [];
  const params: Array<unknown> = [];
  if (action) {
    where.push("a.action = ?");
    params.push(action);
  }
  const username = toText(q.username).trim();
  if (username) {
    where.push("(u.username LIKE ? OR a.actor_name LIKE ?)");
    params.push(`%${username}%`, `%${username}%`);
  }
  const startDate = toText(q.startDate).trim();
  if (startDate) {
    where.push("date(a.create_time) >= date(?)");
    params.push(startDate);
  }
  const endDate = toText(q.endDate).trim();
  if (endDate) {
    where.push("date(a.create_time) <= date(?)");
    params.push(endDate);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ${whereSql}`
      )
      .get(...params) as { n: number }
  ).n;

  const currentPage = Math.max(1, Math.floor(toNumber(q.currentPage, 1)));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.floor(toNumber(q.pageSize, DEFAULT_PAGE_SIZE)))
  );

  const rows = db
    .prepare(`${AUDIT_SELECT} ${whereSql} ORDER BY a.id DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (currentPage - 1) * pageSize) as AuditRow[];

  res.json({
    code: 0,
    message: "操作成功",
    data: {
      list: rows.map(row => ({
        id: String(row.id),
        /** 操作人 user_id（登录失败且账号不存在时为 null） */
        userId: row.user_id === null ? null : String(row.user_id),
        /** 账号名（账号已删除时退回操作人登录名） */
        username: row.account_username ?? row.actor_name ?? "",
        action: row.action,
        actionLabel: auditActionLabel(row.action),
        actorName: row.actor_name ?? "",
        actorIp: row.actor_ip ?? "",
        detail: parseDetail(row.detail),
        createTime: row.create_time ?? ""
      })),
      total,
      currentPage,
      pageSize
    }
  });
});

export default router;
