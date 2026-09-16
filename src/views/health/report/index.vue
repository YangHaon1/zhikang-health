<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from "vue";
import { message } from "@/utils/message";
import { useDark } from "@pureadmin/utils";
import {
  generateHealthReport,
  getHealthReportHistory,
  getHealthReport,
  getHealthRecords
} from "@/api/health";
import type { HealthReport, ReportSummary } from "@/types/health";
import echarts from "@/plugins/echarts";
import { RadarChart } from "echarts/charts";
import { RadarComponent } from "echarts/components";
import { utils, writeFile } from "xlsx";

// 雷达图按需注册（全局插件已注册 Pie/Bar/Line，这里补 Radar）
echarts.use([RadarChart, RadarComponent]);

defineOptions({
  name: "HealthReport"
});

const genLoading = ref(false);
const report = ref<HealthReport | null>(null);
const history = ref<ReportSummary[]>([]);

const radarRef = ref<HTMLDivElement>();
const trendRef = ref<HTMLDivElement>();
let radarChart: ReturnType<typeof echarts.init> | null = null;
let trendChart: ReturnType<typeof echarts.init> | null = null;

const { isDark } = useDark();
const theme = computed(() => (isDark.value ? "dark" : undefined));

/** 本地日期 yyyy-MM-dd */
function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** 最近 n 天日期区间 */
function lastNDays(n: number): [string, string] {
  const end = new Date();
  const start = new Date(Date.now() - (n - 1) * 86400000);
  return [fmtDate(start), fmtDate(end)];
}

const dateRange = ref<[string, string] | null>(lastNDays(30));

function setRange(days: number | null) {
  dateRange.value = days ? lastNDays(days) : null;
}

function fmtTime(iso: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return `${fmtDate(d)} ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

/** 风险等级配色（低/中/高/极高） */
const LEVEL_COLOR: Record<string, string> = {
  低: "#16a34a",
  中: "#f59e0b",
  高: "#f97316",
  极高: "#dc2626"
};
function levelColor(level: string): string {
  return LEVEL_COLOR[level] ?? "#16a34a";
}

// ---------- 图表 ----------
function radarOption(r: HealthReport) {
  return {
    tooltip: { trigger: "item" },
    radar: {
      indicator: r.radar.map(p => ({ name: p.name, max: 100 })),
      radius: "65%"
    },
    series: [
      {
        type: "radar",
        data: [
          {
            value: r.radar.map(p => p.value),
            name: "风险指数",
            areaStyle: { opacity: 0.2 }
          }
        ]
      }
    ]
  };
}

function trendOption(r: HealthReport) {
  return {
    tooltip: { trigger: "axis" },
    legend: { data: ["收缩压", "舒张压", "空腹血糖"] },
    grid: { left: 48, right: 48, top: 44, bottom: 28 },
    xAxis: { type: "category", data: r.trend.map(t => t.date.slice(5)) },
    yAxis: [
      { type: "value", name: "mmHg", scale: true },
      { type: "value", name: "mmol/L", scale: true }
    ],
    series: [
      {
        name: "收缩压",
        type: "line",
        smooth: true,
        data: r.trend.map(t => t.systolic ?? null)
      },
      {
        name: "舒张压",
        type: "line",
        smooth: true,
        data: r.trend.map(t => t.diastolic ?? null)
      },
      {
        name: "空腹血糖",
        type: "line",
        smooth: true,
        yAxisIndex: 1,
        data: r.trend.map(t => t.fastingGlucose ?? null)
      }
    ]
  };
}

function renderCharts() {
  const r = report.value;
  if (!r) return;
  const t = theme.value;
  if (radarRef.value && r.radar.length >= 3) {
    radarChart?.dispose();
    radarChart = echarts.init(radarRef.value, t);
    radarChart.setOption(radarOption(r));
  }
  if (trendRef.value && r.trend.length >= 2) {
    trendChart?.dispose();
    trendChart = echarts.init(trendRef.value, t);
    trendChart.setOption(trendOption(r));
  }
}

function handleResize() {
  radarChart?.resize();
  trendChart?.resize();
}

// ---------- 数据 ----------
async function loadHistory() {
  const { code, data } = await getHealthReportHistory();
  if (code === 0) history.value = data ?? [];
}

async function handleGenerate() {
  genLoading.value = true;
  try {
    const [startDate, endDate] = dateRange.value ?? [];
    const { code, data } = await generateHealthReport({ startDate, endDate });
    if (code === 0 && data) {
      report.value = data;
      await nextTick();
      renderCharts();
      loadHistory();
      message("报告已生成", { type: "success" });
    } else {
      message("报告生成失败", { type: "error" });
    }
  } finally {
    genLoading.value = false;
  }
}

async function viewReport(summary: ReportSummary) {
  const { code, data } = await getHealthReport(summary.id);
  if (code === 0 && data) {
    report.value = data;
    await nextTick();
    renderCharts();
  } else {
    message("报告不存在", { type: "warning" });
  }
}

// ---------- 导出 ----------
/**
 * 打印报告：走浏览器 `window.print()`（打印样式只保留报告区），
 * 不是真正的 PDF 生成——按钮文案与之对齐，导出 PDF 由用户在打印对话框里选「另存为 PDF」。
 */
function handlePrintReport() {
  if (!report.value) {
    message("请先生成报告", { type: "warning" });
    return;
  }
  window.print();
}

async function handleExportExcel() {
  const [startDate, endDate] = dateRange.value ?? [];
  const { code, data } = await getHealthRecords({
    startDate,
    endDate,
    currentPage: 1,
    pageSize: 100000
  });
  if (code !== 0 || !data?.list?.length) {
    message("该时间段内暂无指标明细可导出", { type: "warning" });
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
  const rows = data.list.map(r => [
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
    `健康指标明细_${startDate ?? "全部"}${endDate ? `_${endDate}` : ""}.xlsx`
  );
  message("导出成功", { type: "success" });
}

onMounted(() => {
  window.addEventListener("resize", handleResize);
  loadHistory();
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", handleResize);
  radarChart?.dispose();
  trendChart?.dispose();
});
</script>

<template>
  <div>
    <!-- 查询工具栏（打印时隐藏） -->
    <el-card shadow="never" class="mb-4">
      <div class="flex items-center flex-wrap gap-3">
        <el-button-group>
          <el-button size="small" @click="setRange(7)">最近7天</el-button>
          <el-button size="small" @click="setRange(30)">最近30天</el-button>
          <el-button size="small" @click="setRange(90)">最近90天</el-button>
          <el-button size="small" @click="setRange(null)">全部</el-button>
        </el-button-group>
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          value-format="YYYY-MM-DD"
          range-separator="~"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          class="w-64!"
        />
        <el-button type="primary" :loading="genLoading" @click="handleGenerate">
          生成报告
        </el-button>
        <el-button
          :disabled="!report"
          title="打开打印对话框（可选「另存为 PDF」）"
          @click="handlePrintReport"
        >
          打印报告
        </el-button>
        <el-button @click="handleExportExcel">导出 Excel</el-button>
      </div>
    </el-card>

    <el-row :gutter="16">
      <el-col :xs="24" :md="18">
        <div v-if="report" class="print-area">
          <el-card shadow="never">
            <div class="text-center mb-6">
              <div class="text-xl font-bold">
                智康健康管理系统 · 健康风险评估报告
              </div>
              <div class="text-sm text-gray-500 mt-1">
                {{ report.period }} · 生成于 {{ fmtTime(report.generateTime) }}
              </div>
            </div>

            <!-- 评分卡 -->
            <div class="flex items-center gap-8 mb-6">
              <div class="text-center shrink-0">
                <div
                  class="text-6xl font-bold leading-none"
                  :style="{ color: levelColor(report.level) }"
                >
                  {{ report.score }}
                </div>
                <div class="text-sm text-gray-500 mt-1">综合评分</div>
              </div>
              <div>
                <div
                  class="text-2xl font-bold"
                  :style="{ color: levelColor(report.level) }"
                >
                  风险等级：{{ report.level }}
                </div>
                <div class="text-sm text-gray-500 mt-2">
                  {{ report.summary }}
                </div>
              </div>
            </div>

            <!-- 指标风险雷达图 -->
            <div v-if="report.radar.length >= 3" class="mb-6">
              <div class="font-medium mb-2">指标风险雷达图</div>
              <div ref="radarRef" class="w-full h-72" />
            </div>

            <!-- 近 N 次指标趋势 -->
            <div v-if="report.trend.length >= 2" class="mb-6">
              <div class="font-medium mb-2">
                近 {{ report.trend.length }} 次指标趋势
              </div>
              <div ref="trendRef" class="w-full h-72" />
            </div>

            <!-- 分项分析 -->
            <div class="mb-4">
              <div class="font-medium mb-2">分项分析</div>
              <ul v-if="report.itemAnalysis.length" class="space-y-1">
                <li v-for="(it, i) in report.itemAnalysis" :key="i">
                  {{ it }}
                </li>
              </ul>
              <div v-else class="text-gray-400">暂无指标记录</div>
            </div>

            <!-- 风险点 -->
            <div class="mb-4">
              <div class="font-medium mb-2">风险点</div>
              <ul v-if="report.risks.length" class="space-y-1">
                <li
                  v-for="(r, i) in report.risks"
                  :key="i"
                  class="text-red-500"
                >
                  {{ r }}
                </li>
              </ul>
              <div v-else class="text-gray-400">无</div>
            </div>

            <!-- 健康建议 -->
            <div class="mb-4">
              <div class="font-medium mb-2">健康建议</div>
              <ul v-if="report.suggestions.length" class="space-y-1">
                <li v-for="(s, i) in report.suggestions" :key="i">{{ s }}</li>
              </ul>
              <div v-else class="text-gray-400">无</div>
            </div>

            <!-- 就医提醒 -->
            <div
              v-if="report.medicalAdvice"
              class="p-3 rounded bg-red-50 text-red-600"
            >
              <div class="font-medium mb-1">就医提醒</div>
              <div>{{ report.medicalAdvice }}</div>
            </div>
          </el-card>
        </div>
        <el-empty v-else description="请选择时间段并生成报告" />
      </el-col>

      <el-col :xs="24" :md="6">
        <el-card shadow="never">
          <template #header>
            <div class="font-medium">报告历史</div>
          </template>
          <el-empty
            v-if="!history.length"
            description="暂无历史报告"
            :image-size="60"
          />
          <ul v-else>
            <li
              v-for="h in history"
              :key="h.id"
              class="py-2 border-b border-gray-100 cursor-pointer"
              @click="viewReport(h)"
            >
              <div class="flex-bc">
                <span class="text-sm truncate">{{ h.period }}</span>
                <span
                  class="text-sm font-medium"
                  :style="{ color: levelColor(h.level) }"
                >
                  {{ h.level }}
                </span>
              </div>
              <div class="text-xs text-gray-400 mt-1">
                {{ fmtTime(h.generateTime) }} · {{ h.score }} 分
              </div>
            </li>
          </ul>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<style>
/* 零依赖 PDF：window.print() 打印样式，只打印报告区 */
@media print {
  @page {
    size: a4;
    margin: 12mm;
  }

  html,
  body {
    height: auto;
    overflow: visible;
    background: #fff;
  }

  body * {
    visibility: hidden;
  }

  .print-area,
  .print-area * {
    visibility: visible;
  }

  .print-area {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;

    /* 保留风险等级色、就医提醒底色等背景色 */
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* 报告卡片不跨页断裂，章节标题不孤立在页尾 */
  .print-area .el-card {
    border: none;
    box-shadow: none;
    break-inside: avoid;
  }

  .print-area .font-medium {
    break-after: avoid;
  }
}
</style>
