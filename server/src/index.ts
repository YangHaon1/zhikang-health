// 必须放在最前：先加载 server/.env，后续模块才能读到 JWT_SECRET 等环境变量
import { env, checkEnv } from "./env.js";
import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { initDb } from "./db.js";
import { startReminderScheduler } from "./reminder-scheduler.js";
import { ensureDirs, uploadsDir } from "./paths.js";
import { logger } from "./logger.js";
import { requestLogger } from "./middleware/request-log.js";
import { errorHandler, installProcessGuards } from "./middleware/error-log.js";
import authRouter from "./routes/auth.js";
import healthRouter from "./routes/health/index.js";
import aiProfileRouter from "./routes/ai/profile.js";
import aiCompanionRouter from "./routes/ai/companion.js";
import userRouter from "./routes/user.js";
import healthcheckRouter from "./routes/healthcheck.js";

const app = express();
const port = env.PORT;

// 关键环境变量校验（P0-3 告警不阻断；P1-10 生产模式 NODE_ENV=production 时弱 JWT_SECRET 直接拒绝启动）
checkEnv(env.NODE_ENV === "production");

// 数据目录（server/data 与 server/data/uploads），首次启动自动创建
ensureDirs();

// 建表 + 种子数据（幂等，可重复启动）。初始化失败直接退出，不带着坏库起服务。
try {
  initDb();
  logger.info("database initialized");
} catch (error) {
  logger.error(error, "database init failed");
  process.exit(1);
}

// C6：健康提醒调度器（轻量轮询，随服务进程运行；详见 reminder-scheduler.ts 顶部说明）
startReminderScheduler();

// C7：进程级兜底日志（未捕获异常 / 未处理的 Promise 拒绝 → 记 fatal 后退出，
// 交给部署侧的守护策略重启）。装配在这里、立刻生效，早于任何请求处理。
installProcessGuards();

// C7：请求日志中间件——**必须在所有路由之前**，否则失败/未匹配的请求不会被记到。
// 只记方法/路径/状态码/耗时/归属账号，不记 body 与查询串（见 request-log.ts）。
app.use(requestLogger);

app.use(express.json());

// 存活探针（只证明进程在监听；不带信封，供监控读取）
app.get("/api/ping", (_req, res) => {
  res.json({ code: 0, data: "ok" });
});

// C7：健康检查（额外探一次数据库，不通过则 503；不需要登录）
app.use("/api", healthcheckRouter);

// 鉴权与登录：login / refresh-token / mine / mine-logs / get-async-routes
app.use("/api", authRouter);

// 健康档案与指标记录：profile / records
app.use("/api", healthRouter);

// M4 AI 健康画像：generate / read
app.use("/api", aiProfileRouter);

// M5 AI 健康陪伴：每日总结 + 目标进度
app.use("/api", aiCompanionRouter);

// 用户管理（admin）+ 头像上传（登录）：user / list-all-role / dept / upload
app.use("/api", userRouter);

// 头像静态托管：上传接口返回的 /uploads/xxx 直接可访问（server/data/uploads，不入库）
app.use("/uploads", express.static(uploadsDir));

// 未命中的 /api 路径统一返回 JSON 404，避免被下面的 SPA 回退吞成 index.html
app.use("/api", (_req, res) => {
  res.status(404).json({ code: 404, message: "接口不存在" });
});

// ---------- 生产模式：单端口托管前端产物（dist/）----------
// 触发条件：NODE_ENV=production（Docker / compose / start:prod），或本地已执行过 pnpm build。
// dev 下由 vite(8848) 托管前端、仅把 /api 与 /uploads 代理到本服务，不会走到这里。
const distDir = path.resolve(import.meta.dirname, "../../dist");
const indexHtml = path.join(distDir, "index.html");
const serveFrontend = env.NODE_ENV === "production" || existsSync(indexHtml);

if (serveFrontend) {
  // 静态资源（static/js、static/css、favicon 等），带缓存协商
  app.use(express.static(distDir));
  // SPA 回退：/api 与 /uploads 之外的所有 GET 交给前端路由（history 模式刷新不 404）
  app.get(/^\/(?!api\/|uploads\/).*/, (_req, res) => {
    res.sendFile(indexHtml);
  });
}

// C7：兜底错误处理——**必须注册在所有路由之后**（Express 按注册顺序匹配错误中间件）。
// 路由抛出的异常 / next(err) / express.json() 的畸形 JSON 都会走到这里，记 error 日志
// 并返回统一 JSON 5xx（畸形 JSON 归 400），避免默认 HTML 堆栈把前端 http 封装噎住。
app.use(errorHandler);

app.listen(port, () => {
  logger.info(`zhikang server listening on http://localhost:${port}`);
  logger.info(
    serveFrontend
      ? `[prod] 已托管前端产物：${distDir}`
      : "[dev] 未托管 dist/，前端请走 vite dev(8848)"
  );
});
