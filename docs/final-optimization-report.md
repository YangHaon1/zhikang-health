# 智康健康 · 赛前最终优化报告

> 生成时间：2026-09-25
> 覆盖范围：审计修复结果核验 → 剩余风险处理 → 九步演示链路走查 → 代码质量优化
> 核心原则：**基于真实代码与实测，不编造结果，不为好看修改展示数据，不隐藏失败**

---

## 一、结论摘要

本轮工作不是重新审计，而是**对着已提交的修复报告逐条回到代码里验证**，再修复验证中发现的真实遗留问题。

**三条最关键的结论：**

1. **审计报告里 14 项修复确实已在代码中生效**（逐项读文件 + 跑接口验证，全部 PASS）。
2. **有一处"新发现"是我自己上一轮的误判，已纠正**：`silhouette: 0.066` 是真实值，不是记录错误。
   上一轮我用自写的 kmeans 探针得到 +0.1976 并据此判断"记录失真"；本次用真实 sklearn 流水线
   复算，实测为 **0.0661**，与记录完全一致。跨实现对比指标口径是不可靠的。
3. **本轮新发现并修复了 6 个真实缺陷**，其中 2 个会直接影响现场展示：
   SHAP 解释文案与条形图数字自相矛盾、**Agent 工作流第三步复评结果被前端丢弃**。

**验证基线（全部通过）：**

| 检查项                            | 结果                      |
| --------------------------------- | ------------------------- |
| `vitest`                          | 390 passed / 13 files     |
| `server tsc --noEmit`             | 0 error                   |
| `vue-tsc --noEmit --skipLibCheck` | 0 error                   |
| 九步演示链路（common 账号）       | 12/12 步通过，总耗时 4.1s |
| eslint（改动文件）                | 0 error                   |

---

## 二、阶段一：修复结果真实性核验（PASS 清单）

逐条读真实代码 + 调真实接口验证，未采信报告文字。

| 编号    | 涉及文件                                   | 代码实际状态                                                                                                            | 结论                                         |
| ------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| P0-1    | `.gitattributes`                           | `git ls-files --eol` 显示 `i/lf w/lf`，模型 `crlf=0 lines=6995`                                                         | PASS                                         |
| P0-2    | `server-ml/explain.py`                     | `contrib_pred = matrix[:, pred]`（排序）+ `contrib_risk = matrix[:, risk_idx]`（方向）分离，降级返回 `unknown`          | PASS                                         |
| P0-3    | `server/shared/health-engine.ts`           | `score = measured > 0 ? Math.round((weighted/measured)*100) : 0`，分母只累计已测权重                                    | PASS                                         |
| P0-4    | `server/shared/health-engine.ts`           | `NEGATION_HINTS`（32 词）+ `NEGATION_WINDOW=8`；补 `systolic≤90 / 心率<40 或 >130 / 血糖≥33.3`；`CRISIS_STEPS` 走 12356 | PASS                                         |
| P0-5    | `server-ml/feature.py`、`risk.ts`          | 缺失填 `FEATURE_DEFAULTS`；`days===0` 返回 `insufficient`；`main.py` 中 `sufficient===false` 不返回 SHAP                | PASS（本轮发现其**填充判定不完整**，见 §三） |
| P1-6    | `daily-health.ts`、`dashboard/index.vue`   | `buildHealthDimensions` 实算，不足 3 天返回 `null`（不渲染 0），每维带 `basis`                                          | PASS                                         |
| P1-7    | `report/index.vue`、`ai-profile/index.vue` | 已改真实状态文案，注释明确"不模拟任何生成进度"                                                                          | PASS                                         |
| P1-8    | `HealthFactorChart.vue`                    | 三级渲染：SHAP 画条 → problems 只罗列 → "暂无分析数据"                                                                  | PASS                                         |
| P2-9~11 | `agent-orchestrator.ts` 等                 | 编排器串联；`create_time` 列名已修；前后 8~14 天窗口不重叠                                                              | PASS                                         |
| 13      | `health-knowledge.ts`                      | 三候选路径 + `knowledgeStatus()` 自检；反向包含匹配 `t.includes(k)`                                                     | PASS                                         |
| 14      | `cluster-model/metadata.json`、`paths.ts`  | 键名 `model_version`；`mlAssetPath()` 不依赖 cwd；已补 `authMiddleware`                                                 | PASS                                         |
| 15      | `health-score.ts`、`cluster_predict.py`    | BMI 收敛 1 份、日期格式化收敛共享层                                                                                     | PASS                                         |

---

## 三、阶段二：剩余风险处理

### 3.1 ML-06 聚类质量 —— 结论被推翻并纠正

**上一轮的判断（错误）**："meta 记录的 `silhouette: 0.066` 与真实值 +0.1976 不符，应修正记录值。"

**本轮用真实 sklearn 复算（口径与 `clustering.py` 完全一致：同一批合成数据 → 同一个 `StandardScaler` → 同一个 `kmeans.pkl` 的 `labels_` → `silhouette_score`）**：

```
[restore]  best_k=3  n_samples=600  n_clusters_in_pkl=3
[实测]     sklearn 标准口径 = 0.0661
[记录]     metadata.json   = 0.066      ← 一致
[零假设]   随机标签 20 次均值 = -0.0060  （min -0.0078 / max -0.0043）
[判别力]   相对随机基线 = +1196.6%
[k 扫描]   3: 0.0661  4: 0.0633  5: 0.0561  6: 0.0497
```

**正确结论**：`0.066` 是真实值，**不需要修正，也不需要重训提分**。
合成数据各特征独立生成，原始空间无天然簇结构，所以绝对分值低是预期的；
但把同一批标签随机打乱后轮廓系数掉到 **−0.006（低于 0，意味着比随机划分还差）**，
说明聚类确实抓到了结构性差异，不是把噪声硬分堆。k=3 在扫描区间内最优，不需要调 k。

**据此做了 3 件事（不改展示数据，只加解释与防漂移）：**

1. `clustering.py` 新增零假设基线计算（随机标签 20 次，seed=0）并写入 metadata；
   `metadata.json` 补 `silhouette_null_baseline: -0.006` / `sklearn_version: 1.7.2` /
   `silhouette_readout`（经比对，**旧字段一个都没被改动**，仅新增 3 个）。
2. 看板新增「聚类质量：轮廓系数 vs 随机标签基线」可视化（纯 CSS 条，不引 ECharts 避免生命周期问题），
   并在 `server-ml/README.md` 写明"不要试图把 0.066 优化上去"。
3. **发现并修复一个严重的复现性缺陷**：`requirements.txt` 完全没有 `scikit-learn` /
   `pandas`（而 `clustering.py` 直接依赖），且全部只写 `>=` 无上界。
   实测同一份数据在 **sklearn 1.7.2 与 1.9.1 下重跑，簇命名会从「作息失衡型」变成「健康平衡型」**——
   现场若换环境重训，展示结论会漂。现已补依赖 + `scikit-learn>=1.7.2,<1.8` 上界，
   并在 README 给出锁定版本的复现命令。

> 过程中我一度创建 `.venv17` / `.venv2` 临时环境验证，沙箱阻止了批量删除，
> 二者已被 gitignore 覆盖、不入库；若你需要清理可手动删除 `server-ml/.venv17`、`server-ml/.venv2`。

### 3.2 ML-03 真实数据闭环（承接上一轮）

已闭环并实测通过：`GET /health/survey/dataset-status` → 灌 5 条问卷 → `POST /health/survey/export-dataset`
→ 导出 `real_survey.db`（5 行、feature-key mismatches 0）→ Python 读回训练脚本可读。
越权测试：普通用户导出 **403**、匿名访问 dataset-status **401**。

### 3.3 前端健壮性

- ECharts 生命周期：`dispose()` + `onBeforeUnmount` + resize 监听配对完整（核验通过）。
- 超时错配（上一轮修）：AI 接口统一 `LLM_TIMEOUT = 90_000`，非 AI 接口仍 10s。
- 本轮新增：聚类可视化改用纯 CSS，不新增 ECharts 实例。

### 3.4 安全（答辩现场越权）

| 检查项              | 实测                                                    |
| ------------------- | ------------------------------------------------------- |
| `seed-student` 权限 | 仅 `authMiddleware`，只写本人数据                       |
| `/health/seed`      | `authMiddleware + adminOnly`                            |
| `cluster-stats`     | 已补 `authMiddleware`                                   |
| `/export-dataset`   | `adminOnly`，普通用户 **403**                           |
| `dataset-status`    | 匿名 **401**                                            |
| token 刷新          | 12h / 7d，前端有 `isRefreshing` 并发控制 + 401 重试队列 |

> 澄清一处**我先前成立的断言**：`daily.ts` 的 `POST /health/daily` 与 `GET /health/daily/today`
> 表面上没写 `authMiddleware`，我一度判断为"防御深度缺口"。核实后发现文件内第 30 行有
> `router.use(authMiddleware)` 且早于所有路由定义，实际受保护（匿名实测 401）。**无需修改，已撤销该项改动。**

---

## 四、阶段三：按评委视角走完九步链路

用 `common / common123` 登录，逐端点实测（脚本 `.workbuddy/tmp/walk9.mjs`）：

```
[OK ] 0.登录            http=200  92ms   roles=common
[OK ] 1.健康档案        http=200   4ms   fields=20
[OK ] 2.今日状态        http=200   3ms
[OK ] 3.新增每日记录    http=200   4ms   id=3593
[OK ] 4.风险预测+SHAP   http=200  41ms   source=ml riskLevel=medium prob=0.99   shapFactors=3
[OK ] 5.AI 画像生成     http=200 1652ms  healthType=睡眠改善型 riskLevel=低风险
[OK ] 6.创建计划        http=200   4ms   id=23
[OK ] 7.计划详情        http=200   1ms   tasks=1
[OK ] 8.计划进度        http=200   2ms
[OK ] 9.任务打卡        http=200   2ms
[OK ] 10.生成健康报告   http=200   5ms   score=5 level=低
[OK ] 11.复评 Agent     http=200 2270ms
汇总：共 12 步，失败 0 步，总耗时 4.1s
```

**Agent 编排链路**（`POST /health/agent/workflow`，最坏耗时点）：

```
steps: [{"name":"analyze","source":"ai","degraded":false},
        {"name":"plan","source":"ai","degraded":false},
        {"name":"review","source":"ai","degraded":false}]
耗时 9.9s
```

**"伪 AI"核查结果为否**：AI 画像连续两次调用返回文案不同（"体重保持得很好，这个频率真的很不错"
vs "体重保持得很不错，这个频率很值得肯定"），规则文案是确定性的、不会变，
说明确实走了真实 LLM（DeepSeek，`server/.env` 已配 key）。服务端 `.env` 已被 gitignore 排除，无凭证泄露。

### 本轮在此环节发现并修复的 3 个真实缺陷

**问题 1（P0，解释可信度）— SHAP 文案与条形图数字自相矛盾**

实测返回：`睡眠质量 贡献 1.0309` 但文案写 `睡眠质量当前为 0`。

根因：`explain.py` 的 `value` 是 **SHAP 贡献值**，`description` 却引用**用户原始值**。
更严重的是：`build_features` 只把 `None / ""` 当缺失，而数据库把"未填写"存成了 **0**
（种子数据 `sleep_quality: 0`、`stress_level: 0`），于是分布外的 0 被原样喂给模型，
而 `data_quality` 又按 `!= 0` 把它计为缺失——**两个口径打架，演示账号的风险判定被一批离群 0 推着走**。

修复（已提交）：

- `feature.py` 按字段区分「0 合法」（`exercise_days` / `sleep_below7_days` / `is_off_campus`）
  与「0 只可能是没填」，与 `FEATURE_DEFAULTS` 同口径；新增 `is_missing()` 供解释层复用。
- `explain.py` 缺失时文案改为「（该字段未填写，按训练集平均水平参与计算）」，
  不再拿原始 0 出来说事。修复后实测文案：`平均压力（该字段未填写，按训练集平均水平参与计算），对本次风险判定起缓解作用`。

**问题 2（P1，演示白跑）— Agent 工作流第三步复评结果被丢弃**

后端编排器返回 `{analysis, plan, context, steps, review}`，
但 `src/api/health.ts` 的 `HealthAgentWorkflow` 类型未声明 `review`，
前端链路展示只画了 analyze / plan 两步，**复评算完但不展示**。

修复：补全 `HealthAgentReviewResult` 类型与 `review` 字段，风险页新增「复评结论」区块。

**问题 3（P1，演示失败风险）— admin 账号风险页必然空白**

实测 `admin`（user_id=1）的 `daily_health_records` 为 **0 条**（仅 user 2/74/75 各有 7 天），
`GET /health/risk` 返回 `riskLevel: unknown`、归因数组为空、耗时 5ms。
评委若用 admin 登录打开「健康风险」页，看到的是空白态。

这不是故障——是「数据不足不做预测」的主动降级（空输入落在训练分布外，实测会被误判 high/0.904）。
种子脚本刻意只给 `common` 灌数据（`seed-demo.mjs` 头部注释写明"只给 common 体验账号灌数据，不动 admin"）。
**修复方式：README 明确写出完整演示必须用 `common`，并说明用 admin 会看到什么、如何补救。**
未擅自改动种子脚本的数据策略。

---

## 五、阶段四：代码质量优化

只改已确认存在的问题，不做大规模重构。

| 问题                                                                                          | 位置                                                                           | 修复                                   |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------- |
| 依赖清单漏 `scikit-learn` / `pandas`，聚类脚本直接依赖却装不上                                | `server-ml/requirements.txt`                                                   | 补齐并加 sklearn 版本上界              |
| 4 处完全静默的 `catch`，LLM 降级 / 聚类失败时服务端日志毫无痕迹                               | `health-agent.ts`、`health-plan-agent.ts`、`health-review-agent.ts`、`risk.ts` | 补 `console.warn` + 说明为何必须留痕   |
| `healthSurvey` 的 rank 写死为字面量 `12`，与 `healthAiProfile` 撞号，菜单顺序取决于排序稳定性 | `server/src/data/asyncRoutes.ts`                                               | 改用 `rank.healthSurvey`（新值 16）    |
| 注释断言"rank 与 `src/router/enums.ts` 一致"，实际两套编号完全不同；`enums.ts` 已无任何引用方 | 同上 + `src/router/enums.ts`                                                   | 修正注释，说明 rank 的唯一依据是本文件 |
| 缺 `menus.healthSurvey` 双语键                                                                | `locales/zh-CN.yaml`、`en.yaml`                                                | 补 `健康调研` / `Health Survey`        |

**未改动的（记录原因）：**

- `src/` 下 11 处 `console.*` 中，7 处在 pureadmin 框架内部（`utils/tree.ts`、`useNav.ts`），
  4 处在 `account-settings` 演示页——与比赛链路无关，改动风险大于收益，仅记录。
- `src/router/enums.ts` 作为死代码保留，未删除（避免影响未探明的动态引用）。

---

## 六、遗留问题与建议（不修的理由）

| 问题                                                  | 级别 | 建议                                                                                                                 |
| ----------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------- |
| 种子数据把"未填写"存成 `0`，导致模型输入fois分布外值  | P2   | 已在 ML 侧修好填充口径；若要根治，应改 `seed-demo.mjs` 写 `null`。会改变演示账号的预测数字，**建议在答辩前统一决定** |
| `server-ml/.venv` / `.venv17` / `.venv2` 三个虚拟环境 | P3   | 被 gitignore 覆盖不入库；建议赛前只保留 `.venv`                                                                      |
| `docs/fix-report.md` 未纳入版本管理                   | P3   | 若需提交评审可自行 `git add`                                                                                         |
| AI 画像 / 复评依赖真实 LLM 联网                       | P1   | 断网时会降级为规则文案。链路已如实标 `source: "ai"/"rule"`，但**答辩现场建议提前验证网络**                           |

---

## 七、赛前检查清单（按此顺序走一遍）

**启动**

```bash
pnpm install
pnpm dev            # 前端 8848 + 后端 3000 + ML 8000，三者都要起来
```

**登录**：`common / common123`（**不要**用 admin，原因见 §四问题 3）

**链路顺序**

1. 健康档案 → 2. 每日记录录入 → 3. 风险预测（应出现 3 条 SHAP 归因，且文案与条形图数字一致）
2. AI 画像（约 1~2s，文案每次不同即为真 LLM）→ 5. 风险页「AI Agent 执行链路」应显示 3 个 `AI` 节点
3. 生成计划 → 7. 打卡 → 8. 生成报告 → 9. 复评（约 2s）
4. 管理员看板：确认新增的「聚类质量：轮廓系数 vs 随机标签基线」区块显示 `0.066` / `-0.006`

**现场可主动交代的三件事**（都是加分项，不要等评委问）

1. 行为画像用的是**合成数据**冷启动，`training_mode = synthetic_fallback`；
   问卷页已能导出真实数据集，攒够 100 份会自动切 `real_priority`。
2. 轮廓系数 **0.066 绝对值低**——但随机标签基线是 **−0.006**，说明簇结构真实存在；
   这是合成数据的性质，不是模型缺陷，已如实展示在看板上。
3. `real_priority` 只说明"用了真实数据"，**标签仍来自规则引擎**，不是医学标注。

**不要现场做的事**

- 不要重训模型（换环境 sklearn 版本不同会导致簇命名漂移）
- 不要临时改 `.env` 的 LLM key
- 不要在展示时把 `synthetic_only` 这类不利指标藏起来
