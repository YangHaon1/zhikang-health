/** P2-2 P1：Plan Agent 接口。 */
import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.js";
import { generatePlan } from "../../services/health-plan-agent.js";
import { analyzeHealthType } from "../../services/health-type.js";

const router = Router();

/**
 * POST /api/health/agent/plan
 *
 * 入参（可选）：{ summary?, risk?, reason?, healthType? }
 * 之前 summary 被写死成空串，Plan 完全拿不到 Analyze 的结论。
 * 现在允许调用方把 Analyze 的输出传进来；未传时由编排器负责串联。
 */
router.post("/health/agent/plan", authMiddleware, async (req, res) => {
  const ht = analyzeHealthType(req.user!.id);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) =>
    typeof v === "string" ? v.trim().slice(0, max) : undefined;

  const result = await generatePlan({
    summary: str(body.summary, 500) ?? "",
    healthType: str(body.healthType, 60) ?? ht?.name ?? "",
    risk: str(body.risk, 20),
    reason: str(body.reason, 500)
  });
  res.json({ code: 0, message: "操作成功", data: result });
});

export default router;
