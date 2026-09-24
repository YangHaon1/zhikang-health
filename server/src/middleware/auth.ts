import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import db from "../db.js";
import { env } from "../env.js";
import { splitRoles } from "../types.js";

/** JWT 载荷中携带的登录用户信息 */
export interface JwtUser {
  id: number;
  username: string;
  roles: Array<string>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** authMiddleware 解析成功后挂载 */
      user?: JwtUser;
    }
  }
}

/** 未登录/令牌失效统一响应 */
function unauthorized(res: Response): void {
  res.status(401).json({ code: 401, message: "未登录或登录已过期" });
}

/**
 * 鉴权中间件：解析 `Authorization: Bearer <token>` → `req.user`
 * 失败返回 401（前端 http.ts 已有刷新/登出流程接管）
 */
export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return unauthorized(res);

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtUser;
    // 令牌在有效期内并不代表账号仍有效：管理员停用/删除用户后，
    // 必须立即拒绝其旧 access token，避免继续读写健康数据。
    const account = db
      .prepare("SELECT username, roles, status FROM users WHERE id = ?")
      .get(payload.id) as
      { username: string; roles: string; status: number } | undefined;
    if (!account) return unauthorized(res);
    if (Number(account.status) === 0) {
      res.status(403).json({ code: 403, message: "账号已停用，请联系管理员" });
      return;
    }
    req.user = {
      id: payload.id,
      // 角色从数据库读取；管理员改角色后旧 token 不会继续保留旧权限。
      username: account.username,
      roles: splitRoles(account.roles)
    };
    next();
  } catch {
    // 令牌过期或签名不合法
    unauthorized(res);
  }
}

/** 管理员校验：`req.user.roles` 需含 "admin" */
export function adminOnly(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) return unauthorized(res);
  if (!req.user.roles.includes("admin")) {
    res.status(403).json({ code: 403, message: "无权限访问" });
    return;
  }
  next();
}
