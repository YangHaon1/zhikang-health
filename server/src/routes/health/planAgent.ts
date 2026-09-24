/** P2-2 P1：Plan Agent 接口。 */
import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.js";
import { generatePlan } from "../../services/health-plan-agent.js";
import { analyzeHealthType } from "../../services/health-type.js";

const router = Router();

router.post("/health/agent/plan", authMiddleware, async (req, res) => {
  const ht = analyzeHealthType(req.user!.id);
  const result = await generatePlan({
    summary: "",
    healthType: ht?.name ?? ""
  });
  res.json({ code: 0, message: "操作成功", data: result });
});

export default router;
