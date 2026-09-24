# 智康健康管理系统 · 后端接口文档（API.md）

> 适用版本：后端化改造完成版（Node.js + Express + TypeScript + SQLite）
> 本文档所有接口均与 `server/src/routes` 源码逐一核对，可作为前端对接与开发参考。

## 1. 通用约定

### 1.1 服务地址

| 场景          | 前端地址              | 后端地址              | 说明                                                |
| ------------- | --------------------- | --------------------- | --------------------------------------------------- |
| 开发（dev）   | http://localhost:8848 | http://localhost:3000 | Vite 把 `/api`、`/uploads` 代理到 3000              |
| 生产/本机演示 | http://localhost:3000 | http://localhost:3000 | `NODE_ENV=production` 时 Express 单端口托管 `dist/` |

- 所有业务接口统一前缀 **`/api`**。
- 头像等上传文件通过 **`/uploads/<文件名>`** 静态访问（不带 `/api`，由 `express.static` 托管 `server/data/uploads`）。
- 健康检查：`GET /api/ping` → `{ "code": 0, "data": "ok" }`（无需登录）。

### 1.2 统一响应结构

```json
{ "code": 0, "message": "操作成功", "data": {} }
```

- `code = 0` 表示业务成功；非 0 为业务错误码。
- HTTP 状态码：
  - `200` 正常；
  - `400` 请求参数/请求体不合法（多数参数错误同时给 `code: 40001`）；
  - `401` 未登录、令牌缺失/过期/伪造；
  - `403` 已登录但无权限（普通用户访问管理员接口）；
  - `404` 资源不存在或不属于当前用户；
  - 未命中的 `/api/**` 统一返回 `404 { code: 404, message: "接口不存在" }`，不会被前端 SPA 回退吞成 HTML。

> 特例：**Excel 批量导入** `POST /api/health/records/import` 的行级校验失败返回 **HTTP 200 + `data.errors[]`**（不是 400），因为前端要逐行展示错误；只有请求体本身不合法（`list` 不是数组）才返回 400。

### 1.3 鉴权方式

- 登录成功后获得 `accessToken`（有效期 **12 小时**）与 `refreshToken`（有效期 **7 天**）。
- 之后所有需登录接口在请求头携带：

  ```
  Authorization: Bearer <accessToken>
  ```

- accessToken 过期后用 refreshToken 调 `/api/refresh-token` 换取新令牌。
- 令牌载荷：`{ id, username, roles }`，由服务端 `JWT_SECRET` 签名（HS256）。

### 1.4 角色与数据隔离

- 两类角色：`admin`（管理员）、`common`（普通用户）。
- **所有健康数据（档案、记录、报告、对话）都按 `user_id` 强制隔离**：服务端从令牌取用户 id，客户端无法指定或读取他人数据；越权访问他人资源一律 404。
- 管理员专属接口（导入、演示数据、用户管理）在路由层叠加 `adminOnly` 中间件，普通用户调用返回 403。

### 1.5 错误码

| code  | 含义                                                                         |
| ----- | ---------------------------------------------------------------------------- |
| 0     | 成功                                                                         |
| 401   | 未登录或登录已过期                                                           |
| 403   | 无权限访问                                                                   |
| 404   | 资源不存在 / 接口不存在                                                      |
| 40001 | 业务参数错误（字段缺失、格式不对、用户名密码错误等，`message` 给出具体原因） |
| 10001 | 请求参数缺失或格式不正确（用户角色回查等兼容口径）                           |

---

## 2. 鉴权与登录

### 2.1 登录

`POST /api/login`（无需 token）

请求体：

```json
{ "username": "admin", "password": "admin123" }
```

成功 `data`：

```json
{
  "avatar": "",
  "username": "admin",
  "nickname": "管理员",
  "roles": ["admin"],
  "permissions": ["*:*:*"],
  "accessToken": "xxx",
  "refreshToken": "yyy",
  "expires": "2026/09/17 20:08:38"
}
```

- 密码用 **bcrypt** 校验，数据库不存明文。
- 用户名或密码错误：HTTP 200 + `{ code: 40001, message: "用户名或密码错误" }`。
- 普通用户 `permissions` 为 `["permission:btn:add","permission:btn:edit"]`，管理员为 `["*:*:*"]`。

### 2.2 刷新令牌

`POST /api/refresh-token`

请求体：`{ "refreshToken": "yyy" }` → 成功返回新的 `{ accessToken, refreshToken, expires }`；refreshToken 缺失/无效/伪造返回 401。

### 2.3 当前登录人信息

`GET /api/mine`（登录）

返回 `data`：`{ avatar, username, nickname, email, phone, description }`。

### 2.4 当前登录人安全日志

`GET /api/mine-logs`（登录）

返回分页结构 `{ list, total, pageSize, currentPage }`，用于「账户设置-个人安全日志」展示。

### 2.5 获取当前用户的动态路由

`GET /api/get-async-routes`（登录）

服务端按当前用户 `roles` 过滤菜单树后返回（普通用户不含「数据导入」「用户管理」）。

---

## 3. 健康档案

> 每个用户至多一份档案，`PUT` 为 upsert（局部更新，只覆盖传入字段）。

### 3.1 获取档案

`GET /api/health/profile`（登录）

- 已完善：返回档案对象；
- 未完善：`data` 为 `null`（不返回 404，前端据此显示「去完善」）。

### 3.2 保存/更新档案

`PUT /api/health/profile`（登录）

请求体字段（均可只传一部分）：

| 字段           | 类型   | 说明 / 取值                              |
| -------------- | ------ | ---------------------------------------- |
| name           | string | 姓名                                     |
| gender         | number | 性别：`1` 男，`0` 女                     |
| age            | number | 年龄                                     |
| height         | number | 身高 cm（BMI 计算用）                    |
| weight         | number | 体重 kg（BMI 计算用）                    |
| waistline      | number | 腰围 cm                                  |
| medicalHistory | string | 既往病史                                 |
| familyHistory  | string | 家族病史                                 |
| allergyHistory | string | 过敏史                                   |
| smoking        | string | `从不` / `偶尔`（经常吸烟按偶尔入库）    |
| drinking       | string | `从不` / `偶尔` / `经常`                 |
| exercise       | string | `几乎不运动` / `每周1-2次` / `每周3-5次` |

返回更新后的完整档案（含只读字段 `createTime`）。

---

## 4. 健康指标记录

记录字段（驼峰）：`id`、`date`（`yyyy-MM-dd`，必填）、`systolic`（收缩压）、`diastolic`（舒张压）、`fastingGlucose`（空腹血糖）、`postprandialGlucose`（餐后血糖）、`totalCholesterol`（总胆固醇）、`triglyceride`（甘油三酯）、`ldl`、`hdl`、`heartRate`（心率）、`bloodOxygen`（血氧 %）、`weight`（体重）、`remark`（备注）。除 `date` 外指标均可为空（允许一次只测部分项目）。

### 4.1 分页查询记录

`GET /api/health/records`（登录）

Query 参数：`currentPage`（默认 1）、`pageSize`（默认 10）、`startDate`、`endDate`（`yyyy-MM-dd`，可选）。

返回 `data`：`{ list: Record[], total, pageSize, currentPage }`，按 `record_date DESC, id DESC` 排序。

### 4.2 全量导出记录

`GET /api/health/records/export`（登录）

Query 支持 `startDate`、`endDate`。不分页、不截断，返回 `data: Record[]`，前端用 xlsx 在浏览器生成 Excel。

### 4.3 新增记录

`POST /api/health/records`（登录）

请求体为记录对象，`date` 必填，指标项可空；非数字字段返回 400 `40001`。返回新建记录（含 `id`）。

### 4.4 批量导入（Excel 解析后提交）

`POST /api/health/records/import`（**admin**）

请求体：`{ "list": [ {记录对象}, ... ] }`（前端用 xlsx 解析 Excel、逐行初检后提交）。

- 服务端对每一行做**二次校验**（规则与前端同一份 `server/shared/health-import.ts`）；
- **任一行不合法则整批不落库**，返回 HTTP 200：

  ```json
  {
    "code": 0,
    "data": {
      "success": 0,
      "fail": 2,
      "total": 4,
      "errors": [{ "row": 3, "message": "日期必填且格式需为 yyyy-MM-dd" }]
    }
  }
  ```

- 全部合法才在一个事务内写入，返回 `{ success: n, fail: 0, total: n, errors: [] }`；
- 记录归属一律为当前登录管理员（请求体无法指定 `user_id`）；
- `list` 不是数组 → 400 `40001`。

### 4.5 修改记录

`PUT /api/health/records/:id`（登录）

只更新传入字段；记录不存在或不属于当前用户 → 404。

### 4.6 删除单条记录

`DELETE /api/health/records/:id`（登录）

校验归属后删除；不存在/不属于本人 → 404。

### 4.7 批量删除记录

`DELETE /api/health/records`（登录）

请求体：`{ "ids": string[] }`。

- 只删除当前用户的记录（混入他人 id 自动忽略，防越权）；
- 不存在/已删除的 id 静默跳过（**幂等**）；
- 返回 `{ "deleted": n }`（实际删除条数）；
- `ids` 非数组或过滤后为空 → 400 `40001`。

---

## 5. 实时风险分析

### 5.1 规则引擎实时分级

`POST /api/health/analyze`（登录）

请求体**可整体省略**，也支持两种写法：

- 直接传记录数组：`[ {记录}, ... ]`；
- 对象：`{ "records": HealthRecord[], "profile": HealthProfile | null }`。

省略时服务端读取当前用户库内最新档案与记录（档案/记录一改，结果立即反映）。无论是否传参，数据范围都限定在当前用户，无法越权。

返回 `data`（`analyzeHealth` 结果）包含：

- `score`：0–100 综合风险评分；
- `level`：风险等级（低 / 中 / 高 / 极高）；
- 各指标分级（BMI、收缩压、舒张压、空腹血糖、总胆固醇、甘油三酯、LDL、HDL 等，HDL 阈值按性别区分）；
- `risks`：风险点列表；
- `suggestions`：分项健康建议；
- `medicalAdvice`：就医提醒（如「连续 3 次血压 ≥140/90」）。

> 规则引擎唯一源码：`server/shared/health-engine.ts`，前端经 `@shared` 别名只引用分级函数，不存在第二份实现。

---

## 6. 健康风险报告

### 6.1 生成报告

`POST /api/health/report/generate`（登录）

请求体（可空）：`{ "startDate": "yyyy-MM-dd", "endDate": "yyyy-MM-dd" }`，按时间段过滤记录。

服务端调用规则引擎，生成总体评价、分项分析、风险点、建议、就医提醒，以及雷达图（`radar`）与趋势图（`trend`）数据，落库后返回完整报告。每个用户**最多保留 20 份**，超出自动删除最旧。

### 6.2 报告历史列表

`GET /api/health/report/history`（登录）

返回摘要数组（按生成时间倒序）：`{ id, generateTime, period, score, level }[]`。

> 该路由注册在 `/:id` 之前，避免被动态段抢占。

### 6.3 查看报告详情

`GET /api/health/report/:id`（登录）

返回完整报告；不存在或非本人报告 → 404。

---

## 7. AI 健康对话

双通道：**方案 A 规则引擎**（断网可演示，默认）与**方案 B 真实大模型**（服务端持有 Key，火山方舟豆包），前端用同一套请求/响应结构。

### 7.1 大模型可用性

`GET /api/health/chat/config`（登录）→ `{ "llmAvailable": true | false }`。

Key 只存在于服务端 `server/.env` 的 `LLM_API_KEY`，该接口只回答「能不能用」，永不下发 Key。

### 7.2 获取对话历史

`GET /api/health/chat/history`（登录）

返回最近最多 50 条、按时间正序：`{ role: "user" | "ai", text }[]`，供刷新/换设备后恢复会话（服务端持久化在 `chat_history` 表）。

### 7.3 清空对话历史

`DELETE /api/health/chat/history`（登录）

清空当前用户全部对话记录，**幂等**（无历史也返回成功）。

### 7.4 发送对话

`POST /api/health/chat`（登录）

请求体兼容两种格式：

- deep-chat 组件格式：`{ "messages": [ { "role": "user", "content": "我最近血压怎么样" } ], "mode": "rules" }`；
- 简化格式：`{ "question": "我最近血压怎么样", "mode": "llm" }`。

`mode`：`rules`（默认，规则引擎基于本人档案/最近记录/报告摘要作答）或 `llm`（服务端代调大模型，仅取最近 10 条上下文）。

返回：`{ "code": 0, "data": "回答文本" }`。本次提问与回答成对写入 `chat_history`。提问为空时返回引导语。

---

## 8. 演示数据（管理员）

### 8.1 一键生成演示数据

`POST /api/health/seed`（**admin**，普通用户 403）

- 生成 **90 天**演示记录：前 78 天基本正常、最近 12 天含血压/空腹血糖/LDL 等异常项，便于演示「近期恶化」趋势与高价值风险解读；
- 会**先清空该用户已有记录**再整批写入（整批替换语义，事务保证）；
- 仅当该用户尚无档案时写入一份演示档案，**不覆盖**用户已填真实档案；
- 返回 `{ "total": 90, "profileCreated": true | false }`，幂等可重复执行。

---

## 9. 用户管理（管理员）

> 除头像上传外，下列接口均要求 **admin**；普通用户调用返回 403。

| 方法 & 路径            | 说明                                                                                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/user`        | 分页用户列表。Query：`currentPage`、`pageSize`（≤100）、`username`（模糊）、`phone`（模糊）、`status`、`deptId`。返回 `{ list, total, ... }`                                        |
| `POST /api/user`       | 新建用户。Body：`username`（必填、唯一）、`password`（必填，≥6 位，bcrypt 存储）、`nickname`、`phone`、`email`、`sex`、`status`、`deptId`、`remark`、`roleIds[]`（不传默认 common） |
| `PUT /api/user/:id`    | 更新用户（也兼容 `PUT /api/user` + body 带 `id`）。只更新传入字段；传 `password` 则改密（≥6 位）；`username` 唯一校验                                                               |
| `DELETE /api/user/:id` | 删除用户（兼容 `DELETE /api/user` + body/query 带 `id`）。禁止删除当前登录人；至少保留一名管理员                                                                                    |
| `GET                   | POST /api/list-all-role`                                                                                                                                                            | 角色可选项列表                                                  |
| `GET                   | POST /api/list-role-ids`                                                                                                                                                            | 查询某用户的角色 id，参数 `userId`；用户不存在返回 `code:10001` |
| `GET                   | POST /api/dept`                                                                                                                                                                     | 部门列表（用户表单下拉用）                                      |

### 9.1 头像上传

`POST /api/upload`（登录；`multipart/form-data`，字段名 `file`）

- 限制：图片 ≤ **2MB**，类型只认文件内容魔数，支持 **png / jpg / gif / webp**（不信任客户端扩展名/MIME）；
- 超限 → 400「图片不能超过 2MB」；类型不符 → 400「仅支持 png / jpg / gif / webp 图片」；
- 管理员可带 `userId` 给指定用户换头像，普通用户只能改自己（否则 403）；
- 成功返回 `{ code: 0, data: { url: "/uploads/<时间戳-随机>.<ext>" } }`，并写回该用户 `avatar` 字段；文件通过 `/uploads/**` 静态访问。

---

## 10. 角色-菜单权限矩阵

| 菜单 / 能力                                  | admin |        common         |
| -------------------------------------------- | :---: | :-------------------: |
| 健康总览（首页）                             |  ✅   |          ✅           |
| 我的健康（档案）                             |  ✅   |          ✅           |
| 指标管理（录入 / 历史 / 批量删除 / 导出）    |  ✅   |          ✅           |
| 趋势分析                                     |  ✅   |          ✅           |
| AI 健康报告（生成 / 历史 / 打印 / 导出明细） |  ✅   |          ✅           |
| AI 健康助手（规则引擎 / 大模型 / 清空对话）  |  ✅   |          ✅           |
| 数据导入（Excel 批量导入、一键演示数据）     |  ✅   | ❌（403，菜单不可见） |
| 用户管理（增删改查、角色、部门、头像）       |  ✅   | ❌（403，菜单不可见） |

---

## 11. 内置演示账号

| 账号   | 密码      | 角色     |
| ------ | --------- | -------- |
| admin  | admin123  | 管理员   |
| common | common123 | 普通用户 |

> 生产环境（`NODE_ENV=production`）启动时若 `JWT_SECRET` 为占位值或长度不足 32 位，服务会**直接拒绝启动**；开发模式仅告警不阻断。
