/**
 * V2.2 P2-2 P2：Review Agent。
 * 根据计划完成率 + 前后 7 天数据变化生成复评。LLM 失败模板降级，不编造数据。
 */
import db, { ensureDailyHealth } from "../db.js";
import { callLlm, llmAvailable } from "../llm.js";
import { COACH_ROLE_PROMPT } from "./coach-context.js";
import { planProgress, type PlanFrequency } from "../../shared/health-plan.js";
import { todayStr } from "../../shared/date-utils.js";

export interface ReviewChange {
  metric: string;
  before: string;
  after: string;
  trend: "improve" | "stable" | "decline";
}
export interface ReviewResult {
  summary: string;
  completionRate: number;
  changes: ReviewChange[];
  evaluation: string;
  nextSuggestions: string[];
  confidence: "high" | "low";
  source: "ai" | "rule";
}

interface PlanRow {
  title: string;
  create_time: string;
}

/**
 * 计划完成率。
 *
 * 历史 bug（本次 e2e 才暴露）：
 *   旧实现写了 `FROM task_checkins c JOIN health_plans p ON p.id = c.plan_id ... AND c.done = 1`，
 *   但 `task_checkins` 根本没有 `plan_id` / `done` 两列（只有 id/user_id/task_id/value/note/checked_date），
 *   SQL 直接抛异常 → 被路由 catch 吞成「复评失败」→ **复评功能从未真正成功过**。
 *
 * 修法：不再自己算一套，改用共享层 `planProgress`（与计划页 /api/health/plans 同源唯一口径）。
 */
function calcCompletion(planId: number, userId: number): number {
  ensureDailyHealth();
  const plan = db
    .prepare(
      "SELECT start_date, end_date FROM health_plans WHERE id = ? AND user_id = ?"
    )
    .get(planId, userId) as
    { start_date: string; end_date: string } | undefined;
  if (!plan) return 0;

  const tasks = db
    .prepare(
      "SELECT id, title, frequency FROM plan_tasks WHERE plan_id = ? ORDER BY sort_order, id"
    )
    .all(planId) as Array<{
    id: number;
    title: string;
    frequency: PlanFrequency;
  }>;
  if (!tasks.length) return 0;

  // 打卡行必须同时绑定 user_id，避免读到他人在同一 task 上的打卡
  const checkins = db
    .prepare(
      `SELECT task_id, checked_date FROM task_checkins
        WHERE user_id = ? AND task_id IN (${tasks.map(() => "?").join(",")})`
    )
    .all(userId, ...tasks.map(t => t.id)) as Array<{
    task_id: number;
    checked_date: string;
  }>;

  const today = todayStr();
  return planProgress(
    planId,
    tasks.map(t => ({ id: t.id, frequency: t.frequency, title: t.title })),
    checkins.map(c => ({ taskId: c.task_id, checkedDate: c.checked_date })),
    plan.start_date,
    plan.end_date,
    today
  ).rate;
}

/**
 * 指定日期区间内某指标均值。
 *
 * fromDays/toDays 为「距今多少天」，区间为 [toDays, fromDays]，
 * 用于构造**互不重叠**的前后对比窗口：
 *   当前窗口 = 最近 7 天      → avgMetric(userId, 0, 7, col)
 *   对照窗口 = 第 8~14 天     → avgMetric(userId, 7, 14, col)
 * 旧实现用 (7天) 对比 (14天)，后者包含前者，窗口重叠会把差值稀释甚至反向。
 */
function avgMetric(
  userId: number,
  fromDays: number,
  toDays: number,
  col: string
): number | null {
  // 列名来自本文件内的白名单常量，非用户输入，无注入风险
  try {
    const r = db
      .prepare(
        `SELECT AVG(${col}) v FROM daily_health_records
         WHERE user_id = ?
           AND date < date('now', 'localtime', ?)
           AND date >= date('now', 'localtime', ?)`
      )
      .get(userId, `-${fromDays} days`, `-${toDays} days`) as {
      v: number | null;
    };
    return r.v;
  } catch {
    return null;
  }
}

export async function reviewPlan(
  userId: number,
  planId: number
): Promise<ReviewResult | { forbidden: true }> {
  // 归属校验前置：计划不属于当前用户直接拒绝，不返回任何完成率数据
  // 列名必须是 create_time（health_plans 无 created_at）。
  // 写错列名时 db.prepare 会抛异常，被路由 catch 统一吞成「复评失败」，
  // 越权 403 分支永远走不到 —— 这是本次 e2e 实测才暴露出来的真实阻塞性 bug。
  const plan = db
    .prepare(
      "SELECT title, create_time FROM health_plans WHERE id = ? AND user_id = ?"
    )
    .get(planId, userId) as PlanRow | undefined;
  if (!plan) return { forbidden: true };
  const rate = calcCompletion(planId, userId);

  // 前后对比（近7天 vs 7~14天前）
  const metrics: Array<{
    key: string;
    label: string;
    col: string;
    higherBetter: boolean;
  }> = [
    { key: "sleep", label: "睡眠时长", col: "sleep_hours", higherBetter: true },
    {
      key: "exercise",
      label: "运动分钟",
      col: "exercise_minutes",
      higherBetter: true
    },
    {
      key: "stress",
      label: "压力水平",
      col: "stress_level",
      higherBetter: false
    }
  ];
  const changes: ReviewChange[] = [];
  for (const m of metrics) {
    // 当前 = 最近 7 天；对照 = 第 8~14 天。两个窗口互不重叠。
    const now = avgMetric(userId, 0, 7, m.col);
    const before = avgMetric(userId, 7, 14, m.col);
    if (now == null || before == null) continue;
    const diff = now - before;
    let trend: ReviewChange["trend"] = "stable";
    if (Math.abs(diff) >= 0.5)
      trend = diff > 0 === m.higherBetter ? "improve" : "decline";
    changes.push({
      metric: m.label,
      before: before.toFixed(1),
      after: now.toFixed(1),
      trend
    });
  }
  const confidence = changes.length >= 2 ? "high" : "low";

  // 规则评价
  let evaluation: string;
  if (rate >= 80) evaluation = "计划执行情况良好，可继续保持并逐步加码目标。";
  else if (rate >= 50)
    evaluation = "部分目标完成，建议降低单日难度、提高连续性。";
  else evaluation = "完成率偏低，建议把目标拆得更小、更易执行。";

  if (!llmAvailable()) {
    return {
      summary: `「${plan?.title ?? "健康计划"}」完成率约 ${rate}%。`,
      completionRate: rate,
      changes,
      evaluation,
      nextSuggestions: ["保持连续记录", "把难目标拆小", "每周复盘一次"],
      confidence,
      source: "rule"
    };
  }

  try {
    const prompt = [
      COACH_ROLE_PROMPT,
      `计划：${plan?.title ?? ""}；完成率 ${rate}%；指标变化：${JSON.stringify(changes)}。`,
      '请输出 JSON：{"summary":"","evaluation":"","nextSuggestions":["","\u007d。只输出 JSON。'
    ].join("\n");
    const r = await callLlm([{ role: "system", content: prompt }]);
    const m = r.text.match(/\{[\s\S]*\}/);
    if (m) {
      const obj = JSON.parse(m[0]) as {
        summary?: string;
        evaluation?: string;
        nextSuggestions?: string[];
      };
      return {
        summary: obj.summary ?? `完成率约 ${rate}%。`,
        completionRate: rate,
        changes,
        evaluation: obj.evaluation ?? evaluation,
        nextSuggestions: obj.nextSuggestions ?? [],
        confidence,
        source: "ai"
      };
    }
  } catch (err) {
    // 同上：复评静默降级会让评委把规则总结误当成 AI 复评结论
    console.warn(
      "[health-review-agent] LLM 复评解析失败，降级为规则复评:",
      err
    );
  }

  return {
    summary: `「${plan?.title ?? "健康计划"}」完成率约 ${rate}%。`,
    completionRate: rate,
    changes,
    evaluation,
    nextSuggestions: ["保持连续记录", "把难目标拆小"],
    confidence,
    source: "rule"
  };
}
