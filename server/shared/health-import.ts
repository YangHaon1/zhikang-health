// 健康数据批量导入的行校验规则（唯一源码）
// ★ 后端（server/src/routes/health.ts 的 /api/health/records/import）与前端（@shared 别名）共用这一份，切勿双写。
// 纯函数、禁 Node/DOM 依赖 —— 因此可同时被 Express 与浏览器加载。
//
// 注意：前端导入页（src/views/health/import/index.vue）的 `COLUMNS` 表头定义里有一份**同值**的上限表，
// 那份是「Excel 列定义 + 客户端预校验」，列文案/顺序属于前端展示；本文件是服务端二次校验的权威规则。
// 两侧取值必须保持一致，改这里时记得同步那份（如需彻底收敛，可让前端从本文件取 max）。

/** 日期格式：yyyy-MM-dd */
export const IMPORT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 数值字段上限（下限统一 0）。
 * 不在表内的字段不做范围校验（如 `remark` 是文本列）。
 */
export const IMPORT_FIELD_LIMITS: Array<[string, number]> = [
  ["systolic", 300],
  ["diastolic", 200],
  ["fastingGlucose", 40],
  ["postprandialGlucose", 40],
  ["totalCholesterol", 20],
  ["triglyceride", 20],
  ["ldl", 20],
  ["hdl", 20],
  ["heartRate", 300],
  ["bloodOxygen", 100],
  ["weight", 300]
];

/**
 * 导入行校验：返回错误文案，**空串表示通过**（与 mock 原口径一致）。
 * 空值/未填的指标项跳过校验（允许单次只测部分指标）。
 */
export function validateImportRow(row: unknown): string {
  if (!row || typeof row !== "object") return "行数据格式错误";
  const r = row as Record<string, unknown>;

  const date = r.date;
  if (!date || !IMPORT_DATE_PATTERN.test(String(date)))
    return "日期必填且格式需为 yyyy-MM-dd";

  for (const [key, max] of IMPORT_FIELD_LIMITS) {
    const v = r[key];
    if (v == null || v === "") continue;
    const num = Number(v);
    if (isNaN(num) || num < 0 || num > max)
      return `${key} 需为 0~${max} 之间的数字`;
  }

  return "";
}
