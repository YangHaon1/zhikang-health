# 智康健康 · Zhikang Health

> 基于人工智能的个人健康管理平台：记录健康数据、智能分析趋势、AI 健康助手，提供可解释的风险提示与个性化建议。

[![Vue](https://img.shields.io/badge/Vue-3-42b883)](https://vuejs.org/)
[![Node](https://img.shields.io/badge/Node.js-Express-339933)](https://expressjs.com/)
[![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003B57)](https://www.sqlite.org/)

---

## 项目简介

智康健康是一个面向个人侧的 AI 健康管理平台。它把分散的健康测值（血压、血糖、BMI、睡眠、运动、情绪）统一记录下来，通过**可解释的规则引擎**进行分级与评分，再结合大语言模型生成自然、可执行的健康建议，帮助用户长期追踪和改善健康状态。

平台不做在线问诊与疾病诊断，而是做个人健康数据的长期记录者、可解释的风险提示器与每日生活方式的 AI 陪伴。

---

## 核心功能

### 健康档案

- 基础健康信息管理（年龄、性别、身高、体重）
- 引导式健康档案采集
- 健康指标记录与回显

### 健康分析

- 多维健康指标综合评分
- 数据趋势分析与可视化
- 可解释的健康风险提示与分级
- 每日 AI 健康总结

### AI 风险预测与行为画像（server-ml）

- **LightGBM 三分类风险预测**：15 维生活方式特征 → 低 / 中 / 高风险倾向
- **SHAP 单样本归因**：输出 Top-3 影响因素与影响方向，回答"为什么判我有风险"
- **KMeans 行为画像**：无监督聚类给出生活方式画像与建议
- **训练模式三档自动切换**：`synthetic_only` → `hybrid_training` → `real_priority`（真实问卷 ≥100 条时自动启用）
- 模型版本与训练指标落 `model/metadata.json`，可追溯、可复训

### 三段式 AI 辅助流程

- **Analyze**：整合风险等级 + SHAP 因素 + 知识检索，生成结构化分析
- **Plan**：基于分析结果生成 7 天可执行改善计划
- **Review**：按计划完成率与前后指标变化生成复评
- 每一步都有规则模板兜底，大模型不可用时功能不中断

### AI 健康助手

- 基于自然语言的健康问答交互
- 结合用户真实健康档案与近期数据，给出个性化建议
- **RAG 知识增强**：按问题与风险因素检索本地健康知识库（Top-3）注入上下文
- **急症优先分流**：命中极端指标或危险症状关键词时，无论规则还是大模型模式，一律返回固定处置卡
- 大模型不可用时自动降级为规则引擎文案，主流程不中断

### 健康计划与提醒

- 健康目标管理与进度追踪
- 每日健康打卡记录
- 站内健康提醒（分钟级调度，幂等推送）

### 数据安全与合规

- 用户数据按 `user_id` 全链路隔离，SQL 全程参数化
- 隐私授权独立建表（`user_privacy`），默认关闭共享
- 群体分析启用 k-匿名，小样本分组自动隐藏
- 敏感操作写审计日志（脱敏存储）

---

## 系统架构

```
┌─────────────────────────────────────────────────┐
│  前端  Vue3 + Vite + TypeScript + Element Plus   │
│        ECharts / Pinia / Vue Router / deep-chat  │
└──────────────────┬──────────────────────────────┘
                     │ HTTP / JWT
┌───────────────────▼──────────────────────────────┐
│  后端  Node.js + Express 5（:3000）              │
│  ├─ 健康路由：records/profile/report/plans/risk │
│  ├─ AI 路由：health profile / chat / companion   │
│  ├─ 规则引擎（server/shared/health-engine.ts）   │
│  ├─ 三段式 AI 辅助：analyze → plan → review      │
│  ├─ RAG 知识检索（data/health-knowledge.json）   │
│  └─ LLM 客户端（OpenAI 兼容，火山方舟）          │
└──────┬───────────────────────────┬───────────────┘
         │ better-sqlite3            │ HTTP（2.5s 超时，失败降级）
┌────────▼────────────────┐ ┌───────▼────────────────────────┐
│  SQLite 本地单文件库     │ │  Python ML 服务 FastAPI（:8000）│
│  server/data/zhikang.db  │ │  server-ml/                     │
│  20 张表，user_id 隔离   │ │  ├─ /predict  LightGBM + SHAP   │
│  含审计日志 / 隐私授权   │ │  ├─ /cluster  KMeans 行为画像   │
│                          │ │  └─ /health   模型版本探针      │
└──────────────────────────┘ └─────────────────────────────────┘
```

评分、分级、建议生成的核心逻辑集中在 `server/shared/*.ts` 纯函数中，可单测、可复算、断网可用。

**降级设计**：Python ML 服务或大模型不可用时，系统自动回退规则引擎，响应中的 `source`
字段会如实标注 `ml` / `rule` / `insufficient`，前端据此展示，不伪装成 AI 结果。

---

## 项目结构

```
.
├── src/                    # 前端（Vue3 + Vite + TS）
│   ├── views/health/       # 健康业务页面（驾驶舱/画像/聊天/趋势/报告…）
│   ├── components/health/  # 健康展示组件
│   └── api/                # 前端接口层
├── server/                 # 后端（Express）
│   ├── src/routes/         # 业务路由
│   ├── src/services/       # 服务层（AI 上下文组装 / RAG / Agent）
│   └── shared/             # 规则引擎纯函数（前后端共享唯一源码）
├── server-ml/              # Python ML 服务（FastAPI + LightGBM + SHAP + KMeans）
│   ├── model/              # lgbm.txt + metadata.json
│   └── cluster-model/      # kmeans.pkl + metadata.json
└── server/scripts/         # 演示数据初始化脚本
```

---

## 快速开始

环境要求：Node.js 18+、pnpm，Python 3.10+（可选，用于 ML 服务）。

```bash
# 安装依赖
pnpm install

# 配置环境变量
cp server/.env.example server/.env
```

### 方式一：一键启动全部服务（推荐）

```bash
pnpm dev:all     # 并行启动 ML(8000) + 后端(3000) + 前端(8848)
```

### 方式二：分别启动

```bash
# 1) Python ML 服务（端口 8000，可选但推荐）
pip install -r server-ml/requirements.txt
pnpm dev:ml

# 2) 后端（端口 3000）
cd server && pnpm dev

# 3) 前端（端口 8848）
pnpm dev
```

> ⚠️ **不启动 ML 服务时系统仍可完整运行**，但风险预测会自动降级为规则引擎
> （响应 `source` 字段为 `rule`，前端会如实标注"规则分析结果"）。
> 若需要演示 LightGBM / SHAP / KMeans 能力，请务必启动 ML 服务。

浏览器访问 http://localhost:8848 。

内置演示账号（仅开发环境默认创建）：

- 普通用户（**建议用它演示**）：`common / common123`
- 管理员：`admin / admin123`

> ⚠️ **演示链路请以 `common` 账号登录**，不要直接用 `admin`。
> 种子数据只给 `common` 灌了近 7 天的每日健康记录，而风险预测 / SHAP 归因
> / AI 画像都依赖它。用 `admin` 登录后打开「健康风险」页会显示
> 「近 7 天暂无每日健康记录」的空白态——那不是故障，是「数据不足不做预测」的
> 主动降级（空输入落在训练分布外，实测会被误判成 high 风险 0.904）。
> 想让 `admin` 也有数据，先跑 `node server/scripts/seed-demo.mjs`。

可选：一键初始化演示数据

```bash
node server/scripts/seed-demo.mjs
```

ML 模型重训（真实问卷数据入库后）：

```bash
cd server-ml
python train.py --real-db ../server/data/zhikang.db       # 真实样本 ≥100 自动切 real_priority
python clustering.py --real-db ../server/data/zhikang.db
```

---

## 环境变量

见 `server/.env.example`：

| 变量                 | 说明                                                                               |
| -------------------- | ---------------------------------------------------------------------------------- |
| `PORT`               | 后端端口，默认 3000                                                                |
| `JWT_SECRET`         | JWT 签名密钥，生产环境请替换为足够长的随机串                                       |
| `LLM_API_KEY`        | 大模型 API Key，留空则仅使用规则引擎                                               |
| `LLM_MODEL`          | 可选，大模型名称                                                                   |
| `LLM_BASE_URL`       | 可选，大模型网关地址（OpenAI 兼容）                                                |
| `SEED_DEMO_ACCOUNTS` | 是否自动创建演示账号；留空时生产默认关闭、开发默认开启，可显式 `true`/`false` 覆盖 |
| `ML_SERVICE_URL`     | 可选，Python ML 服务地址，默认 `http://127.0.0.1:8000`                             |

---

## 技术特点

- **前后端分离**：Vue3 SPA + Express REST API + 独立 Python ML 服务
- **可解释 AI**：规则引擎负责打分分级，LLM 负责自然语言表达，二者解耦
- **单样本归因**：SHAP 输出 Top-3 影响因素及方向，每个结论可回溯到指标 / 阈值 / 规则版本
- **AI 健康上下文**：向大模型注入用户结构化健康摘要，回答基于真实数据而非通用话术
- **全链路降级**：ML / LLM / SHAP 三层降级，任一外部依赖故障都不中断主流程
- **数据驱动**：统一记录、趋势分析、目标追踪形成健康管理闭环
- **隐私友好**：本地 SQLite，`user_id` 隔离、k-匿名、审计日志脱敏

---

## 已知限制

为保证技术陈述的准确性，以下限制如实列出（详见 `docs/model-report.md`）：

1. **模型处于冷启动阶段**：`health_survey` 真实问卷仍在采集中，当前模型以合成数据 +
   规则标签训练（`training_mode: synthetic_only`）。该模式下 Accuracy / AUC 偏高是
   「标签由规则定义」的必然结果，**不代表临床预测能力**。真实样本 ≥100 条后会自动切换
   `real_priority` 并重训。
2. **输出为生活方式风险提示，不是疾病诊断**：不能替代专业医疗评估、诊断或处方。
3. **聚类结构待验证**：当前合成数据下 silhouette 偏低，行为画像以规则分型为主；
   真实数据重训后会重新评估。
4. **RAG 为轻量关键词检索**：本地知识库规模有限，未使用向量检索，接口已预留可平滑替换。
5. **三段式 AI 辅助尚未形成自动闭环**：analyze / plan / review 目前需要显式传递上下文，
   尚不具备工具调用与自主规划能力。

---

## 注意事项

> 本项目提供的所有健康分析、建议与风险提示**仅供健康管理参考，不能替代专业医疗诊断、治疗或处方**。如出现胸痛、呼吸困难、昏厥等紧急症状，请立即就医。
