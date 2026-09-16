import { defineConfig } from "vitest/config";

/**
 * 单元测试配置（P1 vitest）。
 * 只跑 server/shared 的纯函数测试（当前为规则引擎），
 * 环境固定 node（引擎禁 DOM/Node 依赖，这里同时验证「可被 Node 加载」）。
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["server/shared/**/*.test.ts"],
    exclude: ["node_modules", "dist", "server/data"]
  }
});
