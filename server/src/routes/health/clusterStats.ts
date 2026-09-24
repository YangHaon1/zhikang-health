/** P1-1：聚类模型训练统计（只读）。 */
import { Router } from "express";
import fs from "node:fs";
import path from "node:path";

const router = Router();
const META = path.resolve(
  process.cwd(),
  "..",
  "server-ml",
  "cluster-model",
  "metadata.json"
);

router.get("/health/cluster-stats", (_req, res) => {
  let meta: Record<string, unknown> = {};
  try {
    if (fs.existsSync(META)) meta = JSON.parse(fs.readFileSync(META, "utf-8"));
  } catch {
    /* ignore */
  }
  res.json({
    code: 0,
    message: "操作成功",
    data: {
      version: meta.model_version ?? "unknown",
      trainingMode: meta.training_mode ?? "unknown",
      realSamples: meta.real_samples ?? 0,
      syntheticSamples: meta.synthetic_samples ?? 0,
      clusterCount: meta.best_k ?? 0,
      silhouette: meta.silhouette ?? 0,
      clusters: meta.clusters ?? []
    }
  });
});

export default router;
