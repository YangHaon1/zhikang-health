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
import plansRouter from "./plans.js";
import analyticsRouter from "./analytics.js";
import deviceRouter from "./device.js";
import auditRouter from "./audit.js";
import authorizationsRouter from "./authorizations.js";
import remindersRouter from "./reminders.js";
import dailyRouter from "./daily.js";
import riskRouter from "./risk.js";
import mlStatusRouter from "./mlStatus.js";
import seedStudentRouter from "./seedStudent.js";
import coachPlanRouter from "./coachPlan.js";
import surveyRouter from "./survey.js";
import mlStatsRouter from "./mlStats.js";
import clusterStatsRouter from "./clusterStats.js";
import agentRouter from "./agent.js";
import planAgentRouter from "./planAgent.js";
import reviewAgentRouter from "./reviewAgent.js";
import studentProfileRouter from "./studentProfile.js";

const router = Router();
router.use(profileRouter);
router.use(recordsRouter);
router.use(reportRouter);
router.use(chatRouter);
router.use(analyzeRouter);
router.use(seedRouter);
router.use(plansRouter);
router.use(analyticsRouter);
router.use(deviceRouter);
router.use(auditRouter);
router.use(authorizationsRouter);
router.use(remindersRouter);
router.use(dailyRouter);
router.use(riskRouter);
router.use(mlStatusRouter);
router.use(seedStudentRouter);
router.use(coachPlanRouter);
router.use(surveyRouter);
router.use(mlStatsRouter);
router.use(clusterStatsRouter);
router.use(agentRouter);
router.use(planAgentRouter);
router.use(reviewAgentRouter);
router.use(studentProfileRouter);

export default router;
