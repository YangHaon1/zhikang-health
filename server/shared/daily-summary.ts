/**
 * M5 AI 健康陪伴共享层：每日健康总结 + 目标进度（纯函数，可复算、断网可用）。
 */

export interface DailySummaryInput {
  /** 昨日（最近一天）daily 记录，无则 null */
  yesterday: {
    sleepHours: number | null;
    exerciseMinutes: number | null;
    moodScore: number | null;
    dietHabit?: string | null;
  } | null;
  /** 近 7 天记录（算频率用） */
  recent7: Array<{
    sleepHours: number | null;
    exerciseMinutes: number | null;
    moodScore: number | null;
  }>;
  /** 用户健康目标（M3 选的，逗号分隔） */
  healthGoal: string;
  /** M4 画像健康分（无则 null） */
  aiScore: number | null;
}

export interface DailySummaryView {
  healthScore: number;
  summary: string;
  highlights: string[];
  warnings: string[];
  suggestions: string[];
}

export interface GoalProgress {
  goalType: string;
  label: string;
  target: string;
  current: string;
  progress: number;
}

/** 规则生成今日总结（断网兜底文案；LLM 只润色 summary 段） */
export function buildDailySummary(input: DailySummaryInput): DailySummaryView {
  const highlights: string[] = [];
  const warnings: string[] = [];
  const suggestions: string[] = [];

  const score = input.aiScore ?? 70;

  if (input.yesterday) {
    const y = input.yesterday;
    if (y.sleepHours !== null) {
      if (y.sleepHours >= 7 && y.sleepHours <= 9)
        highlights.push(`睡眠 ${y.sleepHours} 小时，达标`);
      else warnings.push(`睡眠 ${y.sleepHours} 小时，未达 7 小时目标`);
    }
    if (y.exerciseMinutes !== null && y.exerciseMinutes > 0) {
      highlights.push(`运动 ${y.exerciseMinutes} 分钟`);
    } else {
      warnings.push("昨日未记录运动");
    }
    if (y.moodScore !== null && y.moodScore >= 3) highlights.push("心情良好");
  } else {
    warnings.push("昨日还没有打卡，记得记录睡眠和运动");
  }

  // 近 7 天运动频率
  const exerciseDays = input.recent7.filter(
    d => (d.exerciseMinutes ?? 0) > 0
  ).length;
  if (input.recent7.length >= 3) {
    if (exerciseDays >= 3)
      highlights.push(
        `近 ${input.recent7.length} 天运动 ${exerciseDays} 天，频率良好`
      );
    else
      warnings.push(
        `近 ${input.recent7.length} 天仅运动 ${exerciseDays} 天，建议增加频次`
      );
  }

  if (input.healthGoal.includes("睡眠"))
    suggestions.push("固定作息，目标每晚 7-9 小时睡眠");
  if (input.healthGoal.includes("运动"))
    suggestions.push("从每天 10 分钟开始，逐步达到每周 150 分钟");
  if (input.healthGoal.includes("体重"))
    suggestions.push("控制总热量，减少精制碳水");
  if (input.healthGoal.includes("压力"))
    suggestions.push("安排 10 分钟呼吸放松或冥想");
  if (suggestions.length === 0)
    suggestions.push("保持当前健康节奏，继续每日打卡");

  const status =
    score >= 80 ? "状态良好" : score >= 60 ? "状态一般" : "需要调整";
  const summary = `早上好！今日健康指数 ${score}，${status}。`;

  return { healthScore: score, summary, highlights, warnings, suggestions };
}

/** 从 healthGoal 文字 + 近 7 天数据算目标进度（规则，纯函数） */
export function buildGoalProgress(
  healthGoal: string,
  recent7: Array<{ exerciseMinutes: number | null; sleepHours: number | null }>
): GoalProgress[] {
  const goals: GoalProgress[] = [];

  if (healthGoal.includes("运动")) {
    const days = recent7.filter(d => (d.exerciseMinutes ?? 0) > 0).length;
    const target = 3;
    goals.push({
      goalType: "exercise",
      label: "每周运动",
      target: `${target} 次/周`,
      current: `${days} 次`,
      progress: Math.min(100, Math.round((days / target) * 100))
    });
  }

  if (healthGoal.includes("睡眠")) {
    const sleeps = recent7
      .map(d => d.sleepHours)
      .filter((h): h is number => h !== null);
    const good = sleeps.filter(h => h >= 7 && h <= 9).length;
    const target = 7;
    goals.push({
      goalType: "sleep",
      label: "睡眠达标",
      target: `${target} 天/周`,
      current: `${good} 天`,
      progress: sleeps.length
        ? Math.min(100, Math.round((good / target) * 100))
        : 0
    });
  }

  return goals;
}
