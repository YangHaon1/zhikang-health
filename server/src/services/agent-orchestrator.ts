/**
 * Agent 编排器：把 Analyze → Plan → Review 串成一条真实工作流。
 *
 * 为什么需要这一层：
 *   之前三个 Agent 是三个彼此独立的接口，没有任何数据传递 ——
 *   planAgent 里甚至写死 `summary: ""`，Plan 完全拿不到 Analyze 的结论，
 *   UI 上看着像流水线，实际是三次互不相干的 LLM 调用。
 *
 * 编排器负责：
 *   1. 按序执行，把上一步的结构化输出作为下一步的输入；
 *   2. 任一步失败都不中断整条链（降级为规则结果后继续）；
 *   3. 对外只暴露「一次调用拿到完整结果」的接口，避免前端重复编排。
 */
import { analyzeHealth, type AgentAnalysis } from "./health-agent.js";
import { generatePlan, type PlanResult } from "./health-plan-agent.js";
import { reviewPlan } from "./health-review-agent.js";
import { analyzeHealthType } from "./health-type.js";

export interface WorkflowStep {
  name: string;
  /** 该步骤的真实数据来源：ai = 大模型产出，rule = 规则降级 */
  source: "ai" | "rule";
  /** 失败时为 true（已降级，但工作流继续） */
  degraded: boolean;
}

export interface AnalyzeToPlanResult {
  analysis: AgentAnalysis;
  plan: PlanResult;
  /** 传递给下一步的上下文，便于调用方/日志核对链路 */
  context: {
    risk?: string;
    reason?: string;
    summary: string;
    healthType: string;
  };
  steps: WorkflowStep[];
}

/**
 * 用户数据 → Analyze Agent → 风险总结 → Plan Agent → 健康计划
 */
export async function runAnalyzeToPlan(
  userId: number
): Promise<AnalyzeToPlanResult> {
  const steps: WorkflowStep[] = [];
  const healthType = analyzeHealthType(userId);
  const healthTypeName = healthType?.name ?? "";

  // 1) Analyze
  const analysis = await analyzeHealth(userId, healthTypeName);
  steps.push({
    name: "analyze",
    source: analysis.source,
    degraded: analysis.source === "rule"
  });

  // 2) 把 Analyze 的结论整理成 Plan 的入参（这一步就是"链路"本身）
  const reason = (analysis.keyProblems ?? [])
    .map(p => `${p.factor}：${p.reason}`)
    .join("；");
  const risk = analysis.currentStatus?.riskLevel;
  const summary = analysis.summary ?? "";

  const plan = await generatePlan({
    summary,
    healthType: healthTypeName,
    risk,
    reason
  });
  steps.push({
    name: "plan",
    source: plan.source,
    degraded: plan.source === "rule"
  });

  return {
    analysis,
    plan,
    context: { risk, reason, summary, healthType: healthTypeName },
    steps
  };
}

/**
 * 健康计划 → Review Agent → 效果反馈。
 * 计划不属于当前用户时返回 forbidden，由路由转成 403。
 */
export async function runReview(userId: number, planId: number) {
  const result = await reviewPlan(userId, planId);
  if ("forbidden" in result) {
    return { forbidden: true as const, steps: [] as WorkflowStep[] };
  }
  return {
    forbidden: false as const,
    review: result,
    steps: [
      {
        name: "review",
        source: result.source,
        degraded: result.source === "rule"
      }
    ]
  };
}

/**
 * 完整闭环：Analyze → Plan → （可选）Review。
 * withPlanId 有值时，在计划生成后追加一步复评，输出结果反馈。
 */
export async function runAgentWorkflow(
  userId: number,
  withPlanId?: number
): Promise<AnalyzeToPlanResult & { review?: unknown; forbidden?: boolean }> {
  const base = await runAnalyzeToPlan(userId);
  if (!withPlanId) return base;

  const r = await runReview(userId, withPlanId);
  if (r.forbidden) return { ...base, forbidden: true };
  return { ...base, review: r.review, steps: [...base.steps, ...r.steps] };
}
