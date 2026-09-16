# 智康健康管理系统

一款面向个人健康管理的**前后端一体**系统（Vue3 + Vite 前端 / Node + Express + SQLite 后端）。系统内置**本地医学规则引擎**作为 AI 内核（断网可用），并预留**真实大模型**通道（可切换），用于比赛现场演示健康数据的录入、分析、报告与智能对话全流程。

## 项目简介

- 系统名：**智康健康管理系统**
- 形态：Vue3 + Vite 前端 + Express + better-sqlite3 后端（JWT 鉴权、SQLite 落库），生产由 Express 单端口托管前端产物，**无需额外部署、不依赖网络**
- AI 方案：**A+B 双通道**
  - 方案 A（默认）：本地医学规则引擎（唯一源码 `server/shared/health-engine.ts`，前后端共用），稳定零成本、断网可用
  - 方案 B：真实大模型 API（火山方舟 / 豆包），由**后端**直连转发，API Key 只存在服务端 `server/.env`
- 数据存储：SQLite（`server/data/zhikang.db`）+ 个人手动录入 + 管理员 Excel 一键导入 + 演示数据一键生成
- 权限：RBAC（admin / common），JWT 签发 + 动态路由菜单过滤 + 接口级 `adminOnly` 校验

## 功能列表

| 模块              | 说明                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| 健康总览          | 核心指标卡片（BMI / 血压 / 空腹血糖 / 综合风险评分）、近 30 天趋势、风险提示条                  |
| 我的健康          | 个人健康档案（基本信息 + 生活方式）                                                             |
| 指标管理          | 指标录入 + 历史记录（分页、日期筛选、修改、删除、导出）                                         |
| 趋势分析          | ECharts 多指标趋势 + 正常参考范围带 + 时间范围筛选                                              |
| AI 健康报告       | 一键生成风险评估报告（评分卡 + 雷达图 + 分项分析 + 建议）、打印报告（可另存为 PDF）/ 导出 Excel |
| AI 健康助手       | deep-chat 智能对话，基于真实健康数据回答健康问题                                                |
| 数据导入（admin） | Excel 模板下载 / 上传 / 逐行校验 / 批量入库、一键生成演示数据                                   |
| 用户管理（admin） | 系统用户管理                                                                                    |

## 技术栈

- Vue 3 + Vite + TypeScript
- Element Plus + Tailwind CSS
- ECharts（指标趋势 / 雷达图）
- Pinia + vue-router
- deep-chat（AI 对话）、xlsx（Excel 导入导出）

## 启动方式

> 环境要求：Node ≥ 22.22.1、pnpm ≥ 11（Docker 构建时按 `packageManager` 字段用 pnpm 12.4.2）

### 一、开发模式（双终端，改代码热更新）

```bash
pnpm install

# 终端 1：后端（Express + SQLite，端口 3000）
pnpm dev:server

# 终端 2：前端（Vite，端口 8848；/api 与 /uploads 已代理到 3000）
pnpm dev
```

浏览器打开 <http://localhost:8848>。

### 二、生产模式（单端口，演示 / 比赛现场推荐）

```bash
pnpm start          # = pnpm build && tsx server/src/index.ts
```

浏览器打开 <http://localhost:3000>：前端产物、`/api` 接口、`/uploads` 头像全部由 Express 一个端口提供（`NODE_ENV=production` 或已存在 `dist/` 时自动开启托管）。数据落在 `server/data/zhikang.db`，**进程重启不丢**。

### 三、Docker 部署

```bash
docker compose up -d --build
# 浏览器打开 http://localhost:3000
```

`docker-compose.yml` 已把 `./server/data` 挂载为数据卷，容器重建数据仍在；`JWT_SECRET`、`LLM_API_KEY` 通过环境变量注入（也可在同目录放 `.env` 文件）。

### 其他常用命令

```bash
pnpm typecheck      # 前端类型检查（vue-tsc）
npx tsc -p server/tsconfig.json --noEmit   # 后端类型检查
pnpm lint           # eslint + prettier + stylelint
```

### 局域网 / 其他机器访问

前端与服务端都在 `0.0.0.0` 监听：用 `ipconfig` 查到本机内网 IP（如 `192.168.1.5`），其他设备直接访问 `http://192.168.1.5:3000`（生产模式）。数据存在服务端，换浏览器 / 换电脑看到的是同一份数据。

## 账号说明

| 账号     | 密码        | 角色     | 菜单                               |
| -------- | ----------- | -------- | ---------------------------------- |
| `admin`  | `admin123`  | 管理员   | 全部菜单（含数据导入、用户管理）   |
| `common` | `common123` | 普通用户 | 公共菜单（不含数据导入、用户管理） |

> 密码在数据库中以 **bcrypt** 哈希存储；首次启动自动建库并写入这两个账号（`server/src/db.ts` 的种子数据）。
> 用户管理页（admin）可新增用户、修改资料、重置密码、分配角色、上传头像。

## 方案 B（真实大模型）Key 配置

默认使用**方案 A（本地规则引擎）**，无需任何配置、断网可用。如需接入真实大模型：

1. 从模板复制出服务端配置（`server/.env` 已被 `.gitignore` 忽略，不会提交）：

   ```bash
   cp server/.env.example server/.env
   ```

2. 编辑 `server/.env`，填入 Key：

   ```ini
   LLM_API_KEY=你的火山方舟/豆包 API Key
   # 可选：模型名与网关地址
   # LLM_MODEL=doubao-1-5-pro-32k-250115
   # LLM_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
   ```

3. 重启后端，在「AI 健康助手」页面切到「AI 大模型」模式（写入 `localStorage["health-ai-mode"]`）。

> Key 只在服务端使用，前端不持有任何 Key；未配置 Key 时页面会给出降级提示，规则引擎模式始终可用。

## 项目结构（核心）

```
server/
  ├─ src/index.ts                  # Express 入口：/api 路由 + 生产模式托管 dist/
  ├─ src/db.ts                     # SQLite 建表 + 幂等迁移 + 种子账号
  ├─ src/routes/{auth,health,user}.ts   # 登录鉴权 / 健康档案与记录 / 用户管理与上传
  ├─ src/middleware/auth.ts        # JWT 解析 + adminOnly
  ├─ shared/health-engine.ts       # ★ 医学规则引擎唯一源码（AI 方案 A 内核，前后端共用）
  ├─ shared/health-{report,import,chat,seed}.ts  # 报告模板 / 导入校验 / 对话意图 / 演示数据（同样唯一源码）
  └─ data/                         # SQLite 库与上传头像（不入库，Docker 下挂 volume）
src/api/                           # 前端 API 封装（health / user / system / routes）
src/types/health.ts                # 健康数据类型
src/views/health/
  ├─ dashboard/                    # 健康总览
  ├─ profile/                      # 我的健康（档案）
  ├─ records/                      # 指标管理（录入 + 历史）
  ├─ trend/                        # 趋势分析
  ├─ report/                       # AI 健康报告
  ├─ chat/                         # AI 健康助手
  └─ import/                       # 数据导入（admin）
src/views/system/user/             # 用户管理（admin）
```

> 前端通过 `vite.config.ts` 的 `@shared` 别名直接引用 `server/shared/*`，分级口径前后端永远一致、无双写。

## 许可证

[MIT](./LICENSE)
