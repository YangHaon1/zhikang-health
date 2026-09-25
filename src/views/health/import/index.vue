<script setup lang="ts">
import { computed, ref } from "vue";
import { message } from "@/utils/message";
import { read, utils, writeFile } from "xlsx";
import { importHealthRecords, seedHealthRecords } from "@/api/health";
import type { HealthRecord } from "@/types/health";
import { fmtDate } from "@/utils/date";

defineOptions({
  name: "HealthImport"
});

/** 导入列定义（模板表头、解析与校验共用，顺序即 Excel 列顺序） */
interface ColDef {
  key: string;
  label: string;
  /** 数值上限（下限统一 0）；缺省表示无需范围校验（如备注） */
  max?: number;
}

const COLUMNS: ColDef[] = [
  { key: "date", label: "日期" },
  { key: "systolic", label: "收缩压(mmHg)", max: 300 },
  { key: "diastolic", label: "舒张压(mmHg)", max: 200 },
  { key: "fastingGlucose", label: "空腹血糖(mmol/L)", max: 40 },
  { key: "postprandialGlucose", label: "餐后血糖(mmol/L)", max: 40 },
  { key: "totalCholesterol", label: "总胆固醇(mmol/L)", max: 20 },
  { key: "triglyceride", label: "甘油三酯(mmol/L)", max: 20 },
  { key: "ldl", label: "LDL(mmol/L)", max: 20 },
  { key: "hdl", label: "HDL(mmol/L)", max: 20 },
  { key: "heartRate", label: "心率(次/分)", max: 300 },
  { key: "bloodOxygen", label: "血氧(%)", max: 100 },
  { key: "weight", label: "体重(kg)", max: 300 },
  { key: "remark", label: "备注" }
];

/** 解析日期单元格：支持 Date 对象、Excel 序列号、yyyy-MM-dd / yyyy/M/d / yyyy.M.d 字符串 */
function parseDate(v: any): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : fmtDate(v);
  if (typeof v === "number") {
    if (!isFinite(v)) return null;
    const d = new Date(Math.round((v - 25569) * 86400000));
    return isNaN(d.getTime()) ? null : fmtDate(d);
  }
  const s = String(v).trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) {
    const y = +m[1];
    const mo = +m[2];
    const d = +m[3];
    const dt = new Date(y, mo - 1, d);
    if (
      mo >= 1 &&
      mo <= 12 &&
      dt.getFullYear() === y &&
      dt.getMonth() === mo - 1 &&
      dt.getDate() === d
    ) {
      return fmtDate(dt);
    }
    return null;
  }
  const n = Number(s);
  if (!isNaN(n)) {
    const d = new Date(Math.round((n - 25569) * 86400000));
    return isNaN(d.getTime()) ? null : fmtDate(d);
  }
  return null;
}

/** 单元格 → 展示文本 */
function cellText(v: any): string {
  if (v == null) return "";
  if (v instanceof Date) return fmtDate(v);
  return String(v).trim();
}

/** 逐行校验：返回错误文案数组与校验通过的记录（未通过为 null） */
function validateRow(row: any[]): {
  errors: string[];
  record: Omit<HealthRecord, "id"> | null;
} {
  const errors: string[] = [];
  const record: Record<string, any> = {};

  const dateStr = parseDate(row[0]);
  if (!dateStr) {
    errors.push("日期必填且格式需为 yyyy-MM-dd");
  } else {
    record.date = dateStr;
  }

  for (let i = 1; i < COLUMNS.length; i++) {
    const col = COLUMNS[i];
    if (!col.max) continue; // 备注列不做范围校验
    const raw = row[i];
    if (raw == null || raw === "") continue; // 空值跳过
    const num = typeof raw === "number" ? raw : Number(String(raw).trim());
    if (isNaN(num)) {
      errors.push(`${col.label} 需为数字`);
      continue;
    }
    if (num < 0 || num > col.max) {
      errors.push(`${col.label} 需在 0~${col.max} 之间`);
      continue;
    }
    record[col.key] = num;
  }

  const remark = row[COLUMNS.length - 1];
  if (remark != null && remark !== "") record.remark = String(remark).trim();

  if (errors.length) return { errors, record: null };
  return { errors, record: record as Omit<HealthRecord, "id"> };
}

// ---------- 模板下载 ----------
function downloadTemplate() {
  const headers = COLUMNS.map(c => c.label);
  const sample = [
    [
      "2026-09-16",
      120,
      78,
      5.2,
      6.8,
      4.5,
      1.2,
      2.6,
      1.4,
      72,
      98,
      65,
      "示例数据"
    ],
    ["2026-09-15", 135, 88, 6.5, 8.1, 5.6, 1.9, 3.5, 1.1, 76, 97, 66, ""]
  ];
  const ws = utils.aoa_to_sheet([headers, ...sample]);
  ws["!cols"] = COLUMNS.map(() => ({ wch: 16 }));
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, "健康数据");
  writeFile(wb, "健康数据导入模板.xlsx");
}

// ---------- 上传解析 ----------
interface ParsedRow {
  /** Excel 行号（表头占第 1 行，数据从第 2 行起） */
  rowNo: number;
  /** 各列展示文本 */
  cells: string[];
  errors: string[];
  record: Omit<HealthRecord, "id"> | null;
}

const uploadRef = ref();
const fileName = ref("");
const parsedRows = ref<ParsedRow[]>([]);
const importing = ref(false);
const seeding = ref(false);
/** 服务端返回的行级错误（已换算成 Excel 行号），无错误时为空、不展示 */
const importErrors = ref<Array<{ row: number; message: string }>>([]);

const validRows = computed(() =>
  parsedRows.value.filter(r => r.record).map(r => r.record!)
);
const validCount = computed(() => validRows.value.length);
const errorCount = computed(
  () => parsedRows.value.filter(r => r.errors.length).length
);

async function handleFileChange(uploadFile: any) {
  const file = uploadFile?.raw as File | undefined;
  if (!file) return;
  // 限制 1：文件大小 ≤ 2MB，防止大文件全量解析卡死主线程
  if (file.size > 2 * 1024 * 1024) {
    message("文件超过 2MB，请拆分后分批导入", { type: "error" });
    uploadRef.value?.clearFiles();
    return;
  }
  let wb;
  try {
    wb = read(await file.arrayBuffer(), { type: "array", cellDates: true });
  } catch {
    message("文件解析失败，请确认是有效的 Excel 文件", { type: "error" });
    uploadRef.value?.clearFiles();
    return;
  }
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) {
    message("文件中没有工作表", { type: "error" });
    uploadRef.value?.clearFiles();
    return;
  }
  const rows = utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    blankrows: false
  }) as any[][];
  const dataRows = rows
    .slice(1)
    .filter(r => r.some(c => c !== "" && c != null));
  if (!dataRows.length) {
    message("文件中没有数据行", { type: "warning" });
    uploadRef.value?.clearFiles();
    return;
  }
  // 限制 2：数据行数 ≤ 5000
  if (dataRows.length > 5000) {
    message("文件超过 5000 行，请拆分后分批导入", { type: "error" });
    uploadRef.value?.clearFiles();
    return;
  }

  fileName.value = file.name;
  parsedRows.value = dataRows.map((row, idx) => {
    const { errors, record } = validateRow(row);
    return { rowNo: idx + 2, cells: row.map(cellText), errors, record };
  });
  importErrors.value = []; // 换了新文件，上一批的服务端错误明细不再适用

  const errCount = parsedRows.value.filter(r => r.errors.length).length;
  if (errCount) {
    message(
      `解析完成：共 ${parsedRows.value.length} 行，${errCount} 行有错误（已标红）`,
      {
        type: "warning"
      }
    );
  } else {
    message(`解析完成：共 ${parsedRows.value.length} 行，全部通过`, {
      type: "success"
    });
  }
  uploadRef.value?.clearFiles();
}

/** 错误行标红 */
function rowClassName({ row }: { row: ParsedRow }) {
  return row.errors.length ? "import-error-row" : "";
}

/** 一键生成 90 天演示数据（admin），生成后 toast 提示 */
async function handleSeed() {
  seeding.value = true;
  try {
    const { code, data } = await seedHealthRecords();
    if (code === 0) {
      message(`已生成 ${data?.total ?? 90} 条演示数据，可到「健康总览」查看`, {
        type: "success"
      });
    } else {
      message("生成演示数据失败", { type: "error" });
    }
  } finally {
    seeding.value = false;
  }
}

// ---------- 批量入库 ----------
async function handleImport() {
  if (!validCount.value) {
    message("没有可导入的有效数据，请先上传或修正错误行", { type: "warning" });
    return;
  }
  importing.value = true;
  try {
    // 只提交校验通过的行；保留其 Excel 行号，用于把服务端错误行号换算回文件里的真实行号
    const submitted = parsedRows.value.filter(r => r.record);
    const { code, data } = await importHealthRecords({
      list: submitted.map(r => r.record!)
    });
    if (code === 0 && data) {
      // 服务端逐行校验若判定失败会整批不落库，此处把「第几行 + 原因」原样抛给用户
      importErrors.value = (data.errors ?? []).map(e => ({
        row: submitted[e.row - 1]?.rowNo ?? e.row,
        message: e.message
      }));
      // C2：来源固定为「批量导入」，服务端按共享区间现算质量标记，
      // 存疑 / 无效的条数如实回报（这些数据入库但会被标黄 / 不参与分析）
      const q = data.quality;
      const qualityTip = q
        ? `，存疑 ${q.suspect} 条，无效 ${q.invalid} 条`
        : "";
      const tip = `导入完成：成功 ${data.success} 条，失败 ${data.fail} 条${qualityTip}`;
      message(tip, {
        type:
          data.fail || (q && (q.suspect || q.invalid)) ? "warning" : "success"
      });
      // 清空预览，可继续上传下一批（错误明细留在上方提示里）
      parsedRows.value = [];
      fileName.value = "";
    } else {
      message("导入失败", { type: "error" });
    }
  } finally {
    importing.value = false;
  }
}
</script>

<template>
  <div>
    <el-card shadow="never">
      <template #header>
        <div class="flex-bc flex-wrap gap-3">
          <span class="font-medium">健康数据导入（管理员）</span>
          <div class="flex items-center gap-2">
            <el-button @click="downloadTemplate">下载模板</el-button>
            <el-button type="warning" :loading="seeding" @click="handleSeed">
              一键生成演示数据
            </el-button>
            <el-upload
              ref="uploadRef"
              :auto-upload="false"
              :show-file-list="false"
              :limit="1"
              accept=".xlsx,.xls"
              :on-change="handleFileChange"
            >
              <el-button type="primary">上传 Excel</el-button>
            </el-upload>
          </div>
        </div>
      </template>

      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="支持 .xlsx/.xls，文件 ≤2MB 且 ≤5000 行；先下载模板，填入数据后上传，错误行将标红且不会被导入"
        class="mb-3"
      />

      <!-- 服务端行级校验失败明细（整批未入库时给出具体行号与原因） -->
      <el-alert
        v-if="importErrors.length"
        type="warning"
        show-icon
        :closable="true"
        class="mb-3"
        @close="importErrors = []"
      >
        <template #title>
          本次导入未写入任何数据，以下
          {{ importErrors.length }} 行未通过服务端校验：
        </template>
        <ul class="import-error-list">
          <li v-for="err in importErrors" :key="`${err.row}-${err.message}`">
            第 {{ err.row }} 行：{{ err.message }}
          </li>
        </ul>
      </el-alert>

      <!-- 校验结果预览 -->
      <template v-if="parsedRows.length">
        <div class="flex items-center gap-4 mb-3 text-sm">
          <span>文件：{{ fileName }}</span>
          <span>总行数：{{ parsedRows.length }}</span>
          <span class="text-green-600">有效：{{ validCount }}</span>
          <span class="text-red-500">错误：{{ errorCount }}</span>
        </div>

        <el-table
          :data="parsedRows"
          border
          stripe
          :row-class-name="rowClassName"
          max-height="480"
        >
          <el-table-column prop="rowNo" label="行号" width="70" />
          <el-table-column label="日期" width="110">
            <template #default="{ row }">{{ row.cells[0] }}</template>
          </el-table-column>
          <el-table-column label="血压(mmHg)" width="120">
            <template #default="{ row }">
              {{ row.cells[1] || "-" }} / {{ row.cells[2] || "-" }}
            </template>
          </el-table-column>
          <el-table-column label="空腹血糖" width="100">
            <template #default="{ row }">{{ row.cells[3] || "-" }}</template>
          </el-table-column>
          <el-table-column label="总胆固醇" width="100">
            <template #default="{ row }">{{ row.cells[5] || "-" }}</template>
          </el-table-column>
          <el-table-column label="心率" width="90">
            <template #default="{ row }">{{ row.cells[9] || "-" }}</template>
          </el-table-column>
          <el-table-column label="体重(kg)" width="100">
            <template #default="{ row }">{{ row.cells[11] || "-" }}</template>
          </el-table-column>
          <el-table-column label="校验结果" min-width="220">
            <template #default="{ row }">
              <span v-if="!row.errors.length" class="text-green-600">通过</span>
              <span v-else class="text-red-500">
                {{ row.errors.join("；") }}
              </span>
            </template>
          </el-table-column>
        </el-table>

        <div class="mt-4">
          <el-button
            type="primary"
            :loading="importing"
            :disabled="!validCount"
            @click="handleImport"
          >
            导入 {{ validCount }} 条有效数据
          </el-button>
          <span class="text-xs text-gray-400 ml-3">
            错误行不会被导入，请修正后重新上传
          </span>
        </div>
      </template>

      <el-empty
        v-else
        description="请下载模板并上传数据文件"
        :image-size="80"
      />
    </el-card>
  </div>
</template>

<style scoped>
:deep(.import-error-row td) {
  color: var(--el-color-danger);
  background-color: var(--el-color-danger-light-9);
}

.import-error-list {
  padding-left: 18px;
  margin: 4px 0 0;
  line-height: 1.8;
  list-style: disc;
}
</style>
