/**
 * C6 可访问性与移动端口径：**唯一源码**（纯函数 / 常量，禁 Node / DOM 依赖）。
 *
 * 分工：
 * - `MOBILE_BREAKPOINT`：移动端断点。**只能有一个值**，页面的 CSS 媒体查询、文档口径、
 *   单测断言都引用它——CSS 无法 import，所以页面里写字面量，此常量是它的权威定义。
 * - `RECORD_FIELD_LABELS` / `PLAN_FIELD_LABELS`：录入页与行动计划页的控件标签。
 *   表单的可见 `label` 与无可见标签控件的 `aria-label` 都取自这里：**新增一个指标
 *   必然同时有标签**，不会出现只有 placeholder 的裸控件（placeholder 不是标签）。
 * - `RISK_DELTA_TEXT` / `RISK_DELTA_MARKS`：风险点变化的文字与符号。
 * - `SCORE_DIRECTION_TEXT` / `SCORE_DIRECTION_MARKS` / `SCORE_DIRECTION_HINT`：评分变化方向的
 *   文字与符号。
 *
 * **颜色不作唯一信息载体**：对比区的每处配色（好转绿 / 恶化红 / 持平灰、新增红 / 消失绿 /
 * 持续黄）都有对应的文字或符号，色盲用户与黑白打印同样能读懂；符号只是冗余增强，
 * 文字才是承载语义的那一层。
 *
 * 前端经 `@shared` 别名引用，后端经相对路径引用。
 */
import type { ComparisonDirection, RiskDeltaKind } from "./health-report.js";

// ---------- 移动端断点 ----------

/**
 * 移动端断点（px）。手机竖屏 375 / 414 宽度的通用分界，也是本项目各健康页
 * `@media (width <= 768px)` 的统一取值。**改这里就要同步改页面里的媒体查询字面量**。
 */
export const MOBILE_BREAKPOINT = 768;

/** 断点口径说明（报告与页面注释共用同一句话） */
export const MOBILE_BREAKPOINT_NOTE = `小屏适配断点 ${MOBILE_BREAKPOINT}px：健康模块各页在该宽度以下改为单列、表格内部横向滚动、图表跟随容器宽度，页面本身不出现横向滚动。`;

// ---------- 表单字段标签 ----------

/**
 * 指标录入页字段标签（**每一项都必须作为一个 `el-form-item` 的 `label` 出现在页面上**）。
 *
 * 与页面上原有的可见 `label` 文案**逐字一致**（含单位写法），本次只是把它们收敛到
 * 唯一源码，不改变任何展示文案。`time`（测量时刻）原先与记录日期挤在同一个表单项里、
 * 没有自己的标签，本次拆成独立表单项——**一个表单项只放一个控件**是这条口径的关键：
 * Element Plus 的 `el-form-item` 只在「恰好一个子控件」时才把可见 `<label>` 用 `for`
 * 绑到该控件上（子控件为 0 或 ≥2 个时降级成 `role="group"` + `aria-labelledby`），
 * 所以「一个标签对一个控件」既是最简单的结构，也是关联最牢的结构。
 */
export const RECORD_FIELD_LABELS = {
  date: "记录日期",
  time: "测量时刻",
  systolic: "收缩压(mmHg)",
  diastolic: "舒张压(mmHg)",
  fastingGlucose: "空腹(mmol/L)",
  postprandialGlucose: "餐后(mmol/L)",
  totalCholesterol: "总胆固醇",
  triglyceride: "甘油三酯",
  ldl: "LDL",
  hdl: "HDL",
  heartRate: "心率(次/分)",
  bloodOxygen: "血氧(%)",
  weight: "体重(kg)",
  remark: "备注"
} as const;

/** 指标录入页应出现可见标签的字段（顺序即页面顺序） */
export const RECORD_LABELED_FIELDS = [
  "date",
  "time",
  "systolic",
  "diastolic",
  "fastingGlucose",
  "postprandialGlucose",
  "totalCholesterol",
  "triglyceride",
  "ldl",
  "hdl",
  "heartRate",
  "bloodOxygen",
  "weight",
  "remark"
] as const;

/**
 * 行动计划页字段标签。
 *
 * 外层表单项沿用页面原有文案（`tasks` 即「任务列表」）。`taskTitle` / `taskType` /
 * `frequency` 是任务编辑器里同一行的三个控件：它们共处一个表单项（EP 会把它标成
 * `role="group"` + `aria-labelledby="任务列表"`），因此**必须各自带 `aria-label`**，
 * 否则组内成员没有可区分的名字。
 */
export const PLAN_FIELD_LABELS = {
  title: "计划标题",
  riskKey: "风险类型",
  targetValue: "目标值",
  startDate: "开始日期",
  endDate: "结束日期",
  tasks: "任务列表",
  taskTitle: "任务内容",
  taskType: "任务类型",
  frequency: "打卡频率"
} as const;

/** 行动计划页任务编辑器里**必须带 aria-label** 的控件（组内无可见标签的三个） */
export const PLAN_ARIA_FIELDS = ["taskTitle", "taskType", "frequency"] as const;

// ---------- 风险点变化：文字 + 符号 ----------

/** 风险点变化 → 文字（语义载体） */
export const RISK_DELTA_TEXT: Record<RiskDeltaKind, string> = {
  new: "新增",
  gone: "消失",
  ongoing: "持续"
};

/** 风险点变化 → 符号（冗余增强，`aria-hidden` 展示） */
export const RISK_DELTA_MARKS: Record<RiskDeltaKind, string> = {
  new: "▲",
  gone: "▼",
  ongoing: "—"
};

/** 风险点变化文案 */
export function riskDeltaText(kind: RiskDeltaKind): string {
  return RISK_DELTA_TEXT[kind] ?? kind;
}

/** 风险点变化符号 */
export function riskDeltaMark(kind: RiskDeltaKind): string {
  return RISK_DELTA_MARKS[kind] ?? "";
}

// ---------- 评分变化方向：文字 + 符号 ----------

/**
 * 方向 → 文字。
 *
 * ⚠️ 方向口径来自规则引擎的**风险分**语义（`scoreDelta > 0` 即风险分升高 = 恶化，
 * 见 `health-report.ts` 的 `ComparisonDirection` 注释）。页面不得自行推断方向，
 * 一律用服务端给的 `direction` 取这里的文案。
 */
export const SCORE_DIRECTION_TEXT: Record<ComparisonDirection, string> = {
  improved: "好转",
  worsened: "恶化",
  stable: "持平"
};

/**
 * 方向 → 符号。**符号描述的是风险分**：▲ 风险分升高（恶化）、▼ 风险分降低（好转）、
 * — 持平。为避免误读，`SCORE_DIRECTION_HINT` 必须与符号一同展示。
 */
export const SCORE_DIRECTION_MARKS: Record<ComparisonDirection, string> = {
  improved: "▼",
  worsened: "▲",
  stable: "—"
};

/** 符号含义说明（与符号同屏展示，消除「▼ 却是好转」的歧义） */
export const SCORE_DIRECTION_HINT =
  "▲ 表示风险分升高（恶化），▼ 表示风险分降低（好转），— 表示持平";

/** 评分变化方向文案；未知方向原样返回，不显示成空白 */
export function scoreDirectionText(direction: string): string {
  return (
    SCORE_DIRECTION_TEXT[direction as ComparisonDirection] ?? String(direction)
  );
}

/** 评分变化方向符号；未知方向返回空串（不猜方向） */
export function scoreDirectionMark(direction: string): string {
  return SCORE_DIRECTION_MARKS[direction as ComparisonDirection] ?? "";
}

// ---------- 指标分级：符号 ----------

/**
 * 指标分级 → 符号（0 正常 / 1 警戒 / 2 异常）。
 *
 * 录入页的分级标签本来就带文字（正常 / 警戒 / 异常），符号是**灰度下的冗余增强**：
 * 打印成黑白或色盲用户看到的 `✓ / ! / ▲` 仍然能区分三档。
 * 符号一律用 `aria-hidden` 包裹，语义由文字承载，读屏不会重复播报。
 */
export const GRADE_MARKS: Record<number, string> = {
  0: "✓",
  1: "!",
  2: "▲"
};

/** 指标分级符号；未知等级返回空串 */
export function gradeMark(level: number): string {
  return GRADE_MARKS[level] ?? "";
}
