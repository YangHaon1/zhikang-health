# 智康健康 · 审计问题修复报告

> 对应《项目问题审查与比赛竞争力分析报告》（`docs/project-review-report.md`）问题编号。
> 修复提交：`5bbf24c64`（50 个文件，+3694 / -394）。
> 全部结论基于真实代码定位 + 本地实测验证，非泛泛总结。

---

## 一、逐项修复说明（对应审计编号）

### P0-1 LightGBM 模型文件被 Git CRLF 破坏

- **文件**：`.gitattributes`
- **问题**：全局 `core.autocrlf=true` 且模型文件未标记，`lgbm.txt` 在 checkout 时 6995 行全被转成 `\r\n`，LightGBM 报 `Model format error, expect a tree here`，**评委在 Windows 克隆后 AI 功能完全失效**。
- **修复**：追加 `server-ml/model/*.txt -text`、`*.pkl binary` 等标记，`git add --renormalize .`。
- **验证**：删除文件后 `git checkout --` 重新取出，CRLF=0 / LF=6995，`Booster(...).num_trees()==360`。

### P0-2 SHAP 解释方向反直觉

- **文件**：`server-ml/explain.py`、`server/src/services/ml-client.ts`、`server/src/routes/health/risk.ts`、`src/views/health/risk/index.vue`
- **问题**：多分类 SHAP 对三分类各返回一套贡献值，原实现取全类平均导致正负抵消；对 low 类的正贡献本意是"推向低风险"，直接当方向输出，出现"睡 8 小时=升高风险"。
- **修复**：**重要度排序用被预测类 `matrix[:, pred]`，风险方向统一用 high 类 `matrix[:, 2]`**；降级时方向输出 `unknown` 不伪装；Node 层透传不做二次计算。
- **实测**：健康学生 → 睡眠 `-0.9575 lower_risk`；高风险学生 → 运动 `+0.9752 raise_risk`。方向语义正确。

### P0-3 健康评分未归一化（血压 200/120 得 25 分"低风险"）

- **文件**：`server/shared/health-engine.ts`
- **修复**：公式改为 `Σ(w×lvl) / Σ(w_已测) × 100`，未测指标不进分母；新增高危保底——任一单项 level=2 时总分不低于 30（"中"阈值）。
- **实测**：血压 200/120 → 100 分"极高"（原 25 分"低"）；仅 LDL 异常 → 保底 30 分"中"。新增 5 条黄金用例，390/390 通过。

### P0-4 急症判断误触发（"我没有胸痛"触发 120）

- **文件**：`server/shared/health-engine.ts`
- **修复**：
  1. 否定语境过滤：`NEGATION_HINTS`（没有/不会/绝不/以前/家人/已经好了/担心/如果…共 35 词），关键词前 8 字窗口内命中否定词则不触发；
  2. 补低血压下界：收缩压≤90、舒张压≤60；
  3. 补心率 <40 或 >130、血糖 ≥33.3；
  4. 心理危机词（不想活/轻生/自杀）走 **12356 心理援助热线** 而非 120。
- **实测**：20/20 用例通过，"我没有胸痛""家人有抽搐史""我不会轻生"均不再误触发。

### P0-5 缺失数据填 0 导致全零输入被判高风险

- **文件**：`server-ml/feature.py`、`server-ml/model.py`、`server-ml/main.py`、`server/src/routes/health/risk.ts`
- **问题**：0 在训练分布里是极端值（就寝 0 点、BMI 0），实测全零输入 → `high / 0.904`。
- **修复**：缺失一律填训练集统计值（`FEATURE_DEFAULTS`）；`dataQuality` 新增 `empty` 级别；关键字段全缺时返回 `riskLevel=unknown / sufficient=false / 提示补充记录`，**不输出伪结论**；`risk.ts` 近 7 天无记录直接返回 `insufficient`，不再调模型。
- **实测**：`POST /predict {"features":{}}` → `unknown, sufficient=false, 含提示文案`；版本号从错误的 v0.2 修正为 v0.3（改为从 `metadata.json` 读取）。

### P1-6 前端硬编码五维健康画像

- **文件**：`server/shared/daily-health.ts`（新增 `buildHealthDimensions`）、`server/src/routes/health/daily.ts`、`src/views/health/dashboard/index.vue`
- **修复**：画像由共享层根据健康记录实算（睡眠=时长+质量、运动=日均分钟、压力、饮食规律占比、**作息按就寝偏离 23:00 每小时扣 20 分**），每维返回 `basis` 数据依据；采样不足 3 天返回 `null`（前端显示"—"不渲染 0）。前端只展示不计算。

### P1-7 伪 AI 进度条

- **文件**：`src/views/health/report/index.vue`、`src/views/health/ai-profile/index.vue`
- **修复**：删除模拟百分比动画，改为真实状态「数据分析完成 / 风险计算完成 / 建议生成完成」，并注明"由规则引擎实时计算生成，非分步 AI 生成过程"。答辩时不再被问"这个进度条是真的吗"。

### P1-8 健康因素图用正则数关键词次数当强度

- **文件**：`src/components/health/ai/HealthFactorChart.vue`
- **修复**：废弃 `count*50%` 伪量化，改为 SHAP 贡献度条形图（带方向、注明"来自模型 SHAP 单样本归因"）；无 SHAP 时只罗列问题不画条；都无则显示"暂无分析数据"。三级渲染，永不造假。

### P2-9 Agent 断链（三个 Agent 互不相干）

- **文件**：`server/src/services/agent-orchestrator.ts`（新增）、`server/src/routes/health/agentWorkflow.ts`（新增）、`server/src/routes/health/index.ts`
- **修复**：新增编排器统一管理 `用户数据 → Analyze Agent → 风险总结 → Plan Agent → 健康计划 →（可选）Review Agent → 效果反馈`，上一步结构化输出作为下一步输入；新路由 `POST /api/health/agent/workflow` 一次调用返回全链结果，前端无需自行串接。

### P2-10 Plan Agent 收到空 summary

- **文件**：`server/src/services/health-plan-agent.ts`、`server/src/routes/health/agentWorkflow.ts`
- **修复**：`PlanInput` 必须接收 Analyze 的 `summary / risk / reason / healthType`，prompt 注入"学生状态 / 行为画像 / 风险等级 / 主要成因"，并要求"建议与成因一一对应，不给通用建议"。
- **实测**：正常用户 `context.risk=low, summary=42 字`；高风险用户 `risk=high, summary=52 字`，步骤 `analyze:ai, plan:ai`。

### P2-11 Review Agent 前后对比窗口重叠

- **文件**：`server/src/services/health-review-agent.ts`
- **修复**：`now = 最近 7 天`，`before = 第 8~14 天`，SQL 用 `date < now-from AND date >= now-to`，两窗口互不重叠。

### P2-12 Review Agent 越权

- **文件**：`server/src/services/health-review-agent.ts`、`server/src/routes/health/reviewAgent.ts`
- **修复**：计划归属校验前置（`WHERE id=? AND user_id=?`），查不到返回 `{forbidden:true}` → 路由转 403，不泄露任何完成率；planId 非法返回 40001。
- **实测**：他人 token 复评他人计划 → **403**；planId=0 → 40001。

### 13 RAG 路径失效（从根目录启动永远读不到知识库）

- **文件**：`server/src/services/health-knowledge.ts`
- **问题**：`path.resolve(process.cwd(), "src", "data", ...)` 只有 `cwd=server/` 才成立，而根 `package.json` 的 `dev:all` 从**项目根目录**启动后端 → 路径解析成 `<root>/src/data`（不存在），异常被 catch 吞掉，RAG 静默降级为空。
- **修复**：改用 `import.meta.dirname` 定位同源码树内的 `server/src/data/health-knowledge.json`（三候选路径兜底，源码/编译产物/根目录启动全兼容），并暴露 `knowledgeStatus()` 供自检。
- **实测**：根目录与 server 目录双场景启动均 `loaded: 10`；"睡眠不好怎么办"→ 命中《固定作息与睡眠卫生》。

### 14 cluster metadata 键名不匹配 + cwd 路径问题

- **文件**：`server-ml/cluster-model/metadata.json`、`server/src/routes/health/clusterStats.ts`、`server/src/routes/health/analytics.ts`、`server/src/paths.ts`、`src/views/health/analytics/index.vue`
- **问题**：metadata 写 `"version"`，三处代码读 `model_version` → 版本永远回退默认值；且路径用 `process.cwd()+/../server-ml` 从根目录启动读不到；前端 `v-if="{}"` 恒真导致渲染 `undefined`。
- **修复**：metadata 键改为 `model_version`（与 `clustering.py` 写入口径一致）；路径统一收敛到 `paths.ts` 的 `mlAssetPath()`；`clusterStats` 补 `authMiddleware`（原来匿名可读训练元信息）；analytics 页面改为真实渲染 `版本/数据模式/真实样本/轮廓系数`，metadata 不可用时显示"模型未加载"。

### 15 清理死代码与重复实现

| 项                                                     | 处理                                                                                                                                                                                                                                         |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `health-score.ts` 的 `bmiLabel` / `calculateRiskLevel` | **删除**。全仓库零调用，且后者 `>=80 判低风险` 与引擎语义**相反**，是会被误用的地雷                                                                                                                                                          |
| `cluster_predict.py` 硬编码 `CLUSTER_NAMES`            | **删除**。与 metadata 实际簇名冲突且永远不会被命中（`info` 优先）                                                                                                                                                                            |
| 聚类预测缺失值填 0                                     | 顺手修正为与 `model.predict` 同口径走 `FEATURE_DEFAULTS`（同类方向性错误）                                                                                                                                                                   |
| BMI 公式 4 份                                          | **收敛为 1 份**：`health-score.calculateBMI`，`health-engine.gradeBmi` / `ai-profile` / `risk.ts` 全部改为引用                                                                                                                               |
| 日期格式化 7 份                                        | 服务端收敛到 `server/shared/date-utils.ts`（`health-plan` 再导出保持老 import 可用，`health-reminder`/`health-seed`/`seedStudent` 改引用）；前端收敛到 `src/utils/date.ts`（trend / report / import / dashboard 四页改引用），口径与后端一致 |

---

## 二、修改文件清单（50 个）

**后端共享层（8）**：`health-engine.ts`、`daily-health.ts`、`ai-profile.ts`、`health-plan.ts`、`health-reminder.ts`、`health-seed.ts`、`health-score.ts`、`date-utils.ts`(新)
**后端路由/服务（15）**：`risk.ts`、`daily.ts`、`analytics.ts`、`clusterStats.ts`、`planAgent.ts`、`reviewAgent.ts`、`agentWorkflow.ts`(新)、`index.ts`、`seedStudent.ts`、`paths.ts`、`agent-orchestrator.ts`(新)、`health-plan-agent.ts`、`health-review-agent.ts`、`health-knowledge.ts`、`ml-client.ts`
**Python ML（6）**：`explain.py`、`feature.py`、`model.py`、`main.py`、`cluster_predict.py`、`cluster-model/metadata.json`
**前端（17）**：`risk/index.vue`、`dashboard/index.vue`、`report/index.vue`、`ai-profile/index.vue`、`analytics/index.vue`、`trend/index.vue`、`import/index.vue`、`HealthFactorChart.vue`、`api/health.ts`、`types/health.ts`、`utils/date.ts`(新) 等
**其他（4）**：`.gitattributes`、`README.md`、`docs/model-report.md`、测试 2 个

---

## 三、测试结果

| 验证项                                 | 结果                                        |
| -------------------------------------- | ------------------------------------------- |
| 服务端 `tsc --noEmit`                  | ✅ 0 error                                  |
| 前端 `vue-tsc --noEmit --skipLibCheck` | ✅ 0 error                                  |
| 前端 `vite build`（生产构建）          | ✅ built in 10.54s，4.94 MB                 |
| 单元测试 `vitest run`                  | ✅ 13 文件 / 390 用例全通过                 |
| `eslint server src build`              | ✅ 0 error                                  |
| ML 服务启动                            | ✅ `/health` 返回 `modelVersion: lgbm-v0.3` |
| 后端启动（从根目录，模拟 `dev:all`）   | ✅ 3000 端口，托管新构建产物                |

**核心流程端到端（三类用户，57 项断言全部通过）**

| 用例             | 风险预测                                  | SHAP                                         | Analyze Agent                  | 工作流                                         |
| ---------------- | ----------------------------------------- | -------------------------------------------- | ------------------------------ | ---------------------------------------------- |
| 新用户（零数据） | `unknown / insufficient` ✅ 不再误判 high | 空（不造假）                                 | 提示补充记录                   | `analyze:rule → plan:ai`                       |
| 正常用户         | `low / 0.876`                             | 3 项全部 `risk_down`，无"睡够=升高风险"      | `summary 42 字` + 3 个关键问题 | `analyze:ai → plan:ai`，Plan 收到 risk+summary |
| 高风险用户       | `high / 1.0`                              | 3 项全部 `risk_up`（睡眠/压力/睡眠不足天数） | `summary 52 字`                | 同上，且计划任务非空                           |

安全断言：他人 planId / 不存在的 planId → **403**（不泄露完成率）；planId=0 → 40001；`cluster-stats` 匿名访问 → 401。

---

## 四、e2e 过程中发现并修复的新问题（审计报告未覆盖）

1. **复评功能从未真正成功过**（最严重）：`health-review-agent.ts` 查询了不存在的列 `health_plans.created_at`（实际是 `create_time`），SQL 抛异常被路由 catch 吞成"复评失败"，**越权 403 分支永远走不到**。已修列名。
2. **完成率 SQL 引用不存在的列**：`task_checkins` 没有 `plan_id` / `done` 两列，完成率计算必然抛异常。已改用共享层 `planProgress()` 统一口径（与计划页同源）。
3. **异常静默吞没**：`agentWorkflow` / `reviewAgent` 路由的 `catch` 补 `console.error`，此类列名错误不会再潜伏。
4. **RAG 整句提问零命中**：检索只做"关键词∈查询词"正向匹配，"睡眠不好怎么办"命中不了关键词"睡眠"，实际注入率≈0。已补反向包含匹配，实测三类提问均命中、无关提问正确返回空。

> 这 4 个问题印证了审计报告的核心判断：**接口"能返回 200"不等于"功能正确"**——静默降级掩盖了整条链路的失效。这也是本次坚持做全链路 e2e 实测而非只看类型检查的原因。

---

## 五、剩余未修复风险（诚实清单）

| 编号      | 问题                                                                               | 状态                                                                                       |
| --------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| ML-03     | **真实训练样本为 0**（`training_mode=synthetic_only`，4000 条合成数据 + 规则标签） | 未修复（需赛前采真实问卷 ≥100 条触发 `real_priority`，或答辩按"合成数据验证工程闭环"叙事） |
| ML-06     | KMeans 轮廓系数仅 0.066，簇分离度弱                                                | 未修复（依赖真实数据重训；现已在 analytics 页如实展示该指标）                              |
| 前端 P1-6 | ECharts dispose、请求竞态、token 刷新等前端健壮性问题                              | 未修复（不影响演示主链路，建议赛前集中修一轮）                                             |
| P1-8      | `seed-student` 未限环境 + adminOnly；登录/LLM 接口无限流                           | 未修复（演示环境可接受，公网部署前必须加）                                                 |
| LLM 依赖  | 火山方舟 30s 超时，全异常降级为规则模板                                            | 已如实降级不造假；演示时若断网会显示规则文案，属预期行为                                   |
| e2e 数据  | 测试产生的 `e2e_*` 三个账号与数据留在库内                                          | 演示前可用 `/health/seed` 重置或手动清理                                                   |

---

## 六、验收命令（可复跑）

```bash
cd server && npx tsc --noEmit                                   # 服务端类型
npx vue-tsc --noEmit --skipLibCheck                             # 前端类型
npx vitest run                                                  # 390 用例
npx eslint server src build                                     # 0 error
npx vite build                                                  # 生产构建
npx tsx .workbuddy/tmp/e2e.mts                                  # 57 项核心流程断言（需先启动 ml+server）
curl -X POST localhost:8000/predict -H "Content-Type: application/json" -d '{"features":{}}'   # 数据不足守卫
curl -X POST localhost:8000/cluster -H "Content-Type: application/json" -d '{"features":{}}'   # 聚类默认值填充
```
