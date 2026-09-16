import { Router } from "express";
import db from "../db.js";
import { authMiddleware } from "../middleware/auth.js";

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

/** 路径参数 → 记录 id（非正整数返回 null，调用方 404） */
function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** GET /api/health/records —— 分页 + 可选日期范围，按 record_date 倒序 */
router.get("/health/records", authMiddleware, (req, res) => {
  const userId = req.user!.id;
  const q = req.query as Record<string, string | undefined>;
  const pageSize = Math.max(1, Math.trunc(toNumber(q.pageSize, 10)));
  const currentPage = Math.max(1, Math.trunc(toNumber(q.currentPage, 1)));

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
  const whereSql = `WHERE ${where.join(" AND ")}`;

  const { total } = db
    .prepare(`SELECT COUNT(*) AS total FROM records ${whereSql}`)
    .get(...params) as { total: number };

  const rows = db
    .prepare(
      `${RECORD_SELECT} ${whereSql}
       ORDER BY record_date DESC, id DESC
       LIMIT ? OFFSET ?`
    )
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

/** POST /api/health/records —— 新增（record_date 必填，指标项可空） */
router.post("/health/records", authMiddleware, (req, res) => {
  const userId = req.user!.id;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const date = toText(body.date).trim();
  if (!date) {
    res.status(400).json({ code: 40001, message: "记录日期不能为空" });
    return;
  }

  const values: Record<string, unknown> = { user_id: userId };
  for (const [apiKey, column] of RECORD_FIELDS) {
    if (apiKey === "date") continue;
    if (apiKey === "remark") {
      // 备注是文本列，不走数字校验
      values[column] = toText(body[apiKey], "");
      continue;
    }
    const v = toNumOrNull(body[apiKey]);
    if (v === undefined) {
      res.status(400).json({ code: 40001, message: `字段 ${apiKey} 需为数字` });
      return;
    }
    values[column] = v;
  }

  const columns = ["user_id", "record_date", ...Object.keys(values).slice(1)];
  const result = db
    .prepare(
      `INSERT INTO records (${columns.join(", ")})
       VALUES (${columns.map(c => `@${c}`).join(", ")})`
    )
    .run({ ...values, record_date: date });

  const row = findRecord(Number(result.lastInsertRowid), userId);
  res.json({ code: 0, message: "操作成功", data: row ? toRecord(row) : null });
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

export default router;
