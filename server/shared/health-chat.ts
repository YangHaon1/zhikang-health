// AI 健康对话·方案 A 内核（唯一源码）
// ★ 后端（server/src/routes/health.ts 的 /api/health/chat）与前端（@shared 别名）共用这一份，切勿双写。
// 纯函数、禁 Node/DOM 依赖 —— 因此可同时被 Express 与浏览器加载。
//
// 流程：关键词意图匹配 → 取档案 + 最近 5 条记录 → 规则引擎（health-engine）→ 拼接自然语言回答。
// 问答全部基于用户自己的数据，不引入任何外部服务；方案 B（大模型）由后端另一条分支处理。
import {
  analyzeHealth,
  gradeBmi,
  gradeDiastolic,
  gradeFastingGlucose,
  gradeHdl,
  gradeLdl,
  gradeSystolic,
  gradeTotalCholesterol,
  gradeTriglyceride,
  worseGrade
} from "./health-engine.js";
import type { HealthProfile, HealthRecord } from "./health-engine.js";

/** 对话用到的报告摘要（reports 表的历史摘要，或 mock 的报告对象，两者字段都能满足） */
export interface ChatReportSummary {
  period?: string;
  score?: number;
  level?: string;
}

/** 对话上下文：回答所需的全部用户数据（由调用方按 user_id 取好） */
export interface ChatContext {
  profile: HealthProfile | null;
  records: HealthRecord[];
  reports: ChatReportSummary[];
}

/** 取最近一条含指定字段的记录 */
function latestWith(
  records: HealthRecord[],
  field: keyof HealthRecord
): HealthRecord | null {
  return (
    [...records]
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .find(r => r[field] != null) ?? null
  );
}

/** 最近 n 条记录（按日期倒序） */
function recentRecords(records: HealthRecord[], n: number): HealthRecord[] {
  return [...records].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, n);
}

/** 单条记录一行摘要 */
function briefOf(r: HealthRecord): string {
  const parts: string[] = [];
  if (r.systolic != null || r.diastolic != null)
    parts.push(`血压 ${r.systolic ?? "—"}/${r.diastolic ?? "—"}`);
  if (r.fastingGlucose != null) parts.push(`空腹血糖 ${r.fastingGlucose}`);
  if (r.weight != null) parts.push(`体重 ${r.weight}kg`);
  return parts.join("；");
}

/**
 * 组装自然语言回答（已注入档案 + 最近 5 条记录作为上下文）。
 * 六类意图：血压 / 血糖 / 血脂 / BMI 体重 / 报告 / 记录，外加「综合风险」「档案」两类补充，
 * 全部未命中时给通用建议 + 追问引导。
 */
export function chatAnswer(question: string, ctx: ChatContext): string {
  const { profile, records, reports } = ctx;
  const q = (question ?? "").trim();
  const analyze = records.length ? analyzeHealth(records, profile) : null;
  const recent5 = recentRecords(records, 5);
  const latest = recent5[0];

  if (!q) return "请问有什么可以帮您？";

  if (!profile && !records.length) {
    return "您好，我是智康健康助手。您还没有完善个人档案和健康记录，建议先到「我的健康」填写档案，再到「指标录入」添加指标，我就能为您解读血压、血糖、血脂并评估健康风险了。";
  }

  // 血压
  if (/血压|收缩压|舒张压|高压|低压/.test(q)) {
    const r =
      latestWith(records, "systolic") ?? latestWith(records, "diastolic");
    if (!r)
      return "您还没有血压记录，请先到「指标录入」添加一条血压数据，我就能帮您解读了。";
    const s = r.systolic != null ? `${r.systolic}` : "未测";
    const d = r.diastolic != null ? `${r.diastolic}` : "未测";
    const gs = r.systolic != null ? gradeSystolic(r.systolic) : null;
    const gd = r.diastolic != null ? gradeDiastolic(r.diastolic) : null;
    const worse = worseGrade(gs, gd);
    // worse 为 null 需 gs/gd 同时为 null，而上面已保证 r 至少有收缩压或舒张压 —— 不可达，仅作类型收窄
    const worseText = worse ? `${worse.grade}（${worse.desc}）` : "暂无分级";
    const list = recent5
      .filter(x => x.systolic != null || x.diastolic != null)
      .map(x => `${x.date}：${x.systolic ?? "—"}/${x.diastolic ?? "—"}`)
      .join("；");
    return (
      `您最近一次血压记录（${r.date}）为 ${s}/${d} mmHg，${worseText}。` +
      (list ? ` 近 5 次：${list}。` : "") +
      " 建议：低盐饮食（每日 <5g）、戒烟限酒、规律运动，并每日定时监测血压。"
    );
  }

  // 血糖
  if (/血糖|糖尿病|空腹|餐后/.test(q)) {
    const r =
      latestWith(records, "fastingGlucose") ??
      latestWith(records, "postprandialGlucose");
    if (!r) return "您还没有血糖记录，请先到「指标录入」添加血糖数据。";
    const list = recent5
      .filter(x => x.fastingGlucose != null)
      .map(x => `${x.date}：空腹 ${x.fastingGlucose}`)
      .join("；");
    const head =
      r.fastingGlucose != null
        ? `您最近一次空腹血糖（${r.date}）为 ${r.fastingGlucose} mmol/L，${
            gradeFastingGlucose(r.fastingGlucose).grade
          }（${gradeFastingGlucose(r.fastingGlucose).desc}）。`
        : `您最近一次血糖记录（${r.date}）餐后血糖为 ${r.postprandialGlucose} mmol/L。`;
    return (
      head +
      (list ? ` 近 5 次空腹血糖：${list}。` : "") +
      " 建议：控制精制碳水与含糖饮料，规律运动，持续监测空腹与餐后血糖。"
    );
  }

  // 血脂
  if (/血脂|胆固醇|甘油三酯|低密度|高密度|ldl|hdl/i.test(q)) {
    const r =
      latestWith(records, "totalCholesterol") ??
      latestWith(records, "triglyceride") ??
      latestWith(records, "ldl") ??
      latestWith(records, "hdl");
    if (!r)
      return "您还没有血脂记录，请先到「指标录入」添加血脂数据（总胆固醇/甘油三酯/低密度/高密度）。";
    const parts: string[] = [];
    if (r.totalCholesterol != null) {
      const g = gradeTotalCholesterol(r.totalCholesterol);
      parts.push(`总胆固醇 ${r.totalCholesterol}（${g.grade}）`);
    }
    if (r.triglyceride != null) {
      const g = gradeTriglyceride(r.triglyceride);
      parts.push(`甘油三酯 ${r.triglyceride}（${g.grade}）`);
    }
    if (r.ldl != null) {
      const g = gradeLdl(r.ldl);
      parts.push(`低密度脂蛋白 ${r.ldl}（${g.grade}）`);
    }
    if (r.hdl != null) {
      const g = gradeHdl(r.hdl, profile?.gender ?? 1);
      parts.push(`高密度脂蛋白 ${r.hdl}（${g.grade}）`);
    }
    return (
      `您最近一次血脂记录（${r.date}）：${parts.join("；")}。` +
      " 建议：低脂低胆固醇饮食，增加膳食纤维，戒烟限酒，必要时就医。"
    );
  }

  // BMI / 体重
  if (/bmi|体重|身高|胖|瘦|肥胖/i.test(q)) {
    const height = profile?.height;
    const weight = latest?.weight ?? profile?.weight;
    if (!height || !weight)
      return "计算 BMI 需要身高与体重，请先到「我的健康」完善档案，或在「指标录入」记录体重。";
    const bmi = gradeBmi(height, weight);
    // 身高体重都已非空，gradeBmi 不会返回 null —— 不可达，仅作类型收窄
    if (!bmi)
      return "计算 BMI 需要有效的身高与体重，请到「我的健康」核对档案。";
    return `您当前的 BMI 为 ${bmi.value}（${bmi.grade}，${bmi.desc}），标准范围 18.5~23.9。建议：均衡饮食 + 规律运动，维持健康体重。`;
  }

  // 报告
  if (/报告/.test(q)) {
    const rep = reports[0];
    if (rep)
      return `您最近一份健康报告（${rep.period}）综合评分 ${rep.score} 分，风险等级「${rep.level}」。可到「健康报告」页面查看完整内容。`;
    return "您还没有生成过健康报告，可到「健康报告」页面选择时间段生成一份。";
  }

  // 记录
  if (/记录|历史|数据|趋势|情况/.test(q)) {
    if (!records.length) return "您还没有健康记录，请先到「指标录入」添加。";
    const brief = recent5.map(x => `${x.date}：${briefOf(x)}`).join("；");
    return `您共有 ${records.length} 条健康记录，最近 ${recent5.length} 条如下：${brief}。`;
  }

  // 综合风险 / 评分 / 评估
  if (analyze && /风险|评分|评估|怎么样|状态/.test(q)) {
    const parts = [
      `根据您的档案与最近记录，综合风险等级为「${analyze.level}」，评分 ${analyze.score} 分（满分 100）。`
    ];
    if (analyze.risks.length)
      parts.push(`风险点：${analyze.risks.join("、")}。`);
    if (analyze.suggestions.length)
      parts.push(`建议：${analyze.suggestions.slice(0, 3).join(" ")}`);
    if (analyze.medicalAdvice) parts.push(`就医提醒：${analyze.medicalAdvice}`);
    return parts.join("");
  }

  // 档案
  if (/档案|个人信息|我的信息|姓名|年龄|性别|吸烟|饮酒|运动/.test(q)) {
    if (!profile) return "您还没有完善个人档案，请到「我的健康」填写。";
    return (
      `您的健康档案：${profile.name}，${profile.age} 岁，${
        profile.gender === 1 ? "男" : "女"
      }，身高 ${profile.height}cm，体重 ${profile.weight}kg。` +
      `吸烟：${profile.smoking}，饮酒：${profile.drinking}，运动：${profile.exercise}。`
    );
  }

  // 无意图命中：通用建议 + 引导
  const head = analyze
    ? `您最近一次综合评估风险等级为「${analyze.level}」、评分 ${analyze.score} 分。`
    : "保持均衡饮食、规律运动、定期体检是维护健康的基础。";
  return (
    head +
    " 我暂时无法精确理解您的问题，您可以这样问我：「我最近血压怎么样」「我的血糖正常吗」「评估一下健康风险」「查看最近记录」「解读我的报告」。"
  );
}
