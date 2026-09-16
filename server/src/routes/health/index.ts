/**
 * health 路由聚合入口（P1-2 拆分后替代原单文件 routes/health.ts）。
 * 各子路由已带完整 `/health/*` 路径前缀，挂载顺序不影响匹配（无重叠通配）。
 */
import { Router } from "express";
import profileRouter from "./profile.js";
import recordsRouter from "./records.js";
import reportRouter from "./report.js";
import chatRouter from "./chat.js";
import analyzeRouter from "./analyze.js";
import seedRouter from "./seed.js";

const router = Router();
router.use(profileRouter);
router.use(recordsRouter);
router.use(reportRouter);
router.use(chatRouter);
router.use(analyzeRouter);
router.use(seedRouter);

export default router;
