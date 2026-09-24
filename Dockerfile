# 智康健康管理系统 · 生产镜像（两阶段构建：前端产物 + Node 运行环境）
#
# 构建：docker build -t zhikang-health:1.0.0 .
# 运行：docker run -p 3000:3000 -e JWT_SECRET=xxx -v $(pwd)/server/data:/app/server/data zhikang-health:1.0.0
#      或直接用 docker-compose.yml
#
# 单端口对外：Express(NODE_ENV=production) 同时托管 /api、/uploads 与前端 dist/。
#
# 基础镜像用 **node:22-slim（Debian/glibc）而不是 alpine（musl）**：
# better-sqlite3 / bcrypt 是原生模块，官方预编译产物只覆盖 glibc（linux-x64/arm64），
# musl 下 prebuild 拿不到、必须现场 node-gyp 编译（失败概率高、构建慢）；
# 换 slim 后优先命中预编译产物，Dockerfile 里保留的编译工具链只作兜底。
# 注意：slim 里没有 wget/curl，healthcheck 见 docker-compose.yml（用 node 内置 http）。

# ---------- 阶段 1：构建前端（vite + vue-tsc 等构建期依赖只留在这一层） ----------
FROM node:22-slim AS builder
WORKDIR /app

# 镜像内不需要 git hooks
ENV HUSKY=0

# 兜底工具链：预编译产物命中时用不到，缺失时可退回源码编译
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# package.json 的 packageManager 字段固定 pnpm 版本，corepack 按该版本拉取（与本地锁文件格式一致）
RUN corepack enable
# pnpm-workspace.yaml 里有本项目依赖的 pnpm 配置（shellEmulator / allowBuilds 等），必须一起拷
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ---------- 阶段 2：运行（只装生产依赖，镜像更小） ----------
FROM node:22-slim
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HUSKY=0

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# 生产依赖含 express / better-sqlite3 / bcrypt / jsonwebtoken / multer / dotenv / tsx
# （tsx 是 server 入口的运行依赖：`tsx server/src/index.ts`）
# --ignore-scripts：pnpm 默认不跑依赖的构建脚本（allowBuilds 白名单机制），
# 且根项目 prepare(husky) 属于 devDependencies、--prod 下不存在；
# 随后用 pnpm rebuild 单独跑两个原生模块的构建脚本（glibc 下即下载预编译产物），
# 用完再把编译工具链从镜像里删掉。
RUN pnpm install --prod --frozen-lockfile --ignore-scripts \
    && pnpm rebuild better-sqlite3 bcrypt \
    && apt-get purge -y --auto-remove python3 make g++ \
    && rm -rf /var/lib/apt/lists/* /root/.cache

# 前端产物与后端源码
COPY --from=builder /app/dist ./dist
COPY server ./server

# 数据目录（SQLite 与上传头像）：容器内路径 /app/server/data，建议用 volume 挂载持久化
RUN mkdir -p /app/server/data/uploads
VOLUME ["/app/server/data"]

EXPOSE 3000
CMD ["pnpm", "start:server"]
