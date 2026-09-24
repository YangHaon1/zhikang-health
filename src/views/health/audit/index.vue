<template>
  <div class="audit-page">
    <!-- 页头 -->
    <el-card shadow="never" class="mb-4">
      <div class="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h3 class="text-base font-bold">审计日志</h3>
          <p class="text-sm text-gray-500 mt-1">
            关键操作留痕：登录、数据导出、报告生成、授权变更、设备同步、批量导入。
            日志仅记操作人与动作，不含任何健康指标数值。
          </p>
        </div>
        <el-button :loading="loading" @click="load">刷新</el-button>
      </div>
    </el-card>

    <!-- 越权提示：菜单由后端按角色下发，此处再兜一层 -->
    <el-alert
      v-if="!isAdmin"
      type="error"
      show-icon
      :closable="false"
      title="无权限"
      description="审计日志仅管理员可查看。"
    />

    <template v-else>
      <!-- 筛选 -->
      <el-card shadow="never" class="mb-4">
        <el-form :inline="true" @submit.prevent>
          <el-form-item label="动作">
            <el-select
              v-model="query.action"
              placeholder="全部动作"
              clearable
              class="w-40"
              @change="handleSearch"
            >
              <el-option
                v-for="opt in AUDIT_ACTION_OPTIONS"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="操作人">
            <el-input
              v-model="query.username"
              placeholder="账号名 / 登录名"
              clearable
              class="w-45"
              @keyup.enter="handleSearch"
              @clear="handleSearch"
            />
          </el-form-item>
          <el-form-item label="时间范围">
            <el-date-picker
              v-model="range"
              type="daterange"
              value-format="YYYY-MM-DD"
              range-separator="至"
              start-placeholder="开始日期"
              end-placeholder="结束日期"
              class="w-65"
              @change="handleSearch"
            />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="handleSearch">查询</el-button>
            <el-button @click="handleReset">重置</el-button>
          </el-form-item>
        </el-form>
      </el-card>

      <!-- 列表 -->
      <el-card shadow="never">
        <el-table v-loading="loading" :data="list" size="small" border>
          <el-table-column prop="createTime" label="时间" width="170" />
          <el-table-column label="操作人" min-width="150">
            <template #default="{ row }">
              <span>{{ row.username || "—" }}</span>
              <el-tag
                v-if="row.userId === null"
                type="warning"
                effect="plain"
                size="small"
                class="ml-1"
              >
                账号不存在
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="动作" width="120">
            <template #default="{ row }">
              <el-tag :type="TAG_TYPE[row.action] ?? 'info'" effect="light">
                {{ row.actionLabel }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="来源 IP" width="140">
            <template #default="{ row }">{{ row.actorIp || "—" }}</template>
          </el-table-column>
          <el-table-column label="详情" min-width="300">
            <template #default="{ row }">
              <span class="detail-text">{{ detailText(row.detail) }}</span>
            </template>
          </el-table-column>
          <template #empty>
            <el-empty description="暂无审计记录" />
          </template>
        </el-table>

        <el-pagination
          v-model:current-page="query.currentPage"
          v-model:page-size="query.pageSize"
          class="mt-3 justify-end"
          background
          layout="total, sizes, prev, pager, next, jumper"
          :total="total"
          :page-sizes="[10, 20, 50, 100]"
          @current-change="load"
          @size-change="handleSearch"
        />
      </el-card>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { message } from "@/utils/message";
import { useUserStoreHook } from "@/store/modules/user";
import { getAuditLogs } from "@/api/health";
import type { AuditDetail, AuditLogItem } from "@/types/health";
import { AUDIT_ACTION_OPTIONS } from "@/types/health";

defineOptions({
  name: "HealthAudit"
});

/** 审计页可见性与后端 adminOnly、菜单 roles 同一口径 */
const isAdmin = useUserStoreHook().roles.includes("admin");

/** 动作标签配色（仅影响观感，未知动作回落 info） */
const TAG_TYPE: Record<string, "success" | "warning" | "danger" | "info"> = {
  login_success: "success",
  login_failed: "danger",
  data_export: "warning",
  analytics_export: "warning",
  report_generate: "info",
  authorization_change: "warning",
  device_sync: "success",
  records_import: "info"
};

const loading = ref(false);
const list = ref<AuditLogItem[]>([]);
const total = ref(0);
const range = ref<[string, string] | null>(null);

const query = reactive({
  action: "",
  username: "",
  currentPage: 1,
  pageSize: 10
});

/** detail 渲染成 `键=值` 列表：数组用「、」连接，服务端已脱敏，前端只展示 */
function detailText(detail: AuditDetail): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(detail ?? {})) {
    const text = Array.isArray(value)
      ? value.join("、")
      : value === null
        ? "—"
        : String(value);
    parts.push(`${key}=${text}`);
  }
  return parts.length ? parts.join("；") : "—";
}

async function load() {
  if (!isAdmin) return;
  loading.value = true;
  try {
    const { code, data } = await getAuditLogs({
      action: query.action || undefined,
      username: query.username || undefined,
      startDate: range.value?.[0] || undefined,
      endDate: range.value?.[1] || undefined,
      currentPage: query.currentPage,
      pageSize: query.pageSize
    });
    if (code === 0 && data) {
      list.value = data.list ?? [];
      total.value = data.total ?? 0;
    } else {
      message("审计日志获取失败", { type: "error" });
    }
  } catch (error: any) {
    // 越权（403）与登录失效都会走到这里，服务端 message 优先
    message(error?.response?.data?.message ?? "审计日志获取失败", {
      type: "error"
    });
    list.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

/** 条件变化一律回到第 1 页，否则会停在一个空页上 */
function handleSearch() {
  query.currentPage = 1;
  load();
}

function handleReset() {
  query.action = "";
  query.username = "";
  range.value = null;
  handleSearch();
}

onMounted(load);
</script>

<style scoped lang="scss">
.detail-text {
  font-size: 12px;
  color: var(--el-text-color-regular);
  word-break: break-all;
}
</style>
