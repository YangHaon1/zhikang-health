/**
 * V2.2 P2-2 P1：Plan Agent。
 * 把 Analyze 结果转成结构化 7 天可执行计划。LLM 失败模板降级。
 */
import { callLlm, llmAvailable } from "../llm.js";
import { COACH_ROLE_PROMPT } from "./coach-context.js";

export interface PlanGoal {
  name: string;
  reason: string;
  target: string;
}
export interface PlanTask {
  day: number;
  title: string;
  category: string;
  action: string;
  duration: string;
}
export interface PlanResult {
  title: string;
  goals: PlanGoal[];
  tasks: PlanTask[];
  source: "ai" | "rule";
}

function rulePlan(): PlanResult {
  return {
    title: "7 天生活方式改善计划",
    goals: [
      { name: "固定作息", reason: "睡眠不足影响恢复", target: "23:30 前入睡" },
      {
        name: "规律运动",
        reason: "运动频率偏低",
        target: "本周 3 次 30 分钟活动"
      },
      {
        name: "减少久坐",
        reason: "连续久坐过长",
        target: "每学习 50 分钟活动 5 分钟"
      }
    ],
    tasks: [
      {
        day: 1,
        title: "记录今日作息",
        category: "作息",
        action: "记录昨晚入睡和今早起床时间",
        duration: "2 分钟"
      },
      {
        day: 2,
        title: "固定早睡",
        category: "作息",
        action: "23:30 前放下手机准备睡觉",
        duration: "晚上"
      },
      {
        day: 3,
        title: "轻量活动",
        category: "运动",
        action: "快走或拉伸 20 分钟",
        duration: "20 分钟"
      },
      {
        day: 4,
        title: "久坐打断",
        category: "运动",
        action: "每学习 50 分钟起身活动 5 分钟",
        duration: "全天"
      },
      {
        day: 5,
        title: "规律三餐",
        category: "饮食",
        action: "今天吃早餐，不暴饮暴食",
        duration: "全天"
      },
      {
        day: 6,
        title: "运动加量",
        category: "运动",
        action: "慢跑/骑行 30 分钟",
        duration: "30 分钟"
      },
      {
        day: 7,
        title: "周复盘",
        category: "复盘",
        action: "回顾本周变化，下周继续保持",
        duration: "10 分钟"
      }
    ],
    source: "rule"
  };
}

export async function generatePlan(opts: {
  summary: string;
  healthType: string;
}): Promise<PlanResult> {
  if (!llmAvailable()) return rulePlan();
  const prompt = [
    COACH_ROLE_PROMPT,
    `学生状态：${opts.summary}；行为画像：${opts.healthType || "未识别"}。`,
    '请输出 JSON：{"title":"","goals":[{"name":"","reason":"","target":""}],"tasks":[{"day":1,"title":"","category":"睡眠|运动|饮食|作息|压力","action":"","duration":""}]}。共 7 天，每天 1-2 个任务，符合大学生场景。只输出 JSON。'
  ].join("\n");
  try {
    const r = await callLlm([{ role: "system", content: prompt }]);
    const m = r.text.match(/\{[\s\S]*\}/);
    if (m) {
      const obj = JSON.parse(m[0]) as PlanResult;
      if (obj.tasks?.length) return { ...obj, source: "ai" };
    }
  } catch {
    /* fallthrough */
  }
  return rulePlan();
}
