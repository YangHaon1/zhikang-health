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
  >("post", "/health/records/import", { data });
};

/** 导出健康记录（全量，供前端 xlsx 生成 Excel） */
export const exportHealthRecords = () => {
  return http.request<Result<HealthRecord[]>>("get", "/health/records/export");
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
  return http.request<Result<HealthReport>>("post", "/health/report/generate", {
    data
  });
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
  return http.request<Result<HealthReport>>("get", `/health/report/${id}`);
};
