import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import db from "../db.js";
import { env } from "../env.js";
import { authMiddleware, type JwtUser } from "../middleware/auth.js";
import { asyncRoutes } from "../data/asyncRoutes.js";
import { filterNoPermissionTree } from "../utils/filterRoutes.js";
import { splitRoles, type UserRow } from "../types.js";

const router = Router();

/** accessToken 12h / refreshToken 7d（与改造方案「五.1 鉴权」一致） */
const ACCESS_TOKEN_TTL = "12h";
const REFRESH_TOKEN_TTL = "7d";

/** 按 `yyyy/MM/dd HH:mm:ss` 输出过期时间（前端 setToken 用 new Date(str) 解析） */
function formatExpires(timestamp: number): string {
  const d = new Date(timestamp);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

/** 按钮级权限：与改造前 mock 返回保持一致，前端无 v-auth 依赖但结构不能变 */
function permissionsOf(roles: Array<string>): Array<string> {
  return roles.includes("admin")
    ? ["*:*:*"]
    : ["permission:btn:add", "permission:btn:edit"];
}

/** 签发令牌，返回结构与前端 RefreshTokenResult.data 对齐 */
function signTokens(user: UserRow) {
  const accessToken = jwt.sign(
    { id: user.id, username: user.username, roles: splitRoles(user.roles) },
    env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
  const refreshToken = jwt.sign({ id: user.id }, env.JWT_SECRET, {
    expiresIn: REFRESH_TOKEN_TTL
  });
  const decoded = jwt.decode(accessToken) as { exp: number };
  return {
    accessToken,
    refreshToken,
    expires: formatExpires(decoded.exp * 1000)
  };
}

function findUserByName(username: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username) as
    UserRow | undefined;
}

function findUserById(id: number): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
    UserRow | undefined;
}

/** 登录：bcrypt 校验密码 → 签发令牌 + 返回用户信息 */
router.post("/login", (req, res) => {
  const { username, password } = req.body ?? {};
  const user =
    typeof username === "string" ? findUserByName(username.trim()) : undefined;

  if (
    !user ||
    typeof password !== "string" ||
    !bcrypt.compareSync(password, user.password_hash)
  ) {
    res.json({ code: 40001, message: "用户名或密码错误" });
    return;
  }

  const roles = splitRoles(user.roles);
  res.json({
    code: 0,
    message: "操作成功",
    data: {
      avatar: user.avatar ?? "",
      username: user.username,
      nickname: user.nickname ?? "",
      roles,
      permissions: permissionsOf(roles),
      ...signTokens(user)
    }
  });
});

/** 刷新令牌：refreshToken 有效则重新签发 accessToken */
router.post("/refresh-token", (req, res) => {
  const { refreshToken } = req.body ?? {};
  if (typeof refreshToken !== "string" || !refreshToken) {
    res.status(401).json({ code: 401, message: "未登录或登录已过期" });
    return;
  }

  try {
    const { id } = jwt.verify(refreshToken, env.JWT_SECRET) as JwtUser;
    const user = findUserById(id);
    if (!user) throw new Error("user not found");
    res.json({ code: 0, message: "操作成功", data: signTokens(user) });
  } catch {
    res.status(401).json({ code: 401, message: "未登录或登录已过期" });
  }
});

/** 账户设置-个人信息 */
router.get("/mine", authMiddleware, (req, res) => {
  const user = findUserById(req.user!.id);
  if (!user) {
    res.status(401).json({ code: 401, message: "未登录或登录已过期" });
    return;
  }
  res.json({
    code: 0,
    message: "操作成功",
    data: {
      avatar: user.avatar ?? "",
      username: user.username,
      nickname: user.nickname ?? "",
      email: user.email ?? "",
      phone: user.phone ?? "",
      description: user.description ?? ""
    }
  });
});

/** 账户设置-个人安全日志（示例数据，字段对齐前端 SecurityLog.vue 表格） */
router.get("/mine-logs", authMiddleware, (req, res) => {
  const now = Date.now();
  const list = [
    {
      id: 1,
      ip: "127.0.0.1",
      address: "本机",
      system: "Windows",
      browser: "Chrome",
      summary: "账户登录",
      operatingTime: new Date(now).toISOString()
    },
    {
      id: 2,
      ip: "127.0.0.1",
      address: "本机",
      system: "Windows",
      browser: "Chrome",
      summary: `完善健康档案（${req.user!.username}）`,
      operatingTime: new Date(now - 86400000).toISOString()
    }
  ];
  res.json({
    code: 0,
    message: "操作成功",
    data: { list, total: list.length, pageSize: 10, currentPage: 1 }
  });
});

/** 动态路由：按当前登录用户 roles 过滤 */
router.get("/get-async-routes", authMiddleware, (req, res) => {
  res.json({
    code: 0,
    message: "操作成功",
    data: filterNoPermissionTree(asyncRoutes, req.user!.roles)
  });
});

export default router;
