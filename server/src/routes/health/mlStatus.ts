/**
 * V2.0 P1-2：ML 服务状态检查。
 * GET /api/health/ml-status —— 探测 ML 服务是否在线 + 模型版本。
 */
import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.js";

const router = Router();
const ML_BASE = process.env.ML_SERVICE_URL || "http://127.0.0.1:8000";

router.get("/health/ml-status", authMiddleware, async (_req, res) => {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 1500);
  try {
    const r = await fetch(`${ML_BASE}/health`, { signal: controller.signal });
    if (!r.ok) throw new Error();
    const data = (await r.json()) as Record<string, unknown>;
    res.json({
      code: 0,
      message: "ok",
      data: { online: true, modelVersion: data.modelVersion ?? "unknown" }
    });
  } catch {
    res.json({
      code: 0,
      message: "ok",
      data: { online: false, modelVersion: "offline" }
    });
  } finally {
    clearTimeout(t);
  }
});

export default router;
