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
import type {
  HealthReport,
  ReportSummary,
  RiskDeltaKind
} from "@/types/health";
import {
  BOUNDARY_TEXT,
  QUALITY_LABELS,
  RISK_DELTA_TEXT,
  SCORE_DIRECTION_HINT,
  SCORE_STABLE_THRESHOLD,
  SOURCE_LABELS,
  isAnalyzable,
  riskDeltaMark,
  scoreDirectionMark,
  scoreDirectionText
} from "@/types/health";
import echarts from "@/plugins/echarts";
import { RadarChart } from "echarts/charts";
import { RadarComponent } from "echarts/components";
import { utils, writeFile } from "xlsx";
import { fmtDate, lastNDays } from "@/utils/date";

// 雷达图按需注册（全局插件已注册 Pie/Bar/Line，这里补 Radar）
echarts.use([RadarChart, RadarComponent]);

defineOptions({
  name: "HealthReport"
});

const genLoading = ref(false);
const report = ref<HealthReport | null>(null);
const history = ref<ReportSummary[]>([]);

/** C0：固定边界文案（报告统一展示） */
const boundaryText = BOUNDARY_TEXT;

const radarRef = ref<HTMLDivElement>();
const trendRef = ref<HTMLDivElement>();
const timelineRef = ref<HTMLDivElement>();
let radarChart: ReturnType<typeof echarts.init> | null = null;
let trendChart: ReturnType<typeof echarts.init> | null = null;
let timelineChart: ReturnType<typeof echarts.init> | null = null;

const { isDark } = useDark();
const theme = computed(() => (isDark.value ? "dark" : undefined));

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

// ---------- C3：与上周期对比（展示口径） ----------

/** 评分变化徽标配色：好转绿 / 恶化红 / 持平灰（**颜色只是增强**，方向由文字与符号承载） */
const DELTA_TAG_TYPE: Record<string, "success" | "danger" | "info"> = {
  improved: "success",
  worsened: "danger",
  stable: "info"
};

/** 评分变化文案（带正负号） */
function deltaText(delta: number): string {
  return `${delta > 0 ? "+" : ""}${delta} 分`;
}

/** C6：图表明细表格里的数值渲染（未测的指标在表里显式画「—」，不留空单元格） */
function fmtNum(value: number | undefined | null): string {
  return value === null || value === undefined ? "—" : String(value);
}

/**
 * C6：风险点变化的配色（纯展示层）。文字从共享层 `RISK_DELTA_TEXT` 取，
 * 页面不再自留一份文案 —— 「新增 / 消失 / 持续」这三个词只在共享层定义一次。
 */
const RISK_KIND_CLASS: Record<RiskDeltaKind, string> = {
  new: "text-red-500",
  gone: "text-emerald-600",
  ongoing: "text-amber-600"
};

/** 计划完成率对比文案（任一侧无计划时说明原因） */
function planCompareText(c: NonNullable<HealthReport["comparison"]>): string {
  const { planRateCurrent: cur, planRatePrev: prev, planRateDelta: d } = c;
  if (cur === null || prev === null || d === null) return c.planConclusion;
  return `上周期 ${prev}% → 本周期 ${cur}%（${d > 0 ? "+" : ""}${d} 个百分点）`;
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

/**
 * C3：健康历程时间轴 —— 历次报告的评分演变。
 * 数据直接用报告历史列表（`getHealthReportHistory`），不额外请求接口；
 * 历史是倒序，这里反转成时间正序，等级放进 tooltip，与右侧列表口径一致。
 */
function timelineOption() {
  const list = [...history.value].reverse();
  return {
    tooltip: {
      trigger: "axis",
      formatter: (params: Array<{ dataIndex: number }>) => {
        const h = list[params[0]?.dataIndex ?? 0];
        if (!h) return "";
        return `${h.period}<br/>评分 ${h.score} 分 · ${h.level}<br/>${fmtTime(
          h.generateTime
        )}`;
      }
    },
    grid: { left: 44, right: 24, top: 24, bottom: 28 },
    xAxis: {
      type: "category",
      data: list.map(h => h.generateTime.slice(0, 10).slice(5))
    },
    yAxis: { type: "value", name: "评分", min: 0, max: 100 },
    series: [
      {
        name: "综合评分",
        type: "line",
        smooth: true,
        symbolSize: 8,
        areaStyle: { opacity: 0.15 },
        data: list.map(h => h.score)
      }
    ]
  };
}

function renderCharts() {
  const r = report.value;
  const t = theme.value;
  if (r) {
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
  // 时间轴只依赖报告历史，与当前选中哪份报告无关
  renderTimeline();
}

/** 渲染健康历程时间轴（元素或数据未就绪时跳过） */
function renderTimeline() {
  if (!timelineRef.value || history.value.length < 2) return;
  timelineChart?.dispose();
  timelineChart = echarts.init(timelineRef.value, theme.value);
  timelineChart.setOption(timelineOption());
}

function handleResize() {
  radarChart?.resize();
  trendChart?.resize();
  timelineChart?.resize();
}

// ---------- 数据 ----------
async function loadHistory() {
  const { code, data } = await getHealthReportHistory();
  if (code === 0) {
    history.value = data ?? [];
    // 时间轴元素只在已有报告时存在，等 DOM 就绪再画
    await nextTick();
    renderTimeline();
  }
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
  // C2：明细要与报告口径一致 —— 报告评分基于「剔除无效记录」后的数据，
  // 故明细同样剔除（用共享层唯一的 isAnalyzable），并补上来源 / 质量两列便于核对。
  const all = data?.list ?? [];
  const list = all.filter(isAnalyzable);
  const excluded = all.length - list.length;
  if (code !== 0 || !list.length) {
    message("该时间段内暂无指标明细可导出", { type: "warning" });
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
  const rows = list.map(r => [
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
    `健康指标明细_${startDate ?? "全部"}${endDate ? `_${endDate}` : ""}.xlsx`
  );
  message(
    excluded
      ? `导出成功（另有 ${excluded} 条无效记录已按报告口径剔除）`
      : "导出成功",
    { type: "success" }
  );
}

onMounted(() => {
  window.addEventListener("resize", handleResize);
  loadHistory();
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", handleResize);
  radarChart?.dispose();
  trendChart?.dispose();
  timelineChart?.dispose();
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
            <!-- 报告封面（渐变 hero） -->
            <div class="report-cover">
              <p class="cover-kicker">
                <iconify-icon icon="ri:sparkling-2-line" /> AI 健康报告
              </p>
              <div class="cover-period">{{ report.period }}</div>
              <div
                class="cover-score"
                :style="{ color: levelColor(report.level) }"
              >
                {{ report.score }}
              </div>
              <div class="cover-level">综合评分 · {{ report.level }}</div>
              <div class="cover-time">
                生成于 {{ fmtTime(report.generateTime) }}
              </div>
            </div>

            <!--
              报告内容清单：报告由后端一次性同步计算产出（规则引擎，非分步 AI 生成），
              因此这里只如实列出报告包含的内容模块，不模拟任何"生成进度/百分比"。
            -->
            <div class="ai-progress">
              <div class="ai-progress-item done">
                <span class="ai-check">✓</span>
                数据分析完成
              </div>
              <div class="ai-progress-item done">
                <span class="ai-check">✓</span>
                风险计算完成
              </div>
              <div class="ai-progress-item done">
                <span class="ai-check">✓</span>
                建议生成完成
              </div>
            </div>
            <p class="report-note">
              本报告由规则引擎基于你的健康记录实时计算生成，非分步 AI 生成过程。
            </p>

            <!-- 总体评价 -->
            <div class="block-label">总体评价</div>
            <div class="score-row flex items-center gap-8 mb-6">
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

            <!-- 指标风险雷达图（C6：图旁附表格明细，数值不只能从图形上读） -->
            <div v-if="report.radar.length >= 3" class="mb-6">
              <div class="font-medium mb-2">指标风险雷达图</div>
              <div
                ref="radarRef"
                class="w-full h-72"
                role="img"
                :aria-label="`指标风险雷达图，共 ${report.radar.length} 个指标维度，明细见下方表格`"
              />
              <el-table
                :data="report.radar"
                size="small"
                border
                class="chart-table"
              >
                <el-table-column prop="name" label="指标" min-width="120" />
                <el-table-column label="风险指数(0-100)" min-width="120">
                  <template #default="{ row }">
                    {{ row.value }} ·
                    {{
                      row.value >= 100
                        ? "异常"
                        : row.value >= 50
                          ? "警戒"
                          : "正常"
                    }}
                  </template>
                </el-table-column>
              </el-table>
            </div>

            <!-- 近 N 次指标趋势（C6：同上，附表格明细） -->
            <div v-if="report.trend.length >= 2" class="mb-6">
              <div class="font-medium mb-2">
                近 {{ report.trend.length }} 次指标趋势
              </div>
              <div
                ref="trendRef"
                class="w-full h-72"
                role="img"
                :aria-label="`近 ${report.trend.length} 次关键指标趋势折线图，明细见下方表格`"
              />
              <el-table
                :data="report.trend"
                size="small"
                border
                class="chart-table"
              >
                <el-table-column prop="date" label="日期" min-width="110" />
                <el-table-column label="收缩压(mmHg)" min-width="110">
                  <template #default="{ row }">{{
                    fmtNum(row.systolic)
                  }}</template>
                </el-table-column>
                <el-table-column label="舒张压(mmHg)" min-width="110">
                  <template #default="{ row }">
                    {{ fmtNum(row.diastolic) }}
                  </template>
                </el-table-column>
                <el-table-column label="空腹血糖(mmol/L)" min-width="130">
                  <template #default="{ row }">
                    {{ fmtNum(row.fastingGlucose) }}
                  </template>
                </el-table-column>
              </el-table>
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

            <!-- C1：本周期计划完成情况与下周期建议 -->
            <div
              v-if="report.planCompletion"
              class="p-3 mb-4 rounded bg-emerald-50 border border-emerald-100"
            >
              <div class="font-medium text-emerald-700">
                本周期计划完成率 {{ report.planCompletion.rate }}%
                <span class="text-xs font-normal text-gray-500">
                  {{ report.planCompletion.planTitle || "未关联计划" }} ·
                  连续打卡 {{ report.planCompletion.streakDays }} 天
                </span>
              </div>
              <el-progress
                class="mt-2"
                :percentage="report.planCompletion.rate"
                :stroke-width="10"
                :status="
                  report.planCompletion.rate >= 70
                    ? 'success'
                    : report.planCompletion.rate >= 40
                      ? ''
                      : 'exception'
                "
              />
              <div class="text-xs text-gray-600 mt-2">
                下周期建议：{{ report.planCompletion.advice }}
              </div>
            </div>

            <!-- C3：与上周期对比（效果评估） -->
            <div class="mb-4">
              <div class="font-medium mb-2">与上周期对比</div>

              <!-- 有上期报告：评分变化 + 风险点增减 + 计划完成率对比 -->
              <div
                v-if="report.comparison"
                class="p-3 rounded bg-gray-50 border border-gray-200"
              >
                <!-- C6：方向既有颜色也有文字（好转 / 恶化 / 持平）与符号，颜色不是唯一载体 -->
                <div class="flex items-center flex-wrap gap-3">
                  <el-tag
                    :type="
                      DELTA_TAG_TYPE[report.comparison.direction] ?? 'info'
                    "
                    effect="dark"
                  >
                    <span aria-hidden="true">{{
                      scoreDirectionMark(report.comparison.direction)
                    }}</span>
                    评分变化 {{ deltaText(report.comparison.scoreDelta) }} ·
                    {{ scoreDirectionText(report.comparison.direction) }}
                  </el-tag>
                  <span class="text-sm text-gray-600">
                    上周期 {{ report.comparison.prevScore }} 分 → 本期
                    {{ report.score }} 分
                  </span>
                  <span class="text-xs text-gray-400">
                    对比基准：{{ report.comparison.prevPeriod || "上周期报告" }}
                    <template v-if="report.comparison.prevGenerateTime">
                      · {{ fmtTime(report.comparison.prevGenerateTime) }}
                    </template>
                  </span>
                </div>

                <!-- 符号含义：与符号同屏，避免「▼ 却是好转」被误读 -->
                <div class="text-xs text-gray-400 mt-1">
                  {{ SCORE_DIRECTION_HINT }}
                </div>

                <div class="text-sm text-gray-700 mt-2">
                  {{ report.comparison.conclusion }}
                </div>

                <!-- 风险点变化：新增标红 / 消失标绿 / 持续标注「持续」
                     C6：每一项都同时给出符号与文字（▲新增 / ▼消失 / —持续），
                     灰度打印或色觉障碍下依然可读 -->
                <div class="mt-3">
                  <div class="text-sm text-gray-600 mb-1">
                    风险点变化：<span aria-hidden="true">▲</span>新增
                    <span class="text-red-500 font-medium">
                      {{ report.comparison.riskAdded }}
                    </span>
                    项 · <span aria-hidden="true">▼</span>消失
                    <span class="text-emerald-600 font-medium">
                      {{ report.comparison.riskGone }}
                    </span>
                    项 · <span aria-hidden="true">—</span>持续
                    <span class="text-amber-600 font-medium">
                      {{ report.comparison.riskOngoing }}
                    </span>
                    项
                  </div>
                  <ul
                    v-if="report.comparison.riskDeltas.length"
                    class="space-y-1"
                  >
                    <li
                      v-for="(d, i) in report.comparison.riskDeltas"
                      :key="i"
                      class="text-sm flex items-center gap-2"
                    >
                      <span
                        class="shrink-0 text-xs px-1 rounded border"
                        :class="RISK_KIND_CLASS[d.kind]"
                      >
                        <span aria-hidden="true">{{
                          riskDeltaMark(d.kind)
                        }}</span>
                        {{ RISK_DELTA_TEXT[d.kind] }}
                      </span>
                      <span :class="RISK_KIND_CLASS[d.kind]">{{ d.risk }}</span>
                    </li>
                  </ul>
                  <div v-else class="text-sm text-gray-400">
                    两个周期均无风险点
                  </div>
                </div>

                <!-- 计划完成率对比（取两份报告各自已存的 planCompletion.rate） -->
                <div class="text-sm text-gray-700 mt-3">
                  计划完成率：{{ planCompareText(report.comparison) }}
                </div>
              </div>

              <!-- 第一份报告：友好降级 -->
              <div
                v-else
                class="p-3 rounded bg-gray-50 border border-gray-200 text-sm text-gray-500"
              >
                暂无上周期报告，这是第一份报告，生成第二份即可看到评分、风险点与计划完成率的变化。
                <span class="text-xs text-gray-400">
                  （评分变化在 ±{{ SCORE_STABLE_THRESHOLD }} 分内视为持平）
                </span>
              </div>
            </div>

            <!-- C3：健康历程时间轴（历次报告评分演变，与右侧历史列表同一数据源）
                 C6：文本替代即右侧「报告历史」列表——同一数据源、逐条列出评分与时间 -->
            <div v-if="history.length >= 2" class="mb-4">
              <div class="font-medium mb-2">健康历程（报告评分演变）</div>
              <div
                ref="timelineRef"
                class="w-full h-56"
                role="img"
                :aria-label="`历次报告评分演变折线图，共 ${history.length} 份报告，明细见右侧「报告历史」列表`"
              />
            </div>

            <!-- C0：规则依据与数据来源（风险可解释） -->
            <div v-if="report.evidence?.length" class="mb-4">
              <el-collapse>
                <el-collapse-item title="规则依据与数据来源" name="evidence">
                  <ul class="space-y-3">
                    <li
                      v-for="(it, i) in report.evidence"
                      :key="i"
                      class="text-sm"
                    >
                      <div class="flex-bc">
                        <span class="font-medium">
                          {{ it.name }} {{ it.value }}
                        </span>
                        <span
                          class="text-xs font-medium"
                          :style="{
                            color:
                              it.level === 2
                                ? '#dc2626'
                                : it.level === 1
                                  ? '#d97706'
                                  : '#16a34a'
                          }"
                        >
                          {{ it.grade }}
                        </span>
                      </div>
                      <div class="text-xs text-gray-500 mt-1">
                        数据来源：{{ it.sourceDesc }}（{{ it.recordDate }}）
                      </div>
                      <div class="text-xs text-gray-500">
                        阈值说明：{{ it.rule.thresholdDesc }}
                      </div>
                      <div class="text-xs text-gray-500">
                        规则：{{ it.rule.ruleId }} v{{ it.rule.ruleVersion }} ·
                        适用{{ it.rule.applicableTo }}
                      </div>
                      <div class="text-xs text-gray-500">
                        依据：{{ it.rule.evidence }}
                      </div>
                      <div class="text-xs text-gray-500">
                        限制：{{ it.limit }}
                      </div>
                    </li>
                  </ul>
                </el-collapse-item>
              </el-collapse>
            </div>

            <!-- C0：固定边界文案 -->
            <div class="text-xs text-gray-400 text-center mt-4">
              {{ boundaryText }}
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

<style scoped>
/* C6：图表明细表格与报告页移动端适配。断点 768px，与共享层 MOBILE_BREAKPOINT 同值。
   与上面的打印样式分开写：打印规则是**全局**的（要能作用到 body / @page），
   这里改成 scoped，避免移动端规则外泄到其它页面。 */
.chart-table {
  margin-top: 10px;
}

/* 报告封面 */
.report-cover {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 36px 24px;
  margin-bottom: 24px;
  color: #fff;
  text-align: center;
  background:
    radial-gradient(
      circle at 85% 15%,
      rgb(255 255 255 / 22%),
      transparent 12rem
    ),
    linear-gradient(135deg, #075e45, #16a34a 60%, #6366f1);
  border-radius: 20px;
}

.cover-kicker {
  display: flex;
  gap: 6px;
  align-items: center;
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.1em;
  opacity: 0.9;
}

.cover-period {
  font-size: 15px;
  opacity: 0.92;
}

.cover-score {
  margin: 10px 0 4px;
  font-size: 64px;
  font-weight: 800;
  line-height: 1;
  color: #fff;
  letter-spacing: -0.03em;
}

.cover-level {
  font-size: 16px;
  font-weight: 700;
}

.cover-time {
  margin-top: 8px;
  font-size: 12px;
  opacity: 0.8;
}

.block-label {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 700;
  color: #16a34a;
  letter-spacing: 0.05em;
}

/* AI 生成过程状态 */
.ai-progress {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 20px;
  padding: 12px 16px;
  margin-bottom: 8px;
  background: #f5f6ff;
  border-radius: 12px;
}

.report-note {
  margin: 0 0 22px;
  font-size: 12px;
  line-height: 1.6;
  color: #9ca3af;
}

.ai-progress-item {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 13px;
  color: #9ca3af;

  .ai-check {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    font-size: 12px;
    font-weight: 700;
    color: #cbd5e1;
    background: #e5e7eb;
    border-radius: 50%;
  }

  &.done {
    color: #4f46e5;

    .ai-check {
      color: #fff;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
    }
  }
}

@media (width <= 768px) {
  /* 评分卡的 6xl 数字 + 32px 间距在 375px 宽下会把右侧文字挤成每行两三个字 */
  .score-row {
    flex-direction: column;
    gap: 12px;
    align-items: flex-start;
  }

  /* 图表容器保持 288px 高即可，但左右 y 轴名称在窄屏下会与刻度重叠 */
  .print-area :deep(.el-card__body) {
    padding: 14px;
  }
}
</style>
