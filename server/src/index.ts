// 必须放在最前：先加载 server/.env，后续模块才能读到 JWT_SECRET 等环境变量
import { env } from "./env.js";
import express from "express";
import { initDb } from "./db.js";
import authRouter from "./routes/auth.js";

const app = express();
const port = env.PORT;

// 建表 + 种子数据（幂等，可重复启动）
initDb();

app.use(express.json());

app.get("/api/ping", (_req, res) => {
  res.json({ code: 0, data: "ok" });
});

// 鉴权与登录：login / refresh-token / mine / mine-logs / get-async-routes
app.use("/api", authRouter);

app.listen(port, () => {
  console.log(`zhikang server listening on http://localhost:${port}`);
});
