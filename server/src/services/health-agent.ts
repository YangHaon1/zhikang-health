/**
 * V2.2 P2-2 P0：AI 健康分析 Agent。
 * 整合 risk + SHAP + healthType + profile + 近7天数据 + RAG，输出结构化分析。
 * LLM 失败自动模板降级，不阻塞主流程。
 */
import db from "../db.js";
import { callLlm, llmAvailable } from "../llm.js";
import { COACH_ROLE_PROMPT, buildKnowledgeContext } from "./coach-context.js";

export interface AgentKeyProblem {
  factor: string;
  reason: string;
  impact: string;
}

export interface AgentAnalysis {
  summary: string;
  currentStatus: { riskLevel: string; healthType: string; description: string };
  keyProblems: AgentKeyProblem[];
  suggestions: string[];
  source: "ai" | "rule";
}

interface RiskRow {
  risk_level: string;
  risk_probability: number;
  shap_factors: string;
}

/** 取最新风险 + SHAP */
function latestRisk(userId: number) {
  const row = db
    .prepare(
      "SELECT risk_level, risk_probability, shap_factors FROM risk_predictions WHERE user_id = ? ORDER BY id DESC LIMIT 1"
    )
    .get(userId) as RiskRow | undefined;
  if (!row) return null;
  let factors: Array<{ label: string; direction: string }> = [];
  try {
    factors = JSON.parse(row.shap_factors).slice(0, 3);
  } catch {
    factors = [];
  }
  return {
    level: row.risk_level,
    prob: Math.round(row.risk_probability * 100),
    factors
  };
}

/** 规则模板分析（兜底） */
function ruleAnalysis(
  userId: number,
  risk: NonNullable<ReturnType<typeof latestRisk>> | null,
  healthTypeName: string
): AgentAnalysis {
  const level =
    risk?.level === "high" ? "高" : risk?.level === "medium" ? "中" : "低";
  const problems: AgentKeyProblem[] = (risk?.factors ?? []).map(f => ({
    factor: f.label,
    reason:
      f.direction === "raise_risk"
        ? "该行为与风险升高相关"
        : "该行为对风险有改善作用",
    impact: "建议作为本周重点调整项"
  }));
  return {
    summary: `当前属于${level}风险倾向${healthTypeName ? `，行为画像为「${healthTypeName}」` : ""}。`,
    currentStatus: {
      riskLevel: risk?.level ?? "unknown",
      healthType: healthTypeName,
      description: ""
    },
    keyProblems: problems,
    suggestions: ["固定作息", "每周规律运动", "学习间隙活动", "规律三餐"],
    source: "rule"
  };
}

/** 生成 AI 健康分析报告 */
export async function analyzeHealth(
  userId: number,
  healthTypeName: string
): Promise<AgentAnalysis> {
  const risk = latestRisk(userId);
  if (!risk || !llmAvailable())
    return ruleAnalysis(userId, risk, healthTypeName);

  const factorText = risk.factors
    .map(
      f => `${f.label}(${f.direction === "raise_risk" ? "升高风险" : "改善"})`
    )
    .join("、");
  const knowCtx = buildKnowledgeContext({
    riskFactors: risk.factors.map(f => f.label)
  });

  const prompt = [
    COACH_ROLE_PROMPT,
    `学生当前风险：${risk.level}（约${risk.prob}%）；行为画像：${healthTypeName || "未识别"}；主要因素：${factorText || "无"}。`,
    knowCtx,
    '请输出 JSON：{"summary":"一句话总结","keyProblems":[{"factor":"","reason":"","impact":""}],"suggestions":["",""\u007d。只输出 JSON，不要多余文字。'
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const r = await callLlm([{ role: "system", content: prompt }]);
    const m = r.text.match(/\{[\s\S]*\}/);
    if (m) {
      const obj = JSON.parse(m[0]) as {
        summary?: string;
        keyProblems?: AgentKeyProblem[];
        suggestions?: string[];
      };
      return {
        summary:
          obj.summary ?? ruleAnalysis(userId, risk, healthTypeName).summary,
        currentStatus: {
          riskLevel: risk.level,
          healthType: healthTypeName,
          description: ""
        },
        keyProblems: obj.keyProblems ?? [],
        suggestions: obj.suggestions ?? [],
        source: "ai"
      };
    }
  } catch (err) {
    // 静默降级到这里，界面只会看到规则文案、看不出是兜底来的。
    // 现场如果展示的是规则结果，必须能在服务端日志里查到原因，
    // 否则「AI 没输出」和「AI 输出了但解析失败」无从区分。
    console.warn("[health-agent] LLM 解析失败，降级为规则分析:", err);
  }
  return ruleAnalysis(userId, risk, healthTypeName);
}
