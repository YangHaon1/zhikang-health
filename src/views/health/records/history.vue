<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { message } from "@/utils/message";
import { ElMessageBox } from "element-plus";
import { utils, writeFile } from "xlsx";
import {
  getHealthRecords,
  updateHealthRecord,
  deleteHealthRecord,
  exportHealthRecords
} from "@/api/health";
import type { HealthRecord } from "@/types/health";
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

function handleSearch() {
  currentPage.value = 1;
  loadData();
}

function handleReset() {
  dateRange.value = null;
  currentPage.value = 1;
  loadData();
}

/** 按当前时间范围导出 Excel（备份/展示）：走全量导出接口，不分页不截断 */
async function handleExport() {
  const { code, data } = await exportHealthRecords({
    startDate: dateRange.value?.[0],
    endDate: dateRange.value?.[1]
  });
  if (code !== 0 || !data?.length) {
    message("该时间范围内暂无数据可导出", { type: "warning" });
    return;
  }
  const headers = [
    "日期",
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

onMounted(() => {
  loadData();
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
            <el-button type="primary" @click="handleSearch">查询</el-button>
            <el-button @click="handleReset">重置</el-button>
            <el-button @click="handleExport">导出 Excel</el-button>
          </div>
        </div>
      </template>

      <el-table v-loading="loading" :data="list" border stripe>
        <el-table-column prop="date" label="日期" width="120" />
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
