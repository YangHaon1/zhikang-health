# 智康健康管理系统 — UI 深色驾驶舱重规划方案

> 版本：v1.0（规划稿，未动代码）
> 范围：`src/views/health/**` 全部 19 个业务页 + `src/components/health/**` 共享卡片 + 主题层
> 风格：深色科技驾驶舱（Dark Tech Cockpit）
> 依据：`AGENTS.md` 执行契约 —— 只动本方案点名范围，每阶段独立小写 commit

---

## 1. 目标与设计方向

### 1.1 为什么是深色驾驶舱

比赛答辩场景下，评委第一眼看到的是大屏投影。浅色后台模板（vue-pure-admin 默认白底）在投影仪上：

- 对比度低、数据字发灰；
- 卡片之间靠阴影区分，投影糊掉后层次全失；
- 与"AI + 健康"叙事的科技感脱节。

深色驾驶舱的优势：

- 数据字在暗底上天然高对比，远观可读；
- 霓虹主色（青/紫/电蓝）在投影上有发光感，对应"AI 预测"叙事；
- 玻璃拟态卡片用边框和透明度分层，不靠阴影，投影不糊。

### 1.2 设计基调

- **不是** 改成纯黑大屏风（那是监控中心），而是"后台壳子 + 健康模块内部驾驶舱化"。
- 顶栏、侧边栏、tags-view 保持 vue-pure-admin 原生 dark 主题（已存在），**不动 layout 框架核心**。
- 只在 `app-main` 内部、health 路由下，把页面背景、卡片、图表、按钮切成驾驶舱语言。
- 浅色模式保留可用（不写死 `html.dark`，而是给 health 页面加一个 `health-cockpit` 作用域类，在 dark 下生效；浅色下不破坏原视觉）。

---

## 2. 设计 Token（统一变量）

新建 `src/style/health-cockpit.scss`，所有 health 页面通过 `:where(.health-cockpit)` 作用域引用，避免污染 system / login 等无关页。

### 2.1 背景层级（从底到顶）

| Token                | 值                          | 用途                    |
| -------------------- | --------------------------- | ----------------------- |
| `--hc-bg-base`       | `#050810`                   | app-main 最底，深空蓝黑 |
| `--hc-bg-raise`      | `#0a1120`                   | 页面次背景（嵌套区块）  |
| `--hc-card`          | `rgba(148, 184, 255, 0.04)` | 玻璃卡片底              |
| `--hc-card-hover`    | `rgba(148, 184, 255, 0.08)` | 卡片 hover              |
| `--hc-border`        | `rgba(148, 184, 255, 0.12)` | 1px 描边                |
| `--hc-border-strong` | `rgba(148, 184, 255, 0.22)` | 强调描边（霓虹卡）      |

### 2.2 主色与霓虹点缀

| Token              | 值                                                  | 用途                                          |
| ------------------ | --------------------------------------------------- | --------------------------------------------- |
| `--hc-primary`     | `#22d3ee`                                           | 霓虹青，主 CTA、主指标                        |
| `--hc-violet`      | `#a78bfa`                                           | 霓虹紫，AI 相关模块                           |
| `--hc-blue`        | `#60a5fa`                                           | 电蓝，数据系列                                |
| `--hc-cyan-grad`   | `linear-gradient(135deg, #22d3ee 0%, #60a5fa 100%)` | 主渐变                                        |
| `--hc-violet-grad` | `linear-gradient(135deg, #6366f1 0%, #a78bfa 100%)` | AI 渐变（沿用现有 #6366f1→#8b5cf6，提亮端点） |

### 2.3 语义色（深底专用，比原 tailwind 色亮一档）

| 等级            | 旧值（浅底用） | 新值（深底用） |
| --------------- | -------------- | -------------- |
| 低风险 / 良好   | `#16a34a`      | `#34d399`      |
| 中风险 / 警告   | `#f59e0b`      | `#fbbf24`      |
| 高风险          | `#f97316`      | `#fb923c`      |
| 极高风险 / 危险 | `#dc2626`      | `#f87171`      |
| 信息 / 未知     | `#64748b`      | `#94a3b8`      |

> 所有 `LEVEL_COLOR` / `LEVEL_META` 硬编码对象改为读 CSS 变量或 `computed(() => isDark ? dark : light)`，浅色模式自动回退。

### 2.4 文字层级

| Token                 | 值                                                           | 用途        |
| --------------------- | ------------------------------------------------------------ | ----------- |
| `--hc-text-primary`   | `#e6edf7`                                                    | 主文字      |
| `--hc-text-secondary` | `#9aa8bf`                                                    | 次级说明    |
| `--hc-text-disabled`  | `#5b6b85`                                                    | 禁用 / 占位 |
| `--hc-num-font`       | `"DIN Alternate", "JetBrains Mono", ui-monospace, monospace` | 大数字指标  |

### 2.5 卡片通用类

```scss
.hc-card {
  background: var(--hc-card);
  border: 1px solid var(--hc-border);
  border-radius: 12px;
  backdrop-filter: blur(12px);
  transition:
    border-color 0.2s,
    transform 0.2s;
}
.hc-card--glow {
  border-color: var(--hc-border-strong);
  box-shadow: 0 0 24px rgba(34, 211, 238, 0.08);
}
```

---

## 3. 改造范围边界（哪些动、哪些不动）

### 3.1 本次点名要动

- `src/views/health/**`（19 个页面，清单见 §5）
- `src/components/health/**`（6 个基础卡片 + `ai/` 下 3 个 AI 卡片）
- 新建 `src/style/health-cockpit.scss`
- `src/style/dark.scss` 中 `.app-main` 背景：`#020409` → `var(--hc-bg-base)`（仅 dark 下）
- `src/plugins/echarts.ts`：注册自定义 `health-dark` 主题

### 3.2 明确不动（遵守 AGENTS.md 第 3 条）

- `src/layout/**`（顶栏/侧栏/tags-view 框架核心）
- `src/views/system/**`、`src/views/login/**`、`src/views/account-settings/**`、`src/views/error/**`
- 任何业务逻辑、API 调用、规则引擎、文案
- `server/**`、`server-ml/**`、`mock/**`
- 浅色模式下的视觉（即所有改造用 `html.dark .health-cockpit` 或 `isDark` 守卫，浅色回归原样）

---

## 4. 共享组件改造（性价比最高，先做）

| 文件                                         | 现状            | 改造动作                                           |
| -------------------------------------------- | --------------- | -------------------------------------------------- |
| `components/health/TodayScoreCard.vue`       | 浅色底 + 评分圆 | 玻璃卡 + 分数数字用 `--hc-num-font` + 霓虹描边圆环 |
| `components/health/TodayStatusCard.vue`      | 小状态卡        | 改 `hc-card`，状态点加发光                         |
| `components/health/AIAdviceCard.vue`         | 白卡            | 紫渐变顶条（4px）+ 玻璃底                          |
| `components/health/QuickDailyRecord.vue`     | 表单白卡        | 玻璃底，输入框走 Element Plus 暗色变量             |
| `components/health/StudentProfileCard.vue`   | 信息白卡        | 玻璃底，字段名 `--hc-text-secondary`               |
| `components/health/AiBadge.vue`              | 小徽章          | 紫底霓虹字 `#a78bfa`                               |
| `components/health/ai/RiskScoreCard.vue`     | 风险分          | 仪表盘改为发光环（svg stroke 渐变）                |
| `components/health/ai/HealthFactorChart.vue` | SHAP 条形图     | ECharts 切 `health-dark` 主题，条形用青→紫渐变     |
| `components/health/ai/AIAdviceList.vue`      | 建议列表        | 左侧 3px 霓虹竖条 + 玻璃行                         |

> 共享组件改完，dashboard / risk / ai-profile 三页自动受益 60%。

---

## 5. 19 个页面逐页改造要点

按答辩演示路径排序。

### 5.1 第一梯队（答辩主路径，必改）

| 页面           | 文件                          | 改造重点                                                                                                                                                                                                                              |
| -------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard 首页 | `dashboard/index.vue`（36KB） | ① 5 个 quickLink 浅色块（`#e8f7ef/#eef2ff/#fff7ed/#ecfeff/#f5f3ff`）改成玻璃卡 + 对应霓虹图标色；② `#eef2ff→#f5f3ff`、`#f0faf5→#f6fdf9` 两处浅渐变改 `hc-card`；③ ECharts 趋势图切 `health-dark`；④ 顶部问候语区加一条 1px 渐变分割线 |
| 风险预测       | `risk/index.vue`（18KB）      | ① 已有 `#0f766e→#4f46e5` 渐变保留（正好是驾驶舱风）；② `#eef2ff→#f5f3ff`、`#eef2ff→#f0fdf4`、`#fefce8→#f0fdf4` 三处浅渐变改玻璃；③ `LEVEL_META` 颜色切深底语义色；④ Agent 三步流程（Analyze→Plan→Review）步骤条加霓虹连接线           |
| 健康报告       | `report/index.vue`（32KB）    | ① `#6366f1→#8b5cf6` 渐变保留并提亮；② radar / trend 图切 `health-dark`；③ 报告头部加玻璃大卡；④ 风险建议列表套 `AIAdviceList` 样式                                                                                                    |
| AI 中心        | `ai-hub/index.vue`（3.4KB）   | 入口页，紫渐变保留，卡片栅格改 `hc-card` 网格                                                                                                                                                                                         |
| AI 画像        | `ai-profile/index.vue`        | ① 两处紫渐变保留；② `#6366f1→#a5b4fc` 进度条改成发光进度条（`box-shadow: 0 0 8px #a78bfa`）；③ 五维雷达图切 `health-dark`                                                                                                             |

### 5.2 第二梯队（AI 链路配套）

| 页面                                             | 改造重点                                                                                           |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `chat/index.vue` + `chat/components/ChatGPT.vue` | 聊天气泡：用户气泡紫渐变右对齐，AI 气泡 `hc-card` 左对齐；输入框玻璃底；`#6366f1→#8b5cf6` 顶条保留 |
| `companion/index.vue`                            | `#fff→#f0f5ff` 浅渐变改 `hc-bg-raise`；紫渐变保留                                                  |
| `survey/index.vue`                               | `#0f766e→#4f46e5` 渐变头卡保留；表单区玻璃化                                                       |

### 5.3 第三梯队（数据与表格页）

| 页面                                   | 改造重点                                                       |
| -------------------------------------- | -------------------------------------------------------------- |
| `records/history.vue`                  | vxe-table 在 dark.scss 已配暗色，只需把页头统计卡改 `hc-card`  |
| `plans/index.vue`                      | 计划进度条改霓虹进度条；空态插画保留                           |
| `analytics/index.vue`（49 处颜色命中） | 图表全部切 `health-dark`；统计 KPI 大数字用 `--hc-num-font`    |
| `trend/index.vue`                      | 单页图表，切 `health-dark`，加 1px 边框卡                      |
| `import/index.vue`                     | 上传区改虚线霓虹边框（`border: 1px dashed var(--hc-primary)`） |

### 5.4 第四梯队（合规与工具页，统一套皮即可）

| 页面                              | 改造重点                                                                               |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `audit/index.vue`                 | 表格页，套 hc-card 即可                                                                |
| `authorizations/index.vue`        | 开关 + 列表，玻璃化                                                                    |
| `profile/index.vue`               | 档案表单，玻璃化                                                                       |
| `showcase/index.vue`（38 处颜色） | 演示页，`#f8fafc→#eef2ff` 浅渐变改 `hc-bg-raise`；其余绿/紫/青渐变本身就是霓虹色，保留 |

---

## 6. ECharts 自定义主题 `health-dark`

在 `src/plugins/echarts.ts` 同级新建 `src/plugins/echarts-theme-health-dark.ts`，注册：

```ts
export function registerHealthDarkTheme() {
  echarts.registerTheme("health-dark", {
    backgroundColor: "transparent",
    textStyle: { color: "#9aa8bf" },
    title: { textStyle: { color: "#e6edf7" } },
    legend: { textStyle: { color: "#9aa8bf" } },
    grid: { borderColor: "transparent" },
    categoryAxis: {
      axisLine: { lineStyle: { color: "rgba(148,184,255,0.2)" } },
      splitLine: { show: false },
      axisLabel: { color: "#9aa8bf" }
    },
    valueAxis: {
      axisLine: { show: false },
      splitLine: { lineStyle: { color: "rgba(148,184,255,0.08)" } },
      axisLabel: { color: "#9aa8bf" }
    },
    tooltip: {
      backgroundColor: "rgba(10,17,32,0.92)",
      borderColor: "rgba(148,184,255,0.2)",
      textStyle: { color: "#e6edf7" }
    },
    color: ["#22d3ee", "#a78bfa", "#60a5fa", "#34d399", "#fbbf24", "#fb923c"]
  });
}
```

调用点：所有 `echarts.init(el)` → `echarts.init(el, theme ?? "health-dark")`，复用 dashboard 已有的 `useDark()` 模式。

---

## 7. 分阶段实施计划（对应 AGENTS.md 每阶段一 commit）

| 阶段 | commit subject（中性小写）                           | 内容                                                                                       | 验证                                                                 |
| ---- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| P1   | `feat(style): health cockpit theme tokens`           | 新建 `health-cockpit.scss`；改 dark.scss 的 app-main 背景；注册 `health-dark` ECharts 主题 | `pnpm typecheck` 通过；8848 切 dark 后 app-main 变深空蓝，无布局错位 |
| P2   | `refactor(components): health cards glass style`     | §4 九个共享组件玻璃化                                                                      | 浏览 dashboard，卡片背景/边框/字体生效；浅色模式回归原样             |
| P3   | `feat(views): dashboard cockpit layout`              | dashboard 首页 5 个 quickLink + 浅渐变清理 + 趋势图换主题                                  | dashboard 在 dark 下无浅色块残留；`pnpm typecheck`                   |
| P4   | `feat(views): risk and report cockpit`               | risk / report 两页浅渐变清理 + Agent 步骤条霓虹化 + 图表换主题                             | 走一遍风险预测→报告生成链路，SHAP 条形图颜色正确                     |
| P5   | `feat(views): ai hub profile chat companion`         | ai-hub / ai-profile / chat / companion / survey 五页                                       | AI 对话气泡明暗可读；画像雷达图霓虹                                  |
| P6   | `feat(views): records plans analytics trend import`  | 数据与表格五页                                                                             | vxe-table 暗色正常；导入上传区霓虹边框                               |
| P7   | `feat(views): audit authorizations profile showcase` | 合规与工具四页                                                                             | 全 health 模块扫一遍无 `#f0f5ff/#fff/#eef2ff` 浅残留                 |

> 每个阶段完成后跑：
>
> ```powershell
> pnpm typecheck
> npx eslint src/views/health src/components/health src/style --max-warnings 0
> curl http://localhost:8848/  # HTTP 200
> ```

---

## 8. 浅色模式保护原则

- 所有新样式用 `html.dark .health-cockpit` 或 `:deep()` 作用域包裹；
- 颜色切换用 `const token = computed(() => isDark.value ? "#34d399" : "#16a34a")`，不在 scss 里写死；
- ECharts `theme = isDark ? "health-dark" : undefined`（沿用 dashboard 现有写法）。

这样评委如果现场按了浅色模式，页面不会崩，只是回到原 vue-pure-admin 风格。

---

## 9. 验收清单（P7 完成后逐项过）

- [ ] dark 模式下 app-main 背景为 `#050810`，无白块
- [ ] health 模块下 `grep -rE "#eef2ff|#f5f3ff|#fff7ed|#e8f7ef|#f0faf5|#f8fafc" src/views/health` 只剩注释或字符串文案
- [ ] dashboard / risk / report 三页大数字用等宽字体
- [ ] 所有 ECharts tooltip 在 dark 下是深色玻璃，不是白底
- [ ] 语义色（低/中/高/极高）在 dark 下亮度足够，不发灰
- [ ] 切回浅色模式，所有页面视觉与改造前一致
- [ ] `pnpm typecheck` 0 error；`pnpm build` 成功
- [ ] 8848 端口 dev 跑通，无控制台报错

---

## 10. 风险与回滚

- **风险 1**：玻璃拟态 `backdrop-filter` 在老版本 Edge 上性能差。兜底：加 `@supports not (backdrop-filter: blur(1px))` 退回纯色 `#0a1120`。
- **风险 2**：vxe-table 暗色变量在 dark.scss 里已配，但 health 表格页可能局部覆盖。P6 阶段跑 records/plans/audit 三页实测。
- **回滚**：每个阶段独立 commit，出问题 `git revert <hash>` 单阶段回退，不影响其他阶段。
