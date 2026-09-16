// 必须放在最前：先加载 server/.env，后续模块才能读到 JWT_SECRET 等环境变量
import { env } from "./env.js";
import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { initDb } from "./db.js";
import { ensureDirs, uploadsDir } from "./paths.js";
import authRouter from "./routes/auth.js";
import healthRouter from "./routes/health.js";
import userRouter from "./routes/user.js";

const app = express();
const port = env.PORT;

// 数据目录（server/data 与 server/data/uploads），首次启动自动创建
ensureDirs();

// 建表 + 种子数据（幂等，可重复启动）
initDb();

app.use(express.json());

app.get("/api/ping", (_req, res) => {
  res.json({ code: 0, data: "ok" });
});

// 鉴权与登录：login / refresh-token / mine / mine-logs / get-async-routes
app.use("/api", authRouter);

// 健康档案与指标记录：profile / records
app.use("/api", healthRouter);

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

app.listen(port, () => {
  console.log(`zhikang server listening on http://localhost:${port}`);
  console.log(
    serveFrontend
      ? `[prod] 已托管前端产物：${distDir}`
      : "[dev] 未托管 dist/，前端请走 vite dev(8848)"
  );
});
