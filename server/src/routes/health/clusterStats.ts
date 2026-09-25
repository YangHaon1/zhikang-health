/** P1-1：聚类模型训练统计（只读）。 */
import { Router } from "express";
import fs from "node:fs";
import { clusterMetaFile } from "../../paths.js";
import { authMiddleware } from "../../middleware/auth.js";

const router = Router();

/**
 * 补鉴权：原实现无 authMiddleware，任意匿名请求即可拿到模型训练元信息
 * （样本构成、轮廓系数、簇心特征）。虽非个人数据，但属于不应公开的内部信息，
 * 且与同目录 analytics 的 adminOnly 口径不一致。
 */
router.get("/health/cluster-stats", authMiddleware, (_req, res) => {
  let meta: Record<string, unknown> = {};
  const metaFile = clusterMetaFile();
  try {
    if (fs.existsSync(metaFile))
      meta = JSON.parse(fs.readFileSync(metaFile, "utf-8"));
  } catch {
    /* ignore */
  }
  res.json({
    code: 0,
    message: "操作成功",
    data: {
      // 统一键名 model_version（旧文件曾写作 version，保留兼容读取）
      version: meta.model_version ?? meta.version ?? "unknown",
      trainingMode: meta.training_mode ?? "unknown",
      realSamples: meta.real_samples ?? 0,
      syntheticSamples: meta.synthetic_samples ?? 0,
      clusterCount: meta.best_k ?? 0,
      silhouette: meta.silhouette ?? 0,
      // 轮廓系数零假设对照：随机打乱标签后的均值。前端据此解释
      // 「0.066 偏低但不是瞎分」——真实簇结构与噪声必须能区分开。
      silhouetteNullBaseline: meta.silhouette_null_baseline ?? null,
      kScores: meta.k_scores ?? null,
      sklearnVersion: meta.sklearn_version ?? null,
      clusters: meta.clusters ?? []
    }
  });
});

export default router;
