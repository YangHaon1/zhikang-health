/**
 * C5 竞赛优化：审计体系与隐私授权单元测试。
 * 覆盖：审计动作目录 / 文案完整性、detail 脱敏（敏感键、嵌套、截断、键数上限）、
 * 审计行构造（未知动作丢弃、user_id 口径）、审计页可见性、
 * 授权开关默认值与判定、访问范围清单、**开关联动聚合**、以及聚合输出的隐私断言。
 */
import { describe, expect, it } from "vitest";
import {
  ACCESS_SCOPES,
  AUDIT_ACTIONS,
  AUDIT_ACTION_LABELS,
  AUDIT_ACTION_OPTIONS,
  AUDIT_DETAIL_MAX_KEYS,
  AUDIT_DETAIL_MAX_LENGTH,
  DEFAULT_ALLOW_SHARED,
  SENSITIVE_AUDIT_KEYS,
  SHARING_NOTE,
  accessScopes,
  allowSharedOf,
  auditActionLabel,
  buildAuditRecord,
  canViewAuditLogs,
  isAuditAction,
  isShared,
  sanitizeAuditDetail
} from "../health-privacy.js";
import {
  ANALYTICS_MIN_SAMPLE,
  analyzeUserForAnalytics,
  analyticsToCsv,
  buildAnalyticsOverview
} from "../health-analytics.js";
import type { UserAnalyticsInput } from "../health-analytics.js";

// ---------- 工具 ----------

/** 造一个聚合输入（默认：有记录、低风险、无异常、**已授权共享**） */
function user(
  partial: Partial<UserAnalyticsInput> & { userId: number }
): UserAnalyticsInput {
  return {
    recordCount: 1,
    score: 0,
    level: "低",
    abnormalKeys: [],
    measuredKeys: ["systolic"],
    planParticipant: false,
    allowShared: true,
    ...partial
  };
}

function many(count: number, partial: Partial<UserAnalyticsInput> = {}) {
  return Array.from({ length: count }, (_, i) =>
    user({ userId: i + 1, ...partial })
  );
}

// ---------- 审计动作目录 ----------

describe("审计动作目录", () => {
  it("六类关键操作都在目录内", () => {
    for (const action of [
      "login_success",
      "login_failed",
      "data_export",
      "report_generate",
      "authorization_change",
      "device_sync",
      "records_import"
    ]) {
      expect(isAuditAction(action)).toBe(true);
    }
  });

  it("每个动作都有中文文案，且筛选项与目录一一对应", () => {
    for (const action of AUDIT_ACTIONS) {
      expect(AUDIT_ACTION_LABELS[action]).toBeTruthy();
    }
    expect(AUDIT_ACTION_OPTIONS).toHaveLength(AUDIT_ACTIONS.length);
    expect(AUDIT_ACTION_OPTIONS.map(o => o.value)).toEqual([...AUDIT_ACTIONS]);
  });

  it("未知动作不是合法动作，文案原样返回而不是空白", () => {
    expect(isAuditAction("logout")).toBe(false);
    expect(isAuditAction("")).toBe(false);
    expect(auditActionLabel("logout")).toBe("logout");
  });
});

// ---------- detail 脱敏 ----------

describe("审计 detail 脱敏", () => {
  it("凭据类键一律丢弃（密码 / 令牌 / 密钥）", () => {
    const out = sanitizeAuditDetail({
      password: "123456",
      userToken: "abc",
      apiKey: "k",
      secret: "s",
      Authorization: "Bearer x",
      passwordHash: "$2b$10$...",
      format: "csv"
    });
    expect(out).toEqual({ format: "csv" });
  });

  it("健康指标与内容类键一律丢弃（大小写不敏感）", () => {
    const out = sanitizeAuditDetail({
      systolic: 165,
      Diastolic: 100,
      fastingGlucose: 8.2,
      BMI: 24,
      weight: 70,
      content: "对话原文",
      question: "我血压高吗",
      answer: "……",
      email: "a@b.c",
      phone: "13800000000",
      rowCount: 12
    });
    expect(out).toEqual({ rowCount: 12 });
  });

  it("键名是子串匹配：heartRate / userName 这类变体也拦得住", () => {
    const out = sanitizeAuditDetail({
      heartRate: 88,
      bloodOxygen: 96,
      userName: "张三",
      noteText: "备注",
      deviceName: "血压计"
    });
    // deviceName 含 name → 被丢弃；其余同理
    expect(out).toEqual({});
  });

  it("只保留标量与其数组，嵌套对象一律丢弃（防藏在深层绕过键名检查）", () => {
    const out = sanitizeAuditDetail({
      format: "csv",
      nested: { password: "123456", ok: 1 },
      recordIds: [1, 2, 3],
      mixes: [1, "a", true, null]
    });
    expect(out.format).toBe("csv");
    expect(out.nested).toBeUndefined();
    expect(out.recordIds).toEqual([1, 2, 3]);
    expect(out.mixes).toEqual([1, "a", true, null]);
  });

  it("数组里的嵌套对象被丢掉，空数组保留（表达「没有命中项」）", () => {
    const out = sanitizeAuditDetail({
      fields: [{ a: 1 }, "b", 2],
      affected: []
    });
    expect(out.fields).toEqual(["b", 2]);
    expect(out.affected).toEqual([]);
  });

  it("字符串去空白并截断，非有限数字丢弃", () => {
    const long = "x".repeat(AUDIT_DETAIL_MAX_LENGTH + 50);
    const out = sanitizeAuditDetail({
      long,
      blank: "   ",
      nan: Number.NaN,
      inf: Number.POSITIVE_INFINITY,
      ok: 1
    });
    expect(String(out.long)).toHaveLength(AUDIT_DETAIL_MAX_LENGTH + 1); // 含省略号
    expect(String(out.long).endsWith("…")).toBe(true);
    expect(out.blank).toBe("");
    expect(out.nan).toBeUndefined();
    expect(out.inf).toBeUndefined();
    expect(out.ok).toBe(1);
  });

  it("键数上限生效（防止把整个请求体塞进审计）", () => {
    const big: Record<string, number> = {};
    for (let i = 0; i < AUDIT_DETAIL_MAX_KEYS + 10; i += 1)
      big[`field${i}`] = i;
    const out = sanitizeAuditDetail(big);
    expect(Object.keys(out)).toHaveLength(AUDIT_DETAIL_MAX_KEYS);
  });

  it("非对象入参返回空对象，且不修改入参", () => {
    expect(sanitizeAuditDetail(null)).toEqual({});
    expect(sanitizeAuditDetail("str")).toEqual({});
    expect(sanitizeAuditDetail([1, 2])).toEqual({});
    const input = { format: "csv", password: "x" };
    sanitizeAuditDetail(input);
    expect(input.password).toBe("x");
  });

  it("敏感键清单本身包含密码与健康指标两类", () => {
    expect(SENSITIVE_AUDIT_KEYS).toContain("password");
    expect(SENSITIVE_AUDIT_KEYS).toContain("systolic");
  });
});

// ---------- 审计行构造 ----------

describe("审计行构造 buildAuditRecord", () => {
  it("合法动作产出可入库的行，detail 已序列化", () => {
    const rec = buildAuditRecord(
      "data_export",
      { rowCount: 108, scope: "health_records" },
      { userId: 7, username: "admin", ip: "127.0.0.1" }
    )!;
    expect(rec.action).toBe("data_export");
    expect(rec.user_id).toBe(7);
    expect(rec.actor_name).toBe("admin");
    expect(rec.actor_ip).toBe("127.0.0.1");
    expect(JSON.parse(rec.detail)).toEqual({
      rowCount: 108,
      scope: "health_records"
    });
  });

  it("未知动作返回 null（调用方记警告而不写库）", () => {
    expect(buildAuditRecord("logout", {}, { userId: 1 })).toBeNull();
    expect(buildAuditRecord("", {}, { userId: 1 })).toBeNull();
  });

  it("user_id 必须是整数，否则落 null（账号不存在时不能瞎归属）", () => {
    expect(
      buildAuditRecord("login_failed", {}, { username: "ghost" })!.user_id
    ).toBeNull();
    expect(
      buildAuditRecord("login_failed", {}, { userId: Number.NaN })!.user_id
    ).toBeNull();
    expect(
      buildAuditRecord("login_failed", {}, { userId: 1.5 })!.user_id
    ).toBeNull();
    expect(
      buildAuditRecord("login_failed", {}, { userId: null })!.user_id
    ).toBeNull();
    expect(buildAuditRecord("login_failed", {}, { userId: 0 })!.user_id).toBe(
      0
    );
  });

  it("操作人姓名即使用户不存在也保留（这是登录失败的取证关键）", () => {
    const rec = buildAuditRecord(
      "login_failed",
      { reason: "账号不存在" },
      { username: "  ghost  ", ip: "10.0.0.1" }
    )!;
    expect(rec.actor_name).toBe("ghost");
    expect(JSON.parse(rec.detail)).toEqual({ reason: "账号不存在" });
  });

  it("构造时就脱敏：路由即使传了密码也进不了审计", () => {
    const rec = buildAuditRecord("login_success", {
      username: "admin",
      password: "admin123",
      token: "jwt"
    })!;
    expect(rec.detail).not.toContain("admin123");
    expect(rec.detail).not.toContain("jwt");
  });
});

// ---------- 审计页可见性 ----------

describe("审计页可见性 canViewAuditLogs", () => {
  it("仅 admin 可见（与后端 adminOnly、菜单 roles 同口径）", () => {
    expect(canViewAuditLogs(["admin"])).toBe(true);
    expect(canViewAuditLogs(["common", "admin"])).toBe(true);
    expect(canViewAuditLogs(["common"])).toBe(false);
    expect(canViewAuditLogs([])).toBe(false);
    expect(canViewAuditLogs(undefined)).toBe(false);
  });
});

// ---------- 授权开关口径 ----------

describe("授权开关口径", () => {
  it("默认值未变（团队新用户默认不共享）", () => {
    expect(DEFAULT_ALLOW_SHARED).toBe(false);
  });

  it('allowSharedOf 只认 true / 1 / "1"', () => {
    expect(allowSharedOf(true)).toBe(true);
    expect(allowSharedOf(1)).toBe(true);
    expect(allowSharedOf("1")).toBe(true);
    expect(allowSharedOf(false)).toBe(false);
    expect(allowSharedOf(0)).toBe(false);
    expect(allowSharedOf("0")).toBe(false);
    expect(allowSharedOf(null)).toBe(false);
    expect(allowSharedOf(undefined)).toBe(false);
    expect(allowSharedOf("true")).toBe(false);
  });

  it("isShared 对 undefined 取保守口径（漏传字段 = 未授权）", () => {
    expect(isShared({ allowShared: true })).toBe(true);
    expect(isShared({ allowShared: false })).toBe(false);
    expect(isShared({})).toBe(false);
    expect(isShared({ allowShared: undefined })).toBe(false);
    expect(isShared({ allowShared: null })).toBe(false);
  });

  it("analyzeUserForAnalytics 默认不共享（忘传则降级，而不是泄露）", () => {
    const noFlag = analyzeUserForAnalytics(1, [], null, false);
    expect(noFlag.allowShared).toBe(false);
    const withFlag = analyzeUserForAnalytics(1, [], null, false, true);
    expect(withFlag.allowShared).toBe(true);
  });
});

// ---------- 访问范围清单 ----------

describe("访问范围清单", () => {
  it("只有群体聚合这一条随开关变化，系统内部访问恒生效", () => {
    const governed = ACCESS_SCOPES.filter(s => s.governedBySwitch);
    expect(governed).toHaveLength(1);
    expect(governed[0].key).toBe("analytics");
  });

  it("开关关闭时聚合范围停用，其余仍生效", () => {
    const off = accessScopes(false);
    expect(off.find(s => s.key === "analytics")!.active).toBe(false);
    expect(off.filter(s => s.key !== "analytics").every(s => s.active)).toBe(
      true
    );
  });

  it("开关开启时全部生效", () => {
    expect(accessScopes(true).every(s => s.active)).toBe(true);
  });

  it("说明文案点明「关闭不影响系统自身的分级/报告能力」", () => {
    expect(SHARING_NOTE).toContain("聚合");
    expect(SHARING_NOTE).toContain("规则引擎");
  });
});

// ---------- 授权开关联动聚合 ----------

describe("授权开关联动群体聚合", () => {
  it("全站 6 人但仅 2 人授权 → 降级（授权人数才是统计基数）", () => {
    const users = [
      ...many(2, { allowShared: true }),
      ...many(4, { allowShared: false }).map((u, i) => ({
        ...u,
        userId: 10 + i
      }))
    ];
    const o = buildAnalyticsOverview(users);
    expect(o.totals.userCount).toBe(6);
    expect(o.degraded).toBe(true);
    expect(o.totals.withRecords).toBeNull();
  });

  it("被排除的用户数据不进入任何分组（无异常的人关掉开关，异常率不被稀释）", () => {
    const shared = many(6, { abnormalKeys: ["systolic"] });
    // 排除人数取 5（≥ 阈值）以便同时验证该总量本身可见；1~4 人的情况见下一组用例
    const excluded = many(5, { allowShared: false }).map((u, i) => ({
      ...u,
      userId: 90 + i
    }));
    const o = buildAnalyticsOverview([...shared, ...excluded]);
    const stat = o.indicatorAbnormal.find(s => s.key === "systolic")!;
    // 11 人里有 6 人授权：样本 6、异常 6 —— 被排除的 5 人（均无异常）没有进入分母
    expect(stat.sampleSize).toBe(6);
    expect(stat.abnormalCount).toBe(6);
    expect(stat.rate).toBe(100);
    expect(o.totals.userCount).toBe(11);
    expect(o.totals.sharedCount).toBe(6);
    expect(o.totals.excludedByPrivacy).toBe(5);
  });

  it("把开关打开后该用户重新计入，聚合随之变化", () => {
    const base = many(6, { abnormalKeys: ["systolic"] });
    const off = buildAnalyticsOverview([
      ...base,
      { ...user({ userId: 99 }), allowShared: false }
    ]);
    const on = buildAnalyticsOverview([
      ...base,
      { ...user({ userId: 99 }), allowShared: true }
    ]);
    expect(off.totals.sharedCount).toBe(6);
    expect(on.totals.sharedCount).toBe(7);
    expect(on.totals.excludedByPrivacy).toBe(0);
    // 新进来的用户没有异常，异常率因此被稀释
    expect(off.indicatorAbnormal.find(s => s.key === "systolic")!.rate).toBe(
      100
    );
    expect(on.indicatorAbnormal.find(s => s.key === "systolic")!.rate).toBe(
      85.7
    );
  });

  it("无人授权时不抛错，全部明细隐藏", () => {
    const o = buildAnalyticsOverview(many(8, { allowShared: false }));
    expect(o.degraded).toBe(true);
    expect(o.totals.sharedCount).toBeNull();
    expect(o.totals.withRecords).toBeNull();
    expect(o.scoreDistribution.every(b => b.count === null)).toBe(true);
  });

  it("排除人数同受小样本保护（6 人里仅 1 人关闭 → 该数字可指认，隐藏）", () => {
    const users = [
      ...many(5, { allowShared: true }),
      { ...user({ userId: 99 }), allowShared: false }
    ];
    const o = buildAnalyticsOverview(users);
    expect(o.degraded).toBe(false);
    expect(o.totals.excludedByPrivacy).toBeNull();
  });

  it("参与率分母是已授权人数（不是账号总数）", () => {
    const users = [
      ...many(6, { allowShared: true, planParticipant: true }),
      ...many(2, { allowShared: true, planParticipant: false }).map((u, i) => ({
        ...u,
        userId: 20 + i
      })),
      ...many(3, { allowShared: false, planParticipant: true }).map((u, i) => ({
        ...u,
        userId: 30 + i
      }))
    ];
    const o = buildAnalyticsOverview(users);
    expect(o.totals.userCount).toBe(11);
    expect(o.totals.planParticipants).toBe(6);
    // 6 / 8 = 75%；若误用账号总数当分母会算成 6 / 11 = 54.5%
    expect(o.totals.planParticipationRate).toBe(75);
  });

  it("阈值仍为 5（本次未放宽小样本口径）", () => {
    expect(ANALYTICS_MIN_SAMPLE).toBe(5);
  });
});

// ---------- 隐私断言：聚合输出不含个体信息 ----------

describe("隐私断言：聚合输出不出现可指认的个体信息", () => {
  const overview = buildAnalyticsOverview(
    many(8, { abnormalKeys: ["systolic"], score: 10, level: "低" })
  );

  it("序列化结果里没有 userId / username / 账号标识字段", () => {
    const json = JSON.stringify(overview);
    for (const key of ["userId", "user_id", "username", "allowShared"]) {
      expect(json).not.toContain(key);
    }
  });

  it("序列化结果里没有任何测量值（只出现指标名与人数 / 百分比）", () => {
    const json = JSON.stringify(overview);
    // 聚合**会**出现指标 key / 中文名（收 _ 缩压、舒张压），这是分组维度而非个体数据；
    // 但造数据时的测量值 165 / 100 绝不能出现——数值只有人数与百分比两类。
    expect(json).toContain("systolic");
    expect(json).not.toContain("165");
    // 数值集合限定为「人数 / 百分比 / 阈值」，不允许出现 100 以外的测量量级
    expect(json).not.toMatch(/"sampleSize":\s*(16[0-9]|[2-9][0-9]{2})/);
  });

  it("CSV 导出同样不含个体信息", () => {
    const csv = analyticsToCsv(overview);
    for (const key of ["userId", "username", "165"]) {
      expect(csv).not.toContain(key);
    }
  });

  it("被隐藏的分组值一律为 null，不会被兜底成 0（0 也是一种「有信息」的断言）", () => {
    const small = buildAnalyticsOverview(
      many(2, { abnormalKeys: ["systolic"] })
    );
    for (const stat of small.indicatorAbnormal) {
      expect(stat.abnormalCount).toBeNull();
      expect(stat.sampleSize).toBeNull();
      expect(stat.rate).toBeNull();
    }
    for (const bucket of small.scoreDistribution) {
      expect(bucket.count).toBeNull();
      expect(bucket.ratio).toBeNull();
    }
  });
});
