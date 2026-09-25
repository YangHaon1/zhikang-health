/**
 * Agent 工作流统一入口：POST /api/health/agent/workflow
 *
 * 一次调用完成 Analyze → Plan（→ Review），由 services/agent-orchestrator.ts 编排，
 * 前端不必自己串行调用三次并手工搬运上下文。
 */
import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.js";
import { runAgentWorkflow } from "../../services/agent-orchestrator.js";

const router = Router();

router.post("/health/agent/workflow", authMiddleware, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const planId = Number(body.planId);
  const withPlanId = Number.isFinite(planId) && planId > 0 ? planId : undefined;

  try {
    const result = await runAgentWorkflow(req.user!.id, withPlanId);
    if (result.forbidden) {
      res.status(403).json({ code: 403, message: "无权查看该计划" });
      return;
    }
    res.json({ code: 0, message: "操作成功", data: result });
  } catch (err) {
    // 同样不能静默吞：列名/字段写错这类问题只有打出来才能在联调时发现
    console.error("[agent-workflow] 执行失败:", err);
    res.json({ code: 1, message: "AI 工作流执行失败，请稍后重试" });
  }
});

export default router;
