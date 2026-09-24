/** P2-2：AI 健康分析报告接口。 */
import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.js";
import { analyzeHealth } from "../../services/health-agent.js";
import { analyzeHealthType } from "../../services/health-type.js";

const router = Router();

router.post("/health/agent/analyze", authMiddleware, async (req, res) => {
  const userId = req.user!.id;
  const ht = analyzeHealthType(userId);
  try {
    const result = await analyzeHealth(userId, ht?.name ?? "");
    res.json({ code: 0, message: "操作成功", data: result });
  } catch {
    res.json({
      code: 0,
      message: "规则分析",
      data: await analyzeHealth(userId, ht?.name ?? "")
    });
  }
});

export default router;
