/**
 * C5 授权中心：`GET/PUT /api/health/authorizations`。
 *
 * 面向**用户自己**（任何已登录用户，只能读写自己的授权，无 user_id 入参）：
 * - GET 返回当前共享开关 + 「我的数据被谁访问」只读清单（清单与文案在共享层
 *   `@shared/health-privacy` 的 `ACCESS_SCOPES`，前端不另写一份）；
 * - PUT 开/关「允许他人查看我的健康数据」，写 `user_privacy` 并留痕
 *   （action = `authorization_change`，detail 只记开关前后值，不含任何健康数据）。
 *
 * 开关的**唯一作用**是决定该用户是否参与管理端脱敏群体统计（C4 聚合口径联动），
 * 详见共享层 `SHARING_NOTE`；规则引擎 / 报告 / 助手读本人数据的能力不受影响。
 */
import { Router } from "express";
import db, { ensureUserPrivacy } from "../../db.js";
import { authMiddleware } from "../../middleware/auth.js";
import {
  DEFAULT_ALLOW_SHARED,
  SHARING_NOTE,
  accessScopes,
  allowSharedOf
} from "../../../shared/health-privacy.js";
import { actorOf, writeAudit } from "./audit.js";

const router = Router();

interface PrivacyRow {
  user_id: number;
  allow_shared: number;
  update_time: string | null;
}

/** 读取授权行（没有行 = 从未设置 = 默认关闭） */
export function findPrivacy(userId: number): PrivacyRow | undefined {
  ensureUserPrivacy();
  return db
    .prepare(
      "SELECT user_id, allow_shared, update_time FROM user_privacy WHERE user_id = ?"
    )
    .get(userId) as PrivacyRow | undefined;
}

/**
 * C5 供聚合口径判断的批量读法：返回**已开启共享**的 user_id 集合。
 * 聚合路由用它一次查出全部授权状态，避免逐用户查库（与 `findPrivacy` 同一张表、同一判定）。
 */
export function sharedUserIds(): Set<number> {
  ensureUserPrivacy();
  const rows = db
    .prepare("SELECT user_id FROM user_privacy WHERE allow_shared = 1")
    .all() as Array<{ user_id: number }>;
  return new Set(rows.map(r => r.user_id));
}

/** 授权中心响应（GET / PUT 同结构，前端 PUT 后可直接用返回值刷新页面） */
function authorizationPayload(userId: number) {
  const row = findPrivacy(userId);
  const allowShared = row
    ? allowSharedOf(row.allow_shared)
    : DEFAULT_ALLOW_SHARED;
  return {
    allowShared,
    /** 是否从未设置过（前端据此说明「当前为默认关闭」） */
    configured: !!row,
    updateTime: row?.update_time ?? "",
    /** 我的数据访问范围（只读清单，随开关变化的是「管理端脱敏聚合」这一条） */
    scopes: accessScopes(allowShared),
    note: SHARING_NOTE
  };
}

/** GET /api/health/authorizations —— 我的授权状态 + 数据访问范围清单 */
router.get("/health/authorizations", authMiddleware, (req, res) => {
  res.json({
    code: 0,
    message: "操作成功",
    data: authorizationPayload(req.user!.id)
  });
});

/**
 * PUT /api/health/authorizations —— 开启 / 关闭共享授权。
 *
 * 入参：`{ allowShared: boolean }`（也接受 1 / 0 / "1" / "0"，口径见共享层 `allowSharedOf`）。
 * 缺失或非法 → 400（不静默按 false 处理，避免误关）；值未变化时**不写审计**（避免刷屏无意义留痕）。
 */
router.put("/health/authorizations", authMiddleware, (req, res) => {
  const userId = req.user!.id;
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(body, "allowShared")) {
    res.status(400).json({ code: 40001, message: "字段 allowShared 不能为空" });
    return;
  }
  const raw = body.allowShared;
  const acceptable =
    typeof raw === "boolean" ||
    raw === 0 ||
    raw === 1 ||
    raw === "0" ||
    raw === "1";
  if (!acceptable) {
    res
      .status(400)
      .json({ code: 40001, message: "字段 allowShared 需为布尔值" });
    return;
  }
  const next = allowSharedOf(raw);
  const before = allowSharedOf(findPrivacy(userId)?.allow_shared);

  if (next !== before) {
    ensureUserPrivacy();
    db.prepare(
      `INSERT INTO user_privacy (user_id, allow_shared, update_time)
       VALUES (@user_id, @allow_shared, datetime('now','localtime'))
       ON CONFLICT(user_id) DO UPDATE SET
         allow_shared = excluded.allow_shared,
         update_time = excluded.update_time`
    ).run({ user_id: userId, allow_shared: next ? 1 : 0 });

    // 留痕：只记开关前后值，不含任何健康数据（detail 还会再过一次共享层脱敏）
    writeAudit(
      "authorization_change",
      { before, after: next, target: "allowShared" },
      actorOf(req)
    );
  }

  res.json({
    code: 0,
    message: "操作成功",
    data: { ...authorizationPayload(userId), changed: next !== before }
  });
});

export default router;
