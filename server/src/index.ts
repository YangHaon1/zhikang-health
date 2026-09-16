import express from "express";
import { initDb } from "./db.js";

const app = express();
const port = Number(process.env.PORT) || 3000;

// 建表 + 种子数据（幂等，可重复启动）
initDb();

app.get("/api/ping", (_req, res) => {
  res.json({ code: 0, data: "ok" });
});

app.listen(port, () => {
  console.log(`zhikang server listening on http://localhost:${port}`);
});
