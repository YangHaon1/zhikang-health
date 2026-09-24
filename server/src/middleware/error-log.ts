/**
 * C7 错误日志：Express 兜底错误处理 + 进程级未捕获异常。
 *
 * 三层：
 * 1. `errorHandler`（Express 4 参错误中间件，**注册在所有路由之后**）：路由里抛出的
 *    同步异常、`next(err)`、以及 express.json() 解析失败（畸形 JSON）都会走到这里，
 *    记一条 error 日志并返回统一 JSON 500。
 * 2. `installProcessGuards()`：`uncaughtException` / `unhandledRejection` 兜底。
 *    未被捕获的异常意味着进程状态已不可信（可能持有半截事务），记完日志后**主动退出**，
 *    由部署侧的守护/重启策略拉起，好过带病继续服务。
 * 3. 日志去向：pino 输出到 **stdout/stderr**（生产模式 `pnpm start > server.log 2>&1` 落盘）。
 *
 * 日志里**不带请求体**（可能含密码与指标数值），只带方法 / 路径 / 归属账号 / 错误本身。
 */
import type { NextFunction, Request, Response } from "express";
import { logger } from "../logger.js";

/** 畸形 JSON 等客户端错误（由 express.json() 抛出）不应记成 500 */
function isBadRequest(err: unknown): boolean {
  const e = err as { type?: string; status?: number; statusCode?: number };
  return (
    e?.type === "entity.parse.failed" ||
    e?.status === 400 ||
    e?.statusCode === 400
  );
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const e = err as { message?: string; stack?: string; code?: unknown };
  const context = {
    method: req.method,
    path: req.path,
    userId: req.user?.id ?? null,
    code: e?.code ?? null
  };

  if (isBadRequest(err)) {
    logger.warn({ ...context, err: e?.message }, "请求体不是合法 JSON");
    // 已经被前面写过头就不能再写（Express 只在 headersSent 为 false 时交给错误中间件，
    // 这里再兜一层，防止 ERR_HTTP_HEADERS_SENT 把日志搅乱）
    if (!res.headersSent) {
      res.status(400).json({ code: 40001, message: "请求体不是合法 JSON" });
    }
    return;
  }

  logger.error(
    { ...context, err: e?.message, stack: e?.stack },
    "请求处理异常"
  );

  if (!res.headersSent) {
    res.status(500).json({ code: 500, message: "服务内部错误" });
    return;
  }
  // 响应已开始发送：只能把连接交给 Express 默认处理（断开），否则会二次写头
  next(err);
}

/**
 * 进程级兜底。`onFatal` 默认为退出进程，测试里可注入替身以便断言日志内容。
 *
 * 两类异常的处置**刻意不同**：
 * - `uncaughtException`：同步代码抛到了事件循环顶层，此时进程状态已不可信
 *   （可能停在写了一半的事务中间）。记 `fatal` 后**主动退出**，交给部署侧的守护
 *   策略重启，好过带病继续对外服务。
 * - `unhandledRejection`：只记 `error`，**不退出**。Node 15 起的默认行为是抛成
 *   未捕获异常并终止进程，但本项目里 Promise 拒绝可能来自一次外部调用（大模型网关
 *   超时、DNS 抖动），让一次网络抖动把整个服务带走，对演示现场是更糟的结果。
 *   代价是它不会自动重启——所以要记日志，以便事后发现。
 *
 * 返回卸载函数，便于测试后清理监听（避免 vitest 因句柄残留不退出）。
 */
export function installProcessGuards(
  onFatal?: (err: unknown) => void
): () => void {
  const fatal = onFatal ?? (() => process.exit(1));

  const onUncaught = (err: unknown) => {
    const e = err as { message?: string; stack?: string };
    logger.fatal(
      { err: e?.message, stack: e?.stack },
      "未捕获异常，进程即将退出"
    );
    fatal(err);
  };
  const onRejection = (reason: unknown) => {
    const e = reason as { message?: string; stack?: string };
    logger.error(
      { err: e?.message ?? String(reason), stack: e?.stack },
      "未处理的 Promise 拒绝（已记录，进程继续运行）"
    );
  };

  process.on("uncaughtException", onUncaught);
  process.on("unhandledRejection", onRejection);

  return () => {
    process.off("uncaughtException", onUncaught);
    process.off("unhandledRejection", onRejection);
  };
}
