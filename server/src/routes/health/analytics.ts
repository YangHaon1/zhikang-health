/**
 * C4 群体健康看板路由：脱敏聚合统计 + 导出留痕。
 *
 * 权限：全部 adminOnly（普通用户越权 → 403，前端也不下发菜单）。
 * 口径：每个用户的评分 / 等级都由 `analyzeHealth` 现算（复用规则引擎，不重写分级），
 *       聚合与脱敏规则在共享层 `server/shared/health-analytics.ts`（唯一源码）。
 * 隐私：任一分组样本 < 5 人一律隐藏（返回 null），导出同样按脱敏后的值输出。
 */
import { Router } from "express";
import db from "../../db.js";
import fs from "node:fs";
import path from "node:path";
import { adminOnly, authMiddleware } from "../../middleware/auth.js";
import { profileForEngine, recordsForEngine, toText } from "./common.js";
import {
  ANALYTICS_MIN_SAMPLE,
  analyzeUserForAnalytics,
  analyticsToCsv,
  buildAnalyticsOverview
} from "../../../shared/health-analytics.js";
import type {
  AnalyticsOverview,
  UserAnalyticsInput
} from "../../../shared/health-analytics.js";
import { actorOf, writeAudit } from "./audit.js";
import { sharedUserIds } from "./authorizations.js";

const router = Router();

/** 导出动作的审计标识（C4 既有动作名，并入 C5 目录后保持不变，老记录仍可筛选） */
const AUDIT_ACTION_EXPORT = "analytics_export";

/**
 * 采集参与统计的用户：仅启用账号（status = 1），停用账号不计入。
 * 每个用户的记录走 `recordsForEngine`、档案走 `profileForEngine`，与报告/趋势接口同源，
 * 再交给 `analyzeUserForAnalytics` 现算评分与等级。
 *
 * C5：带上该用户的共享授权（`user_privacy.allow_shared`，一次查出全部、不逐人查库）。
 * 授权与否在聚合函数内统一生效（`buildAnalyticsOverview` 只统计 `allowShared === true` 的人）。
 */
function collectAnalyticsUsers(): UserAnalyticsInput[] {
  const users = db
    .prepare("SELECT id FROM users WHERE status = 1 ORDER BY id")
    .all() as Array<{ id: number }>;
  const planRows = db
    .prepare(
      `SELECT DISTINCT user_id FROM health_plans WHERE status IN ('active', 'completed')`
    )
    .all() as Array<{ user_id: number }>;
  const participants = new Set(planRows.map(r => r.user_id));
  const shared = sharedUserIds();

  return users.map(u =>
    analyzeUserForAnalytics(
      u.id,
      recordsForEngine(u.id),
      profileForEngine(u.id),
      participants.has(u.id),
      shared.has(u.id)
    )
  );
}

/** 当前看板数据（接口与导出共用，保证两个出口一定同口径） */
function currentOverview(): AnalyticsOverview {
  return buildAnalyticsOverview(collectAnalyticsUsers());
}

/** P1-2：health_survey 调研聚合（脱敏，无个人信息） */
function surveyStats() {
  const total = (
    db.prepare("SELECT COUNT(*) c FROM health_survey").get() as { c: number }
  ).c;
  if (!total) {
    return {
      totalParticipants: 0,
      riskDistribution: { low: 0, medium: 0, high: 0 },
      averageMetrics: {
        sleepHours: 0,
        stressLevel: 0,
        exerciseMinutes: 0,
        sedentaryHours: 0
      }
    };
  }
  const dist = db
    .prepare(
      "SELECT lifestyle_risk_label l, COUNT(*) c FROM health_survey GROUP BY lifestyle_risk_label"
    )
    .all() as Array<{ l: string; c: number }>;
  const avg = db
    .prepare(
      `SELECT AVG(sleep_hours_avg) s, AVG(study_pressure) p,
              AVG(exercise_min) e, AVG(sedentary_hours) d FROM health_survey`
    )
    .get() as {
    s: number | null;
    p: number | null;
    e: number | null;
    d: number | null;
  };
  const clusterMetaPath = path.resolve(
    process.cwd(),
    "..",
    "server-ml",
    "cluster-model",
    "metadata.json"
  );
  let clusterInfo: Record<string, unknown> = {};
  try {
    if (fs.existsSync(clusterMetaPath)) {
      const m = JSON.parse(fs.readFileSync(clusterMetaPath, "utf-8"));
      clusterInfo = {
        version: m.model_version,
        silhouette: m.silhouette,
        trainingMode: m.training_mode,
        realSamples: m.real_samples
      };
    }
  } catch {
    /* ignore */
  }
  return {
    totalParticipants: total,
    riskDistribution: {
      low: dist.find(r => r.l === "low")?.c ?? 0,
      medium: dist.find(r => r.l === "medium")?.c ?? 0,
      high: dist.find(r => r.l === "high")?.c ?? 0
    },
    averageMetrics: {
      sleepHours: Math.round((avg.s || 0) * 10) / 10,
      stressLevel: Math.round((avg.p || 0) * 10) / 10,
      exerciseMinutes: Math.round(avg.e || 0),
      sedentaryHours: Math.round((avg.d || 0) * 10) / 10
    },
    clusterInfo
  };
}

/** GET /api/health/analytics —— 群体健康看板（脱敏聚合，admin 专属） */
router.get("/health/analytics", authMiddleware, adminOnly, (_req, res) => {
  res.json({
    code: 0,
    message: "操作成功",
    data: { ...currentOverview(), survey: surveyStats() }
  });
});

/**
 * GET /api/health/analytics/export?format=csv|json —— 导出看板并留痕。
 * 返回文件内容（CSV 带 BOM，Excel 直接打开不乱码），同时写一条 audit_logs；
 * 导出内容就是脱敏后的看板数据，小样本分组同样是被隐藏的值。
 */
router.get(
  "/health/analytics/export",
  authMiddleware,
  adminOnly,
  (req, res) => {
    const format =
      toText(req.query.format).trim().toLowerCase() === "json" ? "json" : "csv";
    const data = currentOverview();

    // C5：改走统一审计助手（脱敏 + 动作目录校验），detail 口径与 C4 保持一致
    writeAudit(
      AUDIT_ACTION_EXPORT,
      {
        format,
        minSample: ANALYTICS_MIN_SAMPLE,
        userCount: data.totals.userCount,
        sharedCount: data.totals.sharedCount,
        withRecords: data.totals.withRecords,
        degraded: data.degraded
      },
      actorOf(req)
    );

    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="analytics-${stamp}.${format}"`
    );
    if (format === "json") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.send(JSON.stringify(data, null, 2));
      return;
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    // BOM 前缀：Excel 打开 UTF-8 CSV 不乱码
    res.send("\uFEFF" + analyticsToCsv(data));
  }
);

export default router;
