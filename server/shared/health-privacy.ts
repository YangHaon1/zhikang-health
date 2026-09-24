/**
 * C5 审计体系与隐私授权：**唯一源码**（纯函数，禁 Node / DOM 依赖）。
 *
 * 分工：
 * - `AUDIT_ACTIONS` / `AUDIT_ACTION_LABELS`：审计动作目录与中文文案。后端只允许写目录内的动作，
 *   前端审计页的筛选项与表格文案都取自这里（避免两端各写一份、加动作时漏改一边）。
 * - `sanitizeAuditDetail` + `buildAuditRecord`：审计行的**构造与脱敏**。审计面向管理员开放，
 *   因此写入前就把可能带个体数据的键剔除、把嵌套结构压平、把长文本截断——「审计 detail
 *   永不出现个体健康数据」这条口径只在这里实现一次，各路由只能调用，不能自己拼 detail。
 * - `canViewAuditLogs`：审计页可见性口径（与后端 adminOnly、前端菜单 roles 同源）。
 * - `ACCESS_SCOPES` / `accessScopes`：授权中心「我的数据被谁访问」只读清单（纯数据 + 一个开关）。
 * - `DEFAULT_ALLOW_SHARED` / `isShared`：共享开关的默认值与判定（默认**关闭**）。
 *
 * 前端经 `@shared` 别名引用（只读目录与文案），后端经相对路径引用。
 */

// ---------- 审计动作目录 ----------

/**
 * 审计动作（顺序即审计页筛选项顺序）。
 * 命名与 C4 既有写入点保持兼容：`analytics_export` 是 C4 就在用的动作，本次并入目录统一展示。
 */
export const AUDIT_ACTIONS = [
  "login_success",
  "login_failed",
  "data_export",
  "report_generate",
  "authorization_change",
  "device_sync",
  "records_import",
  "analytics_export"
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** 动作 → 中文文案 */
export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  login_success: "登录成功",
  login_failed: "登录失败",
  data_export: "数据导出",
  report_generate: "报告生成",
  authorization_change: "授权变更",
  device_sync: "设备同步",
  records_import: "批量导入",
  analytics_export: "看板导出"
};

/** 动作文案（未知动作原样返回，老库里的历史动作也不会显示成空白） */
export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action as AuditAction] ?? action;
}

/** 是否为目录内的合法动作 */
export function isAuditAction(action: string): action is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(action);
}

/** 审计页筛选项（前端直接用，选项文案与后端一致） */
export const AUDIT_ACTION_OPTIONS = AUDIT_ACTIONS.map(value => ({
  value,
  label: AUDIT_ACTION_LABELS[value]
}));

// ---------- 审计行构造与脱敏 ----------

/**
 * 审计 detail 里**禁止出现**的键（大小写不敏感，子串匹配）。
 * 两类：① 凭据类，写进审计等于把密码/令牌留档；② 内容类（问答原文、备注、联系方式），
 * 属于个体数据，管理员看审计不等于可以看别人的健康内容。
 */
export const SENSITIVE_AUDIT_KEYS = [
  "password",
  "passwd",
  "pwd",
  "token",
  "secret",
  "hash",
  "authorization",
  "credential",
  "apikey",
  "content",
  "question",
  "answer",
  "message",
  "remark",
  "note",
  "email",
  "phone",
  "name",
  "systolic",
  "diastolic",
  "glucose",
  "cholesterol",
  "triglyceride",
  "ldl",
  "hdl",
  "heartrate",
  "bloodoxygen",
  "weight",
  "bmi"
] as const;

/** detail 最多保留的键数（防止把整个请求体塞进来） */
export const AUDIT_DETAIL_MAX_KEYS = 20;
/** detail 字符串值最大长度（超出截断，避免把长文本留档） */
export const AUDIT_DETAIL_MAX_LENGTH = 120;

/** detail 允许的标量值 */
export type AuditDetailValue = string | number | boolean | null;
/** detail 允许的值：标量，或标量数组（如影响到的 id 列表、字段名列表） */
export type AuditDetailEntry = AuditDetailValue | AuditDetailValue[];
/** 脱敏后的 detail */
export type AuditDetail = Record<string, AuditDetailEntry>;

/** 键是否敏感（大小写不敏感的子串匹配） */
function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  return SENSITIVE_AUDIT_KEYS.some(word => k.includes(word));
}

/** 标量值口径化：非有限数字丢弃，字符串去空白 + 截断 */
function scalarOf(value: unknown): AuditDetailValue | undefined {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return "";
    return s.length > AUDIT_DETAIL_MAX_LENGTH
      ? `${s.slice(0, AUDIT_DETAIL_MAX_LENGTH)}…`
      : s;
  }
  return undefined;
}

/**
 * 审计 detail 脱敏：**白名单式的窄口径**。
 *
 * - 敏感键（凭据 / 健康指标 / 内容 / 联系方式）直接丢弃；
 * - 只保留标量与其数组，嵌套对象一律丢弃（避免绕过键名检查把内容藏在深层）；
 * - 字符串截断、非有限数字丢弃、键数上限。
 *
 * 返回新对象，不改入参。所有审计写入路径都必须经过它。
 */
export function sanitizeAuditDetail(
  detail: unknown,
  maxKeys: number = AUDIT_DETAIL_MAX_KEYS
): AuditDetail {
  const out: AuditDetail = {};
  if (!detail || typeof detail !== "object" || Array.isArray(detail))
    return out;
  let kept = 0;
  for (const [key, raw] of Object.entries(detail as Record<string, unknown>)) {
    if (kept >= maxKeys) break;
    if (isSensitiveKey(key)) continue;
    if (Array.isArray(raw)) {
      const items: AuditDetailValue[] = [];
      for (const item of raw) {
        const v = scalarOf(item);
        if (v !== undefined) items.push(v);
      }
      // 空数组也保留：它表达「没有命中任何项」，是有信息量的
      out[key] = items;
      kept += 1;
      continue;
    }
    const v = scalarOf(raw);
    if (v === undefined) continue;
    out[key] = v;
    kept += 1;
  }
  return out;
}

/** 审计操作人（登录失败时账号可能不存在，故 user_id 可空、只留 actor_name） */
export interface AuditActor {
  /** 操作人 user_id（未登录/账号不存在时为 null） */
  userId?: number | null;
  /** 操作人登录名（登录失败时记录**尝试**的用户名） */
  username?: string;
  /** 来源 IP */
  ip?: string;
}

/** 待写入 audit_logs 的一行（`buildAuditRecord` 的产物） */
export interface AuditRecord {
  user_id: number | null;
  action: string;
  actor_name: string;
  actor_ip: string;
  /** 已脱敏的 detail（JSON 字符串） */
  detail: string;
}

/**
 * 构造一条审计行；动作不在目录内 → 返回 null（调用方视为代码缺陷，记警告而不写库）。
 *
 * 只有本函数可以决定「什么内容能进审计」：detail 一律经 `sanitizeAuditDetail`，
 * 操作人取 actor 而非请求体，因此路由无法把用户输入原样写进审计。
 */
export function buildAuditRecord(
  action: string,
  detail: unknown,
  actor: AuditActor = {}
): AuditRecord | null {
  const normalized = String(action ?? "").trim();
  if (!isAuditAction(normalized)) return null;
  const userId =
    typeof actor.userId === "number" && Number.isInteger(actor.userId)
      ? actor.userId
      : null;
  return {
    user_id: userId,
    action: normalized,
    actor_name: String(actor.username ?? "").trim(),
    actor_ip: String(actor.ip ?? "").trim(),
    detail: JSON.stringify(sanitizeAuditDetail(detail))
  };
}

/** 审计页可见性：只有管理员（与后端 adminOnly、前端菜单 roles 同一口径） */
export function canViewAuditLogs(
  roles: readonly string[] | undefined
): boolean {
  return Array.isArray(roles) && roles.includes("admin");
}

// ---------- 授权中心 ----------

/** 共享开关默认值：**关闭**（缺失行 = 未授权，故老数据零迁移） */
export const DEFAULT_ALLOW_SHARED = false;

/** 开关取值口径化：1 / "1" / true 视为开启，其余（含 null / undefined / 0）视为关闭 */
export function allowSharedOf(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

/**
 * 是否参与群体聚合统计。
 * `undefined` 视为**未授权**（保守口径）：调用方漏传字段时不会把用户算进去。
 */
export function isShared(user: { allowShared?: boolean | null }): boolean {
  return user.allowShared === true;
}

/** 授权中心里的一条访问范围 */
export interface AccessScope {
  key: string;
  /** 访问方（谁在访问） */
  actor: string;
  /** 用途说明 */
  description: string;
  /** 是否受「允许他人查看我的健康数据」开关控制 */
  governedBySwitch: boolean;
  /** 当前是否生效（governedBySwitch 的条目随开关变化） */
  active: boolean;
}

/**
 * 我的数据访问范围清单（只读展示）。
 *
 * 口径：**系统内部访问（规则引擎 / 助手 / 审计）恒生效**——体检数据的分级与报告必须读原始记录，
 * 关掉它等于关掉系统自身能力；该开关控制的是「**他人**（管理员）能否把你的数据纳入聚合统计」，
 * 因此只有群体聚合这一条随开关变化。
 */
export const ACCESS_SCOPES: readonly Omit<AccessScope, "active">[] = [
  {
    key: "self",
    actor: "本人",
    description: "查看与维护自己的健康档案、指标记录、报告与行动计划",
    governedBySwitch: false
  },
  {
    key: "engine",
    actor: "规则引擎（系统内部）",
    description: "为本人生成指标分级、健康报告与行动建议时读取记录与档案",
    governedBySwitch: false
  },
  {
    key: "chat",
    actor: "AI 健康助手（系统内部）",
    description: "回答本人提问时读取本人的档案与最近记录，问答不会跨用户读取",
    governedBySwitch: false
  },
  {
    key: "audit",
    actor: "安全审计（系统内部）",
    description:
      "记录登录、导出、授权变更等关键操作，仅留操作时间与动作，不含健康指标数值",
    governedBySwitch: false
  },
  {
    key: "analytics",
    actor: "系统管理员（脱敏群体看板）",
    description:
      "参与群体健康看板的聚合统计（任一分组样本不足 5 人一律隐藏，不出现个体数据）",
    governedBySwitch: true
  }
];

/** 按开关状态展开访问范围清单（前端只读列表直接用这个） */
export function accessScopes(allowShared: boolean): AccessScope[] {
  return ACCESS_SCOPES.map(scope => ({
    ...scope,
    active: scope.governedBySwitch ? allowShared : true
  }));
}

/** 开关语义说明（前后端同一句文案：说明关掉开关**不会**关掉系统自身的分级/报告能力） */
export const SHARING_NOTE =
  "该开关只决定你的数据是否参与管理端的脱敏群体统计；关闭后你的人身数据立即从聚合中排除。规则引擎、健康报告与 AI 助手为你本人服务时仍需读取你的记录，这部分不受开关影响。";
