// 健康数据层 mock：本地简易存储（localStorage + 内存兜底），仅用 Web 标准 API，禁止 import Node 模块
import { defineFakeRoute } from "vite-plugin-fake-server/client";
import type {
  HealthProfile,
  HealthRecord,
  HealthReport,
  ReportSummary
} from "@/types/health";
import {
  analyzeHealth,
  gradeSystolic,
  gradeDiastolic,
  gradeFastingGlucose,
  gradeTotalCholesterol,
  gradeTriglyceride,
  gradeLdl,
  gradeHdl,
  gradeBmi,
  worseGrade
} from "@shared/health-engine";

// ---------- 存储封装 ----------
// dev 环境 fake-server 在 Node middleware 执行（无 localStorage）；
// 生产 enableProd 在浏览器执行（有 localStorage，模块变量刷新即清）。
// 因此：写时同步写内存 + localStorage（可用时），读时 localStorage 优先、内存兜底。
const memory = new Map<string, string>();

const storage = {
  get(key: string): string | null {
    const ls =
      typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    return ls ?? memory.get(key) ?? null;
  },
  set(key: string, value: string) {
    memory.set(key, value);
    if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
  }
};

const DB_KEY = "health-mock-db";

/** 数据库结构 */
type HealthDb = {
  profile: HealthProfile | null;
  records: HealthRecord[];
  reports: HealthReport[];
};

/** 读取数据库 */
function loadDb(): HealthDb {
  const raw = storage.get(DB_KEY);
  if (raw) {
    try {
      const db = JSON.parse(raw) as HealthDb;
      // 兼容旧数据：reports 可能不存在
      return { profile: null, records: [], reports: [], ...db };
    } catch {
      // 解析失败回退空库
    }
  }
  return { profile: null, records: [], reports: [] };
}

/** 写入数据库 */
function saveDb(db: HealthDb) {
  storage.set(DB_KEY, JSON.stringify(db));
}

/** 生成自增 id（时间戳 + 随机串） */
function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 本地日期 yyyy-MM-dd（避免 toISOString 的 UTC 偏移导致跨天） */
function fmtLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** 成功响应 */
function ok(data: unknown) {
  return { code: 0, message: "操作成功", data };
}

/** 风险等级 → 总体评价结尾文案 */
const LEVEL_SUMMARY: Record<string, string> = {
  低: "各项指标总体平稳，请继续保持健康的生活方式。",
  中: "部分指标处于警戒或异常，建议关注并调整生活方式。",
  高: "多项指标异常，风险较高，建议尽快就医评估并积极干预。",
  极高: "多项指标显著异常，风险极高，请立即就医接受专业诊治。"
};

/** 组装健康报告：调规则引擎 → 模板化拼接自然语言报告 */
function buildReport(
  records: HealthRecord[],
  profile: HealthProfile | null,
  startDate: string,
  endDate: string
): HealthReport {
  const { score, level, items, risks, suggestions, medicalAdvice } =
    analyzeHealth(records, profile);

  // 总体评价
  const abnormalCount = items.filter(i => i.level === 2).length;
  const warnCount = items.filter(i => i.level === 1).length;
  let summary = `本次评估综合评分为 ${score} 分，风险等级为「${level}」。`;
  summary += items.length
    ? ` 共分析 ${items.length} 项指标，其中 ${abnormalCount} 项异常、${warnCount} 项警戒。`
    : " 该时间段内暂无健康指标记录。";
  summary += LEVEL_SUMMARY[level] ?? "";

  // 各指标逐项分析
  const itemAnalysis = items.map(
    it => `${it.name} ${it.value}：${it.grade}（${it.desc}）。`
  );

  // 雷达图数据：等级折算为风险值（正常 0 / 警戒 50 / 异常 100）
  const radar = items.map(it => ({
    name: it.name,
    value: it.level === 2 ? 100 : it.level === 1 ? 50 : 0
  }));

  // 近 10 次趋势（按日期升序取最近 N 次）
  const trend = [...records]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-10)
    .map(r => ({
      date: r.date,
      systolic: r.systolic,
      diastolic: r.diastolic,
      fastingGlucose: r.fastingGlucose
    }));

  const period =
    startDate && endDate ? `${startDate} ~ ${endDate}` : "全部记录";

  return {
    id: genId(),
    generateTime: new Date().toISOString(),
    period,
    startDate,
    endDate,
    score,
    level,
    summary,
    itemAnalysis,
    risks,
    suggestions,
    medicalAdvice,
    radar,
    trend
  };
}

// ---------- AI 健康对话（方案 A 内核）：关键词意图匹配 → 查数据 → 规则引擎 → 自然语言回答 ----------

/** 取最近一条含指定字段的记录 */
function latestWith(
  records: HealthRecord[],
  field: keyof HealthRecord
): HealthRecord | null {
  return (
    [...records]
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .find(r => r[field] != null) ?? null
  );
}

/** 最近 n 条记录（按日期倒序） */
function recentRecords(records: HealthRecord[], n: number): HealthRecord[] {
  return [...records].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, n);
}

/** 单条记录一行摘要 */
function briefOf(r: HealthRecord): string {
  const parts: string[] = [];
  if (r.systolic != null || r.diastolic != null)
    parts.push(`血压 ${r.systolic ?? "—"}/${r.diastolic ?? "—"}`);
  if (r.fastingGlucose != null) parts.push(`空腹血糖 ${r.fastingGlucose}`);
  if (r.weight != null) parts.push(`体重 ${r.weight}kg`);
  return parts.join("；");
}

/** 组装自然语言回答（已注入档案 + 最近 5 条记录作为上下文） */
function chatAnswer(question: string, db: HealthDb): string {
  const { profile, records, reports } = db;
  const q = (question ?? "").trim();
  const analyze = records.length ? analyzeHealth(records, profile) : null;
  const recent5 = recentRecords(records, 5);
  const latest = recent5[0];

  if (!q) return "请问有什么可以帮您？";

  if (!profile && !records.length) {
    return "您好，我是智康健康助手。您还没有完善个人档案和健康记录，建议先到「我的健康」填写档案，再到「指标录入」添加指标，我就能为您解读血压、血糖、血脂并评估健康风险了。";
  }

  // 血压
  if (/血压|收缩压|舒张压|高压|低压/.test(q)) {
    const r =
      latestWith(records, "systolic") ?? latestWith(records, "diastolic");
    if (!r)
      return "您还没有血压记录，请先到「指标录入」添加一条血压数据，我就能帮您解读了。";
    const s = r.systolic != null ? `${r.systolic}` : "未测";
    const d = r.diastolic != null ? `${r.diastolic}` : "未测";
    const gs = r.systolic != null ? gradeSystolic(r.systolic) : null;
    const gd = r.diastolic != null ? gradeDiastolic(r.diastolic) : null;
    const worse = worseGrade(gs, gd);
    const list = recent5
      .filter(x => x.systolic != null || x.diastolic != null)
      .map(x => `${x.date}：${x.systolic ?? "—"}/${x.diastolic ?? "—"}`)
      .join("；");
    return (
      `您最近一次血压记录（${r.date}）为 ${s}/${d} mmHg，${worse.grade}（${worse.desc}）。` +
      (list ? ` 近 5 次：${list}。` : "") +
      " 建议：低盐饮食（每日 <5g）、戒烟限酒、规律运动，并每日定时监测血压。"
    );
  }

  // 血糖
  if (/血糖|糖尿病|空腹|餐后/.test(q)) {
    const r =
      latestWith(records, "fastingGlucose") ??
      latestWith(records, "postprandialGlucose");
    if (!r) return "您还没有血糖记录，请先到「指标录入」添加血糖数据。";
    const list = recent5
      .filter(x => x.fastingGlucose != null)
      .map(x => `${x.date}：空腹 ${x.fastingGlucose}`)
      .join("；");
    const head =
      r.fastingGlucose != null
        ? `您最近一次空腹血糖（${r.date}）为 ${r.fastingGlucose} mmol/L，${
            gradeFastingGlucose(r.fastingGlucose).grade
          }（${gradeFastingGlucose(r.fastingGlucose).desc}）。`
        : `您最近一次血糖记录（${r.date}）餐后血糖为 ${r.postprandialGlucose} mmol/L。`;
    return (
      head +
      (list ? ` 近 5 次空腹血糖：${list}。` : "") +
      " 建议：控制精制碳水与含糖饮料，规律运动，持续监测空腹与餐后血糖。"
    );
  }

  // 血脂
  if (/血脂|胆固醇|甘油三酯|低密度|高密度|ldl|hdl/i.test(q)) {
    const r =
      latestWith(records, "totalCholesterol") ??
      latestWith(records, "triglyceride") ??
      latestWith(records, "ldl") ??
      latestWith(records, "hdl");
    if (!r)
      return "您还没有血脂记录，请先到「指标录入」添加血脂数据（总胆固醇/甘油三酯/低密度/高密度）。";
    const parts: string[] = [];
    if (r.totalCholesterol != null) {
      const g = gradeTotalCholesterol(r.totalCholesterol);
      parts.push(`总胆固醇 ${r.totalCholesterol}（${g.grade}）`);
    }
    if (r.triglyceride != null) {
      const g = gradeTriglyceride(r.triglyceride);
      parts.push(`甘油三酯 ${r.triglyceride}（${g.grade}）`);
    }
    if (r.ldl != null) {
      const g = gradeLdl(r.ldl);
      parts.push(`低密度脂蛋白 ${r.ldl}（${g.grade}）`);
    }
    if (r.hdl != null) {
      const g = gradeHdl(r.hdl, profile?.gender ?? 1);
      parts.push(`高密度脂蛋白 ${r.hdl}（${g.grade}）`);
    }
    return (
      `您最近一次血脂记录（${r.date}）：${parts.join("；")}。` +
      " 建议：低脂低胆固醇饮食，增加膳食纤维，戒烟限酒，必要时就医。"
    );
  }

  // BMI / 体重
  if (/bmi|体重|身高|胖|瘦|肥胖/i.test(q)) {
    const height = profile?.height;
    const weight = latest?.weight ?? profile?.weight;
    if (!height || !weight)
      return "计算 BMI 需要身高与体重，请先到「我的健康」完善档案，或在「指标录入」记录体重。";
    const bmi = gradeBmi(height, weight);
    return `您当前的 BMI 为 ${bmi.value}（${bmi.grade}，${bmi.desc}），标准范围 18.5~23.9。建议：均衡饮食 + 规律运动，维持健康体重。`;
  }

  // 报告
  if (/报告/.test(q)) {
    const rep = reports[0];
    if (rep)
      return `您最近一份健康报告（${rep.period}）综合评分 ${rep.score} 分，风险等级「${rep.level}」。可到「健康报告」页面查看完整内容。`;
    return "您还没有生成过健康报告，可到「健康报告」页面选择时间段生成一份。";
  }

  // 记录
  if (/记录|历史|数据|趋势|情况/.test(q)) {
    if (!records.length) return "您还没有健康记录，请先到「指标录入」添加。";
    const brief = recent5.map(x => `${x.date}：${briefOf(x)}`).join("；");
    return `您共有 ${records.length} 条健康记录，最近 ${recent5.length} 条如下：${brief}。`;
  }

  // 综合风险 / 评分 / 评估
  if (analyze && /风险|评分|评估|怎么样|状态/.test(q)) {
    const parts = [
      `根据您的档案与最近记录，综合风险等级为「${analyze.level}」，评分 ${analyze.score} 分（满分 100）。`
    ];
    if (analyze.risks.length)
      parts.push(`风险点：${analyze.risks.join("、")}。`);
    if (analyze.suggestions.length)
      parts.push(`建议：${analyze.suggestions.slice(0, 3).join(" ")}`);
    if (analyze.medicalAdvice) parts.push(`就医提醒：${analyze.medicalAdvice}`);
    return parts.join("");
  }

  // 档案
  if (/档案|个人信息|我的信息|姓名|年龄|性别|吸烟|饮酒|运动/.test(q)) {
    if (!profile) return "您还没有完善个人档案，请到「我的健康」填写。";
    return (
      `您的健康档案：${profile.name}，${profile.age} 岁，${
        profile.gender === 1 ? "男" : "女"
      }，身高 ${profile.height}cm，体重 ${profile.weight}kg。` +
      `吸烟：${profile.smoking}，饮酒：${profile.drinking}，运动：${profile.exercise}。`
    );
  }

  // 无意图命中：通用建议 + 引导
  const head = analyze
    ? `您最近一次综合评估风险等级为「${analyze.level}」、评分 ${analyze.score} 分。`
    : "保持均衡饮食、规律运动、定期体检是维护健康的基础。";
  return (
    head +
    " 我暂时无法精确理解您的问题，您可以这样问我：「我最近血压怎么样」「我的血糖正常吗」「评估一下健康风险」「查看最近记录」「解读我的报告」。"
  );
}

/** 导入行校验（服务端二次校验，返回错误文案，空串表示通过） */
function validateImportRow(row: any): string {
  if (!row || typeof row !== "object") return "行数据格式错误";
  const date = row.date;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date)))
    return "日期必填且格式需为 yyyy-MM-dd";
  const ranges: Array<[string, number]> = [
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
  for (const [key, max] of ranges) {
    const v = row[key];
    if (v == null || v === "") continue;
    const num = Number(v);
    if (isNaN(num) || num < 0 || num > max)
      return `${key} 需为 0~${max} 之间的数字`;
  }
  return "";
}

export default defineFakeRoute([
  // 读取个人档案
  {
    url: "/health/profile",
    method: "get",
    response: () => {
      return ok(loadDb().profile);
    }
  },
  // 更新个人档案
  {
    url: "/health/profile",
    method: "put",
    response: ({ body }) => {
      const db = loadDb();
      const prev = db.profile ?? ({} as HealthProfile);
      db.profile = {
        ...prev,
        ...body,
        createTime: prev.createTime ?? new Date().toISOString()
      };
      saveDb(db);
      return ok(db.profile);
    }
  },
  // 分页查询记录（支持日期范围筛选，按日期倒序）
  {
    url: "/health/records",
    method: "get",
    response: ({ query }) => {
      const db = loadDb();
      let list = [...db.records].sort((a, b) => (a.date < b.date ? 1 : -1));
      if (query?.startDate) list = list.filter(r => r.date >= query.startDate);
      if (query?.endDate) list = list.filter(r => r.date <= query.endDate);
      const pageSize = Number(query?.pageSize ?? 10);
      const currentPage = Number(query?.currentPage ?? 1);
      const total = list.length;
      const start = (currentPage - 1) * pageSize;
      return ok({
        list: list.slice(start, start + pageSize),
        total,
        pageSize,
        currentPage
      });
    }
  },
  // 新增一条记录
  {
    url: "/health/records",
    method: "post",
    response: ({ body }) => {
      const db = loadDb();
      const record = { ...body, id: genId() } as HealthRecord;
      db.records.push(record);
      saveDb(db);
      return ok(record);
    }
  },
  // 修改记录
  {
    url: "/health/records/:id",
    method: "put",
    response: ({ params, body }) => {
      const db = loadDb();
      const index = db.records.findIndex(r => r.id === params.id);
      if (index === -1) {
        return { code: 10001, message: "记录不存在", data: null };
      }
      db.records[index] = {
        ...db.records[index],
        ...body,
        id: params.id as string
      };
      saveDb(db);
      return ok(db.records[index]);
    }
  },
  // 删除记录
  {
    url: "/health/records/:id",
    method: "delete",
    response: ({ params }) => {
      const db = loadDb();
      db.records = db.records.filter(r => r.id !== params.id);
      saveDb(db);
      return ok(null);
    }
  },
  // 管理员 Excel 批量导入（数组），逐行校验，返回成功/失败计数与行级错误明细
  {
    url: "/health/records/import",
    method: "post",
    response: ({ body }) => {
      const db = loadDb();
      const rows = Array.isArray(body?.list) ? body.list : [];
      const errors: Array<{ row: number; message: string }> = [];
      let success = 0;
      rows.forEach((row: any, idx: number) => {
        const err = validateImportRow(row);
        if (err) {
          errors.push({ row: idx + 1, message: err });
        } else {
          db.records.push({ ...row, id: genId() });
          success++;
        }
      });
      saveDb(db);
      return ok({ success, fail: errors.length, total: rows.length, errors });
    }
  },
  // 导出健康数据（返回全量记录，前端用 xlsx 生成文件）
  {
    url: "/health/records/export",
    method: "get",
    response: () => {
      const list = [...loadDb().records].sort((a, b) =>
        a.date < b.date ? 1 : -1
      );
      return ok(list);
    }
  },
  // 规则引擎分析（输入记录数组 → 分级 + 评分 + 风险点 + 建议）
  {
    url: "/health/analyze",
    method: "post",
    response: ({ body }) => {
      const db = loadDb();
      // 入参支持「记录数组」或「{ records: [...] }」，缺省用库内全部记录
      const records = (
        Array.isArray(body) ? body : (body?.records ?? db.records)
      ) as HealthRecord[];
      return ok(analyzeHealth(records, db.profile));
    }
  },
  // 生成完整文字报告（入参时间段 → 取记录 → 调规则引擎 → 拼接报告）
  {
    url: "/health/report/generate",
    method: "post",
    response: ({ body }) => {
      const db = loadDb();
      const startDate = (body?.startDate as string) ?? "";
      const endDate = (body?.endDate as string) ?? "";
      let records = [...db.records];
      if (startDate) records = records.filter(r => r.date >= startDate);
      if (endDate) records = records.filter(r => r.date <= endDate);
      const report = buildReport(records, db.profile, startDate, endDate);
      db.reports.unshift(report);
      db.reports = db.reports.slice(0, 20); // 最多保留 20 份
      saveDb(db);
      return ok(report);
    }
  },
  // 报告历史（摘要列表）
  {
    url: "/health/report/history",
    method: "get",
    response: () => {
      const list: ReportSummary[] = loadDb().reports.map(r => ({
        id: r.id,
        generateTime: r.generateTime,
        period: r.period,
        score: r.score,
        level: r.level
      }));
      return ok(list);
    }
  },
  // 查看某份报告
  {
    url: "/health/report/:id",
    method: "get",
    response: ({ params }) => {
      const report = loadDb().reports.find(r => r.id === params.id);
      if (!report) {
        return { code: 10001, message: "报告不存在", data: null };
      }
      return ok(report);
    }
  },
  // AI 健康对话（方案 A：规则引擎意图匹配）
  {
    url: "/health/chat",
    method: "post",
    response: ({ body }) => {
      const db = loadDb();
      // deep-chat 默认发送 OpenAI 兼容 { messages: [{ role, content }] }，取最新一条用户消息作为提问
      const messages = Array.isArray(body?.messages) ? body.messages : [];
      const question =
        [...messages].reverse().find((m: any) => m?.role === "user")?.content ??
        (body?.question as string) ??
        "";
      return ok(chatAnswer(String(question), db));
    }
  },
  // 一键生成 90 天演示数据（含 2~3 个异常指标，便于演示 AI 分析价值）
  {
    url: "/health/seed",
    method: "post",
    response: () => {
      const db = loadDb();
      const records: HealthRecord[] = [];
      const today = new Date();
      // 演示档案：45 岁男性、身高 172cm、体重 78kg（BMI≈26.4 超重），
      // 吸烟/饮酒偶尔、几乎不运动 —— 让规则引擎能产出 BMI 分级与生活方式风险
      if (!db.profile) {
        db.profile = {
          name: "演示用户",
          gender: 1,
          age: 45,
          height: 172,
          weight: 78,
          waistline: 88,
          medicalHistory: "无",
          familyHistory: "父亲有高血压史",
          allergyHistory: "无",
          smoking: "偶尔",
          drinking: "偶尔",
          exercise: "几乎不运动",
          createTime: today.toISOString()
        };
      }
      // 最近 12 天为「异常演示段」，其余为「正常段」，
      // 让趋势图呈现「近期恶化」、报告能命中多项风险点
      for (let i = 89; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const abnormal = i < 12;
        records.push({
          id: genId(),
          date: fmtLocalDate(d),
          // 血压：正常段 116~132/73~84，异常段 150~165/90~100（一/二级高血压）
          systolic: abnormal
            ? 150 + Math.round(Math.random() * 15)
            : 116 + Math.round(Math.random() * 16),
          diastolic: abnormal
            ? 90 + Math.round(Math.random() * 10)
            : 73 + Math.round(Math.random() * 11),
          // 空腹血糖：异常段 7.0~7.6（疑似糖尿病）
          fastingGlucose: Number(
            (abnormal
              ? 7.0 + Math.random() * 0.6
              : 4.6 + Math.random() * 1.3
            ).toFixed(1)
          ),
          postprandialGlucose: Number(
            (abnormal
              ? 8.2 + Math.random() * 1.6
              : 6.3 + Math.random() * 1.6
            ).toFixed(1)
          ),
          totalCholesterol: Number(
            (abnormal
              ? 5.4 + Math.random() * 1.0
              : 4.1 + Math.random() * 1.2
            ).toFixed(1)
          ),
          triglyceride: Number(
            (abnormal
              ? 1.8 + Math.random() * 0.8
              : 1.0 + Math.random() * 0.7
            ).toFixed(1)
          ),
          // LDL：异常段 4.1~4.5（升高）
          ldl: Number(
            (abnormal
              ? 4.1 + Math.random() * 0.4
              : 2.3 + Math.random() * 1.0
            ).toFixed(1)
          ),
          hdl: Number((1.0 + Math.random() * 0.4).toFixed(1)),
          heartRate: 68 + Math.round(Math.random() * 16),
          bloodOxygen: 96 + Math.round(Math.random() * 3),
          // 体重：正常段 74 缓升至 78，异常段维持 78
          weight: Number((abnormal ? 78 : 74 + (89 - i) * 0.045).toFixed(1)),
          remark: abnormal && i < 3 ? "近期加班多、睡眠不足" : ""
        });
      }
      db.records = records;
      saveDb(db);
      return ok({ total: records.length });
    }
  }
]);
