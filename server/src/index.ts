// 必须放在最前：先加载 server/.env，后续模块才能读到 JWT_SECRET 等环境变量
import { env } from "./env.js";
import express from "express";
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

app.listen(port, () => {
  console.log(`zhikang server listening on http://localhost:${port}`);
});
