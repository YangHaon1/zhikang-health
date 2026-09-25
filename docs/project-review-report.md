# 智康健康（Zhikang Health）项目审查报告

> 审查方式：基于仓库真实代码的静态审查 + 本地实测验证（含模型加载、预测行为、数据库真实数据量、服务运行状态）。
> 审查范围：`src/`（前端 231 文件）、`server/`（Node 服务 81 个 TS 文件）、`server-ml/`（Python ML 服务）、`server/shared/`（规则引擎共享层）、数据库初始化、API 路由、AI 相关服务。
> 审查日期：2026-09-25　｜　仓库：`https://github.com/YangHaon1/zhikang-health`
> 声明：本报告只做审查，**未修改任何业务代码**。所有结论均附 `文件:行号` 或实测输出作为证据。

---

## 目录

1. [项目概述](#一项目概述)
2. [技术架构](#二技术架构)
3. [功能分析与模块清单](#三功能分析与模块清单)
4. [Bug 清单](#四bug-清单)
5. [AI 能力真实性评估](#五ai-能力真实性评估)
6. [比赛竞争力分析](#六比赛竞争力分析)
7. [风险问题汇总](#七风险问题汇总)
8. [优化路线](#八优化路线)
9. [答辩问题预测与回答方向](#九答辩问题预测与回答方向)

---

## 一、项目概述

### 1.1 项目定位

智康健康是一个面向**大学生群体的 AI 健康管理平台**。核心价值主张是：把分散的健康测值（血压、血糖、BMI、睡眠、运动、情绪）统一记录，通过规则引擎做可解释的分级评分，再叠加机器学习风险预测（LightGBM）、行为聚类画像（KMeans）、知识检索（RAG）与大语言模型（LLM）生成自然语言建议，形成"记录 → 分析 → 预测 → 计划 → 复评"的闭环。

### 1.2 仓库客观状态（实测）

| 项目                 | 实测结果                                                                                                                    | 证据                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Git 提交数           | **2 个**（`bb59db094` 初始导入、`be55b62a6` AI Agent + KMeans）                                                             | `git rev-list --count HEAD`                         |
| 分支                 | 仅 `main`                                                                                                                   | `git branch -a`                                     |
| 前端规模             | 231 文件，约 28,800 行                                                                                                      | `find src -name "*.vue" -o -name "*.ts" \| wc -l`   |
| 后端规模             | 81 个 TS 文件，约 24,000 行（含 3,648 行回归脚本）                                                                          | `find server/src server/shared -type f \| wc -l`    |
| 单元测试             | **376 个用例，13 个文件，全部通过**（2.26s）                                                                                | `npx vitest run`                                    |
| CI                   | GitHub Actions：`ci.yml`（typecheck + build）、`linter.yml`                                                                 | `.github/workflows/`                                |
| **数据库真实数据量** | users=3、records=90、daily_health_records=7、**health_survey=0**、**student_profile=0**、risk_predictions=1、health_plans=1 | `better-sqlite3` 直连 `server/data/zhikang.db` 实测 |
| **ML 服务运行状态**  | 8000 端口**未监听**；3000 端口在跑                                                                                          | `curl 127.0.0.1:8000/health`                        |

> ⚠️ 两个必须正视的事实：
>
> 1. **`health_survey` 表为 0 条**——即"真实大学生问卷数据"一条都没有，模型训练 100% 依赖合成数据。
> 2. **当前系统实际运行在降级模式**——Python ML 服务未启动，`/api/health/risk` 走的是规则引擎分支（`risk.ts:151-177`）。

### 1.3 一句话总体评价

> **工程完整度显著高于 AI 技术含量。** 项目在架构分层、可解释性设计、隐私授权、审计日志、降级容错、测试覆盖这些"工程素养"维度上做得相当扎实（部分设计达到企业级水准）；但作为比赛作品的**核心卖点——AI 能力——目前存在实质性缺陷**：模型标签由规则生成（自证循环）、聚类指标无效、SHAP 方向解释错误、RAG 路径失效、三个 Agent 未形成闭环，且**模型文件因 Git 换行符转换而在 Windows 下无法加载**。这些必须在答辩前解决，否则评委只要现场克隆运行或追问技术细节，就会暴露。

---

## 二、技术架构

### 2.1 完整架构图

```
┌────────────────────────────────────────────────────────────────────────┐
│                        前端  Vue3 + Vite + TypeScript                   │
│   Element Plus / Pinia / Vue Router / ECharts / deep-chat / Tailwind    │
│   src/views/health/*：dashboard | risk | plans | report | trend |       │
│                       analytics | chat | companion | ai-profile |       │
│                       survey | import | showcase | ai-hub | audit       │
└───────────────────────────────┬────────────────────────────────────────┘
                                │ HTTP / JWT Bearer
                                │ vite dev(8848) proxy /api → 3000
┌───────────────────────────────▼────────────────────────────────────────┐
│                    Node 服务  Express 5 + tsx（:3000）                  │
│  ┌──────────────┬──────────────┬──────────────┬────────────────────┐   │
│  │ middleware   │ routes       │ services     │ shared（唯一源码）  │   │
│  │ auth(JWT)    │ /auth        │ ml-client    │ health-engine 885L │   │
│  │ request-log  │ /user        │ health-agent │ health-quality 499L│   │
│  │ error-log    │ /health/*    │ health-plan- │ health-plan   457L │   │
│  │              │   risk       │   agent      │ health-analytics   │   │
│  │              │   agent/p-r  │ health-review│ health-report      │   │
│  │              │   chat       │   -agent     │ health-privacy     │   │
│  │              │   survey     │ coach-context│ health-reminder    │   │
│  │              │   daily ...  │ health-      │ health-chat        │   │
│  │              │ /ai/*        │   knowledge  │ daily-health ...   │   │
│  │              │              │ llm(火山方舟) │ ai-profile         │   │
│  └──────────────┴──────────────┴──────────────┴────────────────────┘   │
│  规则引擎降级：ML 不可用时 analyzeHealth() 接管（risk.ts:151-177）       │
└───────┬──────────────────────────────┬─────────────────────────────────┘
        │ better-sqlite3（同步驱动）     │ HTTP POST（2.5s 超时，失败即降级）
        │ WAL + foreign_keys=ON          │
┌───────▼───────────────────┐  ┌────────▼──────────────────────────────┐
│  SQLite  server/data/     │  │  Python ML 服务  FastAPI（:8000）      │
│    zhikang.db（20 张表）   │  │  server-ml/main.py                     │
│  users / profiles /       │  │  POST /predict  → LightGBM + SHAP      │
│  records / reports /      │  │  POST /cluster  → KMeans               │
│  daily_health_records /   │  │  GET  /health   → 模型版本探针          │
│  student_profile /        │  │                                        │
│  health_survey /          │  │  model/lgbm.txt（360 棵树）             │
│  risk_predictions /       │  │  cluster-model/kmeans.pkl              │
│  health_plans / ...       │  │  ⚠️ lgbm.txt 被 Git CRLF 破坏（见 4.1） │
└───────────────────────────┘  └────────────────────────────────────────┘
                                │
                                │ OpenAI 兼容 /chat/completions
                                │ 30s 超时，失败返回降级文案
                          ┌─────▼──────────────────────┐
                          │  LLM  火山方舟（server/.env）│
                          │  SYSTEM_PROMPT 医疗安全约束  │
                          │  未配 Key → llmAvailable()  │
                          │  = false → 全部走规则模板    │
                          └────────────────────────────┘
```

**RAG 链路**（独立于 LLM，见 5.4）：
`buildKnowledgeContext()` → `retrieveKnowledge()` → 读 `server/src/data/health-knowledge.json`（92 行，本地知识库）→ 关键词子串打分 Top-3 → 拼接进 LLM system prompt。**无向量库、无 embedding。**

### 2.2 数据流向（风险预测主链路）

```
用户填写每日记录（/health/daily）
        ↓
daily_health_records 表
        ↓
GET /api/health/risk → buildFeatures(userId)（risk.ts:17-85）
   近 7 天聚合 → sleep_hours_mean / stress_avg / diet_reg_ratio ...
   student_profile → study_hours / sedentary_hours / bedtime_hour
   profiles + records → BMI
   ⚠️ is_off_campus=0、grade_code=3 为硬编码（risk.ts:81-82）
        ↓
POST http://127.0.0.1:8000/predict  （ml-client.ts:29-57，2.5s 超时）
        ↓
LightGBM 三分类 → riskLevel + riskProbability
SHAP TreeExplainer → Top3 因素（explain.py:29-56）
        ↓
写 risk_predictions 快照（risk.ts:87-103）
        ↓
前端 risk/index.vue 渲染风险卡 + "为什么判断我有这个风险"进度条
```

---

## 三、功能分析与模块清单

### 3.1 后端模块清单

| 模块          | 文件位置                                    | 功能                                   | 完成状态                    |
| ------------- | ------------------------------------------- | -------------------------------------- | --------------------------- |
| 服务入口      | `server/src/index.ts`                       | Express 装配、单端口托管前端、进程守卫 | ✅ 完成                     |
| 数据库初始化  | `server/src/db.ts`（676L）                  | 20 张表 DDL + 幂等迁移 + 演示账号种子  | ✅ 完成，质量高             |
| JWT 鉴权      | `server/src/middleware/auth.ts`             | Bearer 解析 + **停用账号实时拦截**     | ✅ 完成，设计优秀           |
| 请求/错误日志 | `middleware/request-log.ts`、`error-log.ts` | 结构化日志 + 统一 JSON 5xx             | ✅ 完成                     |
| 健康分级引擎  | `server/shared/health-engine.ts`（885L）    | 7 类指标加权评分 + 四级风险 + 急症分流 | ⚠️ 有严重算法缺陷（见 4.2） |
| 数据质量      | `server/shared/health-quality.ts`（499L）   | C2 来源/质量标记、异常值校验           | ✅ 完成                     |
| 计划生成      | `server/shared/health-plan.ts`（457L）      | 计划模板 + 进度计算                    | ⚠️ 有边界 bug               |
| 群体分析      | `server/shared/health-analytics.ts`         | 管理员看板聚合 + k-匿名小样本隐藏      | ✅ 完成，隐私设计好         |
| 报告装配      | `server/shared/health-report.ts`            | 评分/雷达/趋势/建议                    | ⚠️ 重复计算                 |
| 隐私与审计    | `server/shared/health-privacy.ts`           | 动作目录 + 脱敏 + 审计写入             | ✅ 完成                     |
| 提醒调度      | `server/src/reminder-scheduler.ts`          | 分钟级轮询 + 站内信（幂等）            | ✅ 完成                     |
| 规则问答      | `server/shared/health-chat.ts`              | 8 条正则意图 + 兜底                    | ⚠️ 纯关键词，**零测试**     |
| AI 画像       | `server/shared/ai-profile.ts`               | 规则打分生成健康画像                   | ⚠️ 与 health-score 语义冲突 |
| 每日记录      | `routes/health/daily.ts`                    | UPSERT 每日数据 + 今日指数             | ✅ 完成                     |
| 风险预测      | `routes/health/risk.ts`                     | ML 调用 + 降级 + 快照                  | ⚠️ 特征偏差（见 5.1）       |
| ML 客户端     | `services/ml-client.ts`                     | /predict、/cluster 封装                | ✅ 完成                     |
| Analyze Agent | `services/health-agent.ts`                  | 整合 risk+SHAP+RAG → 结构化分析        | ⚠️ 未与 Plan 串联           |
| Plan Agent    | `services/health-plan-agent.ts`             | 生成 7 天计划                          | ❌ **summary 传空串**       |
| Review Agent  | `services/health-review-agent.ts`           | 完成率 + 前后对比复评                  | ⚠️ 窗口重叠 bug             |
| RAG 检索      | `services/health-knowledge.ts`              | JSON 关键词 Top-K                      | ❌ **路径错误，实际失效**   |
| 教练上下文    | `services/coach-context.ts`                 | 人设 + 学生画像 + 风险摘要             | ✅ 完成                     |
| LLM 客户端    | `server/src/llm.ts`                         | 火山方舟调用 + 全异常降级              | ✅ 完成，健壮性好           |
| 问卷打标      | `services/survey-label.ts`                  | 6 项规则 → low/medium/high             | ✅ 完成（但标签仍是规则）   |
| 行为分型      | `services/health-type.ts`                   | 5 类生活方式分型（纯规则）             | ✅ 完成                     |
| 学生画像      | `routes/health/studentProfile.ts`           | 年级/专业/久坐/就寝 CRUD               | ✅ 完成                     |
| 调研问卷      | `routes/health/survey.ts`                   | 提交问卷 + 规则标签入库                | ⚠️ 13 题仅 6 题计分         |
| 一键演示      | `routes/health/seed.ts`                     | 90 天演示数据（admin）                 | ✅ 完成                     |
| 学生演示数据  | `routes/health/seedStudent.ts`              | 7 天固定高风险数据                     | ❌ 无环境限制               |
| 教练方案      | `routes/health/coachPlan.ts`                | SHAP → LLM 方案 + 确认入库             | ✅ 完成                     |
| 设备同步      | `routes/health/device.ts`                   | 设备数据接入                           | ⚠️ **前端零调用（死接口）** |
| 批量导入      | `routes/health/import.ts`（经 records）     | Excel/CSV 导入                         | ✅ 完成                     |
| ML 状态       | `routes/health/mlStatus.ts`                 | 探针                                   | ⚠️ 前端零调用               |
| 训练统计      | `routes/health/mlStats.ts`                  | 读 metadata.json                       | ⚠️ 路径依赖 cwd             |
| 聚类统计      | `routes/health/clusterStats.ts`             | 读 cluster metadata                    | ❌ **无鉴权 + 键名错误**    |
| API 回归脚本  | `server/scripts/regress-api.mjs`（3,648L）  | 接口级端到端回归                       | ✅ 完成，投入大             |

### 3.2 前端模块清单

| 模块           | 文件位置                                     | 功能                                | 完成状态                |
| -------------- | -------------------------------------------- | ----------------------------------- | ----------------------- |
| 健康驾驶舱     | `views/health/dashboard/index.vue`（1,465L） | 综合看板、五维画像、快捷记录        | ⚠️ 五维画像**纯硬编码** |
| 风险评估       | `views/health/risk/index.vue`（542L）        | 风险等级 + SHAP 因素条 + Agent 卡片 | ⚠️ SHAP 方向渲染错误值  |
| 健康计划       | `views/health/plans/index.vue`（1,084L）     | 计划 CRUD + 打卡 + 复评             | ⚠️ 多处无 catch         |
| 健康报告       | `views/health/report/index.vue`（1,025L）    | 报告生成/历史/导出                  | ⚠️ AI 生成进度为伪造    |
| 趋势分析       | `views/health/trend/index.vue`               | 多指标趋势 + ECharts                | ⚠️ 硬编码医学区间       |
| 群体看板       | `views/health/analytics/index.vue`           | 管理员统计                          | ⚠️ 模型名写死模板       |
| AI 对话        | `views/health/chat/*`                        | deep-chat + 规则/LLM 双模式         | ✅ 完成                 |
| AI 陪伴        | `views/health/companion/index.vue`           | 每日总结 + 目标进度                 | ✅ 完成                 |
| AI 画像        | `views/health/ai-profile/index.vue`          | 健康画像展示                        | ⚠️ 进度条恒为 done      |
| AI 能力中心    | `views/health/ai-hub/index.vue`              | 能力导航                            | ✅ 完成                 |
| **产品展示页** | `views/health/showcase/index.vue`（507L）    | **比赛答辩专用营销页**              | ⚠️ 含硬编码数字         |
| 健康问卷       | `views/health/survey/index.vue`              | 13 题调研                           | ⚠️ 未调 latest 接口     |
| 数据导入       | `views/health/import/index.vue`              | Excel 导入预览                      | ✅ 完成                 |
| 隐私授权       | `views/health/authorizations/index.vue`      | 共享授权开关                        | ✅ 完成                 |
| 审计日志       | `views/health/audit/index.vue`               | 操作留痕查询                        | ✅ 完成                 |
| 用户管理       | `views/system/user/index.vue`                | admin 用户 CRUD                     | ✅ 完成                 |

### 3.3 架构问题诊断

#### ✅ 做得好的（应保持并在答辩中重点讲）

1. **规则引擎唯一源码策略执行到位**：`server/shared/health-engine.ts` 是唯一实现，前端直接 `import` 分级函数（`dashboard:151`、`records/index.vue:110-126`），未出现"前端另写一套引擎"。这条契约在 `AGENTS.md` 中被明确约束，实际代码也遵守了。
2. **降级容错体系完整**：ML 超时 2.5s 降级、LLM 全异常降级为可读文案、SHAP 失败回退特征重要性——任何外部依赖抖动都不会让页面 500。
3. **隐私设计有真实考量**：`user_privacy` 独立表（不与档案混写，避免"改档案重置授权"）、k-匿名小样本隐藏（`health-analytics.ts:171-173`）、审计日志脱敏（`health-privacy.ts:146-174`）、`audit_logs` 为可空 user_id 专门做了表重建迁移（`db.ts:377-413`）。**这是本项目最有说服力的技术亮点。**
4. **可解释性设计**：`RuleMeta` 结构（`health-engine.ts:172-233`）让每个分级结论都能回溯到"指标 / 阈值 / 依据 / 限制"，并暴露了 `/health/analyze/explain` 接口。
5. **测试投入真实**：376 个用例，覆盖安全、计划、质量、对比、分析、隐私、提醒、无障碍等维度。

#### ❌ 存在的问题

| 类别           | 具体表现                                                                                                                                                                                                                                                                                                      | 证据                                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **重复模块**   | BMI 公式 **4 份实现**（engine / health-score / ai-profile 内联 / quality 内联）；日期格式化 **3 份**（plan / reminder / seed）+ 前端 **4 份**；日期倒序排序 **3 份**；"有效运动日"口径 **3 套互相矛盾**                                                                                                       | `health-engine.ts:259`、`health-score.ts:13`、`ai-profile.ts:49-51`、`health-quality.ts:261`；`ai-profile.ts:94`(>0) vs `daily-health.ts:228`(>=10) |
| **废弃代码**   | `cluster_predict.py:16-20` 硬编码 `CLUSTER_NAMES`（"规律平衡型/轻度久坐型/久坐高压型"）与 metadata 实际命名冲突，且 `info` 优先命中 → **该常量为死代码**；`health-score.ts:17 bmiLabel`、`health-score.ts:26 calculateRiskLevel` 全仓库零调用                                                                 | Grep 全量核实                                                                                                                                       |
| **无调用代码** | 前端 3 个 API 零引用（`syncDeviceMeasurements`、`getHealthPlanProgress`、`getLatestSurvey`）；后端 4 个接口前端零调用（`/health/cluster-stats`、`/health/ml-status`、`/health/ml-train-stats`、`/health/analyze/explain`）；`/health/device/sync` 前后端均无人调用                                            | `src/api/health.ts:144-181, 288-293, 573-577`                                                                                                       |
| **架构不合理** | ① 路径解析依赖 `process.cwd()` 且三处假设不一致（`health-knowledge.ts:31` 假设 cwd=server；`mlStats.ts:15-20` 用 `cwd/../server-ml`；`clusterStats.ts:16-21` 同）→ 按根 `package.json` 的 `dev:server` 启动（cwd=根）时**三者全部失效**；② 模型 artifact 以文本 `.txt` 入库且未标记 binary → 被 Git CRLF 破坏 | 实测：`ls -d src/data` → No such file；`git config --global core.autocrlf` → true                                                                   |
| **维护风险**   | ① `git` 仅 **2 个提交**，全部功能一次性导入，无演进过程可追溯；② `README.md` 架构图**完全未提及** Python ML 服务、LightGBM、SHAP、KMeans、RAG、Agent（V2.x 全部能力缺失），文档严重落后于实现；③ `README.md:103` 的快速开始**未要求启动 ML 服务**，照做必然跑在降级模式                                       | `README.md:48-68`、`README.md:91-107`                                                                                                               |
| **语义冲突**   | `health-score.ts:26-30 calculateRiskLevel(25)` → "高风险"（分高=健康）与 `health-engine.ts:483-488 riskLevelOf(25)` → "低"（分高=危险）**结论完全相反**，同一分数两个答案                                                                                                                                     | 实测验证                                                                                                                                            |

---

## 四、Bug 清单

> 严重程度定义：**致命** = 答辩现场必然暴露/功能完全不可用；**高** = 影响核心功能或数据安全；**中** = 影响体验或可维护性；**低** = 优化项。

### 4.1 Python ML 层

| 编号      | 问题                                                                                                                                                                                                                                                                                                                         | 位置                                                                                  | 严重程度         | 修复建议                                                                                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ML-01** | **模型文件被 Git CRLF 转换破坏，Windows 下无法加载**。`lgbm.txt` 6995 行全为 `\r\n`，LightGBM 报 `Model format error, expect a tree here`；实测替换为 LF 后加载成功（360 棵树）。根因：全局 `core.autocrlf=true` 且 `.gitattributes` 未标记模型文件。`kmeans.pkl` 因被判定为二进制未受影响                                   | `server-ml/model/lgbm.txt`、`.gitattributes`                                          | **致命**         | ① `.gitattributes` 增 `server-ml/model/*.txt -text`；② `git add --renormalize .` 重新提交 LF 版；③ 或改用 `.pkl`/`.bin` 二进制格式保存模型                      |
| **ML-02** | **标签由规则生成 → 模型是"规则蒸馏"，指标无泛化意义**。`make_synth()` 用高斯噪声造 4000 条，`rule_label()` 用同一套确定性规则打标，标签可由特征 100% 推出、零噪声 → Accuracy 0.981 / AUC 0.999 是"模型成功背下了规则"的自证指标，不是预测能力                                                                                | `train.py:29-95, 131-141`；`model/metadata.json`                                      | **致命**（答辩） | 必须取得真实量表标签（PSSQ/GHQ-12/PSQI 等）或至少做人工标注；答辩时**主动承认**当前为工程闭环验证                                                               |
| **ML-03** | **真实训练样本为 0**。`health_survey` 表实测 0 条，`training_mode=synthetic_only`, `real_samples=0`                                                                                                                                                                                                                          | `server/data/zhikang.db`；`model/metadata.json`                                       | **致命**（答辩） | 赛前组织真实问卷采集（目标 ≥100 条以触发 `real_priority`）；或明确改为"合成数据可行性验证"叙事                                                                  |
| **ML-04** | **全零特征被判"高风险 90.4%"**。新用户未填任何数据 → `build_features` 全部补 0 → 预测 `high, proba=0.904`。原因是合成数据中 `bedtime_hour` 均值 23，全零为分布外极端值，成为最大 SHAP 因素                                                                                                                                   | `model.py:29-31`；实测输出                                                            | **致命**         | ① 缺失时填充训练集中位数而非 0（参考 `dataset.py:16-34` 的 `_default_row`）；② 增加"数据不足不预测"守卫，`dataQuality.level==='low'` 时返回 `insufficient_data` |
| **ML-05** | **SHAP 方向解释错误**。`explain.py:36` 对三分类 SHAP 用 `sv.mean(axis=1)` 取**所有类的平均**，未取被预测类 → 正负贡献相互抵消。实测：健康人（睡 8h / 压力 1 / 运动 300min）输出"睡眠时长 +0.76 **升高风险**"、"平均压力 +0.47 **升高风险**"；高风险用户输出"平均压力 -0.45 **降低风险**"——**完全反直觉，且已直接渲染到前端** | `explain.py:36`；`risk/index.vue:208-215`                                             | **致命**（答辩） | 改为取预测类的 shap 值：`sv[:, pred_class]`；三分类应分别给出"升向 medium/high"的贡献                                                                           |
| **ML-06** | **聚类无效：silhouette = 0.066**。k=3/4/5/6 得分 0.066/0.063/0.056/0.050，全部 <0.1 → 数据无簇结构（合成数据本身是单峰高斯分布）。三个簇心差异极小（睡眠 7.31/7.07/7.29，压力 2.00/1.88/1.83），"健康平衡型/作息失衡型/轻度调整型"的命名缺乏数据支撑                                                                         | `cluster-model/metadata.json:8-9, 27-73`                                              | **高**（答辩）   | ① 报告中如实说明"当前聚类结构不显著"；② 改用真实数据重训并报告 silhouette；③ 或改用规则分型（现有 `health-type.ts` 已能做同样的事）                             |
| **ML-07** | **聚类 metadata 键名不匹配**：文件写 `"version"`，`cluster_predict.py:56` 与 `clusterStats.ts:31` 读 `"model_version"` → **永远回退默认值** `kmeans-v0.2`；`analytics.ts:110` 同样读 `m.model_version` → 前端渲染 "（undefined）"                                                                                            | `cluster-model/metadata.json:2`；`cluster_predict.py:56`；`analytics/index.vue:77-79` | **高**           | 统一键名为 `model_version`                                                                                                                                      |
| **ML-08** | **聚类 confidence 是伪指标**：`1 - d[c]/sum(d)`，k=3 时恒定在 0.667 附近（实测 0.672/0.675/0.696），与聚类的真实确定性无关                                                                                                                                                                                                   | `cluster_predict.py:46`                                                               | **高**（答辩）   | 改为 `1 - d[c]/max(d)` 或 `silhouette` 样本值；或移除该字段                                                                                                     |
| **ML-09** | **问卷字段语义错配**：`sleep_below7_days ← stay_up_freq`（"熬夜频率"≠"睡眠<7h天数"）、`stress_high_days ← exam_pressure`（"考试压力等级"≠"高压天数"）、`exercise_min_sum = exercise_min × exercise_times`（把单次时长×次数当周总量）                                                                                         | `dataset.py:42-61`、`cluster_dataset.py:24-35`                                        | **高**           | 重新设计问卷字段与特征的映射关系，或调整训练特征定义                                                                                                            |
| **ML-10** | **模型版本三处不一致**：`train.py:23` 写 `lgbm-v0.3`、`model/metadata.json` 是 `lgbm-v0.3`，但 `model.py:8`（在线服务实际返回值）写 `lgbm-v0.2`。实测库内 `risk_predictions.model_version = "lgbm-v0.2"`，与实际模型版本不符                                                                                                 | `model.py:8` vs `train.py:23`                                                         | **中**           | 统一常量；版本应从 `metadata.json` 读取而非硬编码                                                                                                               |
| **ML-11** | **`main.py` 未做异常处理**：`predict()` / `explain()` 抛错时 FastAPI 返回 500 + HTML 堆栈，而非结构化 JSON                                                                                                                                                                                                                   | `main.py:27-43`                                                                       | **中**           | 加 try/except 返回统一错误结构（当前靠 ml-client 的 `resp.ok` 兜住降级）                                                                                        |

### 4.2 后端 Node 层

| 编号      | 问题                                                                                                                                                                                                                                                                                                                                    | 位置                                                  | 严重程度         | 修复建议                                                                                          |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------- |
| **BE-01** | **RAG 知识库路径错误，生产路径下永久失效**。`path.resolve(process.cwd(), "src", "data", "health-knowledge.json")`，但文件实际位于 `server/src/data/`；实测项目根下 `src/data` **不存在**。按 `README.md:103` 的 `cd server && pnpm dev`（cwd=server）可读到，但按根 `package.json` 的 `dev:server`（cwd=根）**读不到 → RAG 静默返回空** | `services/health-knowledge.ts:31`                     | **高**           | 改用 `import.meta.dirname` 相对定位，或用已有的 `server/src/paths.ts`                             |
| **BE-02** | **评分不做归一化 → 三级高血压被判"低风险"**。加权分 `Σ(权重×档位)` 不除以"已测项权重之和"，未测指标贡献 0 分而非排除出分母。实测：仅记录血压 200/120 → score=25 → "低风险"且 `medicalAdvice` 为空；仅记录空腹血糖 20 mmol/L → 25 分 "低风险"                                                                                            | `health-engine.ts:236-246, 596-601, 483-488`          | **致命**（安全） | 改为 `Σ(w×lvl)/Σ(w_已测)×100`；并对任何 level=2 的单项设置风险等级下限保底                        |
| **BE-03** | **急症分流无否定词处理 → 假阳性**。实测 `"我没有胸痛，就是有点累"` → 返回"疑似急性心肌梗死，立即拨打 120"；`"家人有抽搐史"` 同样触发                                                                                                                                                                                                    | `health-engine.ts:761-770`                            | **高**（安全）   | 加否定/时态窗口（`没有/不是/以前/已经好了/家人/朋友` ±5 字）                                      |
| **BE-04** | **急症指标只有上界无下界**：收缩压 80/50（休克血压）完全不触发；心率、随机血糖 ≥33.3 无阈值；无心理危机关键词                                                                                                                                                                                                                           | `health-engine.ts:687-723`                            | **高**（安全）   | 补 `systolic<=90 \|\| diastolic<=60`、心率区间、心理危机兜底                                      |
| **BE-05** | **风险等级语义自相矛盾**：`riskLevelOf(25)`="低"（分高=危险）vs `calculateRiskLevel(25)`="高风险"（分高=健康），同一分数两个相反答案                                                                                                                                                                                                    | `health-engine.ts:483-488` vs `health-score.ts:26-30` | **高**           | 删除 `health-score.ts` 的 `calculateRiskLevel`（零调用），或改名为 `healthLevelOf` 并注明输入语义 |
| **BE-06** | **Plan Agent 未接收 Analyze 输出**：`generatePlan({ summary: "", healthType })` 的 `summary` 是**硬编码空串**，Plan 拿不到 Analyze 的任何结论                                                                                                                                                                                           | `routes/health/planAgent.ts:12`                       | **高**（答辩）   | 前端串行调用后把 analyze 结果传入，或后端内部串联                                                 |
| **BE-07** | **Agent 路由 catch 分支重复调用**：`catch` 里又执行了一遍 `analyzeHealth(userId, ht?.name)`，若第一次抛错第二次大概率同样抛错，且无日志                                                                                                                                                                                                 | `routes/health/agent.ts:15-21`                        | **中**           | catch 内直接走 `ruleAnalysis` 降级并记日志                                                        |
| **BE-08** | **Review Agent 前后对比窗口重叠**：`now=avgMetric(7天)`、`before=avgMetric(14天)`，**14 天窗口包含 7 天窗口**，不是"前后对比"，趋势被稀释甚至反向                                                                                                                                                                                       | `services/health-review-agent.ts:92-93`               | **高**           | 改为 `date BETWEEN -14 AND -7` 作为 before 窗口                                                   |
| **BE-09** | **Review Agent 越权计算他人计划完成率**：`calcCompletion(planId)` 的 SQL 不带 `user_id`；`health_plans` 查询带 `user_id` 返回 undefined 后**仍继续计算并返回**                                                                                                                                                                          | `health-review-agent.ts:30-41, 62-67`                 | **高**（安全）   | `plan_tasks`/`task_checkins` 查询 join 到 `health_plans.user_id`；plan 不存在时直接返回 403       |
| **BE-10** | **`/health/cluster-stats` 无鉴权**：全项目唯一无 `authMiddleware` 的业务接口（其余均通过 `router.use(authMiddleware)` 或行内挂载）                                                                                                                                                                                                      | `routes/health/clusterStats.ts:15`                    | **中**           | 补 `authMiddleware`                                                                               |
| **BE-11** | **`/health/seed-student` 无环境限制**：生产环境任意登录用户可调用，**覆盖自己近 7 天真实数据**为固定高风险值（睡眠 5.8h/压力 3/运动 15min/饮食 poor）                                                                                                                                                                                   | `routes/health/seedStudent.ts:12-43`                  | **高**           | 与 `seed.ts` 一致加 `adminOnly`，且 `NODE_ENV=production` 时拒绝                                  |
| **BE-12** | **硬编码特征**：`is_off_campus=0`、`grade_code=3` 对所有用户写死，与训练数据分布（`is_off_campus` 30% 为 1、`grade_code` 1-6 均匀）不符                                                                                                                                                                                                 | `routes/health/risk.ts:81-82`                         | **高**           | 从 `student_profile` 读取（表已含 `is_off_campus`、`grade` 字段但未使用）                         |
| **BE-13** | **线上线下特征偏差**：实测 `student_profile` 表 **0 条** → `study_hours=0`、`sedentary_hours=0`、`bedtime_hour=0` 传入模型，而训练分布为 7 / 8 / 23 → 特征分布外                                                                                                                                                                        | `risk.ts:78-80` + 数据库实测                          | **高**           | 缺失时用训练集中位数填充（对齐 `dataset.py:_default_row`）                                        |
| **BE-14** | **`addDays` 遇非法日期抛 `RangeError`**：实测 `addDays("",1)` 抛异常，且调用点无 try/catch，一条脏 `checked_date` 即可让计划/报告接口 500                                                                                                                                                                                               | `shared/health-plan.ts:112-117`（调用点 433-437）     | **高**           | 加 `Number.isFinite` 守卫                                                                         |
| **BE-15** | **API 返回码不一致**：`reviewAgent` 失败返回 `code:1`，全项目其余接口成功/失败均用 `code:0` + `message` 区分                                                                                                                                                                                                                            | `routes/health/reviewAgent.ts:11,15`                  | **中**           | 统一信封约定                                                                                      |
| **BE-16** | **多项异常只生成第一个计划**：血压+血糖+血脂全异常时只产出"血压改善计划"，其余被静默丢弃                                                                                                                                                                                                                                                | `shared/health-plan.ts:307-324`                       | **中**           | 返回计划数组或合并多模板任务                                                                      |
| **BE-17** | **`ai/profile` LLM prompt 文案错误**：`"近7天平均睡眠${...filter(d=>d.sleepHours).length}天有记录"` —— 标签是"平均睡眠"，值却是"有记录的天数"                                                                                                                                                                                           | `routes/ai/profile.ts:101`                            | **低**           | 修正文案与计算口径                                                                                |
| **BE-18** | **无全局限流**：登录、LLM 调用、Agent 接口均无频率限制，可被刷 token / 爆破密码                                                                                                                                                                                                                                                         | 全局                                                  | **中**           | 登录加失败次数锁定；LLM 类接口加用户级限流                                                        |
| **BE-19** | **JWT 无失效机制**：`auth.ts` 已做停用拦截（很好），但 refresh token 无轮换、无吊销列表                                                                                                                                                                                                                                                 | `routes/auth.ts:123`                                  | **低**           | 加 refresh token 版本号或吊销表                                                                   |

### 4.3 前端 Vue 层

| 编号      | 问题                                                                                                                                                               | 位置                                                                                                                | 严重程度       | 修复建议                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------- |
| **FE-01** | **ECharts 条件 return 前未 dispose**：`!hasPoints` / `data.length<2` / `degraded` 分支直接 return，实例悬挂 → 内存泄漏（4 处）                                     | `trend/index.vue:187-192`、`report/index.vue:226-243`、`dashboard/index.vue:405-411`、`analytics/index.vue:403-423` | **高**         | 提前 return 前统一 `chart?.dispose()`                            |
| **FE-02** | **`try/finally` 无 `catch`** → Promise 未捕获拒绝，页面静默空白                                                                                                    | `risk/index.vue:31-44`、`showcase/index.vue:15-27`                                                                  | **高**         | 补 catch + 错误提示                                              |
| **FE-03** | **token 刷新失败时丢弃排队回调** → 这些 Promise **永不 settle**，请求永久挂起                                                                                      | `utils/http/index.ts:95-101`                                                                                        | **高**         | 失败时遍历 reject                                                |
| **FE-04** | **`ElMessageBox.confirm` 未捕获取消** → 用户点"取消"产生未处理拒绝（3 处）                                                                                         | `plans/index.vue:668-675`、`records/history.vue:175-186, 196-212`                                                   | **中**         | 包 `try/catch`                                                   |
| **FE-05** | **绕过 api 层裸调且 `res: any` 未判 `code`**：`res.data` 直接喂给 `buildPlanFromAnalysis`，code≠0 时弹出误导性提示"当前无明显风险点"                               | `plans/index.vue:537-546`                                                                                           | **高**         | 封装类型化 API 并先判 `code===0`                                 |
| **FE-06** | **`pageSize: 100000` 全量拉取**，后端无上限 → 10 万条时 O(n×m) 卡顿（3 处）                                                                                        | `dashboard:463`、`trend:203`、`report:319`                                                                          | **高**         | 后端 `Math.min(pageSize, 200)`；前端按窗口取数                   |
| **FE-07** | **报告切换竞态**：快速点击多份历史，旧响应覆盖新响应，无请求序号/AbortController                                                                                   | `report/index.vue:289-298`                                                                                          | **高**         | 加 `reqSeq` 比对或 AbortController                               |
| **FE-08** | **`detail.value!` 非空断言**：detail 为 null 时崩溃；`detail.value.tasks` 未判空                                                                                   | `plans/index.vue:635, 661`                                                                                          | **高**         | 显式判空                                                         |
| **FE-09** | **`async-routes` 缓存未在登出时清理** → 上一账号的路由可能泄漏给下一账号（当前 `CachingAsyncRoutes:false` 使分支未生效，属潜伏风险）                               | `router/utils.ts:204-217` vs `:105-115`                                                                             | **中**         | `logOut()` 中移除该键                                            |
| **FE-10** | **五维画像完全硬编码**：睡眠 `score(h,8,4)`、运动 `(60,0)`、压力 `85/60/35`、饮食 `88/62/35`、作息固定 `75`，与规则引擎健康分**无任何关联**                        | `dashboard/index.vue:224-262`                                                                                       | **高**（答辩） | 下沉到 `@shared` 或与引擎打通，否则答辩时不要称其为"AI 分析结果" |
| **FE-11** | **AI 生成进度为伪造**：报告页三段进度由 `trend.length>0`、`radar.length>=3`、`suggestions.length>0` 驱动（后端实为一次同步计算）；AI 画像页三个 `step done` 硬编码 | `report/index.vue:450-479`、`ai-profile/index.vue:55-63`                                                            | **中**（答辩） | 删除或改为真实阶段回调                                           |
| **FE-12** | **硬编码医学区间与共享层冲突**：前端 `[3.9, 6.1]` vs `health-engine.ts:202` 的 "3.9~6.0"                                                                           | `trend/index.vue:76`                                                                                                | **中**         | 共享层建 `NORMAL_RANGES` 常量                                    |
| **FE-13** | **`HealthFactorChart` 用正则数关键词当"影响因素强度"**，柱宽 `count*50%` → 前端另造分析口径                                                                        | `components/health/ai/HealthFactorChart.vue:8-21, 33`                                                               | **高**（答辩） | 改用后端真实贡献度，无数据时显式说明                             |
| **FE-14** | **deep-chat 的 token 在 setup 时取一次**，刷新后失效 → 到期后 401 且不走 axios 拦截器                                                                              | `chat/components/ChatGPT.vue:19-27`                                                                                 | **高**         | 改为 getter 每次读取                                             |
| **FE-15** | **问卷页从不调用 `getLatestSurvey`** → 无法判断"已完成"，同一用户可无限重复提交                                                                                    | `survey/index.vue`、`api/health.ts:573-577`                                                                         | **中**         | 进入页先查 latest                                                |
| **FE-16** | **`clusterInfo` 未判空**：无 metadata 时后端返回 `{}`，`v-if` 判定为真 → 渲染 "AI 模型：LightGBM + KMeans（**undefined**）"                                        | `analytics/index.vue:74-80`                                                                                         | **中**         | 判 `clusterInfo?.version`                                        |
| **FE-17** | **`LEVEL_META[riskLevel]` 无兜底**：未知 level 时 `level.color` 抛错                                                                                               | `risk/index.vue:46-52`                                                                                              | **低**         | 加 `?? LEVEL_META.low`                                           |
| **FE-18** | **showcase 页硬编码"AI 能力模块 5"**，其下实际只有 4 项卡片                                                                                                        | `showcase/index.vue:138` vs `:30-59`                                                                                | **中**（答辩） | 改为 `caps.length`                                               |
| **FE-19** | **重复代码**：`fmtDate` 4 份、`lastNDays` 2 份、16 列 Excel 导出完整重复 2 份、`LEVEL_COLOR` 3 份、AI 能力矩阵 2 份                                                | 多处                                                                                                                | **中**         | 抽取共享工具                                                     |

---

## 五、AI 能力真实性评估

> 本节是评委最可能追问的部分。**结论先行：项目具备真实的 AI 工程链路，但"模型智能"部分目前主要是"规则蒸馏 + 模板生成"，尚不构成可信的预测能力。**

### 5.1 LightGBM 风险预测

| 审查项                     | 结论                                                                                                                                                                                                  | 证据                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **输入特征是否合理**       | 基本合理，15 维覆盖睡眠/运动/压力/饮食/情绪/学习/久坐/作息/BMI/年级，符合大学生生活方式场景。但**字段语义存在错配**                                                                                   | `feature.py:12-28`；`dataset.py:42-61`                         |
| **标签来源是否可信**       | ❌ **不可信**。冷启动标签由 `rule_label()` 用确定性规则生成；`health_survey` 真实样本为 0；即便有真实问卷，标签仍来自 `survey-label.ts` 的 6 项规则打分——**标签从头到尾没有脱离规则**                 | `train.py:29-67, 94`；`survey-label.ts:22-56`；数据库实测 0 条 |
| **是否存在过拟合风险**     | ⚠️ 不是典型过拟合，而是更严重的**目标泄漏式自证**：标签 = f(特征) 的确定性函数，模型只需学会这个函数。Accuracy 0.981 / AUC 0.999 说明的是"LightGBM 能拟合一个 if-else 规则集"，**不代表任何预测能力** | `train.py:70-95`；`model/metadata.json:11-15`                  |
| **是否符合大学生健康场景** | ✅ 场景选择合理（睡眠不足、久坐、考试压力、饮食不规律确实是大学生亚健康主因）；特征设计有场景针对性                                                                                                   | `feature.py`                                                   |
| **线上线下一致性**         | ❌ **存在偏差**：`is_off_campus`/`grade_code` 硬编码；`student_profile` 实测为空 → 三个特征传 0，与训练分布（7/8/23）严重偏离                                                                         | `risk.ts:81-82`；数据库实测                                    |
| **边界行为**               | ❌ **全零输入判高风险 90.4%**；模型无任何"数据不足则拒答"机制                                                                                                                                         | 实测                                                           |

**综合评价**：工程链路（特征工程 → 训练 → 版本化 → 服务化 → 解释 → 降级）**完整且规范**；模型本身**尚不具备可宣称的预测价值**。

> 📌 答辩建议：把叙事从"我们训练了一个准确率 98% 的亚健康预测模型"改为"**我们搭建了一套可持续迭代的 ML 工程闭环，并用规则标签完成了冷启动验证；真实量表数据接入后可直接重训**"。前者一问就倒，后者是真实的工程贡献。

### 5.2 SHAP 解释

| 审查项               | 结论                                                                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **是否真实来自模型** | ✅ **是真实的**。确实用 `shap.TreeExplainer(booster)` 对真实 booster 计算（`explain.py:12-18`），不是模拟数值                                                                     |
| **是否正确**         | ❌ **不正确**。`explain.py:36` 用 `sv.mean(axis=1)` 对三分类取所有类平均，未取被预测类 → 正负贡献抵消，方向失真。实测出现"睡 8 小时 = 升高风险""压力 1 = 升高风险"等反直觉结论    |
| **降级路径**         | ✅ 有 fallback 到 gain 特征重要性，但降级后 `direction` 被硬编码为 `raise_risk`（`explain.py:54`）——**降级时方向全是假的**                                                        |
| **前端呈现**         | ⚠️ 原始 SHAP 值、特征名、特征向量**全部未渲染**，用户只看到归一后的相对条长；`toImportance` 把 `feature` 也填成中文 label（`risk.ts:111-113`），导致 `:key="f.feature"` 非稳定 id |

**综合评价**：**真实调用但结果错误**。这是最危险的一类问题——不是造假，而是算错了还展示了。必须修复后才能演示。

### 5.3 KMeans 行为画像

| 审查项               | 结论                                                                                                                                                                                                                                                               | 证据                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| **聚类是否有效**     | ❌ **无效**。silhouette = 0.066（k=3/4/5/6 → 0.066/0.063/0.056/0.050），全部远低于 0.25 的"弱结构"门槛。合成数据是单峰高斯分布，本就没有簇结构                                                                                                                     | `cluster-model/metadata.json:8-9`               |
| **类型命名是否合理** | ❌ **缺乏数据支撑**。三个簇心：睡眠 7.31/7.07/7.29、压力 2.00/1.88/1.83、运动 2.48/2.53/2.44 —— 差异微乎其微，却分别命名为"健康平衡型""作息失衡型""轻度调整型"。命名逻辑是 `name_cluster()` 对簇心套阈值规则，**本质是"先聚类再按规则贴标签"，聚类本身没提供信息** | `clustering.py:61-91`；metadata 簇心对比        |
| **版本读取**         | ❌ 键名不匹配，永远回退 `kmeans-v0.2`（见 ML-07）                                                                                                                                                                                                                  | 实测 cluster 返回 `modelVersion: 'kmeans-v0.2'` |
| **置信度**           | ❌ 伪指标，k=3 时恒定 ≈0.667（见 ML-08）                                                                                                                                                                                                                           | 实测 0.672/0.675/0.696                          |

**综合评价**：**当前 KMeans 不产生任何规则分型之外的增量信息**（`health-type.ts` 的纯规则分型效果等价且更可控）。建议答辩时要么用真实数据重训并报告显著指标，要么**主动说明这是"无监督管线的工程验证"**，不要声称"AI 发现了 3 类行为画像"。

### 5.4 RAG

| 审查项                   | 结论                                                                                                                                                                                                                        | 证据                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **是否真正参与生成**     | ⚠️ **设计上参与，实际大概率没参与**。`buildKnowledgeContext()` 的返回值确实拼进了 LLM prompt（`chat.ts:189-195`、`health-agent.ts:94-96`），链路是真实的；但 `retrieveKnowledge()` 读不到文件 → 返回空串 → **RAG 形同虚设** | `health-knowledge.ts:31`（路径错误，实测 `src/data` 不存在） |
| **是否只是 prompt 拼接** | ⚠️ **是拼接，且检索方式很原始**。无向量库、无 embedding，用关键词子串包含打分（`score()`：命中 keywords +3、标题 +2、正文 +1），中文按子串匹配                                                                              | `health-knowledge.ts:41-50`                                  |
| **知识库规模**           | 极小：`server/src/data/health-knowledge.json` 仅 92 行                                                                                                                                                                      | `ls -la server/src/data/`                                    |

**综合评价**：属于 **"关键词检索增强"（Keyword-Augmented Generation）**，称 RAG 勉强成立，但不宜渲染为"知识库/向量检索"。**当前实际未生效**，修复后效果也有限（92 行知识库）。

### 5.5 Agent（Analyze / Plan / Review）

| 审查项                    | 结论                                                                                                                                                                   | 证据                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **是否形成真实工作流**    | ❌ **没有**。三个 Agent 是三个**彼此独立**的 LLM 调用，无状态传递、无共享上下文、无结果依赖                                                                            | `agent.ts:9-22`、`planAgent.ts:9-16`、`reviewAgent.ts:8-17`                             |
| **Analyze → Plan**        | ❌ **断开**。`planAgent.ts:12` 传 `summary: ""`（硬编码空串），Plan 只拿到一个 `healthType` 字符串                                                                     | `planAgent.ts:12`                                                                       |
| **Plan → Review**         | ❌ **断开**。Review 只按 `planId` 查库算完成率；而前端复评下拉框的数据源是真实计划表 `getHealthPlans()`，**永远选不到 Agent 生成的方案**（Agent 方案无入库入口）       | `reviewAgent.ts:10-12`；`plans/index.vue:459-471`                                       |
| **Agent 结果能否落地**    | ❌ **不能**。风险页展示 `agentPlan` 但无"采纳为计划"按钮；能落库的是另一条旧路径 `POST /health/coach-plan/confirm`                                                     | `risk/index.vue:145-168` vs `:225-257`                                                  |
| **是否存在伪 Agent 问题** | ⚠️ **存在典型伪 Agent 特征**：无规划（Planning）、无工具调用（Tool Use）、无记忆（Memory）、无多轮反思（Reflection），本质是"三个独立的 prompt → JSON 解析 → 模板降级" | 三个 service 文件全文                                                                   |
| **降级设计**              | ✅ 这点做得好：每个 Agent 都有规则模板兜底，LLM 不可用时功能不中断                                                                                                     | `health-agent.ts:52-78`、`health-plan-agent.ts:27-96`、`health-review-agent.ts:115-125` |

**综合评价**：**当前是"三个 AI 功能"，不是"一个 Agent 工作流"。**

> 📌 若要在答辩中称"多智能体协同"，必须补齐：① Analyze 输出 → Plan 输入；② Plan 结果可入库成为真实计划；③ Review 能读到该计划。否则建议改称"**三段式 AI 辅助流程**"，避免被追问。

### 5.6 AI 能力真实性总表

| 能力              | 是否真实              | 是否正确                   | 是否可用（当前状态）                | 答辩可宣称程度                         |
| ----------------- | --------------------- | -------------------------- | ----------------------------------- | -------------------------------------- |
| LightGBM 风险预测 | ✅ 真实训练与推理     | ⚠️ 标签为规则蒸馏          | ❌ 模型文件损坏 + 服务未启动 → 降级 | 可讲"工程闭环"，不可讲"准确率 98%"     |
| SHAP 解释         | ✅ 真实 TreeExplainer | ❌ 方向计算错误            | ❌ 随模型一起失效                   | 修复后可讲，未修复前不要演示           |
| KMeans 画像       | ✅ 真实 KMeans        | ⚠️ silhouette 0.066 无结构 | ⚠️ pkl 正常但服务未启动             | 可讲"管线验证"，不可讲"发现 3 类人群"  |
| RAG               | ⚠️ 是关键词检索       | ⚠️ 路径错误永久失效        | ❌ 当前未生效                       | 可讲"轻量知识增强"，不可讲"向量知识库" |
| 三个 Agent        | ⚠️ 真实调用 LLM       | ❌ 无闭环、无落地          | ✅ 有 Key 时可用                    | 讲"三段式 AI 辅助"，暂不讲"多智能体"   |
| 规则引擎分级      | ✅ 真实               | ⚠️ 归一化缺陷              | ✅ 可用                             | **最可信的部分，应作为技术主线**       |
| LLM 健康问答      | ✅ 真实调用           | ✅ 有安全约束与降级        | ✅ 配 Key 后可用                    | 可正常宣称                             |
| 急症分流          | ✅ 真实规则           | ⚠️ 假阳性                  | ✅ 可用                             | 可讲，但需先修否定词                   |

---

## 六、比赛竞争力分析

> 按大学生创新创业训练计划 / AI 挑战赛的常见评审维度评分（满分 10 分）。

### 6.1 五维评分

| 评分维度       | 当前表现                                                                                                                                              | 核心问题                                                                                                                                  | 提升方向                                                                                                                                       | 得分    |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| **创新性**     | 场景（大学生亚健康）选择有针对性，"可解释 + 降级 + 隐私授权 + 审计"组合在同类中不多见；但 AI 部分无原创算法，模型是规则蒸馏，Agent 无闭环             | 创新点集中在**工程治理**而非**AI 技术**；缺少一个真正的差异化技术卖点                                                                     | ① 把"可解释安全底座（急症分流 + 阈值可溯源 + 全链路降级）"包装成核心创新；② 补一个真实创新点，如"基于真实问卷的持续学习闭环"或"特征一致性监控" | **5.5** |
| **技术先进性** | 技术栈完整（Vue3 + Express + SQLite + FastAPI + LightGBM + SHAP + KMeans + LLM），分层清晰，376 个测试，CI 齐备，代码注释质量高                       | 模型真实性不足；模型文件损坏；SHAP 算错；聚类无效；RAG 失效；Agent 断链                                                                   | 先修 P0，再把"从 0 到 1 的 ML 工程闭环"讲透（特征版本化、训练模式三档自动切换、模型元数据、线上线下一致性）                                    | **6.0** |
| **实用价值**   | 用户需求真实（大学生睡眠/久坐/压力问题是普遍痛点），功能覆盖记录→分析→计划→打卡→复评，落地形态明确                                                    | 数据依赖手工填报；无真实用户验证（`health_survey`=0、`student_profile`=0）；无设备/平台对接（`/health/device/sync` 是死接口）；留存机制弱 | ① 补真实问卷数据（哪怕 100 份）；② 做小规模用户试用并给出前后对比数据；③ 打通一个真实数据源（如校园一卡通/体育课数据）                         | **6.0** |
| **完整性**     | ✅ **最强项**。前后端 + 数据库 + 模型 + RAG + Agent + 报告 + 权限 + 审计 + 隐私 + 提醒 + 导入导出 + Docker + CI + 回归脚本 + 答辩展示页，产品闭环完整 | 演示数据硬编码（seed-student 固定造高风险）；showcase 页有硬编码数字                                                                      | 保持；补齐 README（当前完全未提 ML/Agent/RAG）                                                                                                 | **8.0** |
| **演示与表达** | 有一键演示数据、产品展示页、降级机制保证现场不翻车；文档（`README.md`、`API.md` 17KB、`docs/model-report.md`）齐备                                    | `README.md` 落后于实现；`docs/model-report.md` 已诚实说明限制（这点很好）；仓库只有 2 个提交                                              | 更新 README 架构图；补架构决策记录；把"诚实说明模型限制"的态度保持到答辩现场                                                                   | **7.0** |

**综合：6.5 / 10** —— 属于"完成度高、工程扎实，但核心技术卖点经不起深挖"的档次。当前状态**有进入省赛的潜力，但冲击高奖项存在明显短板**。

### 6.2 相对同类作品的优劣势

**优势（应在答辩中放大）**

1. **可解释性做得实**：每个分级结论都能回溯到指标、阈值、规则版本、数据来源与限制（`buildEvidence`），并单独开放 `/health/analyze/explain` 接口。多数同类作品只给一个分数。
2. **安全与合规意识强**：急症分流优先于 LLM、健康数据免责声明贯穿全链路、隐私授权独立建模、审计日志脱敏、k-匿名小样本隐藏。这在健康类作品中是稀缺的。
3. **降级容错体系完整**：ML / LLM / SHAP 三层降级，任何外部依赖故障都不中断主流程——现场演示稳定性高。
4. **工程资产完整**：376 个测试、3,648 行 API 回归脚本、CI、Docker、备份脚本、模型元数据与版本管理。

**劣势（会被评委抓）**

1. 模型标签自证循环，指标虚高（0.981/0.999）。
2. 真实数据为 0，"大学生健康数据"名不副实。
3. Agent 无闭环，是三个独立功能。
4. 模型文件损坏，Windows 下 AI 功能直接不可用。
5. 部分前端"AI 展示"是硬编码装饰（进度条恒 done、五维画像硬编码、关键词计数当影响因素）。

---

## 七、风险问题汇总

| 风险类别       | 具体风险                                                                                             | 触发场景                                        | 影响                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------- |
| **演示翻车**   | 模型文件 CRLF 损坏 + ML 服务默认不启动                                                               | 评委 Windows 克隆运行 / 未起 8000               | AI 功能全部静默降级为规则引擎，前端显示"规则分析结果"，与宣传材料不符 |
| **技术深挖**   | 标签规则蒸馏、聚类 silhouette 0.066、SHAP 方向错误                                                   | 评委问"标签哪来的""聚类效果如何""SHAP 怎么算的" | AI 叙事崩塌                                                           |
| **数据真实性** | `health_survey`=0、演示数据硬编码                                                                    | 评委问"有多少真实用户数据"                      | 实用价值被质疑                                                        |
| **安全合规**   | 三级高血压判"低风险"；"我没有胸痛"触发 120；无鉴权接口；越权算他人完成率                             | 评委试用 / 代码审查                             | 健康类作品的安全底线问题，杀伤力极大                                  |
| **学术诚信**   | 前端存在硬编码的"AI 生成过程"、关键词计数冒充影响因素                                                | 代码审查                                        | 被认定为夸大 AI 能力                                                  |
| **知识产权**   | 项目基于 `vue-pure-admin` 模板改造（package.json 名为 zhikang-health，但保留大量模板代码与 LICENSE） | 评委/导师核查                                   | 需明确说明基础框架来源与自有贡献比例                                  |
| **维护**       | 仅 2 个提交；README 落后；路径依赖 cwd                                                               | 长期迭代                                        | 团队协作与答辩材料准备困难                                            |

---

## 八、优化路线

> 按"是否影响比赛结果"排序，不做泛泛建议。

### P0 — 必须修复（不修会直接影响比赛结果）

| #     | 事项                                                                                                                                             | 位置                                          | 工作量 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | ------ |
| P0-1  | **修复模型文件换行符**：`.gitattributes` 加 `server-ml/model/*.txt -text`，`git add --renormalize .` 重新提交；并验证 Linux/Windows 双端均可加载 | `.gitattributes`、`server-ml/model/lgbm.txt`  | 0.5h   |
| P0-2  | **修复 SHAP 方向计算**：`explain.py:36` 改为取预测类 `sv[:, pred]`；降级路径的 `direction` 不再硬编码                                            | `server-ml/explain.py`                        | 1h     |
| P0-3  | **修复评分归一化**：`health-engine.ts:596-601` 改为 `Σ(w×lvl)/Σ(w_已测)×100`；单项 level=2 设置等级下限保底                                      | `server/shared/health-engine.ts`              | 2h     |
| P0-4  | **修复急症分流假阳性**：加否定词窗口（没有/不是/以前/已经好了/家人/朋友）；补低血压、心率、心理危机阈值                                          | `health-engine.ts:687-770`                    | 2h     |
| P0-5  | **修复全零特征误判**：缺失特征用训练集中位数填充（对齐 `dataset.py:_default_row`）；`dataQuality=low` 时返回"数据不足"而非 high 风险             | `server-ml/feature.py`、`model.py`、`risk.ts` | 2h     |
| P0-6  | **补齐 README 架构图**：加入 Python ML 服务、LightGBM/SHAP/KMeans、RAG、Agent；快速开始增加"启动 ML 服务"步骤并说明降级行为                      | `README.md`                                   | 1h     |
| P0-7  | **采集真实问卷数据**（≥100 条触发 `real_priority`），或用真实量表（PSQI/PSSQ/GHQ-12）替换规则标签，重训并在 `docs/model-report.md` 更新真实指标  | `server-ml/train.py --real-db`                | 1-2 周 |
| P0-8  | **清理前端"假 AI"展示**：`ai-profile` 进度条、报告页 AI 生成进度、`HealthFactorChart` 关键词计数、showcase 硬编码"5"                             | 4 个 vue 文件                                 | 3h     |
| P0-9  | **修复 RAG 路径**（改用 `import.meta.dirname`）；统一 `cluster-model/metadata.json` 键名为 `model_version`                                       | `health-knowledge.ts:31`、metadata            | 0.5h   |
| P0-10 | **修复 Agent 断链**：`planAgent.ts` 接收 Analyze 输出；风险页增加"采纳为我的计划"按钮并入库                                                      | `planAgent.ts`、`risk/index.vue`              | 4h     |

### P1 — 建议优化（提升竞争力）

| #     | 事项                                   | 说明                                                                                                                                  |
| ----- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| P1-1  | **把"可解释安全底座"包装为核心创新点** | 急症分流 + 阈值可溯源 + 规则版本 + 全链路降级 + 隐私授权 + 审计脱敏，这套组合是真实差异化的，比"用了 LightGBM"更有说服力              |
| P1-2  | **补齐特征一致性治理**                 | 建 `FEATURE_ORDER` 的单一定义文件（前后端 + Python 三方共用），加"特征漂移检测"（线上分布 vs 训练分布 PSI），这是 ML 工程的高阶加分项 |
| P1-3  | **聚类改用真实数据重训或改叙事**       | 用真实问卷重训并报告 silhouette；若仍 <0.2，主动说明"当前无显著簇结构，改用规则分型"，诚实反而加分                                    |
| P1-4  | **打通一个真实数据源**                 | `/health/device/sync` 目前是死接口，接一个真实来源（可穿戴设备导出、校园体育数据）能显著提升实用价值                                  |
| P1-5  | **补充黄金测试集（golden set）**       | 手工标注"165/100 应得 X 分"这类固定用例，防止评分算法缺陷再次潜伏（当前测试自证问题严重）                                             |
| P1-6  | **修复高危前端 bug**                   | ECharts dispose、无 catch 的 Promise、http 排队回调 reject、token 刷新、请求竞态、`pageSize` 上限                                     |
| P1-7  | **收敛重复实现**                       | BMI 公式 4 份 → 1 份；日期格式化 7 份 → 1 份；"有效运动日"3 套口径 → 1 套；医学区间前后端共用                                         |
| P1-8  | **权限与限流加固**                     | `clusterStats` 补鉴权；`seed-student` 限制环境 + adminOnly；Review 越权修复；登录限流；LLM 接口用户级限流                             |
| P1-9  | **补充产品化材料**                     | 架构决策记录（ADR）、真实用户试用报告、前后对比数据、竞品对比表                                                                       |
| P1-10 | **仓库规范化**                         | 补充有意义的提交历史（或说明原因）；明确 `vue-pure-admin` 基础框架与自有贡献边界                                                      |

### P2 — 长期规划（产品化方向）

| 方向                 | 内容                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **数据闭环**         | 问卷 → 真实标签 → 定期重训 → A/B 对比 → 模型版本灰度；建 `model_registry` 表管理版本与指标历史                   |
| **多模态与设备接入** | 接入智能手环 / 校园一卡通消费数据 / 图书馆出入记录，把"手工填报"变成"自动采集"，这是留存率的关键                 |
| **群体健康服务**     | 面向学校/学院的群体健康看板已具备雏形（`analytics` + k-匿名），可扩展为"院系健康报告"，这是 B 端商业化的入口     |
| **医学合规**         | 引入真实量表（PSQI/PSSQ/GHQ-12/SAS/SDS）作为标签来源；与校医院/心理咨询中心合作做标注；明确"非医疗器械"边界      |
| **Agent 真实化**     | 引入工具调用（查询记录、生成计划、写入打卡）、短期记忆（会话状态）、反思（Review 结果回灌 Plan），形成真正的闭环 |
| **多端与部署**       | 微信小程序（校园场景最合适）、Docker Compose 一键部署、数据备份与恢复自动化                                      |

---

## 九、答辩问题预测与回答方向

> 共 26 题，按类别分组。**每题给出"回答方向"，重点是：诚实 + 转向真实优势，不要硬撑。**

### A. 数据来源与真实性（A1-A5）

| #   | 问题                                                   | 回答方向                                                                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | **你们的数据从哪里来？有多少真实数据？**               | 诚实说明三层：① 医学指标（血压/血糖/血脂）来自用户手动录入与批量导入，库内现有 90 条演示+用户记录；② 生活方式数据（睡眠/运动/压力/心情）来自每日打卡；③ **大学生问卷 `health_survey` 目前仍在采集阶段（当前 0 条）**，这是明确的短板。强调已建好采集通道与自动重训机制（≥100 条自动切 `real_priority`）。**不要虚报数量。** |
| A2  | **模型是用什么数据训练的？**                           | 直接回答：当前 `training_mode = synthetic_only`，4000 条合成数据 + 规则标签，用于验证"数据→训练→预测→解释"工程闭环。引用 `docs/model-report.md` 中已写明的限制。转向：真实问卷接入后一条命令即可重训（`python train.py --real-db`）。                                                                                       |
| A3  | **标签是怎么来的？可信吗？**                           | 诚实：冷启动标签由可解释规则（`train.py: rule_label`）生成，本质是"规则蒸馏"，**不是医学标注**。明确说明这意味着当前指标（Accuracy 0.981 / AUC 0.999）只证明模型拟合了规则，不代表临床预测能力。给出替代方案：真实量表 PSSQ / GHQ-12。                                                                                      |
| A4  | **为什么准确率 98%、AUC 0.999 这么高？是不是过拟合？** | 这是必问题。**主动承认**：不是过拟合，是目标泄漏式自证——标签是特征的确定性函数，模型只需复现规则。高分恰恰说明"这个指标没有信息量"。展示你已经理解这个问题（`docs/model-report.md:100` 已写明），并说明解决路径。承认比狡辩得分高。                                                                                         |
| A5  | **用户隐私怎么保护？**                                 | 这是**优势题**，展开讲：① `user_id` 全链路隔离；② 隐私授权独立建表（`user_privacy`），不与档案混写，避免"改档案重置授权"；③ 群体分析 k-匿名，小样本分组隐藏（`health-analytics.ts:171-173`）；④ 审计日志脱敏 + 动作目录白名单；⑤ 本地 SQLite 不出境；⑥ 默认不共享（`allow_shared DEFAULT 0`）。                             |

### B. 模型与技术（B1-B7）

| #   | 问题                                           | 回答方向                                                                                                                                                                                                                                                                                                           |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | **为什么用 LightGBM？为什么不用深度学习？**    | 四条理由：① 样本量小（当前千级），深度模型必然过拟合；② 表格数据上 GBDT 类模型仍是 SOTA；③ **可解释性是刚需**——SHAP TreeExplainer 可以给出单样本归因，深度模型难以做到同等精度；④ 推理快、CPU 可跑、便于本地部署与断网可用。补充：这是"合适的技术选型"而非"越复杂越好"。                                           |
| B2  | **SHAP 有什么作用？能证明模型可信吗？**        | SHAP 的作用是**解释单样本预测归因**（哪个因素把风险推高了），提升用户信任与可操作性；但它**不能证明模型可信**——如果标签本身有问题，SHAP 只会忠实地解释一个错误的模型。强调你们已经把 SHAP 与规则引擎的 `buildEvidence` 双层解释打通。                                                                              |
| B3  | **SHAP 结果里"睡眠 8 小时升高风险"怎么解释？** | （修复前不要演示该功能）修复后回答：这是多分类 SHAP 方向计算的实现问题（需取预测类而非全类平均），我们已修正为按预测类输出贡献，并在前端区分"升向中风险/升向高风险"。**如果评委现场指出，直接承认这是已知缺陷并给出修复方案。**                                                                                    |
| B4  | **KMeans 轮廓系数只有 0.066，说明什么？**      | 说明**当前合成数据不存在显著簇结构**（单峰高斯分布），聚类不成立。诚实承认，并给出两条路：① 真实问卷数据重训后再评估；② 若仍无结构，改用规则分型（`health-type.ts` 已实现且更可控）。说明你们的 `clustering.py` 已经自动搜索 k=3~6 并输出 silhouette 曲线——**这个评估机制本身是正确的做法**。                      |
| B5  | **线上线下特征不一致怎么办？**                 | 这是好问题，说明你们有工程意识：① `FEATURE_ORDER` 在 Python 侧单一定义；② 缺失值用训练集中位数填充（对齐 `dataset.py:_default_row`）而非 0；③ 已发现 `is_off_campus`/`grade_code` 硬编码问题并改为从 `student_profile` 读取；④ 规划中的 PSI 漂移监控。**承认曾经传 0 导致"新用户被判高风险 90%"的 bug 并已修复。** |
| B6  | **RAG 是怎么实现的？用了什么向量库？**         | 诚实：当前是**轻量关键词检索增强**——对本地 92 条健康知识做关键词加权打分（命中关键词 +3 / 标题 +2 / 正文 +1），取 Top-3 注入 prompt。没有向量库，接口已预留（`retrieveKnowledge` 签名不变），后续可平滑替换为 embedding 检索。**不要说"向量知识库"。**                                                             |
| B7  | **你们说的 Agent 是真的智能体吗？**            | 诚实：当前是"**三段式 AI 辅助流程**"——Analyze（整合风险+SHAP+知识生成分析）、Plan（生成 7 天计划）、Review（完成率+前后对比复评），每段有独立 prompt、结构化 JSON 输出与规则降级。但三者之间**尚未形成自动状态传递与工具调用**，所以严格说不是完整智能体。给出演进路线（工具调用 + 记忆 + 反思回灌）。             |

### C. 产品与价值（C1-C6）

| #   | 问题                                                | 回答方向                                                                                                                                                                                                                                      |
| --- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | **真实用户价值在哪里？和普通健康 APP 有什么区别？** | 三点差异：① **面向大学生场景建模**（睡眠不足、久坐、考试压力、饮食不规律），不是通用计步器；② **可解释**——每个结论都能看到指标、阈值、依据、限制，而不是黑箱分数；③ **安全底座**——急症分流优先级高于 LLM，健康类场景这是刚需。                |
| C2  | **用户为什么要每天填写数据？留存怎么保证？**        | 诚实承认这是当前最大挑战（依赖手工填报）。已有机制：每日打卡 + 连续天数 + 目标进度 + 站内提醒（`reminder-scheduler`）；规划方向是接入真实数据源（可穿戴设备、校园卡消费、图书馆门禁）变被动采集。可补充：提醒调度已实现幂等站内信，不会刷屏。 |
| C3  | **商业模式是什么？**                                | 建议回答 B 端为主：① 面向高校的"院系群体健康报告"（`analytics` 模块已具备 k-匿名群体分析能力）；② 与校医院/心理咨询中心合作做筛查分流转介；③ 增值：个性化干预计划、企业/高校健康管理 SaaS。C 端免费 + 增值服务。**不建议编造营收数据。**      |
| C4  | **竞品对比？比 Keep / 华为健康强在哪？**            | 不要硬比大厂。定位差异：大厂做**通用运动健康**，我们做**大学生亚健康生活方式干预 + 可解释 + 校园场景**。优势是场景聚焦、可解释、可落地到院系管理；劣势是数据与生态，明确承认。                                                                |
| C5  | **有没有真实用户试用过？效果如何？**                | 诚实：目前主要在开发团队与演示账号内验证，尚未开展规模化试用。给出计划：与校医院/辅导员合作开展 100 人问卷 + 4 周干预试点，用"前后 7 天指标变化 + 计划完成率"做效果评估（`health-review-agent` 已实现该对比逻辑）。                           |
| C6  | **这个项目能落地吗？**                              | 技术落地无障碍（Docker 一键部署、本地 SQLite、断网可用）。关键是**合规与数据**：明确"非医疗器械、不替代诊断"边界（已在 UI/LLM prompt/API disclaimer 三处声明）；要真正落地需与校方、校医院建立合作。                                          |

### D. 安全与合规（D1-D4）

| #   | 问题                                       | 回答方向                                                                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **AI 建议可靠吗？出错了谁负责？**          | 分层回答：① 医学分级由**确定性规则引擎**产出（不是 LLM 编的），可复算、可溯源；② LLM 只做自然语言组织与建议生成，prompt 中明确约束"不做诊断、不开药"；③ 急症关键词与危险指标由规则**优先拦截**，不交给 LLM；④ 全链路免责声明；⑤ 涉及明显异常一律提示就医。**责任边界：健康管理参考，不替代诊疗。**               |
| D2  | **如果用户输入危险症状，系统会怎么做？**   | 讲 `checkEmergency`：命中 6 条极端指标阈值（收缩压≥180、舒张压≥110、血糖≥16.7 或 ≤2.8、血氧<90）与 12 类危险症状关键词时，**无论规则模式还是 LLM 模式，一律返回固定处置卡（立即拨打 120），不交由大模型自由回答**（`chat.ts:169-181`）。可补充已知改进点（否定词处理、低血压阈值）。                             |
| D3  | **数据存在本地 SQLite，安全性够吗？**      | 说明设计取舍：本地单文件库意味着数据不出校、不依赖云厂商，对健康数据反而是优势；配套措施有 bcrypt 密码哈希、JWT + 停用账号实时拦截、审计日志、SQL 全程参数化、备份脚本。同时承认：生产环境需要加密存储、传输 HTTPS、访问控制与定期备份策略。                                                                     |
| D4  | **有没有做权限隔离？能看到别人的数据吗？** | 讲三层：① 所有业务接口 `authMiddleware` 强制 JWT；② 查询一律带 `user_id` 参数化绑定；③ admin 接口 `adminOnly` 二次校验；④ JWT 有效期内若账号被停用，下一次请求即拒绝（`auth.ts:50-54`）。**并主动承认已发现并修复的两处越权点**（Review 完成率未带 user_id、`cluster-stats` 缺鉴权）——主动暴露已修复问题会加分。 |

### E. 工程与团队（E1-E4）

| #   | 问题                                           | 回答方向                                                                                                                                                                                                                                                  |
| --- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | **项目用了什么基础框架？哪些是你们自己写的？** | 明确说明：前端基于 `vue-pure-admin` 后台模板（MIT 协议，保留 LICENSE），**健康业务全部自研**：规则引擎、ML 服务、Agent、RAG、隐私与审计、健康全链路页面。给出量化：自研业务代码约 2.4 万行（后端）+ 1.5 万行（健康业务前端）。**不要含糊。**              |
| E2  | **代码质量怎么保证？**                         | 376 个单元测试全绿（13 个文件）、3,648 行 API 回归脚本、GitHub Actions CI（typecheck + build）、ESLint + Prettier + Stylelint + commitlint + husky。规则引擎集中在 `shared/` 纯函数，前后端共用唯一源码，可单测可复算。可补充测试改进方向（golden set）。 |
| E3  | **ML 服务挂了会怎样？**                        | 讲降级设计：`ml-client` 2.5s 超时 → `risk.ts` catch → 走 `analyzeHealth` 规则引擎，返回 `source: "rule"`，前端如实标注"规则分析结果"而非伪装成 AI。LLM 同理（无 Key / 超时 / 非 2xx 全部降级为可读文案）。**"不骗用户"是设计原则。**                      |
| E4  | **团队分工与开发周期？**                       | 按模块说明：前端健康业务、后端规则引擎与 API、Python ML 服务、测试与文档。可提及分阶段推进（B0-B10 后端化改造 + V1.x/V2.x 能力迭代，见 `AGENTS.md` 与代码注释中的阶段标记）。                                                                             |

### F. 高压追问（F1-F4）

| #   | 问题                                                      | 回答方向                                                                                                                                                                                                                                                                            |
| --- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | **如果去掉 AI，你的项目和普通的健康记录表格有什么区别？** | 直面：核心差异不在"有没有 AI"，而在**可解释性与安全底座**——即便去掉 LLM，规则引擎仍能提供带阈值溯源的分级、急症分流、计划生成与前后对比。AI 的增量价值是"把结构化结论翻译成用户能执行的语言"。同时承认：如果去掉 ML 与 LLM，产品价值会显著下降，所以真实数据接入是下一步重点。      |
| F2  | **你说准确率 98%，那能不能现场演示一个真实案例？**        | **不要硬演。** 说明当前模型基于规则标签，演示结果会与规则引擎一致；真正的验证需要真实量表数据。可改为演示"完整工程闭环"：填问卷 → 入库 → 触发重训 → 模型版本更新 → 预测 → SHAP 解释 → 快照落库。                                                                                    |
| F3  | **评委现场克隆代码，AI 功能跑不起来怎么办？**             | **必须提前修好 P0-1（模型文件换行符）**。同时准备：① 一键启动脚本（同时起 ML + 后端 + 前端）；② README 明确 ML 服务启动步骤；③ 预先录制备用演示视频；④ 说明降级行为（不启动 ML 也能完整演示规则引擎能力）。                                                                         |
| F4  | **这个项目最大的短板是什么？**                            | **必须能答出真实短板且给出方案，这题答好会大幅加分。** 建议答三点：① 真实标注数据不足（方案：量表采集 + 校医院合作）；② Agent 尚未形成闭环（方案：工具调用 + 状态传递 + 计划落地）；③ 数据依赖手工填报（方案：设备/校园数据源接入）。**主动承认短板 + 清晰改进路径 = 成熟度信号。** |

---

## 附录：关键实测命令与输出

```bash
# 1. 模型文件换行符（致命问题证据）
$ python -c "b=open('server-ml/model/lgbm.txt','rb').read(); print('CRLF',b.count(b'\r\n'),'LF',b.count(b'\n'))"
CRLF 6995  LF 6995
$ git config --global core.autocrlf
true
# 转 LF 后：lgb.Booster(model_file=...) → num_trees = 360  ✅
# 原文件：LightGBM [Fatal] Model format error, expect a tree here  ❌

# 2. 数据库真实数据量
users=3  records=90  daily_health_records=7  health_survey=0
student_profile=0  risk_predictions=1  health_plans=1
risk_predictions.model_version = "lgbm-v0.2"（实际模型为 v0.3）

# 3. 服务运行状态
$ curl 127.0.0.1:8000/health   → ML 服务未启动（当前运行在规则引擎降级模式）
$ curl 127.0.0.1:3000/api/ping → {"code":0,"data":"ok"}

# 4. 模型边界行为（基于 LF 修复版模型实测）
全零特征（新用户无任何数据）  → riskLevel=high, proba=0.904   ❌
线上特征（seed-student 数据） → riskLevel=high, proba=0.988
健康学生（睡8h/压力1/运动300）→ riskLevel=low,  proba=0.876
  ├─ SHAP: 睡眠时长 +0.7625 "升高风险"   ❌ 反直觉
  └─ SHAP: 平均压力 +0.4749 "升高风险"   ❌ 反直觉
高风险用户 SHAP: 平均压力 -0.4485 "降低风险"  ❌ 反直觉

# 5. 聚类有效性
silhouette(k=3)=0.066  k=4=0.063  k=5=0.056  k=6=0.050   → 无簇结构
confidence: 0.672 / 0.675 / 0.696  → 恒定 ≈0.667，伪指标

# 6. RAG 路径
$ ls -d src/data
ls: cannot access 'src/data': No such file or directory
# health-knowledge.ts:31 解析 → D:\...\vue-pure-admin\src\data\health-knowledge.json (不存在)

# 7. 单元测试
Test Files  13 passed (13)
     Tests  376 passed (376)
```

---

**报告结束**

> 本报告基于 2026-09-25 的仓库快照。所有结论均可通过附录命令复现。建议在完成 P0 修复后重新生成一份对照版本，作为"改进前后对比"材料提交给指导老师。
