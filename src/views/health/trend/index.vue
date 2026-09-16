<script setup lang="ts">
import {
  ref,
  computed,
  watch,
  onMounted,
  onBeforeUnmount,
  nextTick
} from "vue";
import { useDark } from "@pureadmin/utils";
import { getHealthRecords } from "@/api/health";
import type { HealthRecord } from "@/types/health";
import echarts from "@/plugins/echarts";

defineOptions({
  name: "HealthTrend"
});

const loading = ref(false);
const records = ref<HealthRecord[]>([]);

const { isDark } = useDark();
const theme = computed(() => (isDark.value ? "dark" : undefined));

const trendRef = ref<HTMLDivElement>();
let chart: ReturnType<typeof echarts.init> | null = null;

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

/** 指标分组（可切换，含正常参考区间） */
interface MetricGroup {
  key: string;
  label: string;
  unit: string;
  series: Array<{
    key: keyof HealthRecord;
    name: string;
    normal: [number, number];
  }>;
}

const GROUPS: MetricGroup[] = [
  {
    key: "bp",
    label: "血压",
    unit: "mmHg",
    series: [
      { key: "systolic", name: "收缩压", normal: [90, 120] },
      { key: "diastolic", name: "舒张压", normal: [60, 80] }
    ]
  },
  {
    key: "fastingGlucose",
    label: "空腹血糖",
    unit: "mmol/L",
    series: [{ key: "fastingGlucose", name: "空腹血糖", normal: [3.9, 6.1] }]
  },
  {
    key: "postprandialGlucose",
    label: "餐后血糖",
    unit: "mmol/L",
    series: [
      { key: "postprandialGlucose", name: "餐后血糖", normal: [3.9, 7.8] }
    ]
  },
  {
    key: "totalCholesterol",
    label: "总胆固醇",
    unit: "mmol/L",
    series: [{ key: "totalCholesterol", name: "总胆固醇", normal: [3.1, 5.2] }]
  },
  {
    key: "triglyceride",
    label: "甘油三酯",
    unit: "mmol/L",
    series: [{ key: "triglyceride", name: "甘油三酯", normal: [0.4, 1.7] }]
  },
  {
    key: "ldl",
    label: "LDL",
    unit: "mmol/L",
    series: [{ key: "ldl", name: "低密度脂蛋白", normal: [1.8, 3.4] }]
  },
  {
    key: "hdl",
    label: "HDL",
    unit: "mmol/L",
    series: [{ key: "hdl", name: "高密度脂蛋白", normal: [1.0, 1.6] }]
  },
  {
    key: "heartRate",
    label: "心率",
    unit: "次/分",
    series: [{ key: "heartRate", name: "心率", normal: [60, 100] }]
  },
  {
    key: "bloodOxygen",
    label: "血氧",
    unit: "%",
    series: [{ key: "bloodOxygen", name: "血氧", normal: [95, 100] }]
  }
];

const activeGroup = ref("bp");
const group = computed(
  () => GROUPS.find(g => g.key === activeGroup.value) ?? GROUPS[0]
);

/** 按时间范围过滤（升序） */
const filtered = computed<HealthRecord[]>(() => {
  let list = [...records.value].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (dateRange.value) {
    const [s, e] = dateRange.value;
    list = list.filter(r => r.date >= s && r.date <= e);
  }
  return list;
});

/** 当前分组是否至少有一个有效数据点 */
const hasPoints = computed(() =>
  filtered.value.some(r => group.value.series.some(s => r[s.key] != null))
);

function chartOption() {
  const g = group.value;
  const data = filtered.value;
  return {
    tooltip: { trigger: "axis" },
    legend: { data: g.series.map(s => s.name) },
    grid: { left: 60, right: 44, top: 44, bottom: 28 },
    xAxis: { type: "category", data: data.map(t => t.date.slice(5)) },
    yAxis: { type: "value", name: g.unit, scale: true },
    series: g.series.map(s => ({
      name: s.name,
      type: "line",
      smooth: true,
      connectNulls: true,
      data: data.map(t => t[s.key] ?? null),
      // 参考范围带：正常区间绿色阴影
      markArea: {
        silent: true,
        itemStyle: { color: "rgba(22, 163, 74, 0.08)" },
        label: { show: true, position: "insideTopLeft", color: "#16a34a" },
        data: [[{ name: "正常", yAxis: s.normal[0] }, { yAxis: s.normal[1] }]]
      }
    }))
  };
}

function renderChart() {
  if (!trendRef.value || !hasPoints.value) return;
  chart?.dispose();
  chart = echarts.init(trendRef.value, theme.value);
  chart.setOption(chartOption());
}

function handleResize() {
  chart?.resize();
}

async function loadData() {
  loading.value = true;
  try {
    const { code, data } = await getHealthRecords({
      currentPage: 1,
      pageSize: 100000
    });
    if (code === 0 && data) records.value = data.list ?? [];
    await nextTick();
    renderChart();
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  window.addEventListener("resize", handleResize);
  loadData();
});

// 切换指标 / 时间范围时，等 DOM 更新后重绘图表
watch([activeGroup, dateRange], async () => {
  await nextTick();
  renderChart();
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", handleResize);
  chart?.dispose();
});
</script>

<template>
  <div v-loading="loading">
    <el-card shadow="never">
      <template #header>
        <div class="flex-bc flex-wrap gap-3">
          <div>
            <div class="font-medium">指标趋势分析</div>
            <div class="text-xs text-gray-400 mt-1">
              绿色阴影为正常参考区间，可切换指标与时间范围
            </div>
          </div>
          <div class="flex items-center flex-wrap gap-2">
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
          </div>
        </div>
      </template>

      <!-- 指标切换 -->
      <div class="mb-4">
        <span class="text-sm text-gray-500 mr-2">指标：</span>
        <el-radio-group v-model="activeGroup">
          <el-radio-button
            v-for="g in GROUPS"
            :key="g.key"
            :value="g.key"
            size="small"
          >
            {{ g.label }}
          </el-radio-button>
        </el-radio-group>
      </div>

      <div v-if="hasPoints" ref="trendRef" class="w-full h-96" />
      <el-empty
        v-else
        description="该时间范围内暂无此指标的记录"
        :image-size="100"
      />
    </el-card>
  </div>
</template>
