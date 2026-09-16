# 智康健康管理系统 · 生产镜像（两阶段构建：前端产物 + Node 运行环境）
#
# 构建：docker build -t zhikang-health:1.0.0 .
# 运行：docker run -p 3000:3000 -e JWT_SECRET=xxx -v $(pwd)/server/data:/app/server/data zhikang-health:1.0.0
#      或直接用 docker-compose.yml
#
# 单端口对外：Express(NODE_ENV=production) 同时托管 /api、/uploads 与前端 dist/。

# ---------- 阶段 1：构建前端（vite + vue-tsc 等构建期依赖只留在这一层） ----------
FROM node:22-alpine AS builder
WORKDIR /app

# 镜像内不需要 git hooks
ENV HUSKY=0

# better-sqlite3 / bcrypt 是原生模块，alpine(musl) 没有预编译产物，需要本地编译
RUN apk add --no-cache python3 make g++

# package.json 的 packageManager 字段固定 pnpm 版本，corepack 按该版本拉取（与本地锁文件格式一致）
RUN corepack enable
# pnpm-workspace.yaml 里有本项目依赖的 pnpm 配置（shellEmulator / allowBuilds 等），必须一起拷
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ---------- 阶段 2：运行（只装生产依赖，镜像更小） ----------
FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HUSKY=0

RUN apk add --no-cache python3 make g++ && corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# 生产依赖含 express / better-sqlite3 / bcrypt / jsonwebtoken / multer / dotenv / tsx
# （tsx 是 server 入口的运行依赖：`tsx server/src/index.ts`）
# --ignore-scripts：跳过根项目 prepare(husky) —— 它属于 devDependencies，--prod 下不存在；
# 随后用 pnpm rebuild 单独跑两个原生模块的构建脚本，再把编译工具链从镜像里删掉。
RUN pnpm install --prod --frozen-lockfile --ignore-scripts \
    && pnpm rebuild better-sqlite3 bcrypt \
    && apk del python3 make g++

# 前端产物与后端源码
COPY --from=builder /app/dist ./dist
COPY server ./server

# 数据目录（SQLite 与上传头像）：容器内路径 /app/server/data，建议用 volume 挂载持久化
RUN mkdir -p /app/server/data/uploads
VOLUME ["/app/server/data"]

EXPOSE 3000
CMD ["pnpm", "start:server"]
