/**
 * C7 请求日志中间件。
 *
 * 每个请求结束（`res` 的 `finish`/`close`）时打一行结构化日志：
 * **方法、路径、状态码、耗时、user_id**（已登录时）。
 *
 * 刻意**不记录**的（日志是会被拷走、检索、长期留存的东西，宁可少记）：
 * - 请求体 / 响应体（登录密码、健康指标数值都在里面）；
 * - 查询串（导入导出、审计筛选会把账号名等带在 query 上）；
 * - Authorization 头（token 本身即凭据）。
 * 因此路径只取 `req.path`（不含 `?` 之后的部分）。
 *
 * 注册位置：**必须在所有路由之前**（见 index.ts），否则失败请求不会被记到。
 * 耗时用 `process.hrtime.bigint()`（单调时钟，不受系统时间调整影响）。
 *
 * 日志去向：pino 默认写 stdout；错误级别的记录由 logger 统一输出，生产模式下
 * 用 `pnpm start > server.log 2>&1` 之类的重定向落盘（见 README「部署说明」）。
 */
import type { NextFunction, Request, Response } from "express";
import { logger } from "../logger.js";

/**
 * 无需记日志的路径：健康检查与前端静态资源。
 *
 * 健康检查会被探针按秒级轮询，记进来会把真正的业务日志淹掉；静态资源（JS/CSS/图片）
 * 与 SPA 回退的 index.html 同理，它们不是「接口调用」。两者的失败也另有渠道发现
 * （探针告警 / 浏览器控制台）。
 */
const SILENT_PREFIXES = ["/api/ping", "/api/health/ping", "/uploads"];
const SILENT_EXT =
  /\.(js|mjs|css|map|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|html)$/i;

function shouldSkip(path: string): boolean {
  if (SILENT_PREFIXES.some(p => path === p || path.startsWith(`${p}/`))) {
    return true;
  }
  return SILENT_EXT.test(path);
}

export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const started = process.hrtime.bigint();
  const path = req.path;

  // 只带一次性的监听（finish 与 close 二选一先到者，避免连接中断时漏记或重复记）
  let logged = false;
  const done = (aborted: boolean) => {
    if (logged) return;
    logged = true;
    if (shouldSkip(path)) return;

    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    // statusCode 在连接中断时可能仍是 200，用 aborted 明确区分「请求没跑完」
    const status = aborted ? 499 : res.statusCode;
    const line = {
      method: req.method,
      path,
      status,
      durationMs: Math.round(durationMs * 10) / 10,
      /** 已登录时记录归属账号，便于按用户检索；未登录（含登录接口本身）为 null */
      userId: req.user?.id ?? null
    };

    if (aborted) {
      // 客户端提前断开（刷新 / 关页面 / 超时）：不是服务端故障，用 warn 与 5xx 区分
      logger.warn(line, "请求被中断");
    } else if (status >= 500) {
      logger.error(line, "请求失败");
    } else if (status >= 400) {
      logger.warn(line, "请求被拒绝");
    } else {
      logger.info(line, "请求完成");
    }
  };

  res.on("finish", () => done(false));
  // Node 18+ 的 res 在客户端中断时触发 "close"；已 finish 过则 done 内部会跳过
  res.on("close", () => done(!res.writableFinished));

  next();
}
