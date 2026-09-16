import { Router } from "express";
import { writeFileSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcrypt";
import multer from "multer";
import db from "../db.js";
import { adminOnly, authMiddleware } from "../middleware/auth.js";
import { depts, deptName } from "../data/depts.js";
import { uploadsDir } from "../paths.js";
import { splitRoles, type UserRow } from "../types.js";

const router = Router();

/**
 * 用户管理（管理端）+ 头像上传。
 *
 * 权限：除 `/upload`（登录即可，改自己的头像）外全部 `adminOnly`，
 * 非管理员访问一律 403（前端管理页本身也只在 admin 的动态路由里出现）。
 * 响应结构与改造前的 mock 完全一致，用户管理页调用点零改动。
 */

// ---------- 角色（对齐改造前 mock 的 /list-all-role 返回值，前端调用点零改动） ----------

/** 前端角色下拉：id 为数字，name 为展示名 */
const ROLE_OPTIONS = [
  { id: 1, name: "超级管理员" },
  { id: 2, name: "普通角色" }
];

/** 角色 id ↔ 数据库 roles 列（逗号分隔的角色名） */
const ROLE_ID_TO_NAME: Record<number, string> = { 1: "admin", 2: "common" };
const ROLE_NAME_TO_ID: Record<string, number> = { admin: 1, common: 2 };

/** 取单行用户（未找到返回 undefined） */
function findUser(id: number): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
    UserRow | undefined;
}

/** 用户列表行（字段与 mock 一致：dept 为对象、createTime 为毫秒时间戳） */
function toListItem(user: UserRow) {
  return {
    id: user.id,
    avatar: user.avatar ?? "",
    username: user.username,
    nickname: user.nickname ?? "",
    phone: user.phone ?? "",
    email: user.email ?? "",
    sex: Number(user.sex ?? 0),
    status: Number(user.status ?? 1),
    dept: {
      id: Number(user.dept_id ?? 0),
      name: deptName(Number(user.dept_id ?? 0))
    },
    remark: user.remark ?? "",
    createTime: toMillis(user.create_time)
  };
}

/** SQLite `datetime('now','localtime')` → 毫秒时间戳（前端 dayjs 直接格式化） */
function toMillis(text: unknown): number {
  if (typeof text !== "string" || !text) return Date.now();
  const t = Date.parse(text.replace(" ", "T"));
  return Number.isNaN(t) ? Date.now() : t;
}

function toText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

// ---------- 用户列表（分页 + 条件筛选） ----------

function listUsers(req: { query: any }, res: any): void {
  // 查询条件走 query（对齐方案接口清单的 `GET /api/user`，前端 getUserList 已改为 GET + params）
  const src: Record<string, unknown> = req.query ?? {};
  const where: Array<string> = [];
  const params: Array<unknown> = [];

  const username = toText(src.username);
  if (username) {
    where.push("username LIKE ?");
    params.push(`%${username}%`);
  }
  const phone = toText(src.phone);
  if (phone) {
    where.push("phone LIKE ?");
    params.push(`%${phone}%`);
  }
  if (src.status !== undefined && src.status !== null && src.status !== "") {
    where.push("status = ?");
    params.push(toInt(src.status, 1));
  }
  if (src.deptId !== undefined && src.deptId !== null && src.deptId !== "") {
    where.push("dept_id = ?");
    params.push(toInt(src.deptId, 0));
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { c: total } = db
    .prepare(`SELECT COUNT(*) AS c FROM users ${whereSql}`)
    .get(...params) as { c: number };

  const pageSize = Math.min(Math.max(toInt(src.pageSize, 10), 1), 100);
  const currentPage = Math.max(toInt(src.currentPage, 1), 1);
  const rows = db
    .prepare(`SELECT * FROM users ${whereSql} ORDER BY id ASC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (currentPage - 1) * pageSize) as Array<UserRow>;

  res.json({
    code: 0,
    message: "操作成功",
    data: {
      list: rows.map(toListItem),
      total,
      pageSize,
      currentPage
    }
  });
}

// 列表：GET /api/user（方案接口清单口径，前端 getUserList 已改为 GET + params）
router.get("/user", authMiddleware, adminOnly, listUsers);
// 新增：POST /api/user
router.post("/user", authMiddleware, adminOnly, createUser);

// ---------- 用户新增 / 修改 / 删除 ----------

type UserPayload = {
  avatar?: string;
  username?: string;
  nickname?: string;
  phone?: string;
  email?: string;
  sex?: number;
  status?: number;
  deptId?: number;
  remark?: string;
  password?: string;
  roleIds?: Array<number>;
};

function createUser(req: any, res: any): void {
  const body = (req.body ?? {}) as UserPayload;
  const username = toText(body.username);
  const password = toText(body.password);

  if (!username) {
    res.json({ code: 40001, message: "请填写用户名称" });
    return;
  }
  if (password.length < 6) {
    res.json({ code: 40001, message: "密码长度不能少于 6 位" });
    return;
  }
  const exists = db
    .prepare("SELECT id FROM users WHERE username = ?")
    .get(username);
  if (exists) {
    res.json({ code: 40001, message: "用户名称已存在" });
    return;
  }

  const roles = rolesFromIds(body.roleIds) ?? "common";

  const info = db
    .prepare(
      `INSERT INTO users
         (username, password_hash, nickname, phone, email, sex, status, dept_id, remark, avatar, roles)
       VALUES
         (@username, @password_hash, @nickname, @phone, @email, @sex, @status, @dept_id, @remark, @avatar, @roles)`
    )
    .run({
      username,
      password_hash: bcrypt.hashSync(password, 10),
      nickname: toText(body.nickname),
      phone: toText(body.phone),
      email: toText(body.email),
      sex: toInt(body.sex, 0),
      status: toInt(body.status, 1),
      dept_id: toInt(body.deptId, 0),
      remark: toText(body.remark),
      avatar: toText(body.avatar),
      roles
    });

  res.json({
    code: 0,
    message: "新增成功",
    data: { id: Number(info.lastInsertRowid) }
  });
}

/** 角色 id 数组 → 逗号分隔的角色名；未传返回 null（表示不修改） */
function rolesFromIds(ids: unknown): string | null {
  if (!Array.isArray(ids)) return null;
  const names = ids
    .map(id => ROLE_ID_TO_NAME[toInt(id, 0)])
    .filter((name): name is string => Boolean(name));
  return names.length ? Array.from(new Set(names)).join(",") : null;
}

function updateUser(req: any, res: any): void {
  const id = toInt(req.params?.id ?? req.body?.id, 0);
  const user = id ? findUser(id) : undefined;
  if (!user) {
    res.status(404).json({ code: 404, message: "用户不存在" });
    return;
  }

  const body = (req.body ?? {}) as UserPayload;
  const fields: Array<string> = [];
  const values: Record<string, unknown> = { id };

  // 用户名改了要查重（不改则跳过，避免自己和自己撞）
  const username = toText(body.username);
  if (username && username !== user.username) {
    const dup = db
      .prepare("SELECT id FROM users WHERE username = ? AND id <> ?")
      .get(username, id);
    if (dup) {
      res.json({ code: 40001, message: "用户名称已存在" });
      return;
    }
    fields.push("username = @username");
    values.username = username;
  }

  if (body.nickname !== undefined) {
    fields.push("nickname = @nickname");
    values.nickname = toText(body.nickname);
  }
  if (body.phone !== undefined) {
    fields.push("phone = @phone");
    values.phone = toText(body.phone);
  }
  if (body.email !== undefined) {
    fields.push("email = @email");
    values.email = toText(body.email);
  }
  if (body.avatar !== undefined) {
    fields.push("avatar = @avatar");
    values.avatar = toText(body.avatar);
  }
  if (body.sex !== undefined) {
    fields.push("sex = @sex");
    values.sex = toInt(body.sex, 0);
  }
  if (body.status !== undefined) {
    fields.push("status = @status");
    values.status = toInt(body.status, 1);
  }
  if (body.deptId !== undefined) {
    fields.push("dept_id = @dept_id");
    values.dept_id = toInt(body.deptId, 0);
  }
  if (body.remark !== undefined) {
    fields.push("remark = @remark");
    values.remark = toText(body.remark);
  }

  // 改密码：bcrypt 重新哈希后入库（明文永不落库）
  const password = toText(body.password);
  if (password) {
    if (password.length < 6) {
      res.json({ code: 40001, message: "密码长度不能少于 6 位" });
      return;
    }
    fields.push("password_hash = @password_hash");
    values.password_hash = bcrypt.hashSync(password, 10);
  }

  const roles = rolesFromIds(body.roleIds);
  if (roles) {
    fields.push("roles = @roles");
    values.roles = roles;
  }

  if (!fields.length) {
    res.json({ code: 40001, message: "没有需要修改的内容" });
    return;
  }

  db.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = @id`).run(
    values
  );
  res.json({ code: 0, message: "修改成功", data: toListItem(findUser(id)!) });
}

function deleteUser(req: any, res: any): void {
  const id = toInt(req.params?.id ?? req.body?.id ?? req.query?.id, 0);
  const user = id ? findUser(id) : undefined;
  if (!user) {
    res.status(404).json({ code: 404, message: "用户不存在" });
    return;
  }
  if (id === req.user!.id) {
    res.json({ code: 40001, message: "不能删除当前登录用户" });
    return;
  }
  // 不允许删到没有任何管理员（否则没人能再进管理页）
  if (splitRoles(user.roles).includes("admin")) {
    const { c } = db
      .prepare("SELECT COUNT(*) AS c FROM users WHERE roles LIKE '%admin%'")
      .get() as { c: number };
    if (c <= 1) {
      res.json({ code: 40001, message: "至少保留一名管理员，不能删除" });
      return;
    }
  }

  // users 被 records/profiles/reports/chat_history 外键引用（foreign_keys = ON），
  // 删号时连同该用户的健康数据一并清理，避免留下悬空外键。
  db.transaction(() => {
    for (const table of ["chat_history", "reports", "records", "profiles"]) {
      db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(id);
    }
    db.prepare("DELETE FROM users WHERE id = ?").run(id);
  })();

  res.json({ code: 0, message: "删除成功", data: null });
}

router.put("/user", authMiddleware, adminOnly, updateUser);
router.put("/user/:id", authMiddleware, adminOnly, updateUser);
router.delete("/user/:id", authMiddleware, adminOnly, deleteUser);
router.delete("/user", authMiddleware, adminOnly, deleteUser);

// ---------- 用户管理页下拉数据 ----------

function roleOptions(_req: any, res: any): void {
  res.json({ code: 0, message: "操作成功", data: ROLE_OPTIONS });
}

function roleIdsOf(req: any, res: any): void {
  const id = toInt(req.body?.userId ?? req.query?.userId, 0);
  if (!id) {
    res.json({ code: 10001, message: "请求参数缺失或格式不正确", data: [] });
    return;
  }
  const user = findUser(id);
  if (!user) {
    res.json({ code: 10001, message: "用户不存在", data: [] });
    return;
  }
  const ids = splitRoles(user.roles)
    .map(name => ROLE_NAME_TO_ID[name])
    .filter((id): id is number => Boolean(id));
  res.json({ code: 0, message: "操作成功", data: ids });
}

function deptList(_req: any, res: any): void {
  res.json({ code: 0, message: "操作成功", data: depts });
}

// 方案接口清单写的是 GET，改造前前端用的是 POST —— 两种都注册，调用点无需改动
router.get("/list-all-role", authMiddleware, adminOnly, roleOptions);
router.post("/list-all-role", authMiddleware, adminOnly, roleOptions);
router.get("/list-role-ids", authMiddleware, adminOnly, roleIdsOf);
router.post("/list-role-ids", authMiddleware, adminOnly, roleIdsOf);
router.get("/dept", authMiddleware, adminOnly, deptList);
router.post("/dept", authMiddleware, adminOnly, deptList);

// ---------- 头像上传 ----------

/**
 * 内存存储 + 魔数识别：前端 `createFormData` 把裁剪结果包成 `new File([blob], "avatar")`，
 * 既没有扩展名、mime 也可能是空串，所以不看客户端给的类型，只认文件内容的前几个字节。
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

/** 图片魔数 → 扩展名（只接受常见图片格式，其他一律拒绝） */
function imageExt(buf: Buffer): string | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e) {
    return ".png";
  }
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return ".jpg";
  }
  if (buf.length > 6 && buf.subarray(0, 3).toString("latin1") === "GIF") {
    return ".gif";
  }
  if (
    buf.length > 12 &&
    buf.subarray(0, 4).toString("latin1") === "RIFF" &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return ".webp";
  }
  return null;
}

function handleUpload(req: any, res: any, next: any): void {
  upload.any()(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    const code = (err as { code?: string }).code;
    res.json({
      code: 40001,
      message: code === "LIMIT_FILE_SIZE" ? "图片不能超过 5MB" : "上传失败"
    });
  });
}

router.post("/upload", authMiddleware, handleUpload, (req: any, res: any) => {
  const file = (req.files ?? [])[0] as
    { buffer: Buffer; size: number } | undefined;
  if (!file) {
    res.json({ code: 40001, message: "请选择要上传的图片" });
    return;
  }
  const ext = imageExt(file.buffer);
  if (!ext) {
    res.json({ code: 40001, message: "仅支持 png / jpg / gif / webp 图片" });
    return;
  }

  // 归属：默认写当前登录用户；管理员可带 userId 给指定用户换头像（用户管理页「上传头像」）
  let ownerId = req.user!.id;
  const targetId = toInt(req.body?.userId ?? req.query?.userId, 0);
  if (targetId && targetId !== ownerId) {
    if (!req.user!.roles.includes("admin")) {
      res.status(403).json({ code: 403, message: "无权限访问" });
      return;
    }
    if (!findUser(targetId)) {
      res.status(404).json({ code: 404, message: "用户不存在" });
      return;
    }
    ownerId = targetId;
  }

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  writeFileSync(path.join(uploadsDir, filename), file.buffer);

  const url = `/uploads/${filename}`;
  db.prepare("UPDATE users SET avatar = ? WHERE id = ?").run(url, ownerId);

  res.json({
    code: 0,
    message: "操作成功",
    data: { url, userId: ownerId, size: file.size }
  });
});

export default router;
