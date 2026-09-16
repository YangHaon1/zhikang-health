import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../env.js";

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
    req.user = {
      id: payload.id,
      username: payload.username,
      roles: payload.roles ?? []
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
