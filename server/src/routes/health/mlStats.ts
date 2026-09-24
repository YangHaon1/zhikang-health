/**
 * P1-2：模型训练数据统计（只读）。
 * 读取 server-ml/model/metadata.json + health_survey 真实样本量。
 */
import { Router } from "express";
import db from "../../db.js";
import fs from "node:fs";
import path from "node:path";
import { authMiddleware } from "../../middleware/auth.js";

const router = Router();

const META_PATH = path.resolve(
  process.cwd(),
  "..",
  "server-ml",
  "model",
  "metadata.json"
);

router.get("/health/ml-train-stats", authMiddleware, (_req, res) => {
  let meta: Record<string, unknown> = {};
  try {
    if (fs.existsSync(META_PATH)) {
      meta = JSON.parse(fs.readFileSync(META_PATH, "utf-8"));
    }
  } catch {
    meta = {};
  }
  let realCount = 0;
  try {
    const row = db.prepare("SELECT COUNT(*) AS c FROM health_survey").get() as {
      c: number;
    };
    realCount = row.c;
  } catch {
    realCount = 0;
  }
  res.json({
    code: 0,
    message: "操作成功",
    data: {
      ...meta,
      realSurveyCount: realCount
    }
  });
});

export default router;
