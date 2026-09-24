/**
 * V2.2 P2-2 P2：Review Agent。
 * 根据计划完成率 + 前后 7 天数据变化生成复评。LLM 失败模板降级，不编造数据。
 */
import db from "../db.js";
import { callLlm, llmAvailable } from "../llm.js";
import { COACH_ROLE_PROMPT } from "./coach-context.js";

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
  created_at: string;
}

function calcCompletion(planId: number): number {
  const tasks = db
    .prepare("SELECT COUNT(*) c FROM plan_tasks WHERE plan_id = ?")
    .get(planId) as { c: number };
  const done = db
    .prepare(
      "SELECT COUNT(*) c FROM task_checkins WHERE plan_id = ? AND done = 1"
    )
    .get(planId) as { c: number };
  if (!tasks.c) return 0;
  return Math.round((done.c / tasks.c) * 100);
}

/** 近 N 天某指标均值（简单聚合，不足返回 null） */
function avgMetric(userId: number, days: number, col: string): number | null {
  try {
    const r = db
      .prepare(
        `SELECT AVG(${col}) v FROM daily_health_records
         WHERE user_id = ? AND date >= date('now', ?)`
      )
      .get(userId, `-${days} day`) as { v: number | null };
    return r.v;
  } catch {
    return null;
  }
}

export async function reviewPlan(
  userId: number,
  planId: number
): Promise<ReviewResult> {
  const plan = db
    .prepare(
      "SELECT title, created_at FROM health_plans WHERE id = ? AND user_id = ?"
    )
    .get(planId, userId) as PlanRow | undefined;
  const rate = calcCompletion(planId);

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
    const now = avgMetric(userId, 7, m.col);
    const before = avgMetric(userId, 14, m.col);
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
  } catch {
    /* fallthrough */
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
