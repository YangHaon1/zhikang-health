/**
 * 健康上下文服务最小测试（V1.5）。
 *
 * vitest.config.ts 约定：server/src 下的单测不碰 SQLite。
 * buildHealthContext 本身会读库，这里对取数依赖打桩，只验证空数据安全路径：
 * 不报错、返回空串、且绝不输出诊断性结论。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../routes/health/common.js", () => ({
  profileForEngine: () => null,
  recordsForEngine: () => []
}));

vi.mock("../../routes/health/report.js", () => ({
  recentReportSummaries: () => []
}));

import { buildHealthContext } from "../health-context.js";

describe("buildHealthContext", () => {
  it("无档案/无记录/无报告的用户应返回空串，不编造数据", () => {
    const ctx = buildHealthContext(99999999);
    expect(typeof ctx).toBe("string");
    expect(ctx.length).toBe(0);
  });

  it("输出不应包含诊断性措辞（疑似/确诊/患有疾病）", () => {
    const ctx = buildHealthContext(99999999);
    // 空串也满足该约束；这里固定校验敏感词黑名单
    for (const word of ["疑似", "确诊", "你患有"]) {
      expect(ctx.includes(word)).toBe(false);
    }
  });
});
