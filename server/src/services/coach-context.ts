/**
 * V2.0 P2-1：AI 校园健康教练上下文。
 * 在既有 buildHealthContext（健康数据摘要）基础上，注入：
 *   - 教练角色人设
 *   - 学生画像
 *   - 最新 ML 风险预测 + SHAP 因素
 * 只描述生活方式风险，不做疾病诊断。
 */
import db from "../db.js";
import { retrieveKnowledge } from "./health-knowledge.js";

interface StudentRow {
  grade: string;
  major: string;
  sedentary_hours: number;
  study_hours: number;
  bedtime: string;
}

function latestRisk(userId: number) {
  const row = db
    .prepare(
      `SELECT risk_level, risk_probability, shap_factors, model_version, created_at
       FROM risk_predictions WHERE user_id = ? ORDER BY id DESC LIMIT 1`
    )
    .get(userId) as
    | {
        risk_level: string;
        risk_probability: number;
        shap_factors: string;
        model_version: string;
        created_at: string;
      }
    | undefined;
  if (!row) return null;
  let factors: Array<{ label: string; direction: string }> = [];
  try {
    factors = (
      JSON.parse(row.shap_factors) as Array<{
        label: string;
        direction: string;
      }>
    ).slice(0, 3);
  } catch {
    factors = [];
  }
  return {
    level: row.risk_level,
    prob: Math.round(row.risk_probability * 100),
    factors,
    model: row.model_version
  };
}

/** 教练角色 system 前缀（人设 + 回答规范） */
export const COACH_ROLE_PROMPT = `你是一名「校园健康教练」，面向大学生。
你的任务：根据学生的真实生活方式数据，帮助其改善睡眠、运动、压力管理与作息。
回答要求：
1. 结合用户真实数据，给具体、可执行、符合大学生日常的建议；
2. 不做疾病诊断、不开药、不预测疾病；
3. 用「风险倾向 / 影响因素 / 改善建议」这类生活方式语言，避免医疗断言；
4. 语气像贴心的学长教练，简洁有重点。`;

/**
 * V2.2 P2-1：RAG 知识检索。
 * 综合 用户问题 + 风险因素 + 行为类型 检索 Top-3 生活方式知识。
 * 命中不足时返回空（不强行注入）。
 */
export function buildKnowledgeContext(opts: {
  query?: string;
  riskFactors?: string[];
}): string {
  const cats: string[] = [];
  const joined = (opts.riskFactors ?? []).join(" ");
  if (/睡眠|熬夜|作息/.test(joined)) cats.push("sleep");
  if (/压力|情绪|考试/.test(joined)) cats.push("stress");
  if (/运动|久坐|活动/.test(joined)) cats.push("exercise");
  if (/饮食|早餐|规律/.test(joined)) cats.push("diet");
  cats.push("lifestyle");

  const { found, hits } = retrieveKnowledge({
    query: opts.query,
    riskFactors: opts.riskFactors,
    categories: cats,
    topK: 3
  });
  if (!found) return "";
  const lines = hits.map((h, i) => `${i + 1}.《${h.title}》：${h.content}`);
  return [
    "【参考健康知识】（结合当前生活方式因素检索，仅供参考）",
    ...lines
  ].join("\n");
}

/** 生成教练视角的用户近况摘要（拼在健康数据摘要之后） */
export function buildCoachContext(userId: number): string {
  const lines: string[] = [];
  const sp = db
    .prepare(
      "SELECT grade, major, sedentary_hours, study_hours, bedtime FROM student_profile WHERE user_id = ?"
    )
    .get(userId) as StudentRow | undefined;
  if (sp) {
    lines.push(
      `【学生画像】${sp.grade}，${sp.major}；日均久坐约${sp.sedentary_hours}小时、学习约${sp.study_hours}小时；习惯就寝约${sp.bedtime}。`
    );
  }
  const risk = latestRisk(userId);
  if (risk) {
    const levelText =
      risk.level === "high" ? "高" : risk.level === "medium" ? "中" : "低";
    lines.push(
      `【近期风险倾向】${levelText}风险（约${risk.prob}%），来自${risk.model}。`
    );
    if (risk.factors.length) {
      lines.push(
        "【主要影响因素】" +
          risk.factors
            .map(
              (f, i) =>
                `${i + 1}.${f.label}（${f.direction === "raise_risk" ? "升高风险" : "降低风险"}）`
            )
            .join("；")
      );
    }
    lines.push(
      "请围绕上述影响因素，给出本周可执行的改善动作（睡眠/运动/久坐/压力）。"
    );
  }
  return lines.join("\n");
}
