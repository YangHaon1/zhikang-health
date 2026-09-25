/**
 * P1-1 特征一致性治理 · 线上输入分布漂移监控（只读，adminOnly）。
 *
 * GET /api/health/ml-drift
 *   把「全体参与账号近 7 天聚合出的 15 维特征」当成线上分布，
 *   与训练分布（server-ml/model/feature-baseline.json）逐特征算 PSI，
 *   回答答辩必问题：**线上线下特征一致性怎么保证？**
 *
 * 设计取舍：
 *  1. 特征构造直接复用 `risk.ts` 的 buildMlFeatures —— 监控的必须是模型真正吃到的输入，
 *     另写一份就会监控到一个不存在的分布。
 *  2. 与 `/health/analytics` 一样 adminOnly：聚类元信息此前因漏鉴权被补过，
 *     这里不重复同类疏漏。
 *  3. PSI 不是精度指标，响应里带 disclaimer，前端必须原样展示这句话。
 */
import { Router } from "express";
import db from "../../db.js";
import { adminOnly, authMiddleware } from "../../middleware/auth.js";
import { buildMlFeatures } from "./risk.js";
import { driftReport } from "../../services/featureDrift.js";

const router = Router();

/** 参与漂移统计的账号：启用中的账号（停用账号的数据不应影响线上分布判断） */
function activeUserIds(): number[] {
  const rows = db
    .prepare("SELECT id FROM users WHERE status = 1 ORDER BY id")
    .all() as Array<{ id: number }>;
  return rows.map(r => r.id);
}

router.get("/health/ml-drift", authMiddleware, adminOnly, (_req, res) => {
  const live: Record<string, number[]> = {};
  let usersWithData = 0;

  for (const userId of activeUserIds()) {
    const { features, days } = buildMlFeatures(userId);
    if (days === 0) continue; // 没记录的账号不参与：null 会污染分布
    usersWithData += 1;
    for (const [key, value] of Object.entries(features)) {
      if (value === null || value === undefined) continue;
      (live[key] ??= []).push(Number(value));
    }
  }

  const report = driftReport(live);
  res.json({
    code: 0,
    message: "操作成功",
    data: {
      ...report,
      usersWithData
    }
  });
});

export default router;
