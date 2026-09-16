import { Router } from "express";
import db from "../db.js";
import { adminOnly, authMiddleware } from "../middleware/auth.js";
// 规则引擎唯一源码（与前端共用同一份，纯函数），后端只做数据映射 + 隔离，不重复实现评分
import { analyzeHealth } from "../../shared/health-engine.js";
import type {
  HealthProfile,
  HealthRecord
} from "../../shared/health-engine.js";
// 报告模板同样只有一份源码，前后端共用（与 mock 的报告组装逻辑同一份）
import { buildReport } from "../../shared/health-report.js";
import type { RadarPoint, TrendPoint } from "../../shared/health-report.js";
import { validateImportRow } from "../../shared/health-import.js";

const router = Router();

/**
 * 档案 / 记录接口。
 *
 * ⚠️ 字段口径：数据库层保持 B1 的整数枚举（规则引擎依赖整数评分），
 * API 层对齐前端（camelCase + 中文枚举），两侧用下方映射表显式转换，读写双向一致。
 * 所有操作强制 `WHERE user_id = req.user.id`，跨用户访问一律 404（防越权）。
 */

// ---------- 枚举映射：API 中文枚举 ↔ 数据库整数 ----------

/** 吸烟 → 数据库 0/1（「经常」与「偶尔」同为 1、「已戒烟」按 0 计，整数评分只区分有无） */
const SMOKING_TO_DB: Record<string, number> = {
  从不: 0,
  偶尔: 1,
  经常: 1,
  已戒烟: 0
};
const SMOKING_FROM_DB: Record<number, string> = { 0: "从不", 1: "偶尔" };

/** 饮酒 → 数据库 0/1/2（一一对应） */
const DRINKING_TO_DB: Record<string, number> = {
  从不: 0,
  偶尔: 1,
  经常: 2
};
const DRINKING_FROM_DB: Record<number, string> = {
  0: "从不",
  1: "偶尔",
  2: "经常"
};

/** 运动频率 → 数据库 0/1/2（「每周6次以上」与「每周3-5次」同为 2，反向取前一档文案） */
const EXERCISE_TO_DB: Record<string, number> = {
  几乎不运动: 0,
  "每周1-2次": 1,
  "每周3-5次": 2,
  每周6次以上: 2
};
const EXERCISE_FROM_DB: Record<number, string> = {
  0: "几乎不运动",
  1: "每周1-2次",
  2: "每周3-5次"
};

/** 性别：前端 1 男 / 0 女 ↔ 数据库 'male' / 'female' */
function genderToDb(value: unknown): string {
  return value === 1 || value === "1" || value === "male" ? "male" : "female";
}
function genderFromDb(value: unknown): number {
  return value === "male" || value === 1 || value === "1" ? 1 : 0;
}

function enumToDb(
  table: Record<string, number>,
  value: unknown,
  fallback = 0
): number {
  const n = table[String(value ?? "").trim()];
  return n === undefined ? fallback : n;
}

function enumFromDb(table: Record<number, string>, value: unknown): string {
  return table[Number(value)] ?? table[0];
}

// ---------- 通用取值工具 ----------

function toNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toText(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

/** 数值列：空串 / undefined 视作 NULL，其余转数字（非数字返回 undefined 表示不合法） */
function toNumOrNull(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

// ---------- 档案 ----------

interface ProfileRow {
  user_id: number;
  name: string;
  gender: string;
  age: number;
  height: number;
  weight: number;
  waistline: number;
  medical_history: string;
  family_history: string;
  allergy_history: string;
  smoking: number;
  drinking: number;
  exercise: number;
  update_time: string;
}

const PROFILE_SELECT = `
  SELECT user_id, name, gender, age, height, weight, waistline,
         medical_history, family_history, allergy_history,
         smoking, drinking, exercise, update_time
  FROM profiles WHERE user_id = ?`;

/** 数据库行 → 前端 HealthProfile（camelCase + 中文枚举） */
function toProfile(row: ProfileRow) {
  return {
    name: row.name ?? "",
    gender: genderFromDb(row.gender),
    age: toNumber(row.age),
    height: toNumber(row.height),
    weight: toNumber(row.weight),
    waistline: toNumber(row.waistline),
    medicalHistory: row.medical_history ?? "",
    familyHistory: row.family_history ?? "",
    allergyHistory: row.allergy_history ?? "",
    smoking: enumFromDb(SMOKING_FROM_DB, row.smoking),
    drinking: enumFromDb(DRINKING_FROM_DB, row.drinking),
    exercise: enumFromDb(EXERCISE_FROM_DB, row.exercise),
    /** 前端只读展示字段，取档案最近更新时间 */
    createTime: row.update_time ?? ""
  };
}

/** 读取档案行（无档案返回 undefined） */
function findProfile(userId: number): ProfileRow | undefined {
  return db.prepare(PROFILE_SELECT).get(userId) as ProfileRow | undefined;
}

/** GET /api/health/profile —— 无档案返回 data: null（不 404，前端据此判断是否已完善） */
router.get("/health/profile", authMiddleware, (req, res) => {
  const row = findProfile(req.user!.id);
  res.json({
    code: 0,
    message: "操作成功",
    data: row ? toProfile(row) : null
  });
});

/** PUT /api/health/profile —— 局部更新（upsert），只覆盖传入的字段 */
router.put("/health/profile", authMiddleware, (req, res) => {
  const userId = req.user!.id;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const prev = findProfile(userId);
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);

  // 未传入的字段沿用原值，没有原值时用列表默认值
  const merged = {
    user_id: userId,
    name: has("name")
      ? toText(body.name, prev?.name ?? "")
      : (prev?.name ?? ""),
    gender: has("gender") ? genderToDb(body.gender) : (prev?.gender ?? "male"),
    age: has("age") ? toNumber(body.age, prev?.age ?? 0) : (prev?.age ?? 0),
    height: has("height")
      ? toNumber(body.height, prev?.height ?? 0)
      : (prev?.height ?? 0),
    weight: has("weight")
      ? toNumber(body.weight, prev?.weight ?? 0)
      : (prev?.weight ?? 0),
    waistline: has("waistline")
      ? toNumber(body.waistline, prev?.waistline ?? 0)
      : (prev?.waistline ?? 0),
    medical_history: has("medicalHistory")
      ? toText(body.medicalHistory, prev?.medical_history ?? "")
      : (prev?.medical_history ?? ""),
    family_history: has("familyHistory")
      ? toText(body.familyHistory, prev?.family_history ?? "")
      : (prev?.family_history ?? ""),
    allergy_history: has("allergyHistory")
      ? toText(body.allergyHistory, prev?.allergy_history ?? "")
      : (prev?.allergy_history ?? ""),
    smoking: has("smoking")
      ? enumToDb(SMOKING_TO_DB, body.smoking, prev?.smoking ?? 0)
      : (prev?.smoking ?? 0),
    drinking: has("drinking")
      ? enumToDb(DRINKING_TO_DB, body.drinking, prev?.drinking ?? 0)
      : (prev?.drinking ?? 0),
    exercise: has("exercise")
      ? enumToDb(EXERCISE_TO_DB, body.exercise, prev?.exercise ?? 0)
      : (prev?.exercise ?? 0)
  };

  db.prepare(
    `INSERT INTO profiles (
       user_id, name, gender, age, height, weight, waistline,
       medical_history, family_history, allergy_history,
       smoking, drinking, exercise, update_time
     ) VALUES (
       @user_id, @name, @gender, @age, @height, @weight, @waistline,
       @medical_history, @family_history, @allergy_history,
       @smoking, @drinking, @exercise, datetime('now','localtime')
     )
     ON CONFLICT(user_id) DO UPDATE SET
       name = excluded.name,
       gender = excluded.gender,
       age = excluded.age,
       height = excluded.height,
       weight = excluded.weight,
       waistline = excluded.waistline,
       medical_history = excluded.medical_history,
       family_history = excluded.family_history,
       allergy_history = excluded.allergy_history,
       smoking = excluded.smoking,
       drinking = excluded.drinking,
       exercise = excluded.exercise,
       update_time = excluded.update_time`
  ).run(merged);

  res.json({
    code: 0,
    message: "操作成功",
    data: toProfile(findProfile(userId)!)
  });
});

// ---------- 健康记录 ----------

interface RecordRow {
  id: number;
  user_id: number;
  record_date: string;
  systolic: number | null;
  diastolic: number | null;
  fasting_glucose: number | null;
  postprandial_glucose: number | null;
  total_cholesterol: number | null;
  triglycerides: number | null;
  ldl: number | null;
  hdl: number | null;
  heart_rate: number | null;
  blood_oxygen: number | null;
  weight: number | null;
  note: string | null;
}

/** API 字段 ↔ 数据库列（顺序即读写顺序，注意 `triglyceride` ↔ `triglycerides`） */
const RECORD_FIELDS: Array<[string, string]> = [
  ["date", "record_date"],
  ["systolic", "systolic"],
  ["diastolic", "diastolic"],
  ["fastingGlucose", "fasting_glucose"],
  ["postprandialGlucose", "postprandial_glucose"],
  ["totalCholesterol", "total_cholesterol"],
  ["triglyceride", "triglycerides"],
  ["ldl", "ldl"],
  ["hdl", "hdl"],
  ["heartRate", "heart_rate"],
  ["bloodOxygen", "blood_oxygen"],
  ["weight", "weight"],
  ["remark", "note"]
];

const RECORD_SELECT = `
  SELECT id, user_id, record_date, systolic, diastolic,
         fasting_glucose, postprandial_glucose, total_cholesterol, triglycerides,
         ldl, hdl, heart_rate, blood_oxygen, weight, note
  FROM records`;

/** 数据库行 → 前端 HealthRecord（id 为 string） */
function toRecord(row: RecordRow) {
  const out: Record<string, unknown> = {
    id: String(row.id),
    date: row.record_date ?? ""
  };
  for (const [apiKey, column] of RECORD_FIELDS) {
    if (apiKey === "date") continue;
    out[apiKey] = row[column as keyof RecordRow];
  }
  return out;
}

/** 查记录（限定归属，查不到返回 undefined，调用方统一 404） */
function findRecord(id: number, userId: number): RecordRow | undefined {
  return db
    .prepare(`${RECORD_SELECT} WHERE id = ? AND user_id = ?`)
    .get(id, userId) as RecordRow | undefined;
}

/** 路径参数 → 记录 id（非正整数返回 null，调用方 404；Express 5 的 params 值可能是数组，故收 unknown） */
function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * 记录入参 → 数据库列值（POST 新增与批量导入共用，保证两条写入路径口径一致）。
 * 数字列非数字 → 返回错误文案；`remark` 是文本列；空值一律记 NULL（允许单次只测部分指标）。
 */
function buildRecordValues(
  body: Record<string, unknown>,
  userId: number,
  date: string
): { values: Record<string, unknown>; error?: string } {
  const values: Record<string, unknown> = {
    user_id: userId,
    record_date: date
  };
  for (const [apiKey, column] of RECORD_FIELDS) {
    if (apiKey === "date") continue;
    if (apiKey === "remark") {
      // 备注是文本列，不走数字校验
      values[column] = toText(body[apiKey], "");
      continue;
    }
    const v = toNumOrNull(body[apiKey]);
    if (v === undefined) return { values, error: `字段 ${apiKey} 需为数字` };
    values[column] = v;
  }
  return { values };
}

/** 插入列顺序与 `buildRecordValues` 的键顺序一致（user_id, record_date, 其余指标列） */
const RECORD_INSERT_COLUMNS = [
  "user_id",
  "record_date",
  ...RECORD_FIELDS.filter(([apiKey]) => apiKey !== "date").map(
    ([, column]) => column
  )
];

const RECORD_INSERT_SQL = `
  INSERT INTO records (${RECORD_INSERT_COLUMNS.join(", ")})
  VALUES (${RECORD_INSERT_COLUMNS.map(c => `@${c}`).join(", ")})`;

/**
 * 记录查询条件：归属 + 可选日期范围。
 * 列表、导出共用同一份构造，保证两个接口的过滤口径不会漂移。
 */
function recordFilter(
  userId: number,
  q: Record<string, string | undefined>
): { whereSql: string; params: Array<unknown> } {
  const where = ["user_id = ?"];
  const params: Array<unknown> = [userId];
  if (q.startDate) {
    where.push("record_date >= ?");
    params.push(q.startDate);
  }
  if (q.endDate) {
    where.push("record_date <= ?");
    params.push(q.endDate);
  }
  return { whereSql: `WHERE ${where.join(" AND ")}`, params };
}

/** 记录列表排序：日期倒序，同日按 id 倒序（保证分页稳定） */
const RECORD_ORDER = "ORDER BY record_date DESC, id DESC";

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
 *  1. 逐行校验（规则见共享源码 `@shared/health-import`，与 mock/前端同一套上限）；
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

  for (const [apiKey, column] of RECORD_FIELDS) {
    if (apiKey === "date") continue;
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

// ---------- 实时分级（规则引擎） ----------

/** 读取当前用户档案 → 引擎入参（与 API 同口径：camelCase + 中文枚举 + gender 0/1） */
function profileForEngine(userId: number): HealthProfile | null {
  const row = findProfile(userId);
  return row ? toProfile(row) : null;
}

/**
 * 读取当前用户记录 → 引擎入参。
 * 引擎以 `!= null` 判定「未测」，故 DB 的 null 可直接透传（响应 JSON 也因此保持 B3 原样）。
 */
function recordsForEngine(userId: number): HealthRecord[] {
  const rows = db
    .prepare(
      `${RECORD_SELECT} WHERE user_id = ? ORDER BY record_date DESC, id DESC`
    )
    .all(userId) as RecordRow[];
  return rows.map(row => ({ ...toRecord(row) }) as unknown as HealthRecord);
}

/**
 * POST /api/health/analyze —— 实时分级：一次返回评分 / 等级 / 分项分级 / 风险点 / 建议。
 *
 * 入参（均可省略，省略时读当前用户库内最新数据 —— 档案或记录一改，这里立刻反映）：
 *   记录数组 | { records?: HealthRecord[], profile?: HealthProfile | null }
 * 隔离：任何入参都改不了查询范围，缺省数据一律取自 `req.user.id`，无法越权读他人数据。
 */
router.post("/health/analyze", authMiddleware, (req, res) => {
  const userId = req.user!.id;
  const raw: unknown = req.body;
  const payload =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;

  // 与 mock 一致：支持「记录数组」或「{ records }」两种写法
  const rawRecords = Array.isArray(raw) ? raw : payload?.records;
  if (rawRecords !== undefined && !Array.isArray(rawRecords)) {
    res.status(400).json({ code: 40001, message: "字段 records 需为数组" });
    return;
  }

  const records =
    rawRecords === undefined
      ? recordsForEngine(userId)
      : (rawRecords as unknown as HealthRecord[]);

  const profile =
    payload && "profile" in payload
      ? ((payload.profile ?? null) as HealthProfile | null)
      : profileForEngine(userId);

  res.json({
    code: 0,
    message: "操作成功",
    data: analyzeHealth(records, profile)
  });
});

// ---------- 报告：生成 / 历史 / 详情（数据源统一为 reports 表） ----------

/** 每用户最多保留的报告份数（方案 B5：「最多留 20 份」，超出删最旧） */
const REPORT_KEEP_LIMIT = 20;

interface ReportRow {
  id: number;
  period_start: string | null;
  period_end: string | null;
  score: number | null;
  level: string | null;
  summary: string | null;
  radar: string | null;
  trend: string | null;
  create_time: string | null;
}

/** DB 本地时间字符串（datetime('now','localtime')）→ ISO，前端 `new Date()` 可直接解析 */
function toIso(local: string | null): string {
  if (!local) return "";
  const d = new Date(local.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? local : d.toISOString();
}

/** 时间段文案：两端齐全才拼接，否则视为全部记录（与 mock 口径一致） */
function periodOf(start: string | null, end: string | null): string {
  return start && end ? `${start} ~ ${end}` : "全部记录";
}

/** JSON 列解析：容忍脏数据（解析失败退化为兜底值，不让一份坏报告把接口打成 500） */
function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return (JSON.parse(raw) ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/** summary 列内部结构：总体评价 + 分项分析 + 风险点 + 建议 + 就医提醒 */
interface ReportSummaryPayload {
  summary?: string;
  itemAnalysis?: string[];
  risks?: string[];
  suggestions?: string[];
  medicalAdvice?: string;
}

/** 数据库行 → 前端 HealthReport（id 为 string，时间为 ISO） */
function toReport(row: ReportRow) {
  const s = parseJson<ReportSummaryPayload>(row.summary, {});
  return {
    id: String(row.id),
    generateTime: toIso(row.create_time),
    period: periodOf(row.period_start, row.period_end),
    startDate: row.period_start ?? "",
    endDate: row.period_end ?? "",
    score: toNumber(row.score),
    level: row.level ?? "",
    summary: s.summary ?? "",
    itemAnalysis: s.itemAnalysis ?? [],
    risks: s.risks ?? [],
    suggestions: s.suggestions ?? [],
    medicalAdvice: s.medicalAdvice ?? "",
    radar: parseJson<RadarPoint[]>(row.radar, []),
    trend: parseJson<TrendPoint[]>(row.trend, [])
  };
}

/** 查报告（限定归属，查不到返回 undefined，调用方统一 404） */
function findReport(id: number, userId: number): ReportRow | undefined {
  return db
    .prepare(
      `SELECT id, period_start, period_end, score, level, summary, radar, trend, create_time
       FROM reports WHERE id = ? AND user_id = ?`
    )
    .get(id, userId) as ReportRow | undefined;
}

/**
 * POST /api/health/report/generate —— 生成报告：取当前用户记录（可按时间段过滤）→ 规则引擎 → 落 reports 表。
 * 报告正文（总体评价/分项分析/风险点/建议/就医提醒）存 summary 列，雷达与趋势各存一列 JSON；
 * 落库后立刻出现在 GET /health/report/history 里（同一张表、同一数据源）。
 */
router.post("/health/report/generate", authMiddleware, (req, res) => {
  const userId = req.user!.id;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const startDate = toText(body.startDate);
  const endDate = toText(body.endDate);

  // 与 mock 一致：只在传了对应端点时才按日期过滤
  const records = recordsForEngine(userId).filter(
    r =>
      (!startDate || (r.date ?? "") >= startDate) &&
      (!endDate || (r.date ?? "") <= endDate)
  );
  const content = buildReport(
    records,
    profileForEngine(userId),
    startDate,
    endDate
  );

  const info = db
    .prepare(
      `INSERT INTO reports (
         user_id, period_start, period_end, score, level, summary, radar, trend, create_time
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))`
    )
    .run(
      userId,
      startDate,
      endDate,
      content.score,
      content.level,
      JSON.stringify({
        summary: content.summary,
        itemAnalysis: content.itemAnalysis,
        risks: content.risks,
        suggestions: content.suggestions,
        medicalAdvice: content.medicalAdvice
      }),
      JSON.stringify(content.radar),
      JSON.stringify(content.trend)
    );

  // 每用户最多保留 20 份（方案 B5 明确要求，与 mock 的 `unshift + slice(0,20)` 行为对齐）：
  // 超出的删最旧。按 id DESC 判定新旧（id 即生成顺序，比秒级 create_time 更稳）。
  db.prepare(
    `DELETE FROM reports
     WHERE user_id = ?
       AND id NOT IN (
         SELECT id FROM reports WHERE user_id = ? ORDER BY id DESC LIMIT ${REPORT_KEEP_LIMIT}
       )`
  ).run(userId, userId);

  res.json({
    code: 0,
    message: "操作成功",
    data: toReport(findReport(Number(info.lastInsertRowid), userId)!)
  });
});

/**
 * GET /api/health/report/history —— 当前用户的报告摘要列表（按生成时间倒序）。
 * ⚠️ 必须注册在 `/health/report/:id` 之前，否则会被 `:id` 抢走匹配。
 */
router.get("/health/report/history", authMiddleware, (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, period_start, period_end, score, level, summary, radar, trend, create_time
       FROM reports WHERE user_id = ? ORDER BY create_time DESC, id DESC`
    )
    .all(req.user!.id) as ReportRow[];

  res.json({
    code: 0,
    message: "操作成功",
    data: rows.map(row => ({
      id: String(row.id),
      generateTime: toIso(row.create_time),
      period: periodOf(row.period_start, row.period_end),
      score: toNumber(row.score),
      level: row.level ?? ""
    }))
  });
});

/** GET /api/health/report/:id —— 报告详情（非本人或不存在一律 404，防越权） */
router.get("/health/report/:id", authMiddleware, (req, res) => {
  const id = parseId(req.params.id);
  const row = id === null ? undefined : findReport(id, req.user!.id);
  if (!row) {
    res.status(404).json({ code: 404, message: "报告不存在" });
    return;
  }
  res.json({ code: 0, message: "操作成功", data: toReport(row) });
});

export default router;
