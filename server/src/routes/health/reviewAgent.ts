/** P2-2 P2：Review Agent 接口。 */
import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.js";
import { reviewPlan } from "../../services/health-review-agent.js";

const router = Router();

router.post("/health/agent/review", authMiddleware, async (req, res) => {
  const planId = Number((req.body ?? {}).planId);
  if (!Number.isFinite(planId) || planId <= 0) {
    res.json({ code: 40001, message: "缺少或非法 planId" });
    return;
  }
  try {
    const result = await reviewPlan(req.user!.id, planId);
    // 计划不属于当前用户：不泄露任何完成率信息
    if ("forbidden" in result) {
      res.status(403).json({ code: 403, message: "无权查看该计划" });
      return;
    }
    res.json({ code: 0, message: "操作成功", data: result });
  } catch (err) {
    // 不能静默吞异常：本次 e2e 就是因为列名写错（created_at → 实际为 create_time）
    // 被这里吞成「复评失败」，越权 403 分支永远走不到，问题潜伏很久。
    console.error("[review-agent] 复评失败:", err);
    res.json({ code: 1, message: "复评失败，请稍后重试" });
  }
});

export default router;
