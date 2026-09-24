/**
 * 实时分级路由：POST /api/health/analyze（规则引擎，评分 / 等级 / 分项分级 / 风险点 / 建议）
 * 与 POST /api/health/analyze/explain（C0 风险解释：指标、记录日期、阈值、规则版本、依据、限制）。
 * 拆自原 routes/health.ts（P1-2），规则引擎唯一源码在 server/shared/health-engine.ts。
 */
import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.js";
import { analyzeHealth, buildEvidence } from "../../../shared/health-engine.js";
import type {
  HealthProfile,
  HealthRecord
} from "../../../shared/health-engine.js";
import { profileForEngine, recordsForEngine } from "./common.js";

const router = Router();

/**
 * POST /api/health/analyze —— 实时分级：一次返回评分 / 等级 / 分项分级 / 风险点 / 建议。
 *
 * 入参（均可省略，省略时读当前用户库内最新数据 —— 档案或记录一改，这里立刻反映）：
 *   记录数组 | { records?: HealthRecord[], profile?: HealthProfile | null }
 * 隔离：任何入参都改不了查询范围，缺省数据一律取自 `req.user.id`，无法越权读他人数据。
 * C0 附加：`data.evidence` 为本次结论的逐项解释（规则版本 / 阈值 / 数据来源 / 限制）。
 */
router.post("/health/analyze", authMiddleware, (req, res) => {
  const userId = req.user!.id;
  const raw: unknown = req.body;
  const payload =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;

  // 与 mock 一致：支持「记录数组」或「{ records }」两种写法
  const rawRecords = Array.isArray(raw) ? raw : payload?.records;
  if (rawRecords !== undefined && !Array.isArray(rawRecords)) {
    res.status(400).json({ code: 40001, message: "字段 records 需为数组" });
    return;
  }

  const records =
    rawRecords === undefined
      ? recordsForEngine(userId)
      : (rawRecords as unknown as HealthRecord[]);

  const profile =
    payload && "profile" in payload
      ? ((payload.profile ?? null) as HealthProfile | null)
      : profileForEngine(userId);

  const result = analyzeHealth(records, profile);
  res.json({
    code: 0,
    message: "操作成功",
    data: { ...result, evidence: buildEvidence(records, profile, result) }
  });
});

/**
 * POST /api/health/analyze/explain —— C0 风险解释接口：
 * 返回本次结论使用的指标、记录日期、阈值说明、规则版本/依据、建议与限制说明。
 * 入参与 analyze 一致（均可省略，省略时读当前用户库内最新数据）。
 */
router.post("/health/analyze/explain", authMiddleware, (req, res) => {
  const userId = req.user!.id;
  const raw: unknown = req.body;
  const payload =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;

  const rawRecords = Array.isArray(raw) ? raw : payload?.records;
  if (rawRecords !== undefined && !Array.isArray(rawRecords)) {
    res.status(400).json({ code: 40001, message: "字段 records 需为数组" });
    return;
  }

  const records =
    rawRecords === undefined
      ? recordsForEngine(userId)
      : (rawRecords as unknown as HealthRecord[]);

  const profile =
    payload && "profile" in payload
      ? ((payload.profile ?? null) as HealthProfile | null)
      : profileForEngine(userId);

  res.json({
    code: 0,
    message: "操作成功",
    data: buildEvidence(records, profile)
  });
});

export default router;
