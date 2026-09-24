/**
 * 健康报告路由：生成 / 历史 / 详情（数据源统一为 reports 表）。
 * 拆自原 routes/health.ts（P1-2），共享逻辑见 ./common.ts。
 * 另导出 `recentReportSummaries` 供 chat 路由的「报告」意图使用。
 */
import { Router } from "express";
import db from "../../db.js";
import { authMiddleware } from "../../middleware/auth.js";
import {
  buildReport,
  buildReportComparison
} from "../../../shared/health-report.js";
import type {
  ComparisonSide,
  RadarPoint,
  ReportComparison,
  TrendPoint
} from "../../../shared/health-report.js";
import type { RiskEvidence } from "../../../shared/health-engine.js";
import type { PlanCompletion } from "../../../shared/health-plan.js";
import { fmtDate } from "../../../shared/health-plan.js";
import { planCompletionIn } from "./plans.js";
import {
  toNumber,
  toText,
  parseId,
  profileForEngine,
  recordsForEngine
} from "./common.js";
// C5：报告生成留痕
import { actorOf, writeAudit } from "./audit.js";

const router = Router();

/** 每用户最多保留的报告份数（方案 B5：「最多留 20 份」，超出删最旧） */
const REPORT_KEEP_LIMIT = 20;

interface ReportRow {
  id: number;
  period_start: string | null;
  period_end: string | null;
  score: number | null;
  level: string | null;
  summary: string | null;
  radar: string | null;
  trend: string | null;
  create_time: string | null;
}

/** DB 本地时间字符串（datetime('now','localtime')）→ ISO，前端 `new Date()` 可直接解析 */
function toIso(local: string | null): string {
  if (!local) return "";
  const d = new Date(local.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? local : d.toISOString();
}

/** 时间段文案：两端齐全才拼接，否则视为全部记录（与 mock 口径一致） */
function periodOf(start: string | null, end: string | null): string {
  return start && end ? `${start} ~ ${end}` : "全部记录";
}

/** JSON 列解析：容忍脏数据（解析失败退化为兜底值，不让一份坏报告把接口打成 500） */
function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return (JSON.parse(raw) ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/**
 * summary 列内部结构：总体评价 + 分项分析 + 风险点 + 建议 + 就医提醒
 * + C0 风险解释 + C1 计划完成情况 + C3 与上周期对比。
 * 全部字段可选：老报告（C1/C2 之前生成的）没有新字段，读时按空值兜底，向后兼容。
 */
interface ReportSummaryPayload {
  summary?: string;
  itemAnalysis?: string[];
  risks?: string[];
  suggestions?: string[];
  medicalAdvice?: string;
  evidence?: RiskEvidence[];
  planCompletion?: PlanCompletion | null;
  comparison?: ReportComparison | null;
}

/** 查该报告之前最近的一份报告（id 更小的最大者 = 生成这份时的那份「上一份」） */
function prevReportOf(id: number, userId: number): ReportRow | undefined {
  return db
    .prepare(
      `SELECT id, period_start, period_end, score, level, summary, radar, trend, create_time
       FROM reports WHERE user_id = ? AND id < ? ORDER BY id DESC LIMIT 1`
    )
    .get(userId, id) as ReportRow | undefined;
}

/**
 * 数据库行 → 前端 HealthReport（id 为 string，时间为 ISO）。
 * `prevRow` 只在「报告生成于 C3 之前、summary 里没存 comparison」时传入：
 * 对比结果是两份已存报告的纯函数（可复算），当场算一份与落库值必然一致，
 * 老报告因此也能正常展示对比，而不会被误判成「这是第一份报告」。
 */
function toReport(row: ReportRow, prevRow?: ReportRow) {
  const s = parseJson<ReportSummaryPayload>(row.summary, {});
  return {
    id: String(row.id),
    generateTime: toIso(row.create_time),
    period: periodOf(row.period_start, row.period_end),
    startDate: row.period_start ?? "",
    endDate: row.period_end ?? "",
    score: toNumber(row.score),
    level: row.level ?? "",
    summary: s.summary ?? "",
    itemAnalysis: s.itemAnalysis ?? [],
    risks: s.risks ?? [],
    suggestions: s.suggestions ?? [],
    medicalAdvice: s.medicalAdvice ?? "",
    evidence: s.evidence ?? [],
    planCompletion: s.planCompletion ?? null,
    comparison:
      s.comparison ??
      (prevRow
        ? buildReportComparison(
            comparisonSideOf(row),
            comparisonSideOf(prevRow)
          )
        : null),
    radar: parseJson<RadarPoint[]>(row.radar, []),
    trend: parseJson<TrendPoint[]>(row.trend, [])
  };
}

/** 查报告（限定归属，查不到返回 undefined，调用方统一 404） */
function findReport(id: number, userId: number): ReportRow | undefined {
  return db
    .prepare(
      `SELECT id, period_start, period_end, score, level, summary, radar, trend, create_time
       FROM reports WHERE id = ? AND user_id = ?`
    )
    .get(id, userId) as ReportRow | undefined;
}

/** 取当前用户最近一份报告（id 最大即最近生成；生成新报告前调用，拿到的就是「上一份」） */
function latestReport(userId: number): ReportRow | undefined {
  return db
    .prepare(
      `SELECT id, period_start, period_end, score, level, summary, radar, trend, create_time
       FROM reports WHERE user_id = ? ORDER BY id DESC LIMIT 1`
    )
    .get(userId) as ReportRow | undefined;
}

/**
 * 报告里的计划完成率 → 对比用取值。
 * C1 的 `planCompletionIn` 在「窗口内没有计划」时返回的是 planId=0 的哨兵对象（rate 也是 0），
 * 直接拿 rate 参与对比会把「本周期没有计划」显示成「完成率 0%，与上周期持平」。
 * 这里按 C1 自己的哨兵（planId）折算成 null，rate 本身不另做换算。
 */
function planRateOf(pc: PlanCompletion | null | undefined): number | null {
  return pc && pc.planId > 0 ? pc.rate : null;
}

/**
 * 数据库行 → 对比用的一侧。
 * 全部取自该报告已存的字段（评分/等级/风险点/planCompletion.rate），不重新跑规则引擎，
 * 保证「对比结论」与两份报告本身永远一致、可复算。
 */
function comparisonSideOf(row: ReportRow): ComparisonSide {
  const s = parseJson<ReportSummaryPayload>(row.summary, {});
  return {
    reportId: String(row.id),
    period: periodOf(row.period_start, row.period_end),
    generateTime: toIso(row.create_time),
    score: toNumber(row.score),
    level: row.level ?? "",
    risks: s.risks ?? [],
    planRate: planRateOf(s.planCompletion)
  };
}

/**
 * POST /api/health/report/generate —— 生成报告：取当前用户记录（可按时间段过滤）→ 规则引擎 → 落 reports 表。
 * 报告正文（总体评价/分项分析/风险点/建议/就医提醒）存 summary 列，雷达与趋势各存一列 JSON；
 * 落库后立刻出现在 GET /health/report/history 里（同一张表、同一数据源）。
 */
router.post("/health/report/generate", authMiddleware, (req, res) => {
  const userId = req.user!.id;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const startDate = toText(body.startDate);
  const endDate = toText(body.endDate);

  // 与 mock 一致：只在传了对应端点时才按日期过滤
  const records = recordsForEngine(userId).filter(
    r =>
      (!startDate || (r.date ?? "") >= startDate) &&
      (!endDate || (r.date ?? "") <= endDate)
  );
  const content = buildReport(
    records,
    profileForEngine(userId),
    startDate,
    endDate
  );

  // C1：计划完成情况（与 plans/:id/progress 同一口径）——窗口取报告时间段，
  // 未指定时间段时用最早记录日期 ~ 今天。
  const today = fmtDate(new Date());
  const pcStart =
    startDate ||
    (records.length > 0 ? (records[records.length - 1].date ?? today) : today);
  const pcEnd = endDate || today;
  const planCompletion = planCompletionIn(userId, pcStart, pcEnd, today);

  // C3：与「上一份报告」对比（第一份报告没有上期 → null，前端降级展示「暂无上周期报告」）。
  // 注意必须在 INSERT 之前取上期，否则拿到的是刚生成的这份。
  const prevRow = latestReport(userId);
  const comparison = buildReportComparison(
    {
      score: content.score,
      level: content.level,
      risks: content.risks,
      planRate: planRateOf(planCompletion)
    },
    prevRow ? comparisonSideOf(prevRow) : null
  );

  const info = db
    .prepare(
      `INSERT INTO reports (
         user_id, period_start, period_end, score, level, summary, radar, trend, create_time
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))`
    )
    .run(
      userId,
      startDate,
      endDate,
      content.score,
      content.level,
      JSON.stringify({
        summary: content.summary,
        itemAnalysis: content.itemAnalysis,
        risks: content.risks,
        suggestions: content.suggestions,
        medicalAdvice: content.medicalAdvice,
        evidence: content.evidence,
        planCompletion,
        comparison
      }),
      JSON.stringify(content.radar),
      JSON.stringify(content.trend)
    );

  // 每用户最多保留 20 份（方案 B5 明确要求，与 mock 的 `unshift + slice(0,20)` 行为对齐）：
  // 超出的删最旧。按 id DESC 判定新旧（id 即生成顺序，比秒级 create_time 更稳）。
  db.prepare(
    `DELETE FROM reports
     WHERE user_id = ?
       AND id NOT IN (
         SELECT id FROM reports WHERE user_id = ? ORDER BY id DESC LIMIT ${REPORT_KEEP_LIMIT}
       )`
  ).run(userId, userId);

  // C5：报告生成留痕（只记报告 id / 评分等级 / 参与分析的记录条数与时间段，不含报告正文）
  writeAudit(
    "report_generate",
    {
      reportId: String(info.lastInsertRowid),
      score: content.score,
      level: content.level,
      recordCount: records.length,
      periodStart: startDate || "",
      periodEnd: endDate || ""
    },
    actorOf(req)
  );

  res.json({
    code: 0,
    message: "操作成功",
    data: toReport(findReport(Number(info.lastInsertRowid), userId)!)
  });
});

/**
 * GET /api/health/report/history —— 当前用户的报告摘要列表（按生成时间倒序）。
 * ⚠️ 必须注册在 `/health/report/:id` 之前，否则会被 `:id` 抢走匹配。
 */
router.get("/health/report/history", authMiddleware, (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, period_start, period_end, score, level, summary, radar, trend, create_time
       FROM reports WHERE user_id = ? ORDER BY create_time DESC, id DESC`
    )
    .all(req.user!.id) as ReportRow[];

  res.json({
    code: 0,
    message: "操作成功",
    data: rows.map(row => ({
      id: String(row.id),
      generateTime: toIso(row.create_time),
      period: periodOf(row.period_start, row.period_end),
      score: toNumber(row.score),
      level: row.level ?? ""
    }))
  });
});

/** GET /api/health/report/:id —— 报告详情（非本人或不存在一律 404，防越权） */
router.get("/health/report/:id", authMiddleware, (req, res) => {
  const id = parseId(req.params.id);
  const row = id === null ? undefined : findReport(id, req.user!.id);
  if (!row) {
    res.status(404).json({ code: 404, message: "报告不存在" });
    return;
  }
  res.json({
    code: 0,
    message: "操作成功",
    data: toReport(row, prevReportOf(row.id, req.user!.id))
  });
});

/** 「报告」意图只需要摘要三件套（与 mock 的 reports[0] 用法等价） */
export function recentReportSummaries(userId: number): Array<{
  period: string;
  score: number;
  level: string;
}> {
  const rows = db
    .prepare(
      `SELECT period_start, period_end, score, level FROM reports
       WHERE user_id = ? ORDER BY id DESC LIMIT 5`
    )
    .all(userId) as Array<{
    period_start: string | null;
    period_end: string | null;
    score: number | null;
    level: string | null;
  }>;
  return rows.map(r => ({
    period: periodOf(r.period_start, r.period_end),
    score: toNumber(r.score),
    level: r.level ?? ""
  }));
}

export default router;
