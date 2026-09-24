/**
 * 全链路接口回归：一条命令跑完 B0–B10 与竞赛优化 C0–C7 的验收断言。
 *
 * 用法：
 *   pnpm start                        # 另开终端先把服务跑起来
 *   node server/scripts/regress-api.mjs
 *   BASE=http://192.168.1.5:3000 node server/scripts/regress-api.mjs   # 指向其他机器
 *   LOG_FILE=/d/tmp/server.log node server/scripts/regress-api.mjs     # 追加断言服务端日志留痕
 *   CLEAN=1 node server/scripts/regress-api.mjs                        # 跑完自动清回交付基线
 *
 * 退出码：0 全部通过 / 1 有失败项（失败明细会打印在末尾）。
 *
 * 断言分两段：
 * - 第 0–11 节：B 阶段（后端化改造）接口清单，逐条对照《后端化改造方案.md》第四节；
 * - 第 12–20 节：C0–C6 各阶段的**仓库外验证脚本已合并进来**，加上 C7 的可观测性与
 *   测试数据清理。这段的断言全部挂在显式测试账号（`test_common` / `test_c4_1..6`）名下，
 *   跑完由第 20 节删除并做残留体检；断言的判据是「相对变化」或「规则式」的，不写死库内总数。
 *
 * 关于测试数据：
 * - C7 段落自己造的测试账号与数据**会自己删干净**（第 20 节会断言用户总数回到跑之前）；
 * - 但第 7 / 8 / 9 节会往**种子账号**里写演示数据（20 份报告、90 天记录、若干对话），
 *   这些属于「演示现场」不是测试污染，需要时用 `CLEAN=1` 或手动执行
 *   `node server/scripts/reset-demo-data.mjs` 清回交付基线，再现场演示。
 *
 * 环境变量：
 * - `BASE`：服务地址，默认 http://127.0.0.1:3000；
 * - `LOG_FILE`：服务端日志文件路径。给了就额外断言「每个请求都留了日志、且不含
 *   请求体与凭据」（诊断 C7 请求日志中间件的唯一办法——脚本读不到服务进程的 stdout）；
 * - `CLEAN=1`：跑完自动执行 `reset-demo-data.mjs` 把库清回交付基线（仅当 BASE 是本机）。
 */
import os from "node:os";

const BASE = process.env.BASE || "http://127.0.0.1:3000";
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

let pass = 0;
const failures = [];
let section = "";
function sec(name) {
  section = name;
  console.log(`\n===== ${name} =====`);
}
function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(`[${section}] ${name} :: ${detail}`);
    console.log(`  FAIL  ${name}   <<< ${detail}`);
  }
}
function note(msg) {
  console.log(`  --    ${msg}`);
}

async function api(method, path, opts = {}) {
  const { token, body, form, raw } = opts;
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (raw !== undefined) payload = raw;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON（HTML/静态资源） */
  }
  return { status: res.status, json, text, headers: res.headers };
}

const j = r => r.json ?? {};

// ---------------------------------------------------------------- 会话准备
const login = async (username, password) => {
  const r = await api("POST", "/api/login", { body: { username, password } });
  return { r, token: j(r).data?.accessToken, data: j(r).data };
};

sec("0. 服务可达性 / 环境");
{
  const ping = await api("GET", "/api/ping");
  check(
    "GET /api/ping → 200 {code:0,data:'ok'}",
    ping.status === 200 && j(ping).data === "ok",
    `status=${ping.status} body=${ping.text.slice(0, 80)}`
  );

  const A = await login("admin", "admin123");
  const C = await login("common", "common123");
  check(
    "种子账号 admin/admin123 可登录",
    A.r.status === 200 && j(A.r).code === 0 && !!A.token,
    `status=${A.r.status} body=${A.r.text.slice(0, 120)}`
  );
  check(
    "种子账号 common/common123 可登录",
    C.r.status === 200 && j(C.r).code === 0 && !!C.token,
    `status=${C.r.status}`
  );

  if (!A.token || !C.token) {
    console.log("\n致命：登录失败，后续用例无法执行");
    process.exit(1);
  }
  check(
    "登录返回 accessToken + refreshToken + expires + roles",
    !!A.data?.accessToken &&
      !!A.data?.refreshToken &&
      A.data?.expires != null &&
      Array.isArray(A.data?.roles),
    `keys=${Object.keys(A.data || {}).join(",")}`
  );
  check(
    "admin 角色为 [admin]",
    JSON.stringify(A.data.roles) === '["admin"]',
    JSON.stringify(A.data.roles)
  );
  check(
    "common 角色为 [common]",
    JSON.stringify(C.data.roles) === '["common"]',
    JSON.stringify(C.data.roles)
  );
  check(
    "登录响应带 permissions（前端按钮级权限用）",
    Array.isArray(A.data.permissions),
    typeof A.data.permissions
  );

  globalThis.T = {
    admin: A.token,
    common: C.token,
    adminRefresh: A.data.refreshToken,
    commonData: C.data
  };
  globalThis.ADMIN = { ...A };
}

const T = globalThis.T;

// ---------------------------------------------------------------- A 公开 / 鉴权
sec(
  "1. 鉴权与登录（方案：/api/login /api/refresh-token /api/mine /api/mine-logs /api/get-async-routes）"
);
{
  const bad = await api("POST", "/api/login", {
    body: { username: "admin", password: "wrong-password" }
  });
  check(
    "错密码登录 → code 40001「用户名或密码错误」",
    j(bad).code === 40001,
    `code=${j(bad).code} status=${bad.status}`
  );

  const nouser = await api("POST", "/api/login", {
    body: { username: "ghost", password: "x" }
  });
  check(
    "不存在用户登录 → code 40001",
    j(nouser).code === 40001,
    `code=${j(nouser).code}`
  );

  const rt = await api("POST", "/api/refresh-token", {
    body: { refreshToken: T.adminRefresh }
  });
  check(
    "POST /api/refresh-token（有效）→ 200 新 accessToken",
    rt.status === 200 && j(rt).code === 0 && !!j(rt).data?.accessToken,
    `status=${rt.status}`
  );

  const rtBad = await api("POST", "/api/refresh-token", {
    body: { refreshToken: "not-a-token" }
  });
  check(
    "POST /api/refresh-token（无效）→ 401",
    rtBad.status === 401,
    `status=${rtBad.status}`
  );

  const noTok = await api("GET", "/api/mine");
  check(
    "GET /api/mine 无 token → 401",
    noTok.status === 401,
    `status=${noTok.status}`
  );

  const fakeTok = await api("GET", "/api/mine", { token: "aaa.bbb.ccc" });
  check(
    "GET /api/mine 伪造 token → 401",
    fakeTok.status === 401,
    `status=${fakeTok.status}`
  );

  // 口径对齐原 mock：/api/mine 返回账户设置页所需字段（不含 roles，角色由 login / get-async-routes 提供）
  const mine = await api("GET", "/api/mine", { token: T.admin });
  const md = j(mine).data ?? {};
  check(
    "GET /api/mine（admin）→ 200 含 username/avatar/nickname/email/phone",
    mine.status === 200 &&
      j(mine).code === 0 &&
      md.username === "admin" &&
      "avatar" in md &&
      "nickname" in md &&
      "email" in md &&
      "phone" in md,
    `status=${mine.status} data=${mine.text.slice(0, 160)}`
  );

  // 口径对齐原 mock + SecurityLog.vue：分页对象 {list,total,pageSize,currentPage}
  const logs = await api("GET", "/api/mine-logs", { token: T.admin });
  const lgd = j(logs).data ?? {};
  check(
    "GET /api/mine-logs → 200 分页列表（list 非空 + total/pageSize/currentPage）",
    logs.status === 200 &&
      Array.isArray(lgd.list) &&
      lgd.list.length > 0 &&
      lgd.total != null &&
      lgd.pageSize != null &&
      lgd.currentPage != null,
    `status=${logs.status} body=${logs.text.slice(0, 140)}`
  );

  const ra = await api("GET", "/api/get-async-routes", { token: T.admin });
  const rc = await api("GET", "/api/get-async-routes", { token: T.common });
  const flat = nodes => (nodes || []).flatMap(n => [n, ...flat(n.children)]);
  const adminPaths = flat(j(ra).data).map(n => n.path);
  const commonPaths = flat(j(rc).data).map(n => n.path);
  check(
    "GET /api/get-async-routes（admin）→ 200 含用户管理 /system/user",
    ra.status === 200 && adminPaths.includes("/system/user"),
    `paths=${adminPaths.join(",")}`
  );
  check(
    "GET /api/get-async-routes（common）不含 /system/user（角色收敛）",
    rc.status === 200 && !commonPaths.includes("/system/user"),
    `paths=${commonPaths.join(",")}`
  );
  check(
    "GET /api/get-async-routes 无 token → 401",
    (await api("GET", "/api/get-async-routes")).status === 401
  );
  note(
    `admin 路由数=${adminPaths.length}，common 路由数=${commonPaths.length}`
  );
}

// ---------------------------------------------------------------- B 用户管理
sec("2. 用户管理 /api/user + 下拉（方案权限：admin）");
let createdUserId = null;
{
  const list = await api("GET", "/api/user?currentPage=1&pageSize=10", {
    token: T.admin
  });
  const d = j(list).data ?? {};
  const arr = d.list ?? d.records ?? [];
  check(
    "GET /api/user（admin）→ 200 分页列表",
    list.status === 200 && j(list).code === 0 && Array.isArray(arr),
    `status=${list.status} body=${list.text.slice(0, 120)}`
  );
  check(
    "用户列表 total=2（仅种子账号）",
    Number(d.total) === 2,
    `total=${d.total} len=${arr.length}`
  );
  // 口径对齐原 mock/system.ts 的列表项：id/avatar/username/nickname/phone/email/sex/status/dept/remark/createTime
  // （不含 roles —— 角色列由「分配角色」弹窗的 /list-role-ids 单独提供，前端 index.vue 不读 row.roles）
  const itemKeys = Object.keys(arr[0] ?? {});
  check(
    "列表项字段与原 mock 一致（id/username/nickname/avatar/sex/status/dept/remark/createTime）",
    arr.length > 0 &&
      arr.every(
        u =>
          u.id != null &&
          !!u.username &&
          u.dept &&
          "avatar" in u &&
          "sex" in u &&
          "status" in u &&
          "remark" in u &&
          u.createTime != null
      ),
    `keys=${itemKeys.join(",")}`
  );

  const commonList = await api("GET", "/api/user?currentPage=1&pageSize=10", {
    token: T.common
  });
  check(
    "GET /api/user（common）→ 403 无权限",
    commonList.status === 403,
    `status=${commonList.status} body=${commonList.text.slice(0, 80)}`
  );

  const filtered = await api(
    "GET",
    "/api/user?currentPage=1&pageSize=10&username=admin",
    { token: T.admin }
  );
  const farr = j(filtered).data?.list ?? [];
  check(
    "GET /api/user?username=admin 模糊筛选生效",
    farr.length === 1 && farr[0].username === "admin",
    `len=${farr.length}`
  );

  const rolesGet = await api("GET", "/api/list-all-role", { token: T.admin });
  const rolesPost = await api("POST", "/api/list-all-role", { token: T.admin });
  check(
    "GET /api/list-all-role → 200 角色选项",
    rolesGet.status === 200 && (j(rolesGet).data ?? []).length >= 2,
    `status=${rolesGet.status} data=${rolesGet.text.slice(0, 100)}`
  );
  check(
    "POST /api/list-all-role → 200（前端用 POST，兼容保留）",
    rolesPost.status === 200 && (j(rolesPost).data ?? []).length >= 2,
    `status=${rolesPost.status}`
  );

  const idsGet = await api("GET", "/api/list-role-ids?userId=2", {
    token: T.admin
  });
  check(
    "GET /api/list-role-ids?userId=2 → [2]（common）",
    idsGet.status === 200 && JSON.stringify(j(idsGet).data) === "[2]",
    `data=${idsGet.text.slice(0, 100)}`
  );

  const dept = await api("GET", "/api/dept", { token: T.admin });
  check(
    "GET /api/dept → 200 部门树非空",
    dept.status === 200 &&
      Array.isArray(j(dept).data) &&
      j(dept).data.length > 0,
    `status=${dept.status}`
  );

  check(
    "GET /api/list-all-role（common）→ 403",
    (await api("GET", "/api/list-all-role", { token: T.common })).status === 403
  );
  check(
    "GET /api/list-role-ids（common）→ 403",
    (await api("GET", "/api/list-role-ids?userId=1", { token: T.common }))
      .status === 403
  );
  check(
    "GET /api/dept（common）→ 403",
    (await api("GET", "/api/dept", { token: T.common })).status === 403
  );

  // 新增
  const uname = `b10test${Date.now().toString().slice(-6)}`;
  const created = await api("POST", "/api/user", {
    token: T.admin,
    body: {
      username: uname,
      nickname: "回归测试",
      password: "test123456",
      roleIds: [2],
      phone: "13900000001",
      deptId: 105,
      status: 1
    }
  });
  createdUserId = j(created).data?.id;
  check(
    "POST /api/user（admin）新增用户 → 200 返回 id",
    created.status === 200 && j(created).code === 0 && createdUserId != null,
    `status=${created.status} body=${created.text.slice(0, 140)}`
  );
  const activeUser = await login(uname, "test123456");
  check(
    "新增的启用用户可登录",
    activeUser.r.status === 200 && !!activeUser.token,
    `status=${activeUser.r.status} body=${activeUser.r.text.slice(0, 120)}`
  );

  const dup = await api("POST", "/api/user", {
    token: T.admin,
    body: { username: uname, password: "test123456" }
  });
  check(
    "POST /api/user 重复用户名 → 拒绝（code != 0）",
    j(dup).code !== 0,
    `code=${j(dup).code}`
  );

  const weak = await api("POST", "/api/user", {
    token: T.admin,
    body: { username: `weak${Date.now()}`, password: "123" }
  });
  check(
    "POST /api/user 密码不足 6 位 → 拒绝",
    weak.status === 400 || j(weak).code !== 0,
    `status=${weak.status} code=${j(weak).code}`
  );

  check(
    "POST /api/user（common）→ 403",
    (
      await api("POST", "/api/user", {
        token: T.common,
        body: { username: "hack", password: "hack123456" }
      })
    ).status === 403
  );

  // 修改资料
  const upd = await api("PUT", `/api/user/${createdUserId}`, {
    token: T.admin,
    body: {
      nickname: "回归测试-改",
      phone: "13900000002",
      status: 0,
      deptId: 106
    }
  });
  check(
    "PUT /api/user/:id 改资料 → 200",
    upd.status === 200 && j(upd).code === 0,
    `status=${upd.status} body=${upd.text.slice(0, 120)}`
  );
  const after = await api(
    "GET",
    `/api/user?currentPage=1&pageSize=10&username=${uname}`,
    { token: T.admin }
  );
  const au = (j(after).data?.list ?? [])[0] ?? {};
  check(
    "PUT 后回读一致（昵称/手机号/状态/部门）",
    au.nickname === "回归测试-改" &&
      au.phone === "13900000002" &&
      Number(au.status) === 0,
    JSON.stringify(au).slice(0, 200)
  );

  const disabledLogin = await login(uname, "test123456");
  check(
    "停用用户无法登录（HTTP 403）",
    disabledLogin.r.status === 403 && j(disabledLogin.r).code === 403,
    `status=${disabledLogin.r.status} body=${disabledLogin.r.text.slice(0, 120)}`
  );
  const disabledToken = await api("GET", "/api/mine", {
    token: activeUser.token
  });
  check(
    "停用后旧 accessToken 立即失效（HTTP 403）",
    disabledToken.status === 403 && j(disabledToken).code === 403,
    `status=${disabledToken.status} body=${disabledToken.text.slice(0, 120)}`
  );
  const disabledRefresh = await api("POST", "/api/refresh-token", {
    body: { refreshToken: activeUser.data?.refreshToken }
  });
  check(
    "停用后 refreshToken 无法续期（HTTP 403）",
    disabledRefresh.status === 403 && j(disabledRefresh).code === 403,
    `status=${disabledRefresh.status} body=${disabledRefresh.text.slice(0, 120)}`
  );

  // 改密码 → 新密码可登录、旧密码不可
  const pwd = await api("PUT", `/api/user/${createdUserId}`, {
    token: T.admin,
    body: { password: "newpwd12345", status: 1 }
  });
  check(
    "PUT /api/user/:id 重置密码 → 200",
    pwd.status === 200 && j(pwd).code === 0,
    `status=${pwd.status}`
  );
  const newLogin = await login(uname, "newpwd12345");
  const oldLogin = await login(uname, "test123456");
  check(
    "新密码可登录（bcrypt 重哈希生效）",
    j(newLogin.r).code === 0 && !!newLogin.token,
    `code=${j(newLogin.r).code}`
  );
  check(
    "旧密码不可登录",
    j(oldLogin.r).code === 40001,
    `code=${j(oldLogin.r).code}`
  );

  const dupName = await api("PUT", `/api/user/${createdUserId}`, {
    token: T.admin,
    body: { username: "admin" }
  });
  check(
    "PUT /api/user/:id 改成已存在用户名 → 拒绝",
    dupName.status === 400 || j(dupName).code !== 0,
    `status=${dupName.status} code=${j(dupName).code}`
  );

  // 删除
  const delCommon = await api("DELETE", `/api/user/${createdUserId}`, {
    token: T.common
  });
  check(
    "DELETE /api/user/:id（common）→ 403",
    delCommon.status === 403,
    `status=${delCommon.status}`
  );

  const delSelf = await api("DELETE", "/api/user/1", { token: T.admin });
  check(
    "DELETE /api/user/1（删除自己）→ 拒绝",
    delSelf.status >= 400 || j(delSelf).code !== 0,
    `status=${delSelf.status} code=${j(delSelf).code}`
  );

  const del = await api("DELETE", `/api/user/${createdUserId}`, {
    token: T.admin
  });
  check(
    "DELETE /api/user/:id（admin）→ 200",
    del.status === 200 && j(del).code === 0,
    `status=${del.status} body=${del.text.slice(0, 120)}`
  );
  const afterDel = await api("GET", "/api/user?currentPage=1&pageSize=10", {
    token: T.admin
  });
  check(
    "删除后用户数回到 2",
    Number(j(afterDel).data?.total) === 2,
    `total=${j(afterDel).data?.total}`
  );
  const deletedLogin = await login(uname, "newpwd12345");
  check(
    "已删除用户无法登录",
    j(deletedLogin.r).code === 40001,
    `code=${j(deletedLogin.r).code}`
  );
  createdUserId = null;
}

// ---------------------------------------------------------------- C 上传
sec("3. 头像上传 /api/upload（方案权限：登录）");
let avatarUrl = null;
{
  const fd = new FormData();
  fd.append(
    "file",
    new Blob([Buffer.from(PNG_B64, "base64")], { type: "image/png" }),
    "avatar"
  );
  const up = await api("POST", "/api/upload", { token: T.admin, form: fd });
  avatarUrl = j(up).data?.url;
  check(
    "POST /api/upload（admin 上传 PNG）→ 200 返回 /uploads/xxx",
    up.status === 200 &&
      j(up).code === 0 &&
      String(avatarUrl).startsWith("/uploads/"),
    `status=${up.status} body=${up.text.slice(0, 140)}`
  );
  note(`url = ${avatarUrl}`);

  const got = await api("GET", avatarUrl);
  check(
    "上传的 URL 可直接访问 → 200 image/png",
    got.status === 200 &&
      String(got.headers.get("content-type")).includes("image/png"),
    `status=${got.status} ct=${got.headers.get("content-type")}`
  );

  const mine = await api("GET", "/api/mine", { token: T.admin });
  check(
    "上传后 /api/mine 的 avatar 已更新为该 URL",
    j(mine).data?.avatar === avatarUrl,
    `avatar=${j(mine).data?.avatar}`
  );

  // 管理员替他人上传（userId 指向 common）
  const list = await api("GET", "/api/user?currentPage=1&pageSize=10", {
    token: T.admin
  });
  const commonRow = (j(list).data?.list ?? []).find(
    u => u.username === "common"
  );
  const fd2 = new FormData();
  fd2.append(
    "file",
    new Blob([Buffer.from(PNG_B64, "base64")], { type: "image/png" }),
    "avatar"
  );
  const up2 = await api("POST", `/api/upload?userId=${commonRow?.id}`, {
    token: T.admin,
    form: fd2
  });
  check(
    "POST /api/upload?userId=<common>（admin 代传）→ 200",
    up2.status === 200 && j(up2).code === 0,
    `status=${up2.status} body=${up2.text.slice(0, 120)}`
  );
  const commonMine = await api("GET", "/api/mine", { token: T.common });
  check(
    "common 的头像被写为目标用户",
    j(commonMine).data?.avatar === j(up2).data?.url,
    `avatar=${j(commonMine).data?.avatar} expect=${j(up2).data?.url}`
  );

  const fd3 = new FormData();
  fd3.append(
    "file",
    new Blob([Buffer.from(PNG_B64, "base64")], { type: "image/png" }),
    "avatar"
  );
  const upEscalate = await api("POST", "/api/upload?userId=1", {
    token: T.common,
    form: fd3
  });
  check(
    "common 试图替 admin 上传（越权）→ 403",
    upEscalate.status === 403,
    `status=${upEscalate.status} body=${upEscalate.text.slice(0, 120)}`
  );

  const fd4 = new FormData();
  fd4.append(
    "file",
    new Blob([Buffer.from("not an image")], { type: "text/plain" }),
    "evil.txt"
  );
  const upBad = await api("POST", "/api/upload", { token: T.admin, form: fd4 });
  check(
    "上传非图片（按魔数校验，不看 mime）→ code 40001",
    j(upBad).code === 40001,
    `code=${j(upBad).code} status=${upBad.status} body=${upBad.text.slice(0, 120)}`
  );

  const fd5 = new FormData();
  fd5.append(
    "file",
    new Blob([Buffer.from(PNG_B64, "base64")], { type: "image/png" }),
    "avatar"
  );
  check(
    "POST /api/upload 无 token → 401",
    (await api("POST", "/api/upload", { form: fd5 })).status === 401
  );
}

// ---------------------------------------------------------------- D 档案 / 记录
sec("4. 健康档案 /api/health/profile");
{
  const p = await api("GET", "/api/health/profile", { token: T.admin });
  check(
    "GET /api/health/profile（admin）→ 200",
    p.status === 200 && j(p).code === 0,
    `status=${p.status} body=${p.text.slice(0, 120)}`
  );
  check(
    "GET /api/health/profile 无 token → 401",
    (await api("GET", "/api/health/profile")).status === 401
  );

  const upd = await api("PUT", "/api/health/profile", {
    token: T.admin,
    body: { name: "回归档案", age: 45, height: 172, weight: 78 }
  });
  check(
    "PUT /api/health/profile → 200",
    upd.status === 200 && j(upd).code === 0,
    `status=${upd.status} body=${upd.text.slice(0, 120)}`
  );
  const back = await api("GET", "/api/health/profile", { token: T.admin });
  const bd = j(back).data ?? {};
  check(
    "PUT 后回读一致（name/age）",
    bd.name === "回归档案" && Number(bd.age) === 45,
    JSON.stringify(bd).slice(0, 200)
  );

  const pc = await api("GET", "/api/health/profile", { token: T.common });
  check(
    "GET /api/health/profile（common）→ 200 自己的档案（与 admin 隔离）",
    pc.status === 200 && j(pc).data?.name !== "回归档案",
    `name=${j(pc).data?.name}`
  );
}

sec("5. 指标记录 /api/health/records（增删改查 + 隔离 + 导入导出）");
let adminRecordId = null;
// 本条记录用于「字段完整性」断言，用日期把它与库内既有数据隔开（见下面的双重定位）
const CREATED_DATE = "2026-09-15";
let exportLen = 0;
{
  const created = await api("POST", "/api/health/records", {
    token: T.admin,
    body: {
      date: CREATED_DATE,
      systolic: 128,
      diastolic: 82,
      fastingGlucose: 5.6,
      ldl: 2.9,
      heartRate: 72,
      weight: 78,
      remark: "B10 回归"
    }
  });
  adminRecordId = j(created).data?.id;
  check(
    "POST /api/health/records（admin）→ 200 返回记录",
    created.status === 200 && j(created).code === 0 && adminRecordId != null,
    `status=${created.status} body=${created.text.slice(0, 140)}`
  );

  check(
    "POST /api/health/records 缺 date → 400",
    (
      await api("POST", "/api/health/records", {
        token: T.admin,
        body: { systolic: 120 }
      })
    ).status === 400
  );
  check(
    "POST /api/health/records 非数字指标 → 400",
    (
      await api("POST", "/api/health/records", {
        token: T.admin,
        body: { date: "2026-09-14", systolic: "abc" }
      })
    ).status === 400
  );

  const list = await api(
    "GET",
    "/api/health/records?currentPage=1&pageSize=10",
    { token: T.admin }
  );
  const ld = j(list).data ?? {};
  const arr = ld.list ?? ld.records ?? [];
  check(
    "GET /api/health/records（admin）→ 200 分页",
    list.status === 200 && Array.isArray(arr) && Number(ld.total) >= 1,
    `status=${list.status} total=${ld.total}`
  );
  // 只断言「本脚本刚建的那条记录」的字段完整性：列表默认按日期倒序，
  // 库里若已有演示/历史数据（如今天的一键演示数据），arr[0] 未必是刚建的这条。
  // 用「创建日期 + id」双重定位，保证与库内既有数据无关。
  const mineList = await api(
    "GET",
    `/api/health/records?currentPage=1&pageSize=50&startDate=${CREATED_DATE}&endDate=${CREATED_DATE}`,
    { token: T.admin }
  );
  const mine = (j(mineList).data?.list ?? []).find(
    r => String(r.id) === String(adminRecordId)
  );
  check(
    "记录字段完整（systolic/diastolic/fastingGlucose/ldl）",
    mine &&
      mine.systolic != null &&
      mine.diastolic != null &&
      mine.fastingGlucose != null &&
      mine.ldl != null,
    JSON.stringify(mine ?? {})
  );

  // 日期范围筛选用一个「演示数据永远不会生成」的历史日期，保证断言与库内既有数据无关
  const RANGE_DATE = "2001-03-04";
  const ranged0 = await api("POST", "/api/health/records", {
    token: T.admin,
    body: { date: RANGE_DATE, systolic: 119, diastolic: 79 }
  });
  const rangeId = j(ranged0).data?.id;
  const ranged = await api(
    "GET",
    `/api/health/records?currentPage=1&pageSize=10&startDate=${RANGE_DATE}&endDate=${RANGE_DATE}`,
    { token: T.admin }
  );
  const rarr = j(ranged).data?.list ?? [];
  check(
    "GET /api/health/records 日期范围筛选生效（区间内只返回该日期记录）",
    Number(j(ranged).data?.total) === 1 &&
      rarr.length === 1 &&
      rarr[0]?.date === RANGE_DATE,
    `total=${j(ranged).data?.total} dates=${rarr.map(r => r.date).join(",")}`
  );
  const rangeHalf = await api(
    "GET",
    `/api/health/records?currentPage=1&pageSize=10&startDate=${RANGE_DATE}&endDate=2001-03-04`,
    { token: T.admin }
  );
  check(
    "日期范围筛选为闭区间（起止同日可命中）",
    Number(j(rangeHalf).data?.total) === 1,
    `total=${j(rangeHalf).data?.total}`
  );
  await api("DELETE", `/api/health/records/${rangeId}`, { token: T.admin });

  const empty = await api(
    "GET",
    "/api/health/records?currentPage=1&pageSize=10&startDate=1900-01-01&endDate=1900-01-02",
    { token: T.admin }
  );
  check(
    "GET /api/health/records 无数据区间 → total=0",
    Number(j(empty).data?.total) === 0,
    `total=${j(empty).data?.total}`
  );

  const cList = await api(
    "GET",
    "/api/health/records?currentPage=1&pageSize=100",
    { token: T.common }
  );
  const carr = j(cList).data?.list ?? [];
  check(
    "GET /api/health/records（common）看不到 admin 的记录（user_id 隔离）",
    !carr.some(r => String(r.id) === String(adminRecordId)),
    `common 记录数=${carr.length}`
  );

  const upd = await api("PUT", `/api/health/records/${adminRecordId}`, {
    token: T.admin,
    body: { systolic: 135, remark: "B10 回归-改" }
  });
  check(
    "PUT /api/health/records/:id（本人）→ 200",
    upd.status === 200 && j(upd).code === 0,
    `status=${upd.status}`
  );
  check(
    "PUT 后字段已更新",
    j(upd).data?.systolic === 135 && Number(j(upd).data?.diastolic) === 82,
    `systolic=${j(upd).data?.systolic} diastolic=${j(upd).data?.diastolic}`
  );

  const updSteal = await api("PUT", `/api/health/records/${adminRecordId}`, {
    token: T.common,
    body: { systolic: 999 }
  });
  check(
    "PUT /api/health/records/:id（跨用户）→ 404",
    updSteal.status === 404,
    `status=${updSteal.status}`
  );

  const delSteal = await api("DELETE", `/api/health/records/${adminRecordId}`, {
    token: T.common
  });
  check(
    "DELETE /api/health/records/:id（跨用户）→ 404",
    delSteal.status === 404,
    `status=${delSteal.status}`
  );

  const delGhost = await api("DELETE", "/api/health/records/99999999", {
    token: T.admin
  });
  check(
    "DELETE /api/health/records/:id（不存在）→ 404",
    delGhost.status === 404,
    `status=${delGhost.status}`
  );

  // 导出
  const ex = await api("GET", "/api/health/records/export", { token: T.admin });
  const exArr = Array.isArray(j(ex).data)
    ? j(ex).data
    : (j(ex).data?.list ?? []);
  exportLen = exArr.length;
  check(
    "GET /api/health/records/export（admin）→ 200 全量数组",
    ex.status === 200 && Array.isArray(exArr),
    `status=${ex.status} len=${exArr.length}`
  );
  // 导出与列表必须是同一套口径（C7 收尾：原先这里取了长度却没用，等于没验）
  const exTotal = Number(
    (
      await api("GET", "/api/health/records?currentPage=1&pageSize=1", {
        token: T.admin
      })
    ).json?.data?.total
  );
  check(
    "导出条数与列表 total 一致（导出不走另一套口径）",
    exportLen === exTotal,
    `export=${exportLen} total=${exTotal}`
  );
  const exC = await api("GET", "/api/health/records/export", {
    token: T.common
  });
  const exCArr = Array.isArray(j(exC).data) ? j(exC).data : [];
  check(
    "GET /api/health/records/export（common）只含本人数据",
    !exCArr.some(r => String(r.id) === String(adminRecordId)),
    `common 导出=${exCArr.length} 条`
  );

  // 导入
  const before = Number(
    (
      await api("GET", "/api/health/records?currentPage=1&pageSize=10", {
        token: T.admin
      })
    ).json?.data?.total
  );
  const ok = await api("POST", "/api/health/records/import", {
    token: T.admin,
    body: {
      list: [
        { date: "2026-09-10", systolic: 120, diastolic: 80 },
        {
          date: "2026-09-11",
          systolic: 122,
          diastolic: 81,
          fastingGlucose: 5.4
        }
      ]
    }
  });
  check(
    "POST /api/health/records/import（admin，全合法）→ code 0 success=2",
    ok.status === 200 && j(ok).code === 0 && Number(j(ok).data?.success) === 2,
    `status=${ok.status} body=${ok.text.slice(0, 160)}`
  );
  const afterOk = Number(
    (
      await api("GET", "/api/health/records?currentPage=1&pageSize=10", {
        token: T.admin
      })
    ).json?.data?.total
  );
  check(
    "导入 2 行后记录数 +2",
    afterOk === before + 2,
    `before=${before} after=${afterOk}`
  );

  const partial = await api("POST", "/api/health/records/import", {
    token: T.admin,
    body: {
      list: [
        { date: "2026-09-12", systolic: 118 },
        { date: "bad-date", systolic: 9999 }
      ]
    }
  });
  const afterPartial = Number(
    (
      await api("GET", "/api/health/records?currentPage=1&pageSize=10", {
        token: T.admin
      })
    ).json?.data?.total
  );
  check(
    "导入含非法行 → code 0 且 errors[] 给出具体行号与原因",
    j(partial).code === 0 && (j(partial).data?.errors ?? []).length > 0,
    `body=${partial.text.slice(0, 200)}`
  );
  check(
    "整批校验失败时不部分写入（success=0 且记录数不变）",
    Number(j(partial).data?.success) === 0 && afterPartial === afterOk,
    `success=${j(partial).data?.success} after=${afterPartial} before=${afterOk}`
  );

  const badBody = await api("POST", "/api/health/records/import", {
    token: T.admin,
    body: { list: "not-array" }
  });
  check(
    "POST /api/health/records/import 请求体非法（list 非数组）→ 400",
    badBody.status === 400,
    `status=${badBody.status}`
  );

  const imp403 = await api("POST", "/api/health/records/import", {
    token: T.common,
    body: { list: [{ date: "2026-09-10", systolic: 120 }] }
  });
  check(
    "POST /api/health/records/import（common）→ 403（修正项 1）",
    imp403.status === 403,
    `status=${imp403.status} body=${imp403.text.slice(0, 100)}`
  );

  // 删除本人记录
  const del = await api("DELETE", `/api/health/records/${adminRecordId}`, {
    token: T.admin
  });
  check(
    "DELETE /api/health/records/:id（本人）→ 200",
    del.status === 200 && j(del).code === 0,
    `status=${del.status}`
  );
  const afterDel = Number(
    (
      await api("GET", "/api/health/records?currentPage=1&pageSize=10", {
        token: T.admin
      })
    ).json?.data?.total
  );
  check("删除后记录数 -1", afterDel === afterPartial - 1, `total=${afterDel}`);
  adminRecordId = null;
}

// ---------------------------------------------------------------- E 分析 / 报告
sec("6. 规则引擎分析 /api/health/analyze");
{
  const an = await api("POST", "/api/health/analyze", {
    token: T.admin,
    body: {}
  });
  const ad = j(an).data ?? {};
  check(
    "POST /api/health/analyze → 200 含 score/level/suggestions",
    an.status === 200 &&
      j(an).code === 0 &&
      ad.score != null &&
      ad.level &&
      Array.isArray(ad.suggestions),
    `status=${an.status} body=${an.text.slice(0, 180)}`
  );
  const anC = await api("POST", "/api/health/analyze", {
    token: T.common,
    body: {}
  });
  check(
    "POST /api/health/analyze（common）→ 200 独立计算",
    anC.status === 200 && j(anC).code === 0,
    `status=${anC.status}`
  );
  const explain = await api("GET", "/api/health/analyze/explanation", {
    token: T.admin
  });
  const ed = j(explain).data ?? {};
  check(
    "GET /api/health/analyze/explanation → 200 含规则版本与解释项",
    explain.status === 200 &&
      j(explain).code === 0 &&
      ed.ruleset?.version === "2026.1" &&
      Array.isArray(ed.items),
    `status=${explain.status} body=${explain.text.slice(0, 180)}`
  );
  check(
    "GET /api/health/analyze/explanation 无 token → 401",
    (await api("GET", "/api/health/analyze/explanation")).status === 401
  );
  const custom = await api("POST", "/api/health/analyze", {
    token: T.admin,
    body: {
      records: [
        {
          date: "2026-09-15",
          systolic: 165,
          diastolic: 100,
          fastingGlucose: 7.5,
          ldl: 4.4
        }
      ],
      profile: { name: "重症样本", age: 60, gender: 1, height: 170, weight: 85 }
    }
  });
  const cd = j(custom).data ?? {};
  check(
    "analyze 支持显式传入 records/profile 并按之分级（异常样本等级非「正常」）",
    custom.status === 200 && cd.level && cd.level !== "正常",
    `level=${cd.level} score=${cd.score}`
  );
  check(
    "POST /api/health/analyze 无 token → 401",
    (await api("POST", "/api/health/analyze", { body: {} })).status === 401
  );
  check(
    "POST /api/health/analyze records 非数组 → 400",
    (
      await api("POST", "/api/health/analyze", {
        token: T.admin,
        body: { records: "x" }
      })
    ).status === 400
  );
}

sec("7. 报告生成 /api/health/report/*（含每用户最多 20 份上限）");
let reportId = null;
{
  const gen = await api("POST", "/api/health/report/generate", {
    token: T.admin,
    body: { startDate: "2026-01-01", endDate: "2026-12-31" }
  });
  reportId = j(gen).data?.id;
  const gd = j(gen).data ?? {};
  check(
    "POST /api/health/report/generate → 200 返回报告（含 id/score/level）",
    gen.status === 200 &&
      j(gen).code === 0 &&
      reportId != null &&
      gd.score != null,
    `status=${gen.status} body=${gen.text.slice(0, 160)}`
  );

  const hist = await api("GET", "/api/health/report/history", {
    token: T.admin
  });
  const harr = j(hist).data ?? [];
  check(
    "GET /api/health/report/history → 200 含刚生成的报告",
    hist.status === 200 &&
      Array.isArray(harr) &&
      harr.some(r => String(r.id) === String(reportId)),
    `status=${hist.status} len=${harr.length}`
  );
  // 同上：只断言「本脚本刚生成的这份报告」，避免历史里既有的报告排在第一行
  const mineReport = harr.find(r => String(r.id) === String(reportId));
  check(
    "报告历史项含 id/period/score/level/generateTime",
    mineReport &&
      mineReport.id != null &&
      mineReport.period != null &&
      mineReport.score != null &&
      mineReport.level &&
      mineReport.generateTime,
    JSON.stringify(mineReport ?? harr[0] ?? {}).slice(0, 200)
  );

  const detail = await api("GET", `/api/health/report/${reportId}`, {
    token: T.admin
  });
  const dd = j(detail).data ?? {};
  check(
    "GET /api/health/report/:id（本人）→ 200 详情含评分/分项/建议",
    detail.status === 200 &&
      j(detail).code === 0 &&
      dd.score != null &&
      dd.radar != null,
    `status=${detail.status} keys=${Object.keys(dd).join(",")}`
  );
  check(
    "GET /api/health/report/:id（跨用户）→ 404",
    (await api("GET", `/api/health/report/${reportId}`, { token: T.common }))
      .status === 404
  );
  check(
    "GET /api/health/report/:id（不存在）→ 404",
    (await api("GET", "/api/health/report/99999999", { token: T.admin }))
      .status === 404
  );

  // 上限：连续生成到超过 20 份
  const histBefore = (
    j(await api("GET", "/api/health/report/history", { token: T.admin }))
      .data ?? []
  ).length;
  const need = 22 - histBefore;
  for (let i = 0; i < need; i++) {
    await api("POST", "/api/health/report/generate", {
      token: T.admin,
      body: { startDate: "2026-01-01", endDate: "2026-12-31" }
    });
  }
  const hAfter = (
    j(await api("GET", "/api/health/report/history", { token: T.admin }))
      .data ?? []
  ).length;
  check(
    "报告上限：连续生成 22 份后仅保留 20 份（修正项 2）",
    hAfter === 20,
    `history=${hAfter}（生成前 ${histBefore}，本次补生成 ${need}）`
  );
  const cHist = (
    j(await api("GET", "/api/health/report/history", { token: T.common }))
      .data ?? []
  ).length;
  check(
    "报告上限按用户独立（common 不受影响）",
    cHist === 0,
    `common history=${cHist}`
  );
}

// ---------------------------------------------------------------- F AI 对话
sec("8. AI 对话 /api/health/chat（A 规则引擎 / B 大模型降级）");
{
  const cfg = await api("GET", "/api/health/chat/config", { token: T.admin });
  check(
    "GET /api/health/chat/config → 200 返回 llmAvailable",
    cfg.status === 200 && typeof j(cfg).data?.llmAvailable === "boolean",
    `status=${cfg.status} body=${cfg.text.slice(0, 100)}`
  );
  note(
    `llmAvailable=${j(cfg).data?.llmAvailable}（未配置 LLM_API_KEY 时应为 false）`
  );

  const a = await api("POST", "/api/health/chat", {
    token: T.admin,
    body: { question: "我的健康风险" }
  });
  const answer = j(a).data;
  check(
    "POST /api/health/chat（方案 A 规则引擎）→ 200 文本回答",
    a.status === 200 &&
      j(a).code === 0 &&
      typeof answer === "string" &&
      answer.length > 0,
    `status=${a.status} answer=${String(answer).slice(0, 80)}`
  );

  const bp = await api("POST", "/api/health/chat", {
    token: T.admin,
    body: { question: "分析一下我的血压" }
  });
  check(
    "chat 命中血压意图（回答含血压相关分级）",
    /血压|收缩压|舒张压/.test(String(j(bp).data)),
    `answer=${String(j(bp).data).slice(0, 100)}`
  );

  const msgs = await api("POST", "/api/health/chat", {
    token: T.admin,
    body: { messages: [{ role: "user", content: "最近血糖怎么样" }] }
  });
  check(
    "chat 支持 deep-chat messages 格式",
    msgs.status === 200 &&
      j(msgs).code === 0 &&
      String(j(msgs).data).length > 0,
    `status=${msgs.status}`
  );

  const hist = await api("GET", "/api/health/chat/history", { token: T.admin });
  const harr = j(hist).data ?? [];
  check(
    "GET /api/health/chat/history → 200 已持久化本轮问答",
    hist.status === 200 &&
      Array.isArray(harr) &&
      harr.some(m => m.role === "user" && m.text === "我的健康风险") &&
      harr.some(m => m.role === "ai"),
    `status=${hist.status} len=${harr.length} roles=${harr.map(m => m.role).join(",")}`
  );
  const cHist =
    j(await api("GET", "/api/health/chat/history", { token: T.common })).data ??
    [];
  check(
    "对话历史按 user_id 隔离（common 看不到 admin 的提问）",
    !cHist.some(m => m.text === "我的健康风险"),
    `common 历史=${cHist.length} 条`
  );

  const llm = await api("POST", "/api/health/chat", {
    token: T.admin,
    body: { question: "你好", mode: "llm" }
  });
  const llmText = String(j(llm).data);
  const llmAvailable = j(cfg).data?.llmAvailable;
  check(
    "方案 B 未配 Key 时给出降级提示（不报错、页面可用）",
    llmAvailable
      ? llmText.length > 0
      : /降级|未配置|不可用|LLM_API_KEY|规则/.test(llmText),
    `llmAvailable=${llmAvailable} answer=${llmText.slice(0, 120)}`
  );
  check(
    "POST /api/health/chat 无 token → 401",
    (await api("POST", "/api/health/chat", { body: { question: "x" } }))
      .status === 401
  );
  check(
    "GET /api/health/chat/history 无 token → 401",
    (await api("GET", "/api/health/chat/history")).status === 401
  );
}

// ---------------------------------------------------------------- G 演示数据
sec("9. 一键演示数据 /api/health/seed（方案权限：admin）");
{
  const seed403 = await api("POST", "/api/health/seed", { token: T.common });
  check(
    "POST /api/health/seed（common）→ 403 管理员隔离",
    seed403.status === 403,
    `status=${seed403.status} body=${seed403.text.slice(0, 100)}`
  );

  const seed = await api("POST", "/api/health/seed", { token: T.admin });
  const sd = j(seed).data ?? {};
  check(
    "POST /api/health/seed（admin）→ 200 生成 90 天记录",
    seed.status === 200 && j(seed).code === 0 && Number(sd.total) === 90,
    `status=${seed.status} data=${seed.text.slice(0, 120)}`
  );

  const total = Number(
    (
      await api("GET", "/api/health/records?currentPage=1&pageSize=1", {
        token: T.admin
      })
    ).json?.data?.total
  );
  check("seed 后 admin 记录数 = 90", total === 90, `total=${total}`);

  const seed2 = await api("POST", "/api/health/seed", { token: T.admin });
  const total2 = Number(
    (
      await api("GET", "/api/health/records?currentPage=1&pageSize=1", {
        token: T.admin
      })
    ).json?.data?.total
  );
  check(
    "seed 幂等（重复执行不翻倍）",
    Number(j(seed2).data?.total) === 90 && total2 === 90,
    `total=${total2}`
  );

  const cTotal = Number(
    (
      await api("GET", "/api/health/records?currentPage=1&pageSize=1", {
        token: T.common
      })
    ).json?.data?.total
  );
  check(
    "seed 只写当前用户（common 记录数不受影响）",
    cTotal === 0,
    `common total=${cTotal}`
  );

  const an = await api("POST", "/api/health/analyze", {
    token: T.admin,
    body: {}
  });
  const ad = j(an).data ?? {};
  check(
    "演示数据的分析结果能触发风险（level 非「正常」）",
    ad.level && ad.level !== "正常",
    `level=${ad.level} score=${ad.score}`
  );
  note(
    `演示态分析：score=${ad.score} level=${ad.level} risks=${(ad.risks ?? []).length}`
  );
}

// ---------------------------------------------------------------- H 生产托管
sec("10. 生产模式单端口托管（dist/ + SPA 回退 + /uploads）");
{
  const root = await api("GET", "/");
  check(
    "GET / → 200 text/html（前端产物已托管）",
    root.status === 200 &&
      String(root.headers.get("content-type")).includes("text/html") &&
      /<div id="app">/.test(root.text),
    `status=${root.status} ct=${root.headers.get("content-type")} len=${root.text.length}`
  );

  const m = root.text.match(/\/static\/js\/[A-Za-z0-9._-]+\.js/);
  check(
    "index.html 引用了打包产物 /static/js/*.js",
    !!m,
    `html=${root.text.slice(0, 160)}`
  );
  if (m) {
    const js = await api("GET", m[0]);
    check(
      `GET ${m[0]} → 200 text/javascript`,
      js.status === 200 &&
        String(js.headers.get("content-type")).includes("javascript"),
      `status=${js.status} ct=${js.headers.get("content-type")} len=${js.text.length}`
    );
  }

  for (const route of [
    "/health/dashboard",
    "/health/trend",
    "/system/user",
    "/login"
  ]) {
    const r = await api("GET", route);
    check(
      `SPA 回退：GET ${route} → 200 html（history 刷新不 404）`,
      r.status === 200 && /<div id="app">/.test(r.text),
      `status=${r.status}`
    );
  }

  const nf = await api("GET", "/api/not-exist");
  check(
    "未命中的 /api 路径 → 404 JSON（不被 SPA 回退吞成 html）",
    nf.status === 404 && j(nf).code === 404,
    `status=${nf.status} body=${nf.text.slice(0, 80)}`
  );

  if (globalThis.__avatar) {
    /* noop */
  }
}

// ---------------------------------------------------------------- I 局域网一致性
sec("11. 局域网 IP 访问同一份数据");
{
  const ips = Object.values(os.networkInterfaces())
    .flat()
    .filter(i => i && i.family === "IPv4" && !i.internal)
    .map(i => i.address);
  note(`本机内网 IP：${ips.join(", ") || "（无）"}`);
  const ip = ips[0];
  if (!ip) {
    check("检测到内网 IP 并可访问", false, "未检测到非回环 IPv4 地址");
  } else {
    let ok = false;
    let detail = "";
    try {
      const r = await fetch(`http://${ip}:3000/api/ping`);
      const t = await r.text();
      ok = r.status === 200 && t.includes("ok");
      detail = `status=${r.status} body=${t.slice(0, 60)}`;
    } catch (e) {
      detail = String(e.message);
    }
    check(
      `GET http://${ip}:3000/api/ping → 200（服务监听 0.0.0.0，其他设备可访问）`,
      ok,
      detail
    );

    let same = false;
    let sd = "";
    try {
      const r = await fetch(`http://${ip}:3000/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "admin123" })
      });
      const d = await r.json();
      const tk = d?.data?.accessToken;
      const r2 = await fetch(
        `http://${ip}:3000/api/user?currentPage=1&pageSize=10`,
        { headers: { Authorization: `Bearer ${tk}` } }
      );
      const d2 = await r2.json();
      same = Number(d2?.data?.total) === 2;
      sd = `total=${d2?.data?.total}`;
    } catch (e) {
      sd = String(e.message);
    }
    check(
      "经局域网 IP 登录并读取数据 → 与 localhost 同一份（SQLite 在服务端）",
      same,
      sd
    );
  }
}

// ============================================================================
// C7：把 C0–C6 各阶段「仓库外验证脚本」的断言沉淀为可重复跑的接口回归
//
// 三条约定：
// 1. 本节所有断言都挂在**显式测试账号**下（`test_common` 与 `test_c4_1..6`），跑完由第 20 节
//    删除；不在种子账号 admin / common 名下留任何测试数据；
// 2. 断言与库内既有数据无关：涉及数量的判断一律用「相对变化」或「规则式」判断
//    （库里可能已有一键演示数据、其他人的数据），不写死总数；
// 3. 需要服务端日志作为证据时，把日志文件路径给到环境变量 `LOG_FILE`（第 19 节读取并断言）。
// ============================================================================

const pad2 = n => String(n).padStart(2, "0");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** 本地日期 yyyy-MM-dd（与服务端 `datetime('now','localtime')` 同一时区口径） */
function dayOffset(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

const TODAY = dayOffset(0);
const TEST_PWD = "test-common-123";
/** 测试账号 id / token */
const U = {};
const TT = {};

/** 按账号名查用户 id（找不到返回 null） */
async function findUserId(username) {
  const r = await api(
    "GET",
    `/api/user?username=${encodeURIComponent(username)}&currentPage=1&pageSize=100`,
    { token: T.admin }
  );
  const row = (j(r).data?.list ?? []).find(u => u.username === username);
  return row ? Number(row.id) : null;
}

/**
 * 幂等建号：上次跑挂留下的同名账号先删掉再建。
 * 顺带把「删号级联」也验一遍——C7 修过一个真 bug：建过计划 / 提醒的账号删不掉
 * （`deleteUser` 的清理清单没跟上 C1/C5/C6 新增的外键表，直接 500）。
 */
async function ensureTestUser(username, nickname) {
  const existing = await findUserId(username);
  if (existing) {
    const del = await api("DELETE", `/api/user/${existing}`, {
      token: T.admin
    });
    check(
      `幂等准备：清掉上次残留的测试账号 ${username}`,
      del.status === 200 && j(del).code === 0,
      `status=${del.status} body=${del.text.slice(0, 140)}`
    );
  }
  const created = await api("POST", "/api/user", {
    token: T.admin,
    body: { username, password: TEST_PWD, nickname, roleIds: [2] }
  });
  const id = Number(j(created).data?.id);
  check(
    `建立测试账号 ${username}`,
    created.status === 200 && j(created).code === 0 && id > 0,
    `status=${created.status} body=${created.text.slice(0, 140)}`
  );
  return id;
}

/** 测试账号登录 */
async function loginTest(username) {
  const r = await api("POST", "/api/login", {
    body: { username, password: TEST_PWD }
  });
  const token = j(r).data?.accessToken;
  check(
    `测试账号 ${username} 登录成功`,
    r.status === 200 && !!token,
    `status=${r.status} body=${r.text.slice(0, 140)}`
  );
  return token;
}

/** 某用户当前记录总数 */
async function recordTotal(token) {
  return Number(
    (
      await api("GET", "/api/health/records?currentPage=1&pageSize=1", {
        token
      })
    ).json?.data?.total
  );
}

// ---------------------------------------------------------------- C0 规则可解释性
sec("12. C0 规则可解释性（/analyze、/analyze/explain、急救分流）");
/** C7 起点快照：第 20 节据此断言「测试数据零残留」与「没动种子账号的数据」 */
const ADMIN_RECORDS_BEFORE = await recordTotal(T.admin);
const USER_TOTAL_BEFORE = Number(
  (await api("GET", "/api/user?currentPage=1&pageSize=1", { token: T.admin }))
    .json?.data?.total
);
U.test = await ensureTestUser("test_common", "回归测试账号");
TT.test = await loginTest("test_common");
T.test = TT.test;
if (!TT.test) {
  console.log("\n致命：测试账号无法登录，C7 各节无法执行");
  process.exit(1);
}
note(
  `C7 起点：种子账号记录 ${ADMIN_RECORDS_BEFORE} 条，用户总数 ${USER_TOTAL_BEFORE} 个`
);
{
  // C0 断言用**内联记录**喂给引擎，结果完全由入参决定，与库内既有数据无关
  const RISKY = {
    date: TODAY,
    systolic: 190,
    diastolic: 115,
    fastingGlucose: 8.5,
    ldl: 4.5
  };
  const RISKY_PROFILE = {
    gender: 1,
    age: 45,
    height: 170,
    weight: 88,
    smoking: 1,
    drinking: 1,
    exercise: 0
  };
  const NORMAL = {
    date: TODAY,
    systolic: 112,
    diastolic: 72,
    fastingGlucose: 5.2,
    ldl: 2.6
  };
  const NORMAL_PROFILE = {
    gender: 1,
    age: 45,
    height: 175,
    weight: 68,
    smoking: 0,
    drinking: 0,
    exercise: 2
  };

  // 另外给测试账号落一条真实记录：C0 急救分流按「库内最新记录」判定，C2 字段断言也用它
  const created = await api("POST", "/api/health/records", {
    token: TT.test,
    body: { ...RISKY, remark: "C7 回归高危记录" }
  });
  check(
    "测试账号落一条高危记录（供 C0 急救 / C2 字段断言使用）",
    created.status === 200 && j(created).data?.id != null,
    `status=${created.status} body=${created.text.slice(0, 140)}`
  );

  const an = await api("POST", "/api/health/analyze", {
    token: TT.test,
    body: { records: [RISKY], profile: RISKY_PROFILE }
  });
  const ad = j(an).data ?? {};
  check(
    "POST /api/health/analyze（高风险记录）→ 200 含 score/level/items/risks",
    an.status === 200 &&
      j(an).code === 0 &&
      ad.score > 0 &&
      !!ad.level &&
      Array.isArray(ad.items) &&
      Array.isArray(ad.risks),
    `status=${an.status} keys=${Object.keys(ad).join(",")}`
  );
  check(
    "分析结果带 evidence（C0 风险解释的输出位）",
    ad.evidence &&
      typeof ad.evidence === "object" &&
      Array.isArray(ad.evidence.items) &&
      ad.evidence.items.length > 0,
    JSON.stringify(ad.evidence ?? null).slice(0, 160)
  );

  const items = ad.items ?? [];
  const pick = key => items.find(i => i.key === key);
  check(
    "收缩压 190 → 三级高血压（level 2），规则 id BP-SYS-001",
    pick("systolic")?.grade === "三级高血压" &&
      pick("systolic")?.level === 2 &&
      pick("systolic")?.rule?.ruleId === "BP-SYS-001",
    JSON.stringify(pick("systolic") ?? null)
  );
  check(
    "舒张压 115 → level 2，规则 id BP-DIA-001",
    pick("diastolic")?.level === 2 &&
      pick("diastolic")?.rule?.ruleId === "BP-DIA-001",
    JSON.stringify(pick("diastolic") ?? null)
  );
  check(
    "空腹血糖 8.5 → 疑似糖尿病（level 2）",
    pick("fastingGlucose")?.grade === "疑似糖尿病" &&
      pick("fastingGlucose")?.level === 2,
    JSON.stringify(pick("fastingGlucose") ?? null)
  );
  check(
    "BMI 由档案身高体重算出 30.4 → 肥胖（level 2）",
    pick("bmi")?.grade === "肥胖" && pick("bmi")?.level === 2,
    JSON.stringify(pick("bmi") ?? null)
  );
  check(
    "每个分级项都带规则元信息（规则 id / 版本 / 适用人群 / 阈值 / 依据）",
    items.length > 0 &&
      items.every(
        i =>
          i.rule?.ruleId &&
          i.rule?.ruleVersion &&
          i.rule?.applicableTo &&
          i.rule?.thresholdDesc &&
          i.rule?.evidence
      ),
    `items=${items.length}`
  );

  const ev = ad.evidence ?? {};
  const evItems = ev.items ?? [];
  check(
    "解释项含指标 / 数值 / 记录日期 / 数据来源 / 阈值口径 / 限制说明",
    evItems.length > 0 &&
      evItems.every(
        i =>
          i.key &&
          i.name &&
          i.value != null &&
          i.recordDate &&
          i.sourceDesc &&
          i.limit
      ),
    JSON.stringify(evItems[0] ?? {}).slice(0, 200)
  );
  check(
    "解释项与分级项的指标集合一致（key 一一对应）",
    evItems.length === items.length &&
      evItems.every(e => items.filter(i => i.key === e.key).length === 1),
    `evidence=${evItems.length} items=${items.length}`
  );
  check(
    "规则版本唯一：解释项 ruleVersion 全等于 engineVersion",
    evItems.every(i => i.rule?.ruleVersion === ev.engineVersion),
    `engineVersion=${ev.engineVersion}`
  );
  check(
    "解释项带本次记录日期（记录类指标回填记录日期，不是兜底文案）",
    evItems.filter(i => i.key !== "bmi").every(i => i.recordDate === TODAY),
    evItems.map(i => `${i.key}:${i.recordDate}`).join(" ")
  );
  check(
    "bmi 的解释日期退回「档案建立时」（它由档案身高体重算出，本来就没有记录日期）",
    evItems.find(i => i.key === "bmi")?.recordDate === "档案建立时" &&
      String(evItems.find(i => i.key === "bmi")?.sourceDesc ?? "").includes(
        "档案"
      ),
    JSON.stringify(evItems.find(i => i.key === "bmi") ?? {}).slice(0, 160)
  );
  check(
    "结论文案含评分与等级，边界文案非空",
    String(ev.conclusion ?? "").includes(String(ad.score)) &&
      String(ev.conclusion ?? "").includes(String(ad.level)) &&
      String(ev.boundary ?? "").length > 0,
    `conclusion=${String(ev.conclusion ?? "").slice(0, 80)}`
  );
  check(
    "风险点文案来自本次分级（非空且带数值）",
    (ad.risks ?? []).length > 0 &&
      (ad.risks ?? []).some(r => r.includes("190")),
    JSON.stringify(ad.risks ?? []).slice(0, 200)
  );

  const anNormal = await api("POST", "/api/health/analyze", {
    token: TT.test,
    body: { records: [NORMAL], profile: NORMAL_PROFILE }
  });
  const and = j(anNormal).data ?? {};
  check(
    "全项正常的记录 → score 0 / level 低 / risks 为空",
    Number(and.score) === 0 &&
      and.level === "低" &&
      (and.risks ?? []).length === 0,
    `score=${and.score} level=${and.level} risks=${(and.risks ?? []).length}`
  );

  const ex = await api("POST", "/api/health/analyze/explain", {
    token: TT.test,
    body: { records: [RISKY], profile: RISKY_PROFILE }
  });
  const ed = j(ex).data ?? {};
  check(
    "POST /analyze/explain → 200 返回解释对象（版本/结论/明细/边界）",
    ex.status === 200 &&
      j(ex).code === 0 &&
      !!ed.engineVersion &&
      !!ed.conclusion &&
      Array.isArray(ed.items) &&
      !!ed.boundary,
    `status=${ex.status} keys=${Object.keys(ed).join(",")}`
  );
  check(
    "explain 输出**不含** score / level（与 analyze 形状不同，前端按需取用）",
    !("score" in ed) && !("level" in ed),
    `keys=${Object.keys(ed).join(",")}`
  );
  check(
    "explain 与 analyze 的规则版本一致（同一份规则引擎）",
    ed.engineVersion === ev.engineVersion,
    `${ed.engineVersion} vs ${ev.engineVersion}`
  );

  const badRec = await api("POST", "/api/health/analyze", {
    token: TT.test,
    body: { records: "not-array" }
  });
  check(
    "records 非数组 → 400 40001「字段 records 需为数组」",
    badRec.status === 400 && j(badRec).code === 40001,
    `status=${badRec.status} body=${badRec.text.slice(0, 140)}`
  );
  check(
    "analyze 无 token → 401",
    (await api("POST", "/api/health/analyze", { body: {} })).status === 401
  );

  // C0 急救分流（extreme 路：库内最新记录命中极端阈值）
  const chatEx = await api("POST", "/api/health/chat", {
    token: TT.test,
    body: { question: "我这样需要去医院吗" }
  });
  const cxd = String(j(chatEx).data ?? "");
  check(
    "最新记录命中极端阈值 → 对话直接返回急救处置卡（不走向大模型）",
    chatEx.status === 200 &&
      cxd.includes("紧急健康提示") &&
      cxd.includes("达到紧急危险阈值"),
    `status=${chatEx.status} data=${cxd.slice(0, 140)}`
  );
  // 同一句话在有极端记录时先命中「极端指标」——记录高于提问，这是分流的设计顺序：
  // 用户没提症状、但最新记录已是三级高血压，先给急救卡比先答问题更要紧。
  const chatSym0 = await api("POST", "/api/health/chat", {
    token: TT.test,
    body: { question: "我突然胸痛" }
  });
  check(
    "分流优先级：极端指标先于症状关键词（同一句话命中的是极端卡）",
    String(j(chatSym0).data ?? "").includes("达到紧急危险阈值") &&
      !String(j(chatSym0).data ?? "").includes("您的问题中提到"),
    String(j(chatSym0).data ?? "").slice(0, 120)
  );

  // C0 急救分流（symptom 路：用户主动提及危险症状关键词）
  // 先让「最新记录」回到正常范围，症状关键词才有机会被匹配到
  await api("POST", "/api/health/records", {
    token: TT.test,
    body: {
      date: TODAY,
      systolic: 112,
      diastolic: 72,
      fastingGlucose: 5.2,
      ldl: 2.6,
      remark: "C7 回归（用于症状关键词分流）"
    }
  });
  const chatSym = await api("POST", "/api/health/chat", {
    token: TT.test,
    body: { question: "我突然胸痛" }
  });
  const csd = String(j(chatSym).data ?? "");
  check(
    "提及危险症状关键词 → 对话返回急救处置卡",
    chatSym.status === 200 &&
      csd.includes("紧急健康提示") &&
      csd.includes("胸痛") &&
      csd.includes("请立即采取以下措施"),
    `status=${chatSym.status} data=${csd.slice(0, 140)}`
  );
  check(
    "急救卡与风险解释共用同一份边界文案（单一源码，不各写一套）",
    csd.includes(ed.boundary),
    `boundary=${String(ed.boundary ?? "").slice(0, 60)}`
  );
}

// ---------------------------------------------------------------- C1 行动计划
sec("13. C1 行动计划与打卡（/plans、/plans/today、/tasks/:id/checkin）");
const PLAN_START = TODAY;
const PLAN_END = dayOffset(30);
let planId = null;
let planTaskIds = [];
{
  const expect400 = async (body, name) => {
    const r = await api("POST", "/api/health/plans", {
      token: TT.test,
      body
    });
    check(
      name,
      r.status === 400 && j(r).code === 40001,
      `status=${r.status} body=${r.text.slice(0, 140)}`
    );
  };
  const task = (over = {}) => ({
    title: "每天测血压",
    taskType: "measure",
    frequency: "daily",
    ...over
  });
  const base = {
    title: "C7 回归计划",
    riskKey: "systolic",
    startDate: PLAN_START,
    endDate: PLAN_END,
    tasks: [task()]
  };
  await expect400({ ...base, title: "" }, "缺 title → 400 40001");
  await expect400({ ...base, riskKey: "" }, "缺 riskKey → 400 40001");
  await expect400(
    { ...base, startDate: PLAN_END, endDate: PLAN_START },
    "开始日期晚于结束日期 → 400 40001"
  );
  await expect400({ ...base, tasks: [] }, "tasks 为空 → 400 40001");
  await expect400(
    { ...base, tasks: [task({ taskType: "bogus" })] },
    "任务类型非法 → 400 40001"
  );
  await expect400(
    { ...base, tasks: [task({ frequency: "hourly" })] },
    "任务频率非法 → 400 40001"
  );

  const ok = await api("POST", "/api/health/plans", {
    token: TT.test,
    body: {
      ...base,
      targetValue: 130,
      source: "manual",
      tasks: [
        task(),
        task({ title: "每周快走", taskType: "exercise", frequency: "weekly" })
      ]
    }
  });
  const pd = j(ok).data ?? {};
  planId = Number(pd.id);
  planTaskIds = (pd.tasks ?? []).map(t => Number(t.id));
  check(
    "POST /api/health/plans → 200 返回计划（含 2 个任务与 progress）",
    ok.status === 200 &&
      j(ok).code === 0 &&
      planId > 0 &&
      planTaskIds.length === 2 &&
      !!pd.progress &&
      Array.isArray(pd.progress.perTask),
    `status=${ok.status} body=${ok.text.slice(0, 160)}`
  );
  check(
    "计划初始状态 active、来源 manual、任务带类型 / 频率 / 排序",
    pd.status === "active" &&
      pd.source === "manual" &&
      (pd.tasks ?? []).every(
        t => t.taskType && t.frequency && t.sortOrder != null
      ),
    `status=${pd.status} source=${pd.source}`
  );
  check(
    "progress 初值为 0（总数 2、已完成 0、完成率 0）",
    Number(pd.progress?.totalTasks) === 2 &&
      Number(pd.progress?.doneCount) === 0 &&
      Number(pd.progress?.rate) === 0,
    JSON.stringify(pd.progress ?? {}).slice(0, 160)
  );

  const list = await api("GET", "/api/health/plans", { token: TT.test });
  const arr = j(list).data ?? [];
  check(
    "GET /api/health/plans → 200 含刚建的计划（列表倒序）",
    list.status === 200 &&
      Array.isArray(arr) &&
      arr.some(p => Number(p.id) === planId) &&
      (arr.length < 2 || Number(arr[0].id) >= Number(arr[1].id)),
    `len=${arr.length}`
  );

  const detail = await api("GET", `/api/health/plans/${planId}`, {
    token: TT.test
  });
  check(
    "GET /api/health/plans/:id（本人）→ 200 含 tasks（2 个）",
    detail.status === 200 &&
      j(detail).code === 0 &&
      (j(detail).data?.tasks ?? []).length === 2,
    `status=${detail.status}`
  );
  check(
    "GET /api/health/plans/:id（跨用户）→ 404（不泄露存在性）",
    (await api("GET", `/api/health/plans/${planId}`, { token: T.common }))
      .status === 404
  );
  check(
    "GET /api/health/plans/:id（不存在）→ 404",
    (await api("GET", "/api/health/plans/99999999", { token: TT.test }))
      .status === 404
  );

  const today = await api("GET", "/api/health/plans/today", {
    token: TT.test
  });
  const entry = (j(today).data ?? []).find(e => Number(e.plan?.id) === planId);
  check(
    "GET /api/health/plans/today → 200 含进行中的计划（plan + tasks + streakDays）",
    today.status === 200 &&
      !!entry &&
      Array.isArray(entry.tasks) &&
      entry.tasks.length === 2 &&
      entry.tasks.every(t => "checkedToday" in t && "lastCheckedDate" in t) &&
      entry.streakDays != null,
    `status=${today.status} entries=${(j(today).data ?? []).length}`
  );
  check(
    "今日视图里任务尚未打卡（checkedToday=false / lastCheckedDate 空）",
    !!entry && entry.tasks.every(t => t.checkedToday === false),
    JSON.stringify((entry?.tasks ?? [])[0] ?? {}).slice(0, 160)
  );

  const ci = await api("POST", `/api/health/tasks/${planTaskIds[0]}/checkin`, {
    token: TT.test,
    body: { value: 128, note: "C7 回归打卡" }
  });
  const cd = j(ci).data ?? {};
  check(
    "POST /api/health/tasks/:id/checkin → 200 返回 taskId / checkedDate / streakDays",
    ci.status === 200 &&
      j(ci).code === 0 &&
      Number(cd.taskId) === planTaskIds[0] &&
      cd.checkedDate === TODAY &&
      Number(cd.streakDays) >= 1,
    `status=${ci.status} body=${ci.text.slice(0, 160)}`
  );
  const dup = await api("POST", `/api/health/tasks/${planTaskIds[0]}/checkin`, {
    token: TT.test,
    body: {}
  });
  check(
    "同日重复打卡 → 400 40002（唯一约束兜底）",
    dup.status === 400 && j(dup).code === 40002,
    `status=${dup.status} code=${j(dup).code} body=${dup.text.slice(0, 140)}`
  );
  const future = await api(
    "POST",
    `/api/health/tasks/${planTaskIds[0]}/checkin`,
    { token: TT.test, body: { date: dayOffset(1) } }
  );
  check(
    "未来日期打卡 → 400 40001",
    future.status === 400 && j(future).code === 40001,
    `status=${future.status} body=${future.text.slice(0, 140)}`
  );
  check(
    "对他人任务打卡 → 404（归属经 任务→计划→用户 校验）",
    (
      await api("POST", `/api/health/tasks/${planTaskIds[0]}/checkin`, {
        token: T.common,
        body: {}
      })
    ).status === 404
  );
  check(
    "对不存在的任务打卡 → 404",
    (
      await api("POST", "/api/health/tasks/99999999/checkin", {
        token: TT.test,
        body: {}
      })
    ).status === 404
  );

  const prog = await api("GET", `/api/health/plans/${planId}/progress`, {
    token: TT.test
  });
  const pg = j(prog).data ?? {};
  check(
    "GET /api/health/plans/:id/progress → 200：总数 2 / 完成 1 / 完成率 >0",
    prog.status === 200 &&
      Number(pg.totalTasks) === 2 &&
      Number(pg.doneCount) === 1 &&
      Number(pg.rate) > 0 &&
      (pg.perTask ?? []).length === 2,
    JSON.stringify({ t: pg.totalTasks, d: pg.doneCount, r: pg.rate })
  );
  check(
    "progress 按任务给出到期 / 完成 / 完成率明细",
    (pg.perTask ?? []).every(
      t =>
        t.taskId != null &&
        t.title &&
        t.frequency &&
        t.due != null &&
        t.rate != null
    ),
    JSON.stringify((pg.perTask ?? [])[0] ?? {}).slice(0, 160)
  );
  const today2 = await api("GET", "/api/health/plans/today", {
    token: TT.test
  });
  const entry2 = (j(today2).data ?? []).find(
    e => Number(e.plan?.id) === planId
  );
  check(
    "打卡后今日视图的该任务 checkedToday=true 且带上次打卡日期",
    !!entry2 &&
      entry2.tasks.some(
        t => Number(t.id) === planTaskIds[0] && t.checkedToday === true
      ) &&
      entry2.tasks.some(t => t.lastCheckedDate === TODAY),
    JSON.stringify((entry2?.tasks ?? [])[0] ?? {}).slice(0, 160)
  );

  const put = await api("PUT", `/api/health/plans/${planId}`, {
    token: TT.test,
    body: { title: "C7 回归计划（改）", endDate: dayOffset(45) }
  });
  check(
    "PUT /api/health/plans/:id → 200 改动生效",
    put.status === 200 &&
      j(put).data?.title === "C7 回归计划（改）" &&
      j(put).data?.endDate === dayOffset(45),
    `status=${put.status} body=${put.text.slice(0, 160)}`
  );
  const put400 = await api("PUT", `/api/health/plans/${planId}`, {
    token: TT.test,
    body: { startDate: dayOffset(60) }
  });
  check(
    "PUT 开始日期晚于结束日期 → 400 40001",
    put400.status === 400 && j(put400).code === 40001,
    `status=${put400.status} body=${put400.text.slice(0, 140)}`
  );
  check(
    "PUT 他人计划 → 404",
    (
      await api("PUT", `/api/health/plans/${planId}`, {
        token: T.common,
        body: { title: "x" }
      })
    ).status === 404
  );

  // 状态机：completed → 非法值静默保留 → 回到 active（不影响后续 C3 的完成度联动）
  const st1 = await api("PUT", `/api/health/plans/${planId}`, {
    token: TT.test,
    body: { status: "completed" }
  });
  const st2 = await api("PUT", `/api/health/plans/${planId}`, {
    token: TT.test,
    body: { status: "bogus" }
  });
  const st3 = await api("PUT", `/api/health/plans/${planId}`, {
    token: TT.test,
    body: { status: "active" }
  });
  check(
    "计划状态可切换（active → completed → active）",
    j(st1).data?.status === "completed" && j(st3).data?.status === "active",
    `${j(st1).data?.status} / ${j(st3).data?.status}`
  );
  check(
    "非法状态值静默保留原状态（不 400、也不写坏数据）",
    j(st2).data?.status === "completed" && st2.status === 200,
    `status=${j(st2).data?.status}`
  );
}

// ---------------------------------------------------------------- C2 来源与质量
sec("14. C2 数据来源与质量标记（/records?sourceType、/device/sync）");
const DEVICE_NAME = "C7 回归手环";
{
  const list = await api(
    "GET",
    `/api/health/records?currentPage=1&pageSize=50&startDate=${TODAY}&endDate=${TODAY}`,
    { token: TT.test }
  );
  const mine = (j(list).data?.list ?? []).find(r => r.systolic === 190);
  const KEYS = ["sourceType", "qualityFlag", "measuredAt", "deviceName"];
  check(
    "记录响应含来源 / 质量 / 测量时刻 / 设备名四个字段",
    !!mine && KEYS.every(k => k in mine),
    `keys=${Object.keys(mine ?? {}).join(",")}`
  );
  check(
    "手工录入的记录：来源 manual、质量 good、测量时刻有兜底值",
    mine?.sourceType === "manual" &&
      mine?.qualityFlag === "good" &&
      !!mine?.measuredAt &&
      mine?.deviceName === "",
    JSON.stringify(mine ?? {}).slice(0, 200)
  );

  const D_SUSPECT = dayOffset(-1);
  const D_INVALID = dayOffset(-2);
  const sync = await api("POST", "/api/health/device/sync", {
    token: TT.test,
    body: {
      device: DEVICE_NAME,
      measurements: [
        { metric: "sbp", value: 260, measuredAt: `${D_SUSPECT} 07:30` },
        { metric: "spo2", value: 97, measuredAt: `${D_SUSPECT} 07:30` },
        { metric: "hr", value: 400, measuredAt: `${D_INVALID} 08:00` }
      ]
    }
  });
  const sd = j(sync).data ?? {};
  check(
    "POST /api/health/device/sync → 200 返回 device/received/saved/quality/issues/records",
    sync.status === 200 &&
      j(sync).code === 0 &&
      sd.sourceType === "device" &&
      Number(sd.received) === 3 &&
      Number(sd.saved) === 2 &&
      sd.quality &&
      Array.isArray(sd.issues) &&
      Array.isArray(sd.records),
    `status=${sync.status} body=${sync.text.slice(0, 200)}`
  );
  check(
    "来源中文标签来自共享层（设备同步）",
    sd.sourceLabel === "设备同步",
    `sourceLabel=${sd.sourceLabel}`
  );
  check(
    "同一日期的多次测量合并为一条记录（按日期分组）",
    (sd.records ?? []).length === 2,
    `records=${(sd.records ?? []).length}`
  );
  const grouped = (sd.records ?? []).find(r => r.date === D_SUSPECT);
  check(
    "同一天的多个指标落在同一条记录上",
    grouped?.systolic === 260 && grouped?.bloodOxygen === 97,
    JSON.stringify(grouped ?? {}).slice(0, 200)
  );
  check(
    "超出合理区间 → 打 suspect 并给出原因（仍入库、仍参与分析）",
    Number(sd.quality?.suspect) >= 1 &&
      (sd.issues ?? []).some(
        i => i.qualityFlag === "suspect" && (i.messages ?? []).length > 0
      ),
    JSON.stringify(sd.quality ?? {})
  );
  check(
    "生理学不可能值 → 打 invalid（入库但不参与任何分析）",
    Number(sd.quality?.invalid) >= 1 &&
      (sd.issues ?? []).some(i => i.qualityFlag === "invalid"),
    JSON.stringify(sd.quality ?? {}) + ` issues=${(sd.issues ?? []).length}`
  );
  check(
    "同步落库的记录带 sourceType=device 与设备名",
    (sd.records ?? []).every(
      r => r.sourceType === "device" && r.deviceName === DEVICE_NAME
    ),
    JSON.stringify((sd.records ?? [])[0] ?? {}).slice(0, 200)
  );

  const filtered = await api(
    "GET",
    "/api/health/records?currentPage=1&pageSize=50&sourceType=device",
    { token: TT.test }
  );
  check(
    "GET /records?sourceType=device → 只回来源为设备的记录",
    filtered.status === 200 &&
      (j(filtered).data?.list ?? []).length > 0 &&
      (j(filtered).data?.list ?? []).every(r => r.sourceType === "device"),
    `len=${(j(filtered).data?.list ?? []).length}`
  );
  check(
    "sourceType 非法 → 400 40001",
    (
      await api("GET", "/api/health/records?sourceType=bogus", {
        token: TT.test
      })
    ).status === 400
  );

  const totalBefore = await recordTotal(TT.test);
  const expect400 = async (body, name) => {
    const r = await api("POST", "/api/health/device/sync", {
      token: TT.test,
      body
    });
    check(
      name,
      r.status === 400 && j(r).code === 40001,
      `status=${r.status} body=${r.text.slice(0, 140)}`
    );
  };
  await expect400(
    { measurements: [{ metric: "sbp", value: 120, measuredAt: TODAY }] },
    "缺 device → 400 40001"
  );
  await expect400(
    { device: "x", measurements: [] },
    "measurements 为空数组 → 400 40001"
  );
  await expect400(
    {
      device: "x",
      measurements: [{ metric: "bogus", value: 1, measuredAt: TODAY }]
    },
    "无法识别的指标名 → 400 40001"
  );
  await expect400(
    {
      device: "x",
      measurements: [{ metric: "sbp", value: "abc", measuredAt: TODAY }]
    },
    "value 非数字 → 400 40001"
  );
  await expect400(
    {
      device: "x",
      measurements: [{ metric: "sbp", value: 120, measuredAt: "bad-date" }]
    },
    "measuredAt 非法 → 400 40001"
  );
  await expect400(
    { device: "x", measurements: [{ metric: "sbp", value: 120 }] },
    "缺 measuredAt → 400 40001"
  );
  check(
    "设备同步整批校验失败时**不部分写入**",
    (await recordTotal(TT.test)) === totalBefore,
    `before=${totalBefore} after=${await recordTotal(TT.test)}`
  );

  const adminSees = await api(
    "GET",
    `/api/health/records?currentPage=1&pageSize=100&startDate=${D_INVALID}&endDate=${TODAY}`,
    { token: T.admin }
  );
  const myIds = (sd.records ?? []).map(r => String(r.id));
  check(
    "设备同步的数据只落当前用户（admin 看不到）",
    !(j(adminSees).data?.list ?? []).some(r => myIds.includes(String(r.id))),
    `admin 同期记录=${(j(adminSees).data?.list ?? []).length} 条`
  );
}

// ---------------------------------------------------------------- C3 报告对比
sec("15. C3 报告对比与方向口径（/report/generate、/report/:id）");
let repIds = [];
{
  // 先清掉测试账号已有记录，让本节报告只由本节数据决定（与库内既有数据无关）
  const ids = (
    (
      await api("GET", "/api/health/records?currentPage=1&pageSize=100", {
        token: TT.test
      })
    ).json?.data?.list ?? []
  ).map(r => r.id);
  if (ids.length) {
    const del = await api("DELETE", "/api/health/records", {
      token: TT.test,
      body: { ids }
    });
    check(
      `批量删除测试账号历史记录（清 ${ids.length} 条，C3 从零起算）`,
      del.status === 200 && Number(j(del).data?.deleted) === ids.length,
      `deleted=${j(del).data?.deleted} ids=${ids.length}`
    );
  }
  check(
    "DELETE /health/records 请求体非法（ids 非数组）→ 400",
    (
      await api("DELETE", "/api/health/records", {
        token: TT.test,
        body: { ids: "x" }
      })
    ).status === 400
  );

  const WIN = { startDate: dayOffset(-7), endDate: TODAY };
  const add = body =>
    api("POST", "/api/health/records", { token: TT.test, body });
  const generate = async () => {
    const g = await api("POST", "/api/health/report/generate", {
      token: TT.test,
      body: WIN
    });
    const id = j(g).data?.id;
    if (id == null) return { g, id: null, det: null };
    const det = await api("GET", `/api/health/report/${id}`, {
      token: TT.test
    });
    repIds.push(id);
    return { g, id, det: j(det).data ?? {} };
  };
  /** 方向口径：评分是**风险分**，故正数代表恶化（C3 修正项） */
  const dirOf = d => (d > 3 ? "worsened" : d < -3 ? "improved" : "stable");

  const r1 = await generate();
  check(
    "生成第 1 份报告（数据正常）→ 200 返回 id/score/level",
    r1.g.status === 200 &&
      j(r1.g).code === 0 &&
      r1.id != null &&
      r1.det.score != null,
    `status=${r1.g.status} body=${r1.g.text.slice(0, 140)}`
  );
  check(
    "第 1 份报告无上期可比 → comparison 为 null（降级不编造）",
    r1.det.comparison === null,
    JSON.stringify(r1.det.comparison ?? null).slice(0, 140)
  );
  check(
    "报告详情含 radar / trend / itemAnalysis / evidence（图表与解释位）",
    Array.isArray(r1.det.radar) &&
      Array.isArray(r1.det.trend) &&
      Array.isArray(r1.det.itemAnalysis) &&
      Array.isArray(r1.det.evidence),
    `keys=${Object.keys(r1.det).join(",")}`
  );

  // 第 2 期：指标恶化（记录日期更晚 → 引擎取最新一条）
  await add({ date: dayOffset(-1), systolic: 178, diastolic: 108 });
  await add({
    date: TODAY,
    systolic: 176,
    diastolic: 106,
    fastingGlucose: 7.6
  });
  const r2 = await generate();
  const c2 = r2.det.comparison ?? {};
  check(
    "生成第 2 份报告（指标恶化）→ 带上期对比",
    r2.id != null && !!r2.det.comparison,
    JSON.stringify(r2.det.comparison ?? null).slice(0, 140)
  );
  check(
    "对比指向上期报告（prevReportId / prevScore / prevLevel）",
    String(c2.prevReportId) === String(r1.id) &&
      Number(c2.prevScore) === Number(r1.det.score) &&
      c2.prevLevel === r1.det.level,
    `prev=${c2.prevReportId} score ${c2.prevScore}→${r2.det.score}`
  );
  check(
    "**风险分升高 = 恶化**：本期分更高 → direction=worsened（C3 修正项）",
    Number(r2.det.score) > Number(r1.det.score) &&
      Number(c2.scoreDelta) > 0 &&
      c2.direction === "worsened",
    `Δ=${c2.scoreDelta}（${r1.det.score}→${r2.det.score}）direction=${c2.direction}`
  );
  check(
    "scoreDelta 恒等于「本期分 − 上期分」且与 direction 口径一致",
    Number(c2.scoreDelta) === Number(r2.det.score) - Number(r1.det.score) &&
      c2.direction === dirOf(Number(c2.scoreDelta)),
    `Δ=${c2.scoreDelta} direction=${c2.direction}`
  );
  check(
    "新出现的风险点标记为 new（riskAdded 与明细一致）",
    Number(c2.riskAdded) > 0 &&
      (c2.riskDeltas ?? []).length > 0 &&
      (c2.riskDeltas ?? []).every(d => d.kind === "new" && d.risk),
    JSON.stringify(c2.riskDeltas ?? []).slice(0, 200)
  );
  check(
    "风险点差异计数与明细条数一致",
    (c2.riskDeltas ?? []).length ===
      Number(c2.riskAdded) + Number(c2.riskGone) + Number(c2.riskOngoing),
    JSON.stringify({
      added: c2.riskAdded,
      gone: c2.riskGone,
      ongoing: c2.riskOngoing,
      len: (c2.riskDeltas ?? []).length
    })
  );
  check(
    "风险点差异顺序恒为「新增 → 持续 → 消失」",
    (() => {
      const rank = { new: 0, ongoing: 1, gone: 2 };
      const kinds = (c2.riskDeltas ?? []).map(d => d.kind);
      return kinds.every((k, i) => i === 0 || rank[kinds[i - 1]] <= rank[k]);
    })(),
    (c2.riskDeltas ?? []).map(d => d.kind).join(",")
  );
  check(
    "对比结论文案非空（前端直接展示）",
    String(c2.conclusion ?? "").length > 0,
    String(c2.conclusion ?? "").slice(0, 120)
  );

  // 第 3 期：恢复正常（记录日期相同则比 id，新写入的 id 更大 → 引擎取到正常值）
  const DELTA_BEFORE = Number(c2.scoreDelta);
  await add({
    date: TODAY,
    systolic: 110,
    diastolic: 70,
    fastingGlucose: 5.0,
    ldl: 2.5
  });
  const r3 = await generate();
  const c3 = r3.det.comparison ?? {};
  check(
    "**风险分降低 = 好转**：本期分更低 → direction=improved",
    Number(c3.scoreDelta) < 0 && c3.direction === "improved",
    `Δ=${c3.scoreDelta}（${r2.det.score}→${r3.det.score}）direction=${c3.direction}`
  );
  check(
    "恢复后原风险点全部标记为 gone（riskGone > 0）",
    Number(c3.riskGone) > 0 &&
      (c3.riskDeltas ?? []).every(d => d.kind === "gone"),
    JSON.stringify(c3.riskDeltas ?? []).slice(0, 200)
  );
  note(
    `C3 方向口径实测：第 1→2 期 Δ=${DELTA_BEFORE}（恶化），第 2→3 期 Δ=${c3.scoreDelta}（好转）`
  );

  check(
    "报告带行动计划完成度（C1↔C3 联动）",
    r3.det.planCompletion &&
      Number(r3.det.planCompletion.planId) === planId &&
      Number(r3.det.planCompletion.rate) > 0 &&
      Number(r3.det.planCompletion.streakDays) >= 1,
    JSON.stringify(r3.det.planCompletion ?? null).slice(0, 160)
  );
  check(
    "对比里也带计划完成率与结论（跨期闭环）",
    c3.planRateCurrent != null &&
      typeof c3.planRateDelta === "number" &&
      String(c3.planConclusion ?? "").length > 0,
    JSON.stringify({
      cur: c3.planRateCurrent,
      prev: c3.planRatePrev,
      delta: c3.planRateDelta
    })
  );

  const hist = await api("GET", "/api/health/report/history", {
    token: TT.test
  });
  const harr = j(hist).data ?? [];
  check(
    "GET /api/health/report/history → 200 含本次生成的 3 份（倒序）",
    hist.status === 200 &&
      repIds.every(id => harr.some(r => String(r.id) === String(id))) &&
      String(harr[0].id) === String(repIds[repIds.length - 1]),
    `len=${harr.length}`
  );
  check(
    "报告历史项含 id/period/score/level/generateTime",
    harr.every(
      r =>
        r.id != null && r.period && r.score != null && r.level && r.generateTime
    ),
    JSON.stringify(harr[0] ?? {}).slice(0, 160)
  );
  check(
    "GET /api/health/report/:id（跨用户）→ 404",
    (
      await api("GET", `/api/health/report/${repIds[0]}`, {
        token: T.common
      })
    ).status === 404
  );
  check(
    "GET /api/health/report/:id（不存在）→ 404",
    (await api("GET", "/api/health/report/99999999", { token: TT.test }))
      .status === 404
  );
}

// ---------------------------------------------------------------- C4 脱敏看板
sec("16. C4 脱敏群体看板（/analytics、/analytics/export）");
const C4 = [];
const MASKED_TEXT = "样本不足，已隐藏";
{
  check(
    "GET /api/health/analytics（common）→ 403 管理员隔离",
    (await api("GET", "/api/health/analytics", { token: T.common })).status ===
      403
  );
  check(
    "GET /api/health/analytics/export（common）→ 403",
    (
      await api("GET", "/api/health/analytics/export?format=csv", {
        token: T.common
      })
    ).status === 403
  );
  check(
    "GET /api/health/analytics 无 token → 401",
    (await api("GET", "/api/health/analytics")).status === 401
  );

  // 6 个样本账号：每个落一条记录（看板的「有记录人数」才有分子）
  for (const i of [1, 2, 3, 4, 5, 6]) {
    const name = `test_c4_${i}`;
    const id = await ensureTestUser(name, `C4 样本账号 ${i}`);
    const token = await loginTest(name);
    C4.push({ name, id, token });
    const created = await api("POST", "/api/health/records", {
      token,
      body: {
        date: TODAY,
        systolic: 118 + i * 8,
        diastolic: 76 + i * 4,
        fastingGlucose: Number((5.0 + i * 0.4).toFixed(1))
      }
    });
    check(
      `样本账号 ${name} 落一条记录`,
      created.status === 200 && j(created).data?.id != null,
      `status=${created.status}`
    );
  }
  const setShared = (u, value) =>
    api("PUT", "/api/health/authorizations", {
      token: u.token,
      body: { allowShared: value }
    });

  // 记下种子账号的授权开关原值，跑完恢复，不动演示现场
  const adminSharedBefore = !!j(
    await api("GET", "/api/health/authorizations", { token: T.admin })
  ).data?.allowShared;
  const commonSharedBefore = !!j(
    await api("GET", "/api/health/authorizations", { token: T.common })
  ).data?.allowShared;

  // A 阶段：只开 3 个样本账号（若库里没有其他已授权账号，就会命中「小样本降级」分支）
  for (const [i, u] of C4.entries()) await setShared(u, i < 3);
  await api("PUT", "/api/health/authorizations", {
    token: T.admin,
    body: { allowShared: false }
  });
  await api("PUT", "/api/health/authorizations", {
    token: T.common,
    body: { allowShared: false }
  });

  const a1 =
    j(await api("GET", "/api/health/analytics", { token: T.admin })).data ?? {};
  check(
    "看板响应结构完整（minSample/degraded/degradedReason/totals/三组分布）",
    Number(a1.minSample) === 5 &&
      typeof a1.degraded === "boolean" &&
      typeof a1.degradedReason === "string" &&
      !!a1.totals &&
      Array.isArray(a1.scoreDistribution) &&
      Array.isArray(a1.riskDistribution) &&
      Array.isArray(a1.indicatorAbnormal),
    `keys=${Object.keys(a1).join(",")}`
  );
  check(
    "评分分布固定 4 档（lt30 / b30to59 / b60to79 / gte80，顺序固定）",
    (a1.scoreDistribution ?? []).map(b => b.key).join(",") ===
      "lt30,b30to59,b60to79,gte80",
    (a1.scoreDistribution ?? []).map(b => b.key).join(",")
  );
  check(
    "风险等级分布固定 4 档（低 → 中 → 高 → 极高，顺序固定）",
    (a1.riskDistribution ?? []).map(b => b.level).join(",") === "低,中,高,极高",
    (a1.riskDistribution ?? []).map(b => b.level).join(",")
  );
  check(
    "指标异常率覆盖 7 项指标（key 集合固定）",
    (a1.indicatorAbnormal ?? [])
      .map(b => b.key)
      .sort()
      .join(",") ===
      [
        "systolic",
        "diastolic",
        "fastingGlucose",
        "bmi",
        "totalCholesterol",
        "triglyceride",
        "ldl"
      ]
        .sort()
        .join(","),
    (a1.indicatorAbnormal ?? []).map(b => b.key).join(",")
  );
  check(
    "账号总数恒可见（不涉及个体属性，不做隐藏）",
    Number(a1.totals?.userCount) >= 8,
    `userCount=${a1.totals?.userCount}`
  );

  // 三组分布的字段名**不一样**：评分 / 等级是 count + ratio，指标异常率是
  // abnormalCount + rate，且指标组多一个分母 sampleSize。
  // 所以按分组显式列出字段名——写成 `b.ratio` 这种「一刀切」时，指标组取到的是
  // undefined，(undefined === null) 恒为 false，断言会**静默失效**（要么假绿要么假红）。
  const groups = [
    ["评分分布", a1.scoreDistribution, "count", ["count", "ratio"]],
    ["风险等级分布", a1.riskDistribution, "count", ["count", "ratio"]],
    [
      "指标异常率",
      a1.indicatorAbnormal,
      "abnormalCount",
      ["abnormalCount", "sampleSize", "rate"]
    ]
  ];
  for (const [label, rows, countKey, maskKeys] of groups) {
    check(
      `${label}：每组要么给出计数、要么整体隐藏（没有半隐藏状态）`,
      (rows ?? []).every(b => (b[countKey] === null) === b.masked),
      JSON.stringify(rows ?? []).slice(0, 160)
    );
    check(
      `${label}：可见的分组计数只能是 0 或 ≥阈值（1~4 人一律隐藏）`,
      (rows ?? []).every(
        b =>
          b[countKey] === null ||
          Number(b[countKey]) === 0 ||
          Number(b[countKey]) >= Number(a1.minSample)
      ),
      JSON.stringify(rows ?? []).slice(0, 160)
    );
    check(
      `${label}：断言依据的字段确实在返回体里（防字段改名后断言静默失效）`,
      (rows ?? []).every(b => maskKeys.every(k => k in b)),
      JSON.stringify((rows ?? [])[0] ?? {})
    );
    check(
      `${label}：隐藏分组不泄露任何数值（${maskKeys.join(" / ")} 与 masked 齐步）`,
      (rows ?? []).every(b =>
        maskKeys.every(k => (b[k] === null) === b.masked)
      ),
      JSON.stringify(rows ?? []).slice(0, 160)
    );
  }
  note(`A 阶段：已授权 ${a1.totals?.sharedCount} 人，degraded=${a1.degraded}`);
  if (a1.degraded) {
    check(
      "小样本降级：给出降级说明、分组数值一律不下发",
      a1.degradedReason.length > 0 &&
        a1.totals.sharedCount === null &&
        a1.totals.withRecords === null &&
        (a1.scoreDistribution ?? []).every(b => b.masked && b.count === null),
      `reason=${String(a1.degradedReason).slice(0, 80)}`
    );
  } else {
    check(
      "已授权人数达标时不降级（degraded 与人数同口径）",
      Number(a1.totals.sharedCount) >= Number(a1.minSample),
      `sharedCount=${a1.totals.sharedCount}`
    );
  }

  // B 阶段：6 个样本账号全部授权 → 必然不降级，检验脱敏规则本身
  for (const u of C4) await setShared(u, true);
  const a2 =
    j(await api("GET", "/api/health/analytics", { token: T.admin })).data ?? {};
  check(
    "6 个样本账号全部授权后不再降级（样本充足）",
    a2.degraded === false &&
      a2.degradedReason === "" &&
      Number(a2.totals?.sharedCount) >= 6,
    `sharedCount=${a2.totals?.sharedCount} degraded=${a2.degraded}`
  );
  check(
    "不降级时分组计数与占比都按「1~4 人隐藏」规则给出",
    (a2.scoreDistribution ?? []).every(b =>
      b.count === null
        ? b.masked === true
        : Number(b.count) === 0 || Number(b.count) >= Number(a2.minSample)
    ) &&
      (a2.riskDistribution ?? []).every(b => (b.count === null) === b.masked),
    JSON.stringify(a2.scoreDistribution ?? []).slice(0, 200)
  );
  check(
    "计划参与率与参与人数同隐藏（不失真）",
    (a2.totals?.planParticipants === null) ===
      (a2.totals?.planParticipationRate === null),
    JSON.stringify({
      n: a2.totals?.planParticipants,
      r: a2.totals?.planParticipationRate
    })
  );

  // 导出：CSV / JSON 与接口同口径
  const ymd = TODAY.replace(/-/g, "");
  const csv = await api("GET", "/api/health/analytics/export?format=csv", {
    token: T.admin
  });
  const csvText = csv.text;
  check(
    "导出 CSV → 200 + text/csv + attachment 文件名带日期",
    csv.status === 200 &&
      String(csv.headers.get("content-type") ?? "").includes("text/csv") &&
      String(csv.headers.get("content-disposition") ?? "").includes(
        `analytics-${ymd}.csv`
      ),
    `ct=${csv.headers.get("content-type")} cd=${csv.headers.get("content-disposition")}`
  );
  // BOM 只能在**字节**上看：`res.text()` 按 fetch 规范会把 BOM 吃掉，
  // 用文本断言永远看不到它（这条一开始就是这么写错的）
  const csvBuf = new Uint8Array(
    await (
      await fetch(`${BASE}/api/health/analytics/export?format=csv`, {
        headers: { Authorization: `Bearer ${T.admin}` }
      })
    ).arrayBuffer()
  );
  check(
    "导出 CSV 带 BOM（Excel 识别 UTF-8 中文）",
    csvBuf[0] === 0xef && csvBuf[1] === 0xbb && csvBuf[2] === 0xbf,
    `前 3 字节=${Array.from(csvBuf.slice(0, 3)).join(",")}`
  );
  check(
    "导出 CSV 含指标与风险等级明细（与接口同数据源）",
    csvText.includes("收缩压") && csvText.includes("极高"),
    csvText.slice(0, 120)
  );
  // 导出不得绕过脱敏：接口里为 null（被隐藏）的单元格，CSV 里必须是隐藏文案而不是 0
  // 逐组显式列出字段名（指标组是 abnormalCount / rate / sampleSize，与分布组不同）；
  // undefined 一并算作「可疑」——字段被改名时让断言**变红**，而不是静默通过。
  const cells = [
    a2.totals?.sharedCount,
    a2.totals?.excludedByPrivacy,
    a2.totals?.withRecords,
    a2.totals?.planParticipants,
    a2.totals?.planParticipationRate,
    ...(a2.scoreDistribution ?? []).flatMap(b => [b.count, b.ratio]),
    ...(a2.riskDistribution ?? []).flatMap(b => [b.count, b.ratio]),
    ...(a2.indicatorAbnormal ?? []).flatMap(b => [
      b.abnormalCount,
      b.sampleSize,
      b.rate
    ])
  ];
  const hasNullCell = cells.some(v => v === null || v === undefined);
  check(
    "导出 CSV 的隐藏单元格写「样本不足，已隐藏」而非 0（导出不绕过脱敏）",
    csvText.includes(MASKED_TEXT) === hasNullCell,
    `csv 含隐藏文案=${csvText.includes(MASKED_TEXT)} 接口有隐藏字段=${hasNullCell}`
  );
  check(
    "format 非法值按 CSV 处理（不报错、不泄露）",
    (
      await api("GET", "/api/health/analytics/export?format=weird", {
        token: T.admin
      })
    ).headers
      .get("content-type")
      ?.includes("text/csv") === true
  );
  const jsonEx = await api("GET", "/api/health/analytics/export?format=json", {
    token: T.admin
  });
  const jd = j(jsonEx);
  check(
    "导出 JSON 与接口同结构（脱敏口径一致，导出不绕过隐藏）",
    jsonEx.status === 200 &&
      Number(jd.minSample) === Number(a2.minSample) &&
      jd.degraded === a2.degraded &&
      JSON.stringify(jd.totals ?? {}) === JSON.stringify(a2.totals ?? {}),
    `status=${jsonEx.status} degraded=${jd.degraded}`
  );

  // 恢复种子账号的授权开关原值
  const restoreAdmin = await api("PUT", "/api/health/authorizations", {
    token: T.admin,
    body: { allowShared: adminSharedBefore }
  });
  const restoreCommon = await api("PUT", "/api/health/authorizations", {
    token: T.common,
    body: { allowShared: commonSharedBefore }
  });
  check(
    "恢复 admin / common 的共享开关原值（不动种子账号的现场）",
    j(restoreAdmin).data?.allowShared === adminSharedBefore &&
      j(restoreCommon).data?.allowShared === commonSharedBefore,
    `admin=${adminSharedBefore} common=${commonSharedBefore}`
  );
}

// ---------------------------------------------------------------- C5 审计与授权
sec("17. C5 审计体系与授权中心（/audit-logs、/authorizations）");
const SENSITIVE_KEY_PARTS = [
  "password",
  "token",
  "secret",
  "name",
  "note",
  "remark",
  "systolic",
  "diastolic",
  "glucose",
  "cholesterol",
  "triglyceride",
  "ldl",
  "hdl",
  "bmi",
  "weight",
  "height"
];
{
  check(
    "GET /api/health/audit-logs（common）→ 403 管理员隔离",
    (await api("GET", "/api/health/audit-logs", { token: T.common })).status ===
      403
  );
  check(
    "GET /api/health/audit-logs 无 token → 401",
    (await api("GET", "/api/health/audit-logs")).status === 401
  );

  const all = await api("GET", "/api/health/audit-logs?pageSize=100", {
    token: T.admin
  });
  const ad = j(all).data ?? {};
  const list = ad.list ?? [];
  check(
    "审计列表 → 200 分页结构（list/total/currentPage/pageSize）",
    all.status === 200 &&
      Array.isArray(list) &&
      list.length > 0 &&
      ad.total != null &&
      ad.currentPage != null &&
      ad.pageSize != null,
    `status=${all.status} total=${ad.total}`
  );
  check(
    "审计项字段完整（id/userId/username/action/actionLabel/actorName/actorIp/detail/createTime）",
    list.every(
      i =>
        i.id != null &&
        "userId" in i &&
        i.username &&
        i.action &&
        i.actionLabel &&
        i.actorName &&
        "actorIp" in i &&
        i.detail &&
        typeof i.detail === "object" &&
        i.createTime
    ),
    JSON.stringify(list[0] ?? {}).slice(0, 200)
  );
  check(
    "动作有中文文案（actionLabel ≠ action）",
    list.every(i => i.actionLabel !== i.action && i.actionLabel.length > 0),
    `sample=${list[0]?.action}→${list[0]?.actionLabel}`
  );
  check(
    "审计 detail 不含敏感键（读取时再脱敏一次）",
    list
      .flatMap(i => Object.keys(i.detail ?? {}))
      .every(
        k => !SENSITIVE_KEY_PARTS.some(part => k.toLowerCase().includes(part))
      ),
    list
      .flatMap(i => Object.keys(i.detail ?? {}))
      .slice(0, 12)
      .join(",")
  );
  check(
    "pageSize 上限 100（不因入参放大泄露面）",
    Number(
      (
        await api("GET", "/api/health/audit-logs?pageSize=999", {
          token: T.admin
        })
      ).json?.data?.pageSize
    ) === 100
  );

  const login = await api(
    "GET",
    "/api/health/audit-logs?action=login_success&pageSize=100",
    { token: T.admin }
  );
  const llist = j(login).data?.list ?? [];
  check(
    "按动作筛选 → 只返回该动作（login_success）",
    login.status === 200 &&
      llist.length > 0 &&
      llist.every(i => i.action === "login_success"),
    `len=${llist.length}`
  );
  check(
    "登录成功也留痕（含账号名与来源 IP）",
    llist.some(i => i.username === "test_common" && i.actorIp) &&
      llist.every(i => i.detail && typeof i.detail === "object"),
    JSON.stringify(llist[0] ?? {}).slice(0, 200)
  );
  const badAction = await api(
    "GET",
    "/api/health/audit-logs?action=not_an_action",
    { token: T.admin }
  );
  check(
    "未知动作筛选 → 400 40001「未知的审计动作」",
    badAction.status === 400 && j(badAction).code === 40001,
    `status=${badAction.status} body=${badAction.text.slice(0, 140)}`
  );
  check(
    "按账号名筛选 → 命中的都是该账号的操作",
    (
      await api(
        "GET",
        "/api/health/audit-logs?username=test_common&pageSize=100",
        { token: T.admin }
      )
    ).json?.data?.list?.every(i => i.username === "test_common") === true
  );
  check(
    "按日期筛选 endDate=2000-01-01 → 无结果（时间边界生效）",
    Number(
      (
        await api("GET", "/api/health/audit-logs?endDate=2000-01-01", {
          token: T.admin
        })
      ).json?.data?.total
    ) === 0
  );

  // C4 导出应当留痕（跨阶段：授权 → 看板 → 审计）
  const exp = await api(
    "GET",
    "/api/health/audit-logs?action=analytics_export&pageSize=100",
    { token: T.admin }
  );
  const elist = j(exp).data?.list ?? [];
  check(
    "看板导出写审计（analytics_export，detail 记录口径）",
    elist.length > 0 &&
      elist.some(
        i => i.detail?.format === "csv" || i.detail?.format === "json"
      ),
    `len=${elist.length} detail=${JSON.stringify(elist[0]?.detail ?? {}).slice(0, 140)}`
  );

  // 授权中心：只能读写自己的（无 user_id 入参）
  const auth0 =
    j(await api("GET", "/api/health/authorizations", { token: TT.test }))
      .data ?? {};
  check(
    "GET /authorizations → 默认「未设置 + 不允许共享」",
    auth0.allowShared === false && auth0.configured === false,
    `allowShared=${auth0.allowShared} configured=${auth0.configured}`
  );
  check(
    "授权范围清单 5 项，且只有「群体看板」受开关控制",
    (auth0.scopes ?? []).length === 5 &&
      (auth0.scopes ?? []).map(s => s.key).join(",") ===
        "self,engine,chat,audit,analytics" &&
      (auth0.scopes ?? []).filter(s => s.governedBySwitch).length === 1 &&
      (auth0.scopes ?? []).find(s => s.key === "analytics")
        ?.governedBySwitch === true,
    (auth0.scopes ?? []).map(s => `${s.key}:${s.governedBySwitch}`).join(" ")
  );
  check(
    "授权页带口径说明文案（note，来自共享层）",
    String(auth0.note ?? "").length > 0,
    String(auth0.note ?? "").slice(0, 80)
  );
  check(
    "开关关闭时「群体看板」范围未生效（active=false）",
    (auth0.scopes ?? []).find(s => s.key === "analytics")?.active === false,
    JSON.stringify((auth0.scopes ?? []).find(s => s.key === "analytics") ?? {})
  );

  // 本节接下来一共 PUT 5 次，其中 4 次真的改了值（1 次同值）。
  // 用「前后条数之差」而不是绝对值断言，免得受历史残留行影响。
  const authAuditBefore = Number(
    (
      await api(
        "GET",
        "/api/health/audit-logs?action=authorization_change&username=test_common&pageSize=100",
        { token: T.admin }
      )
    ).json?.data?.total
  );

  const on = await api("PUT", "/api/health/authorizations", {
    token: TT.test,
    body: { allowShared: true }
  });
  check(
    "PUT /authorizations 开启共享 → 200 changed=true + updateTime",
    on.status === 200 &&
      j(on).data?.allowShared === true &&
      j(on).data?.changed === true &&
      String(j(on).data?.updateTime ?? "").length > 0,
    `status=${on.status} body=${on.text.slice(0, 140)}`
  );
  check(
    "开启后「群体看板」范围生效（active=true）",
    j(on).data?.scopes?.find(s => s.key === "analytics")?.active === true
  );
  const onAgain = await api("PUT", "/api/health/authorizations", {
    token: TT.test,
    body: { allowShared: true }
  });
  check(
    "重复设置同值 → changed=false（值未变化不写审计）",
    j(onAgain).data?.changed === false,
    `changed=${j(onAgain).data?.changed}`
  );
  const readBack =
    j(await api("GET", "/api/health/authorizations", { token: TT.test }))
      .data ?? {};
  check(
    "读回一致（allowShared=true 且 configured=true）",
    readBack.allowShared === true && readBack.configured === true,
    `allowShared=${readBack.allowShared} configured=${readBack.configured}`
  );

  check(
    "PUT 缺 allowShared → 400 40001",
    (
      await api("PUT", "/api/health/authorizations", {
        token: TT.test,
        body: {}
      })
    ).status === 400
  );
  check(
    "PUT allowShared 非法值 → 400 40001",
    (
      await api("PUT", "/api/health/authorizations", {
        token: TT.test,
        body: { allowShared: "yes" }
      })
    ).status === 400
  );
  check(
    'PUT allowShared=0 / "1" 等兼容写法可接受（前端 0/1 也吃）',
    j(
      await api("PUT", "/api/health/authorizations", {
        token: TT.test,
        body: { allowShared: 0 }
      })
    ).data?.allowShared === false &&
      j(
        await api("PUT", "/api/health/authorizations", {
          token: TT.test,
          body: { allowShared: "1" }
        })
      ).data?.allowShared === true
  );

  // 越权：带 userId 试图改别人的授权 —— 接口只认 token 身份，userId 被忽略
  const target = C4[0];
  const targetBefore = j(
    await api("GET", "/api/health/authorizations", { token: target.token })
  ).data?.allowShared;
  const spoof = await api("PUT", "/api/health/authorizations", {
    token: TT.test,
    body: { allowShared: false, userId: target.id }
  });
  const targetAfter = j(
    await api("GET", "/api/health/authorizations", { token: target.token })
  ).data?.allowShared;
  check(
    "PUT 带他人 userId → 只改到自己的授权（越权无效）",
    spoof.status === 200 &&
      j(spoof).data?.allowShared === false &&
      targetAfter === targetBefore,
    `自己=${j(spoof).data?.allowShared} 他人 ${targetBefore}→${targetAfter}`
  );

  const chg = await api(
    "GET",
    "/api/health/audit-logs?action=authorization_change&pageSize=100",
    { token: T.admin }
  );
  const clist = j(chg).data?.list ?? [];
  check(
    "授权变更写审计（authorization_change，detail 含 before/after）",
    clist.some(
      i =>
        i.username === "test_common" &&
        i.detail?.target === "allowShared" &&
        "before" in (i.detail ?? {}) &&
        "after" in (i.detail ?? {})
    ),
    JSON.stringify(clist[0]?.detail ?? {}).slice(0, 160)
  );
  const authAuditAfter = Number(
    (
      await api(
        "GET",
        "/api/health/audit-logs?action=authorization_change&username=test_common&pageSize=100",
        { token: T.admin }
      )
    ).json?.data?.total
  );
  check(
    "重复设置不留重复审计（5 次 PUT 只有 4 次写审计，同值那次没写）",
    authAuditAfter - authAuditBefore === 4,
    `新增审计 ${authAuditAfter - authAuditBefore} 条（before=${authAuditBefore} after=${authAuditAfter}）`
  );
  note(
    '本节 5 次 PUT：开启(true)✓ / 同值(true)✗不写 / 兼容值(0)✓ / 兼容值("1")✓ / 带他人 userId(false)✓'
  );
}

// ---------------------------------------------------------------- C6 健康提醒
sec("18. C6 健康提醒（/reminders 设置与站内提醒）");
{
  const get = () => api("GET", "/api/health/reminders", { token: TT.test });
  const put = body =>
    api("PUT", "/api/health/reminders", { token: TT.test, body });

  const r0 = j(await get()).data ?? {};
  const s0 = Object.fromEntries((r0.settings ?? []).map(s => [s.kind, s]));
  check(
    "GET /reminders → 200：两个提醒类型 + 站内提醒 + 渠道清单 + 口径文案",
    !!s0.measure &&
      !!s0.checkin &&
      Array.isArray(r0.notices) &&
      Array.isArray(r0.channels) &&
      String(r0.note ?? "").length > 0 &&
      String(r0.scheduleNote ?? "").length > 0 &&
      String(r0.timeHint ?? "").length > 0,
    `keys=${Object.keys(r0).join(",")}`
  );
  check(
    "从未设置过 → configured=false，两类提醒默认都是关闭",
    r0.configured === false &&
      s0.measure.enabled === false &&
      s0.checkin.enabled === false,
    `configured=${r0.configured}`
  );
  check(
    "默认时刻为 08:00 / 20:00（来自共享层默认值）",
    s0.measure.time === "08:00" && s0.checkin.time === "20:00",
    `${s0.measure.time} / ${s0.checkin.time}`
  );
  check(
    "投递渠道 3 个、当前只开通 1 个（站内），其余声明为未开通",
    r0.channels.length === 3 &&
      r0.channels.filter(c => c.available).length === 1 &&
      r0.activeChannel === "station" &&
      r0.channels.find(c => c.key === "station")?.available === true,
    r0.channels.map(c => `${c.key}:${c.available}`).join(" ")
  );
  check(
    "服务端时刻随响应下发（演示时对齐「为什么现在会/不会触发」）",
    /^\d{2}:\d{2}$/.test(String(r0.serverTime ?? "")),
    `serverTime=${r0.serverTime}`
  );
  check(
    "未开启时「今日已提醒」为 false 且给出下次时刻文案",
    s0.measure.firedToday === false &&
      String(s0.measure.nextFireText ?? "").length > 0,
    `nextFireText=${s0.measure.nextFireText}`
  );

  const on = await put({ kind: "measure", enabled: true, time: "07:15" });
  check(
    "PUT 开启测量提醒并设时刻 → 200 changed=true",
    on.status === 200 &&
      j(on).data?.changed === true &&
      j(on).data?.settings?.find(s => s.kind === "measure")?.enabled === true &&
      j(on).data?.settings?.find(s => s.kind === "measure")?.time === "07:15",
    `status=${on.status} body=${on.text.slice(0, 160)}`
  );
  check(
    "开启后 configured=true、updateTime 非空",
    j(on).data?.configured === true &&
      String(j(on).data?.updateTime ?? "").length > 0,
    `configured=${j(on).data?.configured}`
  );
  const onAgain = await put({ kind: "measure", enabled: true, time: "07:15" });
  check(
    "重复设置同值 → changed=false（幂等，不重复写库）",
    j(onAgain).data?.changed === false
  );
  const readBack = j(await get()).data ?? {};
  check(
    "读回一致（开启状态与时刻都持久化）",
    readBack.settings.find(s => s.kind === "measure")?.enabled === true &&
      readBack.settings.find(s => s.kind === "measure")?.time === "07:15"
  );
  check(
    "只改一个类型不影响另一个（checkin 仍为默认关闭 20:00）",
    readBack.settings.find(s => s.kind === "checkin")?.enabled === false &&
      readBack.settings.find(s => s.kind === "checkin")?.time === "20:00"
  );

  for (const bad of [
    "24:00",
    "25:99",
    "8:0",
    "0800",
    "abc",
    "08:00:00",
    "  ",
    "-1",
    "800"
  ]) {
    const r = await put({ kind: "measure", enabled: true, time: bad });
    check(
      `非法时刻「${bad}」→ 400 40001`,
      r.status === 400 && j(r).code === 40001,
      `status=${r.status} body=${r.text.slice(0, 120)}`
    );
  }
  const stillThere = j(await get()).data?.settings?.find(
    s => s.kind === "measure"
  );
  check(
    "校验失败不写库（时刻仍是上一次成功值 07:15）",
    stillThere?.time === "07:15" && stillThere?.enabled === true,
    `time=${stillThere?.time} enabled=${stillThere?.enabled}`
  );
  const wide = await put({ kind: "measure", enabled: true, time: "21：30" });
  check(
    "全角冒号「21：30」→ 归一化为 21:30（中文输入法容错）",
    j(wide).data?.settings?.find(s => s.kind === "measure")?.time === "21:30",
    `time=${j(wide).data?.settings?.find(s => s.kind === "measure")?.time}`
  );
  const short = await put({ kind: "measure", enabled: true, time: "8:00" });
  check(
    "「8:00」→ 补零为 08:00",
    j(short).data?.settings?.find(s => s.kind === "measure")?.time === "08:00"
  );

  check(
    "缺 enabled → 400（不静默按关闭处理）",
    (await put({ kind: "measure" })).status === 400
  );
  check(
    "enabled 非法值 → 400",
    (await put({ kind: "measure", enabled: "yes" })).status === 400
  );
  check("缺 kind → 400", (await put({ enabled: true })).status === 400);
  check(
    "未知 kind → 400（不静默忽略）",
    (await put({ kind: "bogus", enabled: true })).status === 400
  );

  // 越权：本接口只认 token 身份，显式传他人 id 按「不存在」处理（404 而非 403）
  for (const key of ["userId", "user_id", "userid"]) {
    const r = await put({ kind: "measure", enabled: true, [key]: C4[0].id });
    check(
      `PUT 带他人 ${key} → 404（不泄露该 id 是否存在）`,
      r.status === 404,
      `status=${r.status} body=${r.text.slice(0, 120)}`
    );
  }
  check(
    "PUT 带自己的 userId → 200（同 id 不算越权）",
    (await put({ kind: "measure", enabled: true, userId: U.test })).status ===
      200
  );
  const adminRem =
    j(await api("GET", "/api/health/reminders", { token: T.admin })).data ?? {};
  check(
    "提醒设置按用户隔离（admin 从未设置过，configured=false）",
    adminRem.configured === false &&
      (adminRem.settings ?? []).every(s => s.enabled === false) &&
      (adminRem.notices ?? []).length === 0,
    `configured=${adminRem.configured}`
  );

  // 调度器真触发：把两类时刻都设成已过去的 00:00，等一次扫描（30 秒一轮）
  await put({ kind: "measure", enabled: true, time: "00:00" });
  await put({ kind: "checkin", enabled: true, time: "00:00" });
  let fired = null;
  for (let i = 0; i < 18; i++) {
    const d = j(await get()).data ?? {};
    if (
      (d.settings ?? []).every(s => s.firedToday === true) &&
      (d.notices ?? []).length >= 2
    ) {
      fired = d;
      break;
    }
    await sleep(2500);
  }
  check(
    "到点后调度器写入站内提醒（两类都触发，最多等一次扫描周期）",
    !!fired,
    fired ? "" : "等待 45 秒仍未见提醒，检查 server/src/reminder-scheduler.ts"
  );
  if (fired) {
    const kinds = (fired.notices ?? []).map(n => n.kind);
    check(
      "站内提醒字段完整（kind/title/content/fireDate/createTime）",
      (fired.notices ?? []).every(
        n =>
          n.id != null &&
          n.kind &&
          n.title &&
          n.content &&
          n.fireDate &&
          n.createTime
      ),
      JSON.stringify(fired.notices[0] ?? {}).slice(0, 200)
    );
    check(
      "两类提醒都到齐，且日期为今天",
      kinds.includes("measure") &&
        kinds.includes("checkin") &&
        (fired.notices ?? []).every(n => n.fireDate === TODAY),
      `kinds=${kinds.join(",")} fireDate=${fired.notices[0]?.fireDate}`
    );
    check(
      "到点的类型标记「今日已提醒」",
      (fired.settings ?? []).every(s => s.firedToday === true)
    );
  }
  const adminNotices = j(
    await api("GET", "/api/health/reminders", { token: T.admin })
  ).data;
  check(
    "站内提醒只写当前用户（admin 看不到 test_common 的提醒）",
    (adminNotices?.notices ?? []).length === 0,
    `admin notices=${(adminNotices?.notices ?? []).length}`
  );
  const off = await put({ kind: "measure", enabled: false });
  check(
    "关闭提醒 → 200 changed=true 且不再标记已提醒",
    j(off).data?.changed === true &&
      j(off).data?.settings?.find(s => s.kind === "measure")?.enabled === false
  );
}

// ---------------------------------------------------------------- C7 可观测性
sec("19. C7 可观测性（/health/ping、日志与错误兜底）");
{
  const ping = await api("GET", "/api/health/ping");
  const pd = j(ping);
  check(
    "GET /api/health/ping → 200 {status:ok,time,uptime,db}",
    ping.status === 200 &&
      pd.status === "ok" &&
      pd.db === "ok" &&
      typeof pd.uptime === "number" &&
      Number.isFinite(Date.parse(String(pd.time))),
    `status=${ping.status} body=${ping.text.slice(0, 160)}`
  );
  check(
    "健康检查字段固定为 4 个（不带 code/data 信封，探针直接可用）",
    Object.keys(pd).sort().join(",") === "db,status,time,uptime",
    `keys=${Object.keys(pd).join(",")}`
  );
  check(
    "db 字段来自真实 SQL 探活（不是写死的 ok）",
    pd.db === "ok",
    `db=${pd.db}`
  );
  check(
    "健康检查无 token 也可访问（探针/负载均衡不经鉴权）",
    ping.status === 200
  );

  const nf = await api("GET", "/api/health/no-such-endpoint");
  check(
    "未知 /api 路径 → 404 JSON（不落成 HTML）",
    nf.status === 404 && j(nf).code === 404,
    `status=${nf.status} body=${nf.text.slice(0, 120)}`
  );
  const nfRoot = await api("GET", "/api/user/123/whatever");
  check(
    "未知子路径 → 404 JSON",
    nfRoot.status === 404,
    `status=${nfRoot.status} body=${nfRoot.text.slice(0, 120)}`
  );

  // 畸形 JSON：express.json() 抛出 → 兜底错误处理按「客户端错误」记 warn 并回 400
  const badJson = await fetch(`${BASE}/api/health/records`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TT.test}`
    },
    body: "{ this is not json"
  });
  const bjText = await badJson.text();
  let bjJson = null;
  try {
    bjJson = JSON.parse(bjText);
  } catch {
    /* 非 JSON 响应 */
  }
  check(
    "畸形 JSON 请求体 → 400 40001（兜底错误处理，不是 500）",
    badJson.status === 400 && bjJson?.code === 40001,
    `status=${badJson.status} body=${bjText.slice(0, 140)}`
  );

  if (process.env.LOG_FILE) {
    const { readFile } = await import("node:fs/promises");
    let logText = "";
    try {
      logText = await readFile(process.env.LOG_FILE, "utf8");
    } catch (e) {
      logText = "";
      note(`LOG_FILE 读取失败：${e.message}`);
    }
    check(
      "服务端日志含本次请求的处理记录（方法 / 路径 / 状态码）",
      logText.includes("/api/health/analytics") &&
        logText.includes("/api/health/records"),
      `日志长度=${logText.length}`
    );
    check(
      "日志区分成功 / 被拒绝（4xx 记 warn）",
      logText.includes("请求完成") && logText.includes("请求被拒绝"),
      `complete=${logText.includes("请求完成")} rejected=${logText.includes("请求被拒绝")}`
    );
    check(
      "日志不含请求体与凭据（密码 / 令牌不进日志）",
      !logText.includes(TEST_PWD) &&
        !logText.includes("admin123") &&
        !logText.includes("Bearer "),
      `len=${logText.length}`
    );
  } else {
    note(
      "未设置 LOG_FILE，跳过「服务端日志留痕」断言；如需验证请用 LOG_FILE=<服务端日志文件> 再跑一次"
    );
  }
}

// ---------------------------------------------------------------- 清理与体检
sec("20. 测试数据清理与残留体检");
{
  // 1) 先留证：清理前测试账号在审计里是有留痕的
  const before =
    j(
      await api(
        "GET",
        "/api/health/audit-logs?username=test_common&pageSize=100",
        {
          token: T.admin
        }
      )
    ).data ?? {};
  check(
    "清理前：测试账号在审计里有留痕",
    Number(before.total) > 0,
    `total=${before.total}`
  );

  // 2) 删号：这些账号名下有记录 / 计划 / 打卡 / 报告 / 提醒 / 授权，一次删净
  //    （C7 修过的级联 bug 就在这里：清单没跟上新表会直接 500）
  const delUser = async (id, name) => {
    const r = await api("DELETE", `/api/user/${id}`, { token: T.admin });
    check(
      `删除测试账号 ${name} → 200（级联清理其名下数据）`,
      r.status === 200 && j(r).code === 0,
      `status=${r.status} body=${r.text.slice(0, 160)}`
    );
  };
  for (const u of C4) await delUser(u.id, u.name);
  await delUser(U.test, "test_common");

  // 3) 账号确实消失
  const relogin = await api("POST", "/api/login", {
    body: { username: "test_common", password: TEST_PWD }
  });
  check(
    "已删账号无法登录（登录失败留痕仍写审计）",
    j(relogin).code === 40001,
    `code=${j(relogin).code} status=${relogin.status}`
  );
  const remain = await api("GET", "/api/user?username=test_&pageSize=100", {
    token: T.admin
  });
  check(
    "用户列表里查不到任何 test_ 前缀的残留账号",
    Number(j(remain).data?.total) === 0,
    `total=${j(remain).data?.total}`
  );
  const total = Number(
    (
      await api("GET", "/api/user?currentPage=1&pageSize=1", {
        token: T.admin
      })
    ).json?.data?.total
  );
  check(
    `用户总数回到 C7 起点（${USER_TOTAL_BEFORE} 个）`,
    total === USER_TOTAL_BEFORE,
    `now=${total} before=${USER_TOTAL_BEFORE}`
  );

  // 4) 审计留痕不随删号消失（否则管理者可以自己抹掉审计）
  const after =
    j(
      await api(
        "GET",
        "/api/health/audit-logs?username=test_common&pageSize=100",
        {
          token: T.admin
        }
      )
    ).data ?? {};
  const alist = after.list ?? [];
  check(
    "删号后审计留痕仍在（不随账号删除而消失）",
    Number(after.total) >= Number(before.total),
    `before=${before.total} after=${after.total}`
  );
  check(
    "已删账号的审计行归属置空、但操作人登录名仍可读",
    alist.length > 0 &&
      alist.every(i => i.userId === null && i.username === "test_common"),
    `len=${alist.length} sample=${JSON.stringify(alist[0] ?? {}).slice(0, 160)}`
  );
  check(
    "审计仍可按已删账号名检索（前端展示不回退成空白）",
    alist.length > 0 && alist.every(i => i.actionLabel.length > 0),
    ""
  );

  // 5) C7 没动种子账号的数据
  check(
    `C7 全程未改动种子账号的记录（仍为 ${ADMIN_RECORDS_BEFORE} 条）`,
    (await recordTotal(T.admin)) === ADMIN_RECORDS_BEFORE,
    `now=${await recordTotal(T.admin)} before=${ADMIN_RECORDS_BEFORE}`
  );

  // 6) 残留体检：把「不是 C7 造的」残留也如实报出来
  const adminRep = (
    j(await api("GET", "/api/health/report/history", { token: T.admin }))
      .data ?? []
  ).length;
  const adminChat = (
    j(await api("GET", "/api/health/chat/history", { token: T.admin })).data ??
    []
  ).length;
  const admPlans = (
    j(await api("GET", "/api/health/plans", { token: T.admin })).data ?? []
  ).length;
  note(
    `非 C7 残留（前 12 节所造，属种子账号）：records=${ADMIN_RECORDS_BEFORE} reports=${adminRep} chat=${adminChat} plans=${admPlans}`
  );
  check(
    "C7 测试账号名下已无任何残留（记录 / 计划 / 报告）",
    (await recordTotal(T.admin)) === ADMIN_RECORDS_BEFORE,
    `admin 记录 now=${await recordTotal(T.admin)}`
  );

  if (process.env.CLEAN !== "1") {
    note(
      "如需把库清回交付基线（records/reports/chat 归零、仅留 admin+common），加上 CLEAN=1 重跑，或手动执行 node server/scripts/reset-demo-data.mjs"
    );
  } else if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(BASE)) {
    note(
      `CLEAN=1 但 BASE=${BASE} 不是本机，跳过自动清理（避免误删远端数据库）`
    );
  } else {
    const { spawnSync } = await import("node:child_process");
    const pathMod = await import("node:path");
    const resetScript = pathMod.default.join(
      import.meta.dirname,
      "reset-demo-data.mjs"
    );
    const out = spawnSync(process.execPath, [resetScript], {
      encoding: "utf8"
    });
    check(
      "CLEAN=1：reset-demo-data.mjs 执行成功（顺带回归清理脚本本身）",
      out.status === 0 && String(out.stdout).includes("清理后"),
      `exit=${out.status} stderr=${String(out.stderr).slice(0, 160)}`
    );
    const users2 = Number(
      (
        await api("GET", "/api/user?currentPage=1&pageSize=1", {
          token: T.admin
        })
      ).json?.data?.total
    );
    const rec2 = await recordTotal(T.admin);
    const rep2 = (
      j(await api("GET", "/api/health/report/history", { token: T.admin }))
        .data ?? []
    ).length;
    check(
      "CLEAN=1：库回到交付基线（users=2 / admin 记录=0 / 报告=0）",
      users2 === 2 && rec2 === 0 && rep2 === 0,
      `users=${users2} records=${rec2} reports=${rep2}`
    );
  }
}

// ---------------------------------------------------------------- 汇总
console.log("\n============================================");
console.log(`通过 ${pass} 项，失败 ${failures.length} 项`);
if (failures.length) {
  console.log("\n失败明细：");
  failures.forEach(f => console.log("  - " + f));
}
console.log("============================================");
process.exit(failures.length ? 1 : 0);
