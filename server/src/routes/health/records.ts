/**
 * 健康记录路由：列表 / 导出 / 新增 / 导入 / 修改 / 删除（DELETE 单条）。
 * 拆自原 routes/health.ts（P1-2）；批量删除见 P1-7（同目录批量删除走 `DELETE /health/records`）。
 * 共享逻辑见 ./common.ts。
 */
import { Router } from "express";
import db from "../../db.js";
import { adminOnly, authMiddleware } from "../../middleware/auth.js";
import { validateImportRow } from "../../../shared/health-import.js";
import {
  RECORD_SELECT,
  RECORD_ORDER,
  RECORD_INSERT_SQL,
  recordFilter,
  toRecord,
  toNumber,
  toText,
  toNumOrNull,
  parseId,
  findRecord,
  buildRecordValues
} from "./common.js";
import type { RecordRow } from "./common.js";

const router = Router();

/** GET /api/health/records —— 分页 + 可选日期范围，按 record_date 倒序 */
router.get("/health/records", authMiddleware, (req, res) => {
  const userId = req.user!.id;
  const q = req.query as Record<string, string | undefined>;
  const pageSize = Math.max(1, Math.trunc(toNumber(q.pageSize, 10)));
  const currentPage = Math.max(1, Math.trunc(toNumber(q.currentPage, 1)));

  const { whereSql, params } = recordFilter(userId, q);

  const { total } = db
    .prepare(`SELECT COUNT(*) AS total FROM records ${whereSql}`)
    .get(...params) as { total: number };

  const rows = db
    .prepare(`${RECORD_SELECT} ${whereSql} ${RECORD_ORDER} LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (currentPage - 1) * pageSize) as Array<RecordRow>;

  res.json({
    code: 0,
    message: "操作成功",
    data: {
      list: rows.map(toRecord),
      total,
      pageSize,
      currentPage
    }
  });
});

/**
 * GET /api/health/records/export —— 全量导出（不分页、不截断）。
 * 排序与字段口径与列表接口完全一致（`record_date DESC, id DESC` + 同一 `toRecord`），
 * 前端拿到后自行用 xlsx 生成 Excel（与 mock 时期一致）。
 */
router.get("/health/records/export", authMiddleware, (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const { whereSql, params } = recordFilter(req.user!.id, q);

  const rows = db
    .prepare(`${RECORD_SELECT} ${whereSql} ${RECORD_ORDER}`)
    .all(...params) as Array<RecordRow>;

  res.json({ code: 0, message: "操作成功", data: rows.map(toRecord) });
});

/** POST /api/health/records —— 新增（record_date 必填，指标项可空） */
router.post("/health/records", authMiddleware, (req, res) => {
  const userId = req.user!.id;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const date = toText(body.date).trim();
  if (!date) {
    res.status(400).json({ code: 40001, message: "记录日期不能为空" });
    return;
  }

  const { values, error } = buildRecordValues(body, userId, date);
  if (error) {
    res.status(400).json({ code: 40001, message: error });
    return;
  }

  const result = db.prepare(RECORD_INSERT_SQL).run(values);

  const row = findRecord(Number(result.lastInsertRowid), userId);
  res.json({ code: 0, message: "操作成功", data: row ? toRecord(row) : null });
});

/**
 * POST /api/health/records/import —— 批量导入（管理员 Excel 导入用）。
 *
 * 口径（二选一后取「全批校验通过才写」）：
 *  1. 逐行校验（规则见共享源码 `@shared/health-import`，与前端导入页同一套上限）；
 *  2. **若有任一行不合法，整批不落库**（`success: 0`），并在 `errors` 里给出行号与原因 —— 避免半份数据入库后难以分辨；
 *  3. 全部通过才在一个事务里写入，归属一律为当前登录用户（`user_id` 由服务端注入，入参无法指定）。
 * 行级校验失败返回 HTTP 200 + `errors[]`（不是 400）：前端 `http` 封装对非 2xx 直接 reject，
 * 而导入页只 `try/finally`，400 会让页面静默失败、连错误行都看不到。
 * 请求体本身不合法（`list` 不是数组）才返回 400 40001，与 B3 的错误码口径一致。
 * 权限：方案接口清单标注为 **admin**，故叠加 `adminOnly`（common 调用 → 403）。
 */
router.post("/health/records/import", authMiddleware, adminOnly, (req, res) => {
  const userId = req.user!.id;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const list = body.list;
  if (!Array.isArray(list)) {
    res.status(400).json({ code: 40001, message: "字段 list 需为数组" });
    return;
  }

  const errors: Array<{ row: number; message: string }> = [];
  const prepared: Array<Record<string, unknown>> = [];

  list.forEach((raw, idx) => {
    const rowNo = idx + 1;
    const err = validateImportRow(raw);
    if (err) {
      errors.push({ row: rowNo, message: err });
      return;
    }
    const row = raw as Record<string, unknown>;
    const date = toText(row.date).trim();
    const { values, error } = buildRecordValues(row, userId, date);
    if (error) {
      errors.push({ row: rowNo, message: error });
      return;
    }
    prepared.push(values);
  });

  // 任一行不合法 → 整批不写
  if (errors.length) {
    res.json({
      code: 0,
      message: "操作成功",
      data: { success: 0, fail: errors.length, total: list.length, errors }
    });
    return;
  }

  const insert = db.prepare(RECORD_INSERT_SQL);
  db.transaction((rows: Array<Record<string, unknown>>) => {
    for (const row of rows) insert.run(row);
  })(prepared);

  res.json({
    code: 0,
    message: "操作成功",
    data: { success: prepared.length, fail: 0, total: list.length, errors: [] }
  });
});

/** PUT /api/health/records/:id —— 只更新传入字段（校验归属） */
router.put("/health/records/:id", authMiddleware, (req, res) => {
  const userId = req.user!.id;
  const id = parseId(req.params.id);
  const current = id === null ? undefined : findRecord(id, userId);
  if (!current) {
    res.status(404).json({ code: 404, message: "记录不存在" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const sets: Array<string> = [];
  const params: Record<string, unknown> = { id, user_id: userId };

  if (Object.prototype.hasOwnProperty.call(body, "date")) {
    const date = toText(body.date).trim();
    if (!date) {
      res.status(400).json({ code: 40001, message: "记录日期不能为空" });
      return;
    }
    sets.push("record_date = @record_date");
    params.record_date = date;
  }

  for (const [apiKey, column] of Object.entries({
    systolic: "systolic",
    diastolic: "diastolic",
    fastingGlucose: "fasting_glucose",
    postprandialGlucose: "postprandial_glucose",
    totalCholesterol: "total_cholesterol",
    triglyceride: "triglycerides",
    ldl: "ldl",
    hdl: "hdl",
    heartRate: "heart_rate",
    bloodOxygen: "blood_oxygen",
    weight: "weight",
    remark: "note"
  })) {
    if (!Object.prototype.hasOwnProperty.call(body, apiKey)) continue;
    if (apiKey === "remark") {
      // 备注是文本列，不走数字校验
      sets.push(`${column} = @${column}`);
      params[column] = toText(body[apiKey], "");
      continue;
    }
    const v = toNumOrNull(body[apiKey]);
    if (v === undefined) {
      res.status(400).json({ code: 40001, message: `字段 ${apiKey} 需为数字` });
      return;
    }
    sets.push(`${column} = @${column}`);
    params[column] = v;
  }

  if (sets.length) {
    db.prepare(
      `UPDATE records SET ${sets.join(", ")} WHERE id = @id AND user_id = @user_id`
    ).run(params);
  }

  res.json({
    code: 0,
    message: "操作成功",
    data: toRecord(findRecord(id!, userId)!)
  });
});

/** DELETE /api/health/records/:id —— 校验归属后删除 */
router.delete("/health/records/:id", authMiddleware, (req, res) => {
  const userId = req.user!.id;
  const id = parseId(req.params.id);
  const current = id === null ? undefined : findRecord(id, userId);
  if (!current) {
    res.status(404).json({ code: 404, message: "记录不存在" });
    return;
  }

  db.prepare("DELETE FROM records WHERE id = ? AND user_id = ?").run(
    id,
    userId
  );
  res.json({ code: 0, message: "操作成功", data: null });
});

/**
 * DELETE /api/health/records —— 批量删除（P1-7）。
 *
 * 入参 `{ ids: string[] }`（记录 id 数组）。只删当前用户的记录（`user_id = ?` 条件内，
 * 混入他人 id 会被忽略，防越权），不存在/已删除的 id 静默跳过（幂等）。
 * 返回实际删除条数 `{ deleted: n }`。
 */
router.delete("/health/records", authMiddleware, (req, res) => {
  const userId = req.user!.id;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const ids = body.ids;
  if (!Array.isArray(ids)) {
    res.status(400).json({ code: 40001, message: "字段 ids 需为数组" });
    return;
  }
  const numeric = ids.map(parseId).filter((id): id is number => id !== null);
  if (!numeric.length) {
    res.status(400).json({ code: 40001, message: "字段 ids 需为非空数组" });
    return;
  }
  const placeholders = numeric.map(() => "?").join(", ");
  const result = db
    .prepare(
      `DELETE FROM records WHERE user_id = ? AND id IN (${placeholders})`
    )
    .run(userId, ...numeric);
  res.json({
    code: 0,
    message: "操作成功",
    data: { deleted: result.changes }
  });
});

export default router;
