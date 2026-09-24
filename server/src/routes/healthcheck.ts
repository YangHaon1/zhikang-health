/**
 * C7 健康检查：`GET /api/health/ping`（部署探针 / 演示前的「服务是否活着」一键确认）。
 *
 * 与既有的 `GET /api/ping`（只证明「进程在监听」）的区别：**本接口真的探一次数据库**。
 * 只证明 HTTP 层活着是不够的——SQLite 文件被删/被锁、磁盘满、迁移失败都会让进程照常
 * 监听却每个业务接口都 500，探针必须能分辨这两种状态。
 *
 * 响应体刻意**不套 `{code,data}` 信封**（与业务接口不同）：它是给监控/编排系统读的，
 * 直接给 `{status, time, uptime, db}` 四个字段，无需二次解包：
 * - `status`：`ok` / `error`；`db`：`ok` / `error`（探活结果）。
 * - `time`：服务端 ISO 时刻；`uptime`：进程已运行秒数。
 * - 数据库不可用时返回 **503**（负载均衡/容器编排据此摘流量；200 会被当成健康）。
 *
 * **不需要登录**：探针没有账号，且响应里不含任何用户数据。
 */
import { Router } from "express";
import db from "../db.js";
import { logger } from "../logger.js";

const router = Router();

/** 一次最轻量的数据库往返（不碰任何业务表，也不依赖迁移是否已跑过） */
function probeDb(): boolean {
  try {
    const row = db.prepare("SELECT 1 AS ok").get() as
      { ok?: number } | undefined;
    return row?.ok === 1;
  } catch (err) {
    logger.error(`[health] 数据库探活失败：${(err as Error).message}`);
    return false;
  }
}

router.get("/health/ping", (_req, res) => {
  const dbOk = probeDb();
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? "ok" : "error",
    time: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    db: dbOk ? "ok" : "error"
  });
});

export default router;
