/**
 * health 路由共享层：枚举映射、通用取值工具、DB 访问与行转换。
 *
 * 拆自原 routes/health.ts（P1-2 拆分），供 profile / records / report / chat / analyze / seed
 * 六个路由模块共用，保证同一份口径只实现一次（避免拆分后映射漂移）。
 * 依赖方向：common ← 各路由模块（本文件不依赖任何路由模块，无循环引用）。
 */
import db from "../../db.js";
import type {
  HealthProfile,
  HealthRecord
} from "../../../shared/health-engine.js";

// ---------- 枚举映射：API 中文枚举 ↔ 数据库整数 ----------

/** 吸烟 → 数据库 0/1（「经常」与「偶尔」同为 1、「已戒烟」按 0 计，整数评分只区分有无） */
export const SMOKING_TO_DB: Record<string, number> = {
  从不: 0,
  偶尔: 1,
  经常: 1,
  已戒烟: 0
};
export const SMOKING_FROM_DB: Record<number, string> = { 0: "从不", 1: "偶尔" };

/** 饮酒 → 数据库 0/1/2（一一对应） */
export const DRINKING_TO_DB: Record<string, number> = {
  从不: 0,
  偶尔: 1,
  经常: 2
};
export const DRINKING_FROM_DB: Record<number, string> = {
  0: "从不",
  1: "偶尔",
  2: "经常"
};

/** 运动频率 → 数据库 0/1/2（「每周6次以上」与「每周3-5次」同为 2，反向取前一档文案） */
export const EXERCISE_TO_DB: Record<string, number> = {
  几乎不运动: 0,
  "每周1-2次": 1,
  "每周3-5次": 2,
  每周6次以上: 2
};
export const EXERCISE_FROM_DB: Record<number, string> = {
  0: "几乎不运动",
  1: "每周1-2次",
  2: "每周3-5次"
};

/** 性别：前端 1 男 / 0 女 ↔ 数据库 'male' / 'female' */
export function genderToDb(value: unknown): string {
  return value === 1 || value === "1" || value === "male" ? "male" : "female";
}
export function genderFromDb(value: unknown): number {
  return value === "male" || value === 1 || value === "1" ? 1 : 0;
}

export function enumToDb(
  table: Record<string, number>,
  value: unknown,
  fallback = 0
): number {
  const n = table[String(value ?? "").trim()];
  return n === undefined ? fallback : n;
}

export function enumFromDb(
  table: Record<number, string>,
  value: unknown
): string {
  return table[Number(value)] ?? table[0];
}

// ---------- 通用取值工具 ----------

export function toNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function toText(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

/** 数值列：空串 / undefined 视作 NULL，其余转数字（非数字返回 undefined 表示不合法） */
export function toNumOrNull(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** 路径参数 → 记录 id（非正整数返回 null，调用方 404；Express 5 的 params 值可能是数组，故收 unknown） */
export function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ---------- 档案：行类型 / 读取 / 转换 ----------

export interface ProfileRow {
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
export function toProfile(row: ProfileRow) {
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
export function findProfile(userId: number): ProfileRow | undefined {
  return db.prepare(PROFILE_SELECT).get(userId) as ProfileRow | undefined;
}

/** 读取当前用户档案 → 引擎入参（与 API 同口径：camelCase + 中文枚举 + gender 0/1） */
export function profileForEngine(userId: number): HealthProfile | null {
  const row = findProfile(userId);
  return row ? toProfile(row) : null;
}

// ---------- 健康记录：列定义 / 行转换 / 读写 SQL ----------

export interface RecordRow {
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
export const RECORD_FIELDS: Array<[string, string]> = [
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

export const RECORD_SELECT = `
  SELECT id, user_id, record_date, systolic, diastolic,
         fasting_glucose, postprandial_glucose, total_cholesterol, triglycerides,
         ldl, hdl, heart_rate, blood_oxygen, weight, note
  FROM records`;

/** 数据库行 → 前端 HealthRecord（id 为 string） */
export function toRecord(row: RecordRow) {
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
export function findRecord(id: number, userId: number): RecordRow | undefined {
  return db
    .prepare(`${RECORD_SELECT} WHERE id = ? AND user_id = ?`)
    .get(id, userId) as RecordRow | undefined;
}

/**
 * 记录入参 → 数据库列值（POST 新增与批量导入共用，保证两条写入路径口径一致）。
 * 数字列非数字 → 返回错误文案；`remark` 是文本列；空值一律记 NULL（允许单次只测部分指标）。
 */
export function buildRecordValues(
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
export const RECORD_INSERT_COLUMNS = [
  "user_id",
  "record_date",
  ...RECORD_FIELDS.filter(([apiKey]) => apiKey !== "date").map(
    ([, column]) => column
  )
];

export const RECORD_INSERT_SQL = `
  INSERT INTO records (${RECORD_INSERT_COLUMNS.join(", ")})
  VALUES (${RECORD_INSERT_COLUMNS.map(c => `@${c}`).join(", ")})`;

/**
 * 记录查询条件：归属 + 可选日期范围。
 * 列表、导出共用同一份构造，保证两个接口的过滤口径不会漂移。
 */
export function recordFilter(
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
export const RECORD_ORDER = "ORDER BY record_date DESC, id DESC";

/**
 * 读取当前用户记录 → 引擎入参。
 * 引擎以 `!= null` 判定「未测」，故 DB 的 null 可直接透传（响应 JSON 也因此保持 B3 原样）。
 */
export function recordsForEngine(userId: number): HealthRecord[] {
  const rows = db
    .prepare(
      `${RECORD_SELECT} WHERE user_id = ? ORDER BY record_date DESC, id DESC`
    )
    .all(userId) as RecordRow[];
  return rows.map(row => ({ ...toRecord(row) }) as unknown as HealthRecord);
}
