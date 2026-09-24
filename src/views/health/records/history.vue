<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { message } from "@/utils/message";
import { ElMessageBox } from "element-plus";
import { utils, writeFile } from "xlsx";
import {
  getHealthProfile,
  getHealthRecords,
  updateHealthRecord,
  deleteHealthRecord,
  deleteHealthRecords,
  exportHealthRecords
} from "@/api/health";
import type {
  HealthRecord,
  RecordSourceType,
  SourceType
} from "@/types/health";
import { QUALITY_LABELS, SOURCE_LABELS, assessQuality } from "@/types/health";
import type { FormInstance } from "element-plus";

defineOptions({
  name: "HealthRecordHistory"
});

const loading = ref(false);
const list = ref<HealthRecord[]>([]);
const total = ref(0);
const currentPage = ref(1);
const pageSize = ref(10);
const dateRange = ref<[string, string] | null>(null);
/** C2 来源筛选（空 = 全部） */
const sourceFilter = ref<SourceType | "">("");

/** 档案身高：质量提示要复算 BMI，口径与服务端 assessQuality 完全同源 */
const height = ref<number | undefined>(undefined);

/** 来源标签配色（手动=灰、设备=蓝、导入=绿） */
const SOURCE_TAG: Record<RecordSourceType, "info" | "primary" | "success"> = {
  manual: "info",
  device: "primary",
  import: "success"
};

/** 来源选项（文案取自共享层，避免前端另写一套） */
const sourceOptions = (Object.keys(SOURCE_LABELS) as SourceType[]).map(v => ({
  value: v,
  label: SOURCE_LABELS[v]
}));

/** 该记录的质量问题说明（与写入时的判定同一函数，故一定与库内标记一致） */
function qualityIssues(row: Partial<HealthRecord>): string[] {
  return assessQuality(row, height.value).issues.map(i => i.message);
}

// 编辑弹窗
const editVisible = ref(false);
const editLoading = ref(false);
const editFormRef = ref<FormInstance>();
const editForm = reactive<HealthRecord>({
  id: "",
  date: ""
});

/** 空值显示占位 */
function fmt(v: number | undefined | null) {
  return v === undefined || v === null ? "-" : v;
}

async function loadData() {
  loading.value = true;
  try {
    const { code, data } = await getHealthRecords({
      startDate: dateRange.value?.[0],
      endDate: dateRange.value?.[1],
      sourceType: sourceFilter.value || undefined,
      currentPage: currentPage.value,
      pageSize: pageSize.value
    });
    if (code === 0 && data) {
      list.value = data.list ?? [];
      total.value = data.total ?? 0;
    }
  } finally {
    loading.value = false;
  }
}

/** 档案身高（质量提示复算 BMI 用）：没有档案或未填身高则只按各项指标判定 */
async function loadHeight() {
  try {
    const { code, data } = await getHealthProfile();
    if (code === 0 && data?.height) height.value = Number(data.height);
  } catch {
    // 档案读取失败不影响列表展示，仅少了 BMI 维度的提示
  }
}

function handleSearch() {
  currentPage.value = 1;
  loadData();
}

function handleReset() {
  dateRange.value = null;
  sourceFilter.value = "";
  currentPage.value = 1;
  loadData();
}

/** 按当前时间范围 / 来源导出 Excel（备份/展示）：走全量导出接口，不分页不截断 */
async function handleExport() {
  const { code, data } = await exportHealthRecords({
    startDate: dateRange.value?.[0],
    endDate: dateRange.value?.[1],
    sourceType: sourceFilter.value || undefined
  });
  if (code !== 0 || !data?.length) {
    message("该筛选条件下暂无数据可导出", { type: "warning" });
    return;
  }
  const headers = [
    "日期",
    "测量时间",
    "数据来源",
    "数据质量",
    "收缩压(mmHg)",
    "舒张压(mmHg)",
    "空腹血糖(mmol/L)",
    "餐后血糖(mmol/L)",
    "总胆固醇(mmol/L)",
    "甘油三酯(mmol/L)",
    "LDL(mmol/L)",
    "HDL(mmol/L)",
    "心率(次/分)",
    "血氧(%)",
    "体重(kg)",
    "备注"
  ];
  const rows = data.map(r => [
    r.date,
    r.measuredAt ?? "",
    SOURCE_LABELS[r.sourceType ?? "manual"],
    QUALITY_LABELS[r.qualityFlag ?? "good"],
    r.systolic ?? "",
    r.diastolic ?? "",
    r.fastingGlucose ?? "",
    r.postprandialGlucose ?? "",
    r.totalCholesterol ?? "",
    r.triglyceride ?? "",
    r.ldl ?? "",
    r.hdl ?? "",
    r.heartRate ?? "",
    r.bloodOxygen ?? "",
    r.weight ?? "",
    r.remark ?? ""
  ]);
  const ws = utils.aoa_to_sheet([headers, ...rows]);
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, "指标明细");
  writeFile(
    wb,
    `健康指标明细_${dateRange.value?.[0] ?? "全部"}${
      dateRange.value?.[1] ? `_${dateRange.value[1]}` : ""
    }.xlsx`
  );
  message("导出成功", { type: "success" });
}

function openEdit(row: any) {
  Object.assign(editForm, row);
  editVisible.value = true;
}

async function handleDelete(row: any) {
  await ElMessageBox.confirm("确定删除该条记录吗？", "提示", {
    type: "warning",
    confirmButtonText: "删除",
    cancelButtonText: "取消"
  });
  const { code } = await deleteHealthRecord(row.id);
  if (code === 0) {
    message("删除成功", { type: "success" });
    loadData();
  }
}

/** 批量删除（P1-7）：勾选行 → 确认 → 批量接口（只删当前用户数据） */
const selectedRows = ref<HealthRecord[]>([]);
const selectedIds = computed(() => selectedRows.value.map(r => r.id));

function handleSelectionChange(rows: HealthRecord[]) {
  selectedRows.value = rows;
}

async function handleBatchDelete() {
  if (!selectedIds.value.length) {
    message("请先勾选要删除的记录", { type: "warning" });
    return;
  }
  await ElMessageBox.confirm(
    `确定删除选中的 ${selectedIds.value.length} 条记录吗？删除后无法恢复。`,
    "批量删除",
    { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" }
  );
  const { code, data } = await deleteHealthRecords(selectedIds.value);
  if (code === 0) {
    message(`已删除 ${data?.deleted ?? 0} 条记录`, { type: "success" });
    selectedRows.value = [];
    loadData();
  }
}

async function handleEditSave(formEl: FormInstance | undefined) {
  if (!formEl) return;
  await formEl.validate(async valid => {
    if (!valid) return;
    editLoading.value = true;
    try {
      const { code } = await updateHealthRecord(editForm.id, { ...editForm });
      if (code === 0) {
        message("修改成功", { type: "success" });
        editVisible.value = false;
        loadData();
      }
    } finally {
      editLoading.value = false;
    }
  });
}

/** 编辑中的实时质量判定（保存后服务端用同一函数重算，故提示与落库标记一致） */
const editQuality = computed(() => assessQuality(editForm, height.value));

onMounted(() => {
  loadData();
  loadHeight();
});
</script>

<template>
  <div>
    <el-card shadow="never">
      <template #header>
        <div class="flex-bc">
          <span class="font-medium">历史记录</span>
          <div class="flex items-center">
            <el-date-picker
              v-model="dateRange"
              type="daterange"
              value-format="YYYY-MM-DD"
              range-separator="至"
              start-placeholder="开始日期"
              end-placeholder="结束日期"
              class="mr-2"
            />
            <!-- C2：按数据来源筛选（手动录入 / 设备同步 / 批量导入） -->
            <el-select
              v-model="sourceFilter"
              placeholder="数据来源"
              clearable
              class="w-32 mr-2"
            >
              <el-option
                v-for="opt in sourceOptions"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
            <el-button type="primary" @click="handleSearch">查询</el-button>
            <el-button @click="handleReset">重置</el-button>
            <el-button
              type="danger"
              plain
              :disabled="!selectedIds.length"
              @click="handleBatchDelete"
            >
              批量删除{{
                selectedIds.length ? `（${selectedIds.length}）` : ""
              }}
            </el-button>
            <el-button @click="handleExport">导出 Excel</el-button>
          </div>
        </div>
      </template>

      <el-table
        v-loading="loading"
        :data="list"
        border
        stripe
        @selection-change="handleSelectionChange"
      >
        <el-table-column type="selection" width="48" />
        <el-table-column label="日期" width="120">
          <template #default="{ row }">
            <div>{{ row.date }}</div>
            <!-- 精确到时刻时补一行小字（仅精确到日期的记录不显示，避免噪声） -->
            <div
              v-if="row.measuredAt && !row.measuredAt.endsWith(' 00:00:00')"
              class="text-xs text-gray-400"
            >
              {{ row.measuredAt.slice(11) }}
            </div>
          </template>
        </el-table-column>
        <!-- C2：来源标签（设备来源附带设备名） -->
        <el-table-column label="来源" width="110">
          <template #default="{ row }">
            <el-tooltip
              :content="
                row.sourceType === 'device' && row.deviceName
                  ? `${SOURCE_LABELS.device}：${row.deviceName}`
                  : (SOURCE_LABELS[row.sourceType] ?? SOURCE_LABELS.manual)
              "
              placement="top"
            >
              <el-tag
                size="small"
                effect="plain"
                :type="SOURCE_TAG[row.sourceType] ?? 'info'"
              >
                {{ SOURCE_LABELS[row.sourceType] ?? SOURCE_LABELS.manual }}
              </el-tag>
            </el-tooltip>
          </template>
        </el-table-column>
        <!-- C2：质量标签（存疑黄色提示、无效红色并不参与分析） -->
        <el-table-column label="质量" width="100">
          <template #default="{ row }">
            <el-tooltip
              v-if="row.qualityFlag && row.qualityFlag !== 'good'"
              :content="qualityIssues(row).join('；')"
              placement="top"
            >
              <el-tag
                size="small"
                :type="row.qualityFlag === 'invalid' ? 'danger' : 'warning'"
              >
                {{ QUALITY_LABELS[row.qualityFlag] }}
                <template v-if="row.qualityFlag === 'invalid'">
                  （不计入分析）
                </template>
              </el-tag>
            </el-tooltip>
            <span v-else class="text-xs text-gray-400">
              {{ QUALITY_LABELS.good }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="血压(mmHg)" width="140">
          <template #default="{ row }">
            {{ fmt(row.systolic) }} / {{ fmt(row.diastolic) }}
          </template>
        </el-table-column>
        <el-table-column label="空腹血糖" width="110">
          <template #default="{ row }">{{ fmt(row.fastingGlucose) }}</template>
        </el-table-column>
        <el-table-column label="总胆固醇" width="110">
          <template #default="{ row }">
            {{ fmt(row.totalCholesterol) }}
          </template>
        </el-table-column>
        <el-table-column label="心率" width="90">
          <template #default="{ row }">{{ fmt(row.heartRate) }}</template>
        </el-table-column>
        <el-table-column label="血氧(%)" width="90">
          <template #default="{ row }">{{ fmt(row.bloodOxygen) }}</template>
        </el-table-column>
        <el-table-column label="体重(kg)" width="100">
          <template #default="{ row }">{{ fmt(row.weight) }}</template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="140" />
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">
              编辑
            </el-button>
            <el-button link type="danger" @click="handleDelete(row)">
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="mt-4 flex justify-end">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next, jumper"
          @current-change="loadData"
          @size-change="handleSearch"
        />
      </div>
    </el-card>

    <!-- 编辑弹窗 -->
    <el-dialog v-model="editVisible" title="编辑记录" width="640px">
      <!-- C2：改动中的数值实时质量提示（保存后服务端用同一函数重算并落库） -->
      <el-alert
        v-if="editQuality.flag !== 'good'"
        :type="editQuality.flag === 'invalid' ? 'error' : 'warning'"
        show-icon
        :closable="false"
        class="mb-3"
        :title="`当前数值将被标记为「${QUALITY_LABELS[editQuality.flag]}」`"
        :description="editQuality.issues.map(i => i.message).join('；')"
      />
      <el-form ref="editFormRef" :model="editForm" label-width="120px">
        <el-form-item label="记录日期">
          <el-date-picker
            v-model="editForm.date"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="请选择日期"
          />
        </el-form-item>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="收缩压(mmHg)">
              <el-input-number
                v-model="editForm.systolic"
                :min="0"
                :max="300"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="舒张压(mmHg)">
              <el-input-number
                v-model="editForm.diastolic"
                :min="0"
                :max="200"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="空腹血糖">
              <el-input-number
                v-model="editForm.fastingGlucose"
                :min="0"
                :max="40"
                :precision="1"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="餐后血糖">
              <el-input-number
                v-model="editForm.postprandialGlucose"
                :min="0"
                :max="40"
                :precision="1"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="总胆固醇">
              <el-input-number
                v-model="editForm.totalCholesterol"
                :min="0"
                :max="20"
                :precision="2"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="甘油三酯">
              <el-input-number
                v-model="editForm.triglyceride"
                :min="0"
                :max="20"
                :precision="2"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="LDL">
              <el-input-number
                v-model="editForm.ldl"
                :min="0"
                :max="20"
                :precision="2"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="HDL">
              <el-input-number
                v-model="editForm.hdl"
                :min="0"
                :max="20"
                :precision="2"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="心率(次/分)">
              <el-input-number
                v-model="editForm.heartRate"
                :min="0"
                :max="300"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="血氧(%)">
              <el-input-number
                v-model="editForm.bloodOxygen"
                :min="0"
                :max="100"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="体重(kg)">
              <el-input-number
                v-model="editForm.weight"
                :min="0"
                :max="300"
                :precision="1"
              />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="备注">
          <el-input v-model="editForm.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="editLoading"
          @click="handleEditSave(editFormRef)"
        >
          保存
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>
