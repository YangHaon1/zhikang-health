// 健康数据层 mock：本地简易存储（localStorage + 内存兜底），仅用 Web 标准 API，禁止 import Node 模块
import { defineFakeRoute } from "vite-plugin-fake-server/client";
import type {
  HealthProfile,
  HealthRecord,
  HealthReport,
  ReportSummary
} from "@/types/health";
// 单项分级函数随对话逻辑一起迁到了 @shared/health-chat，这里只需 analyzeHealth
import { analyzeHealth } from "@shared/health-engine";
import { buildReport as buildReportContent } from "@shared/health-report";
import { validateImportRow } from "@shared/health-import";
import { chatAnswer } from "@shared/health-chat";
import { buildDemoRecords, DEMO_PROFILE } from "@shared/health-seed";

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

// 本地日期格式化的那张表随演示数据生成器一起迁到了 `@shared/health-seed`（B7）。

/** 成功响应 */
function ok(data: unknown) {
  return { code: 0, message: "操作成功", data };
}

/**
 * 组装健康报告：报告模板已迁到唯一源码 `@shared/health-report`（后端 `/api/health/report/generate` 用的是同一份），
 * 这里只补 id 与生成时间这两个「存储层事实」。
 */
function buildReport(
  records: HealthRecord[],
  profile: HealthProfile | null,
  startDate: string,
  endDate: string
): HealthReport {
  return {
    ...buildReportContent(records, profile, startDate, endDate),
    id: genId(),
    generateTime: new Date().toISOString()
  };
}

// 对话意图匹配已迁到唯一源码 `@shared/health-chat`（后端 POST /api/health/chat 用的是同一份）。
// 导入行校验已迁到唯一源码 `@shared/health-import`（后端 /api/health/records/import 用的是同一份），见文件顶部 import。

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
      // 注：mock 侧对话无持久化（内存 db 无 chat_history）；服务端已落库，B9 删 mock 后走 /api
    }
  },
  // 一键生成 90 天演示数据（含 2~3 个异常指标，便于演示 AI 分析价值）
  {
    url: "/health/seed",
    method: "post",
    response: () => {
      const db = loadDb();
      // 生成规则已迁到唯一源码 `@shared/health-seed`（后端 /api/health/seed 用的是同一份）
      const records = buildDemoRecords();
      if (!db.profile) {
        db.profile = { ...DEMO_PROFILE, createTime: new Date().toISOString() };
      }
      db.records = records;
      saveDb(db);
      return ok({ total: records.length });
    }
  }
]);
