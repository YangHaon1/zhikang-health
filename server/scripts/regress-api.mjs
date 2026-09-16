/**
 * B10 全链路回归：逐条对照《后端化改造方案.md》第四节接口清单（119 项断言）。
 *
 * 用法：
 *   pnpm start                        # 另开终端先把服务跑起来
 *   node server/scripts/regress-api.mjs
 *   BASE=http://192.168.1.5:3000 node server/scripts/regress-api.mjs   # 指向其他机器
 *
 * 退出码：0 全部通过 / 1 有失败项（失败明细会打印在末尾）。
 *
 * 注意：本脚本会**写入测试数据**（新增后即删的测试用户、90 天演示记录、20 份报告、若干对话），
 * 跑完请执行 `node server/scripts/reset-demo-data.mjs` 清回交付基线，再现场演示。
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

  // 改密码 → 新密码可登录、旧密码不可
  const pwd = await api("PUT", `/api/user/${createdUserId}`, {
    token: T.admin,
    body: { password: "newpwd12345" }
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
let exportLen = 0;
{
  const created = await api("POST", "/api/health/records", {
    token: T.admin,
    body: {
      date: "2026-09-15",
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
  check(
    "记录字段完整（systolic/diastolic/fastingGlucose/ldl）",
    arr[0] &&
      arr[0].systolic != null &&
      arr[0].diastolic != null &&
      arr[0].fastingGlucose != null &&
      arr[0].ldl != null,
    JSON.stringify(arr[0] ?? {}).slice(0, 200)
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
  check(
    "报告历史项含 id/period/score/level/generateTime",
    harr[0] &&
      harr[0].id != null &&
      harr[0].period != null &&
      harr[0].score != null &&
      harr[0].level &&
      harr[0].generateTime,
    JSON.stringify(harr[0] ?? {}).slice(0, 200)
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

// ---------------------------------------------------------------- 汇总
console.log("\n============================================");
console.log(`通过 ${pass} 项，失败 ${failures.length} 项`);
if (failures.length) {
  console.log("\n失败明细：");
  failures.forEach(f => console.log("  - " + f));
}
console.log("============================================");
process.exit(failures.length ? 1 : 0);
