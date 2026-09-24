/** P2-2 P2：Review Agent 接口。 */
import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.js";
import { reviewPlan } from "../../services/health-review-agent.js";

const router = Router();

router.post("/health/agent/review", authMiddleware, async (req, res) => {
  try {
    const planId = Number((req.body ?? {}).planId);
    if (!planId) return res.json({ code: 1, message: "缺少 planId" });
    const result = await reviewPlan(req.user!.id, planId);
    res.json({ code: 0, message: "操作成功", data: result });
  } catch {
    res.json({ code: 1, message: "复评失败，请稍后重试" });
  }
});

export default router;
