/**
 * C7 可观测性单测：请求日志中间件、兜底错误处理、进程级兜底。
 *
 * 这三者都是「不碰数据库的纯装配代码」，因此可以直接单测（带库行为走 regress-api.mjs）。
 * 用 `vi.spyOn(logger, ...)` 截获日志调用——断言的重点不是「打了一行字」，
 * 而是 **该记的字段都在、不该记的字段一个都没有**（body / 查询串 / token 不许进日志）。
 */
import { EventEmitter } from "node:events";
import type { NextFunction, Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../logger.js";
import { requestLogger } from "../request-log.js";
import { errorHandler, installProcessGuards } from "../error-log.js";

/** 造一个够用的 res：能 emit finish/close，能记 status */
function fakeRes() {
  const res = new EventEmitter() as EventEmitter & {
    statusCode: number;
    writableFinished: boolean;
    headersSent: boolean;
    body: unknown;
    status: (n: number) => unknown;
    json: (b: unknown) => unknown;
  };
  res.statusCode = 200;
  res.writableFinished = false;
  res.headersSent = false;
  res.body = undefined;
  res.status = vi.fn((n: number) => {
    res.statusCode = n;
    return res;
  });
  res.json = vi.fn((b: unknown) => {
    res.body = b;
    res.headersSent = true;
    return res;
  });
  return res;
}

/** 造一个够用的 req：故意带上 body / query / 敏感头，用来证明它们不会被记进日志 */
function fakeReq(over: Partial<Record<string, unknown>> = {}) {
  return {
    method: "POST",
    path: "/api/login",
    originalUrl: "/api/login?username=admin&password=admin123",
    body: { username: "admin", password: "admin123" },
    query: { username: "admin", password: "admin123" },
    headers: { authorization: "Bearer SECRET.TOKEN.VALUE" },
    user: undefined,
    ...over
  } as unknown as Request;
}

type LogSpy = ReturnType<typeof vi.spyOn>;

/**
 * 调 `requestLogger`：测试替身是个 EventEmitter，运行时够用，类型上要转成 Response。
 * 收口在这里，免得每个用例都写一遍 `as unknown as`。
 */
function runLogger(req: Request, res: ReturnType<typeof fakeRes>): void {
  requestLogger(
    req,
    res as unknown as Response,
    (() => undefined) as NextFunction
  );
}

function silence() {
  return {
    info: vi.spyOn(logger, "info").mockImplementation(() => undefined as never),
    warn: vi.spyOn(logger, "warn").mockImplementation(() => undefined as never),
    error: vi
      .spyOn(logger, "error")
      .mockImplementation(() => undefined as never),
    fatal: vi
      .spyOn(logger, "fatal")
      .mockImplementation(() => undefined as never)
  };
}

/** 取某次调用的第一个实参（结构化字段对象） */
function fieldsOf(spy: LogSpy): Record<string, unknown> {
  const call = spy.mock.calls.at(-1);
  expect(call).toBeTruthy();
  return call![0] as Record<string, unknown>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("请求日志：完成、拒绝、失败、中断", () => {
  it("成功请求记 info，含方法/路径/状态码/耗时/user_id", () => {
    const log = silence();
    const req = fakeReq({
      method: "GET",
      path: "/api/health/records",
      user: { id: 7 }
    });
    const res = fakeRes();
    runLogger(req, res);

    res.statusCode = 200;
    res.writableFinished = true;
    res.emit("finish");

    const f = fieldsOf(log.info);
    expect(f.method).toBe("GET");
    expect(f.path).toBe("/api/health/records");
    expect(f.status).toBe(200);
    expect(typeof f.durationMs).toBe("number");
    expect(f.durationMs).toBeGreaterThanOrEqual(0);
    expect(f.userId).toBe(7);
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it("未登录请求 userId 记为 null（不是 undefined，便于按字段检索）", () => {
    const log = silence();
    const res = fakeRes();
    runLogger(fakeReq(), res);
    res.writableFinished = true;
    res.emit("finish");
    expect(fieldsOf(log.info).userId).toBeNull();
  });

  it("**不记录 body / 查询串 / Authorization**——日志只有约定的六个字段", () => {
    const log = silence();
    const req = fakeReq({ user: { id: 1 } });
    const res = fakeRes();
    runLogger(req, res);
    res.writableFinished = true;
    res.emit("finish");

    const f = fieldsOf(log.info);
    expect(Object.keys(f).sort()).toEqual([
      "durationMs",
      "method",
      "path",
      "status",
      "userId"
    ]);
    // 路径不含查询串
    expect(f.path).toBe("/api/login");
    // 整个日志对象序列化后不含任何凭据或请求体字段
    const dumped = JSON.stringify({ calls: log.info.mock.calls });
    expect(dumped).not.toContain("admin123");
    expect(dumped).not.toContain("SECRET.TOKEN.VALUE");
    expect(dumped).not.toContain("Bearer");
    expect(dumped).not.toContain("password");
  });

  it("4xx 记 warn（客户端问题），5xx 记 error（服务端问题）", () => {
    const log = silence();
    const res400 = fakeRes();
    runLogger(fakeReq(), res400);
    res400.statusCode = 401;
    res400.writableFinished = true;
    res400.emit("finish");
    expect(fieldsOf(log.warn).status).toBe(401);
    expect(log.error).not.toHaveBeenCalled();

    const res500 = fakeRes();
    runLogger(fakeReq(), res500);
    res500.statusCode = 500;
    res500.writableFinished = true;
    res500.emit("finish");
    expect(fieldsOf(log.error).status).toBe(500);
  });

  it("客户端提前断开记 warn + 499（不误记成 200 成功）", () => {
    const log = silence();
    const req = fakeReq({ method: "GET", path: "/api/health/report/history" });
    const res = fakeRes();
    runLogger(req, res);
    // 未 finish 就 close = 客户端跑了
    res.writableFinished = false;
    res.emit("close");

    expect(fieldsOf(log.warn).status).toBe(499);
    expect(log.info).not.toHaveBeenCalled();
  });

  it("finish 与 close 都触发时只记一次", () => {
    const log = silence();
    const res = fakeRes();
    runLogger(fakeReq(), res);
    res.writableFinished = true;
    res.emit("finish");
    res.emit("close");
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("健康检查与静态资源不记日志（探针轮询会淹掉业务日志）", () => {
    const log = silence();
    for (const path of [
      "/api/health/ping",
      "/api/ping",
      "/static/js/index-abc.js",
      "/uploads/avatar.png"
    ]) {
      const res = fakeRes();
      runLogger(fakeReq({ path }), res);
      res.writableFinished = true;
      res.emit("finish");
    }
    expect(log.info).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });
});

describe("兜底错误处理", () => {
  it("路由抛出的异常：记 error 并返回统一 JSON 500", () => {
    const log = silence();
    const req = fakeReq({
      method: "POST",
      path: "/api/health/report/generate",
      user: { id: 3 }
    });
    const res = fakeRes();
    const next = vi.fn();

    errorHandler(new Error("boom"), req, res as unknown as Response, next);

    expect(log.error).toHaveBeenCalledTimes(1);
    const f = fieldsOf(log.error);
    expect(f.path).toBe("/api/health/report/generate");
    expect(f.userId).toBe(3);
    expect(f.err).toBe("boom");
    expect(String(f.stack)).toContain("boom");
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ code: 500, message: "服务内部错误" });
    expect(next).not.toHaveBeenCalled();
  });

  it("日志不含请求体（异常请求里的密码/指标数值不落日志）", () => {
    const log = silence();
    const req = fakeReq({ path: "/api/login", body: { password: "admin123" } });
    errorHandler(
      new Error("boom"),
      req,
      fakeRes() as unknown as Response,
      vi.fn()
    );
    const dumped = JSON.stringify(log.error.mock.calls);
    expect(dumped).not.toContain("admin123");
    expect(dumped).not.toContain("password");
  });

  it("畸形 JSON 记 warn + 400（是客户端问题，不该记成 500）", () => {
    const log = silence();
    const res = fakeRes();
    const err = Object.assign(new SyntaxError("Unexpected token"), {
      type: "entity.parse.failed",
      status: 400
    });
    errorHandler(err, fakeReq(), res as unknown as Response, vi.fn());

    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.error).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ code: 40001, message: "请求体不是合法 JSON" });
  });

  it("响应已开始发送时交给 Express 默认处理（不二次写头）", () => {
    const log = silence();
    const res = fakeRes();
    res.headersSent = true;
    const next = vi.fn();

    errorHandler(
      new Error("late"),
      fakeReq(),
      res as unknown as Response,
      next
    );

    expect(log.error).toHaveBeenCalledTimes(1);
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("进程级兜底", () => {
  it("未捕获异常记 fatal 并退出进程（状态不可信，重启胜过带病服务）", () => {
    const log = silence();
    const onFatal = vi.fn();
    const uninstall = installProcessGuards(onFatal);

    process.emit("uncaughtException", new Error("sync boom"));

    expect(fieldsOf(log.fatal).err).toBe("sync boom");
    expect(onFatal).toHaveBeenCalledTimes(1);
    uninstall();
  });

  it("未处理的 Promise 拒绝只记 error、**不**退出（网络抖动不该带走服务）", () => {
    const log = silence();
    const onFatal = vi.fn();
    const uninstall = installProcessGuards(onFatal);

    process.emit(
      "unhandledRejection",
      new Error("llm timeout"),
      Promise.resolve()
    );

    expect(fieldsOf(log.error).err).toBe("llm timeout");
    expect(onFatal).not.toHaveBeenCalled();
    expect(log.fatal).not.toHaveBeenCalled();
    uninstall();
  });

  it("非 Error 的拒绝原因也能记下来（不能打成 undefined）", () => {
    const log = silence();
    const uninstall = installProcessGuards(vi.fn());
    process.emit("unhandledRejection", "字符串原因", Promise.resolve());
    expect(fieldsOf(log.error).err).toBe("字符串原因");
    uninstall();
  });

  it("卸载后监听器复位到装配前的数量（不留悬挂监听）", () => {
    silence();
    const uncaughtBefore = process.listenerCount("uncaughtException");
    const rejectionBefore = process.listenerCount("unhandledRejection");

    const uninstall = installProcessGuards(vi.fn());
    expect(process.listenerCount("uncaughtException")).toBe(uncaughtBefore + 1);
    expect(process.listenerCount("unhandledRejection")).toBe(
      rejectionBefore + 1
    );

    // 卸载后不再 emit 事件来验证：此时没有监听器，emit 会落到 Node 自己的默认处理上，
    // 反而制造出一条游离的未处理拒绝。直接断言监听器数量即可。
    uninstall();
    expect(process.listenerCount("uncaughtException")).toBe(uncaughtBefore);
    expect(process.listenerCount("unhandledRejection")).toBe(rejectionBefore);
  });
});
