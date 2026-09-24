/**
 * 健康上下文服务（V1.5）：为 LLM 对话生成「当前用户的结构化健康摘要」。
 *
 * 背景：原 chat.ts 的 LLM 分支只把前端 messages 发给大模型，模型对用户的血压/血糖/
 * 档案/风险一无所知，只能泛泛回答。本服务复用规则引擎同一套取数函数
 * （profileForEngine / recordsForEngine / recentReportSummaries），把最近数据压缩成一段
 * 简短中文摘要，作为 system 上下文前置注入，让 LLM 回答能引用真实指标。
 *
 * 边界：
 * - 只取最近有限条数（最新记录 + 最近5份报告），不导出整库；
 * - 不含数据库原始字段、不含用户标识、长度受限；
 * - 明确提示「仅供健康参考，不构成诊断」。
 */
import { profileForEngine, recordsForEngine } from "../routes/health/common.js";
import { recentReportSummaries } from "../routes/health/report.js";

/** 取数值：undefined/null/NaN → 不输出 */
function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 生成给 LLM 的健康上下文文本。无档案/无记录时返回空串（调用方据此不注入）。
 */
export function buildHealthContext(userId: number): string {
  const profile = profileForEngine(userId);
  const records = recordsForEngine(userId);
  const reports = recentReportSummaries(userId);

  const lines: string[] = [];

  // 一、基础档案
  if (profile) {
    const sex = profile.gender === 1 ? "男" : "女";
    lines.push("【用户基础档案】");
    const p: string[] = [];
    if (profile.age) p.push(`${profile.age}岁`);
    p.push(sex);
    if (num(profile.height)) p.push(`身高${num(profile.height)}cm`);
    if (num(profile.weight)) p.push(`体重${num(profile.weight)}kg`);
    if (profile.smoking) p.push(`吸烟:${profile.smoking}`);
    if (profile.drinking) p.push(`饮酒:${profile.drinking}`);
    if (profile.exercise) p.push(`运动:${profile.exercise}`);
    lines.push(p.filter(Boolean).join("，"));
    if (profile.healthGoal) lines.push(`健康目标:${profile.healthGoal}`);
  }

  // 二、近期指标（最新一条记录）
  const latest = records[0];
  if (latest) {
    lines.push("【最新一次健康记录】");
    const m: string[] = [];
    if (latest.date) m.push(`日期${latest.date}`);
    if (num(latest.systolic) && num(latest.diastolic))
      m.push(`血压${num(latest.systolic)}/${num(latest.diastolic)}mmHg`);
    if (num(latest.fastingGlucose))
      m.push(`空腹血糖${num(latest.fastingGlucose)}mmol/L`);
    if (num(latest.postprandialGlucose))
      m.push(`餐后血糖${num(latest.postprandialGlucose)}mmol/L`);
    if (num(latest.totalCholesterol))
      m.push(`总胆固醇${num(latest.totalCholesterol)}`);
    if (num(latest.ldl)) m.push(`LDL${num(latest.ldl)}`);
    if (num(latest.hdl)) m.push(`HDL${num(latest.hdl)}`);
    if (num(latest.heartRate)) m.push(`心率${num(latest.heartRate)}`);
    if (num(latest.weight)) m.push(`体重${num(latest.weight)}kg`);
    lines.push(m.filter(Boolean).join("，"));
  }

  // 三、历史报告
  if (reports.length) {
    lines.push("【近期健康报告】");
    for (const r of reports.slice(0, 3)) {
      lines.push(`${r.period}: 评分${r.score}（${r.level}）`);
    }
  }

  if (!lines.length) return "";

  lines.push(
    "以上为系统采集的用户健康数据，仅供健康管理参考，不构成疾病诊断；回答时请引用这些真实数值，异常时提醒及时就医。"
  );
  return lines.join("\n");
}
