/**
 * V2.0 P2-1：一键生成个性化改善方案。
 * POST /api/health/coach-plan —— 读最新 risk 快照 + SHAP → LLM 生成 7 天改善计划。
 * LLM 不可用时降级为模板方案。不写 health_plans，只返回方案 JSON（确认后再入库）。
 */
import { Router } from "express";
import db from "../../db.js";
import { authMiddleware } from "../../middleware/auth.js";
import { callLlm, llmAvailable } from "../../llm.js";
import { buildCoachContext } from "../../services/coach-context.js";
import { fmtDate, addDays } from "../../../shared/health-plan.js";
import { toText } from "./common.js";

const router = Router();

interface Goal {
  name: string;
  reason: string;
  action: string;
  duration: string;
}

interface CoachPlan {
  title: string;
  summary: string;
  goals: Goal[];
}

/** 模板方案：按 SHAP 因素映射到大学生可执行动作 */
function fallbackPlan(factors: Array<{ label: string }>): CoachPlan {
  const goalMap: Record<string, Goal> = {
    睡眠时长: {
      name: "固定睡眠时间",
      reason: "近期睡眠时长偏短",
      action: "每天 23:30 前准备入睡，保证约 7 小时睡眠",
      duration: "7 天"
    },
    平均睡眠质量: {
      name: "提升睡眠质量",
      reason: "睡眠质量自评偏低",
      action: "睡前 1 小时不刷手机，卧室保持黑暗安静",
      duration: "7 天"
    },
    平均压力: {
      name: "压力管理",
      reason: "近期压力水平偏高",
      action: "每天 10 分钟腹式呼吸或散步放松",
      duration: "7 天"
    },
    高压天数: {
      name: "减少连续高压",
      reason: "高压天数偏多",
      action: "学习 50 分钟后起身活动 5 分钟",
      duration: "7 天"
    },
    久坐时长: {
      name: "减少久坐",
      reason: "久坐时间过长",
      action: "每节课间起身走动，每天累计活动 30 分钟",
      duration: "7 天"
    },
    运动量: {
      name: "规律运动",
      reason: "周运动量不足",
      action: "每周 3 次、每次 30 分钟快走或慢跑",
      duration: "7 天"
    }
  };
  const goals: Goal[] = [];
  for (const f of factors) {
    for (const key of Object.keys(goalMap)) {
      if (
        f.label.includes(key) &&
        !goals.some(g => g.name === goalMap[key].name)
      ) {
        goals.push(goalMap[key]);
      }
    }
  }
  if (!goals.length) {
    goals.push({
      name: "规律作息",
      reason: "建立稳定生活节奏",
      action: "固定起床与睡觉时间，每天活动 30 分钟",
      duration: "7 天"
    });
  }
  return {
    title: "7 天健康改善计划",
    summary: "根据近期生活方式数据，为你制定以下本周可执行的改善动作。",
    goals: goals.slice(0, 4)
  };
}

router.post("/health/coach-plan", authMiddleware, async (req, res) => {
  const userId = req.user!.id;
  const row = db
    .prepare(
      `SELECT risk_level, shap_factors FROM risk_predictions WHERE user_id = ? ORDER BY id DESC LIMIT 1`
    )
    .get(userId) as { risk_level: string; shap_factors: string } | undefined;

  let factors: Array<{ label: string }> = [];
  try {
    factors = (row ? JSON.parse(row.shap_factors) : []) as Array<{
      label: string;
    }>;
  } catch {
    factors = [];
  }

  // LLM 可用时让它按结构生成；失败/无 Key 一律降级模板，前端无感知
  if (llmAvailable()) {
    try {
      const ctx = buildCoachContext(userId);
      const prompt = `${ctx}\n\n请输出 JSON：{"title":"...","summary":"...","goals":[{"name":"...","reason":"...","action":"...","duration":"7天"}]}。goals 3-4 条，针对上述影响因素，具体可执行。只输出 JSON。`;
      const r = await callLlm([
        { role: "system", content: "你是校园健康教练，只输出 JSON。" },
        { role: "user", content: prompt }
      ]);
      const m = r.text.match(/\{[\s\S]*\}/);
      if (m) {
        const plan = JSON.parse(m[0]) as CoachPlan;
        if (Array.isArray(plan.goals) && plan.goals.length) {
          res.json({
            code: 0,
            message: "操作成功",
            data: { source: "llm", ...plan }
          });
          return;
        }
      }
    } catch {
      //  fall through to template
    }
  }
  res.json({
    code: 0,
    message: "操作成功",
    data: { source: "template", ...fallbackPlan(factors) }
  });
});

/**
 * POST /api/health/coach-plan/confirm —— 用户采纳 AI 方案，落 health_plans + plan_tasks。
 * 入参：{ title, summary, goals:[{name, action, duration?}] }
 * source=ai_coach，任务统一 lifestyle + daily，周期默认 7 天。
 */
router.post("/health/coach-plan/confirm", authMiddleware, (req, res) => {
  const userId = req.user!.id;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const title = toText(body.title).trim() || "7天健康改善计划";
  const rawGoals = Array.isArray(body.goals)
    ? (body.goals as Array<Record<string, unknown>>)
    : [];
  if (!rawGoals.length) {
    res.status(400).json({ code: 40001, message: "方案需要至少一个目标" });
    return;
  }
  const start = fmtDate(new Date());
  const end = addDays(start, 6);

  const insertPlan = db.prepare(
    `INSERT INTO health_plans (user_id, title, risk_key, target_value, start_date, end_date, status, source, create_time)
     VALUES (?, ?, 'lifestyle', NULL, ?, ?, 'active', 'ai_coach', datetime('now','localtime'))`
  );
  const insertTask = db.prepare(
    `INSERT INTO plan_tasks (plan_id, title, task_type, frequency, sort_order) VALUES (?,?, 'lifestyle', 'daily', ?)`
  );
  const pid = db.transaction(() => {
    const info = insertPlan.run(userId, title, start, end);
    const id = Number(info.lastInsertRowid);
    rawGoals.slice(0, 6).forEach((g, i) => {
      const name = toText(g.name).trim() || "健康改善";
      const action = toText(g.action).trim();
      insertTask.run(id, action ? `${name}：${action}` : name, i);
    });
    return id;
  })();

  res.json({
    code: 0,
    message: "已加入我的健康计划",
    data: { planId: pid, startDate: start, endDate: end }
  });
});

export default router;
