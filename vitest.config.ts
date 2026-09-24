import { defineConfig } from "vitest/config";

/**
 * 单元测试配置（P1 vitest）。
 * 环境固定 node（规则引擎禁 DOM/Node 依赖，这里同时验证「可被 Node 加载」）。
 *
 * 两处测试根：
 * - `server/shared/**`：规则引擎与各阶段共享纯函数（前后端同一份源码）；
 * - `server/src/**`（C7 新增）：不碰数据库的服务端组件（当前为可观测性中间件）。
 *   只放**能脱离 SQLite 运行**的测试；带库行为一律走接口实测
 *   （`server/scripts/regress-api.mjs`），避免单测隐式依赖本机数据。
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["server/shared/**/*.test.ts", "server/src/**/*.test.ts"],
    exclude: ["node_modules", "dist", "server/data"]
  }
});
