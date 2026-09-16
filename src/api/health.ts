import { http } from "@/utils/http";
import type {
  HealthProfile,
  HealthRecord,
  HealthReport,
  ReportSummary
} from "@/types/health";

/** 通用响应结构 */
type Result<T = unknown> = {
  code: number;
  message: string;
  data?: T;
};

/** 分页结果 */
type PageResult<T> = {
  list: T[];
  total?: number;
  pageSize?: number;
  currentPage?: number;
};

/** 读取个人档案 */
export const getHealthProfile = () => {
  return http.request<Result<HealthProfile | null>>(
    "get",
    "/api/health/profile"
  );
};

/** 更新个人档案 */
export const updateHealthProfile = (data: Partial<HealthProfile>) => {
  return http.request<Result<HealthProfile>>("put", "/api/health/profile", {
    data
  });
};

/** 分页查询健康记录（支持日期范围筛选） */
export const getHealthRecords = (data?: {
  startDate?: string;
  endDate?: string;
  currentPage?: number;
  pageSize?: number;
}) => {
  return http.request<Result<PageResult<HealthRecord>>>(
    "get",
    "/api/health/records",
    { params: data }
  );
};

/** 新增一条健康记录 */
export const addHealthRecord = (data: Omit<HealthRecord, "id">) => {
  return http.request<Result<HealthRecord>>("post", "/api/health/records", {
    data
  });
};

/** 修改健康记录 */
export const updateHealthRecord = (id: string, data: Partial<HealthRecord>) => {
  return http.request<Result<HealthRecord>>(
    "put",
    `/api/health/records/${id}`,
    { data }
  );
};

/** 删除健康记录 */
export const deleteHealthRecord = (id: string) => {
  return http.request<Result<null>>("delete", `/api/health/records/${id}`);
};

/** 批量导入健康记录（返回成功/失败计数与行级错误明细） */
export const importHealthRecords = (data: { list: Array<any> }) => {
  return http.request<
    Result<{
      success: number;
      fail: number;
      total: number;
      errors: Array<{ row: number; message: string }>;
    }>
  >("post", "/api/health/records/import", { data });
};

/** 导出健康记录（全量，供前端 xlsx 生成 Excel） */
export const exportHealthRecords = () => {
  return http.request<Result<HealthRecord[]>>(
    "get",
    "/api/health/records/export"
  );
};

/** AI 健康对话（A 规则引擎 / B 大模型，由服务端按 mode 分流） */
export const sendHealthChat = (data: {
  messages?: Array<{ role: string; content: string }>;
  question?: string;
  mode?: "rules" | "llm";
}) => {
  return http.request<Result<string>>("post", "/api/health/chat", { data });
};

/** 当前用户的对话历史（服务端存储，供对话页恢复会话） */
export const getHealthChatHistory = () => {
  return http.request<Result<Array<{ role: string; text: string }>>>(
    "get",
    "/api/health/chat/history"
  );
};

/** 方案 B 可用性（Key 在服务端，前端只问「能不能用」，不下发 Key） */
export const getHealthChatConfig = () => {
  return http.request<Result<{ llmAvailable: boolean }>>(
    "get",
    "/api/health/chat/config"
  );
};

/** 一键生成 90 天演示数据 */
export const seedHealthRecords = () => {
  return http.request<Result<{ total: number }>>("post", "/health/seed");
};

/** 生成健康风险报告（入参时间段） */
export const generateHealthReport = (data?: {
  startDate?: string;
  endDate?: string;
}) => {
  return http.request<Result<HealthReport>>(
    "post",
    "/api/health/report/generate",
    { data }
  );
};

/** 报告历史摘要列表 */
export const getHealthReportHistory = () => {
  return http.request<Result<ReportSummary[]>>(
    "get",
    "/api/health/report/history"
  );
};

/** 查看某份报告 */
export const getHealthReport = (id: string) => {
  return http.request<Result<HealthReport>>("get", `/api/health/report/${id}`);
};
