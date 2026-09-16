<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from "vue";
import { useRouter } from "vue-router";
import { useDark } from "@pureadmin/utils";
import { message } from "@/utils/message";
import { useUserStoreHook } from "@/store/modules/user";
import {
  getHealthProfile,
  getHealthRecords,
  seedHealthRecords
} from "@/api/health";
import { analyzeHealth, worseGrade } from "@/utils/health-engine";
import type { HealthProfile, HealthRecord } from "@/types/health";
import echarts from "@/plugins/echarts";

defineOptions({
  name: "HealthDashboard"
});

const router = useRouter();
const loading = ref(false);
// 管理员可一键生成演示数据（roles 登录后固定，此处直接读一次即可）
const isAdmin = useUserStoreHook().roles.includes("admin");
const seeding = ref(false);
const profile = ref<HealthProfile | null>(null);
const records = ref<HealthRecord[]>([]);

const { isDark } = useDark();
const theme = computed(() => (isDark.value ? "dark" : undefined));

const trendRef = ref<HTMLDivElement>();
let trendChart: ReturnType<typeof echarts.init> | null = null;

/** 本地日期 yyyy-MM-dd */
function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** 最新一条记录（按日期倒序） */
const latest = computed<HealthRecord | null>(
  () => [...records.value].sort((a, b) => (a.date < b.date ? 1 : -1))[0] ?? null
);

/** 综合分析（规则引擎，前端本地计算） */
const analyze = computed(() => analyzeHealth(records.value, profile.value));

/** 是否已有任何数据 */
const hasData = computed(() => records.value.length > 0);

/** BMI（身高取档案，体重优先最新记录、其次档案） */
const bmi = computed(() => {
  const height = profile.value?.height;
  const weight = latest.value?.weight ?? profile.value?.weight;
  if (!height || !weight) return null;
  return Number((weight / Math.pow(height / 100, 2)).toFixed(1));
});

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

/** 分级 → el-tag type */
function gradeTagType(level: number): "success" | "warning" | "danger" {
  return level === 2 ? "danger" : level === 1 ? "warning" : "success";
}

/** 从分析结果里按 key 取分级文案 */
function gradeOf(key: string): { grade: string; level: number } {
  const it = analyze.value.items.find(i => i.key === key);
  return it ? { grade: it.grade, level: it.level } : { grade: "-", level: 0 };
}

/** 核心指标卡片 */
const cards = computed(() => {
  const systolic = analyze.value.items.find(i => i.key === "systolic");
  const diastolic = analyze.value.items.find(i => i.key === "diastolic");
  // 血压取较严重一侧分级（按 severity 比较，一级/二级/三级不再混同）
  const bp = worseGrade(systolic ?? null, diastolic ?? null);
  return [
    {
      label: "BMI",
      value: bmi.value ?? "-",
      grade: gradeOf("bmi").grade,
      level: gradeOf("bmi").level
    },
    {
      label: "血压 (mmHg)",
      value:
        latest.value?.systolic != null || latest.value?.diastolic != null
          ? `${latest.value?.systolic ?? "—"}/${latest.value?.diastolic ?? "—"}`
          : "-",
      grade: bp?.grade ?? "-",
      level: bp?.level ?? 0
    },
    {
      label: "空腹血糖 (mmol/L)",
      value: latest.value?.fastingGlucose ?? "-",
      grade: gradeOf("fastingGlucose").grade,
      level: gradeOf("fastingGlucose").level
    },
    {
      label: "综合风险评分",
      value: analyze.value.score,
      grade: analyze.value.level,
      level:
        analyze.value.level === "低" ? 0 : analyze.value.level === "中" ? 1 : 2
    }
  ];
});

/** 近 30 天关键指标趋势（升序） */
function last30Records(): HealthRecord[] {
  const start = fmtDate(new Date(Date.now() - 29 * 86400000));
  return [...records.value]
    .filter(r => r.date >= start)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

function trendOption(data: HealthRecord[]) {
  return {
    tooltip: { trigger: "axis" },
    legend: { data: ["收缩压", "舒张压", "空腹血糖"] },
    grid: { left: 48, right: 48, top: 44, bottom: 28 },
    xAxis: { type: "category", data: data.map(t => t.date.slice(5)) },
    yAxis: [
      { type: "value", name: "mmHg", scale: true },
      { type: "value", name: "mmol/L", scale: true }
    ],
    series: [
      {
        name: "收缩压",
        type: "line",
        smooth: true,
        data: data.map(t => t.systolic ?? null)
      },
      {
        name: "舒张压",
        type: "line",
        smooth: true,
        data: data.map(t => t.diastolic ?? null)
      },
      {
        name: "空腹血糖",
        type: "line",
        smooth: true,
        yAxisIndex: 1,
        data: data.map(t => t.fastingGlucose ?? null)
      }
    ]
  };
}

function renderTrend() {
  const data = last30Records();
  if (!trendRef.value || data.length < 2) return;
  trendChart?.dispose();
  trendChart = echarts.init(trendRef.value, theme.value);
  trendChart.setOption(trendOption(data));
}

function handleResize() {
  trendChart?.resize();
}

/** 一键生成演示数据（admin），生成后刷新页面数据 */
async function handleSeed() {
  seeding.value = true;
  try {
    const { code, data } = await seedHealthRecords();
    if (code === 0) {
      message(`已生成 ${data?.total ?? 90} 条演示数据`, { type: "success" });
      await loadData();
    } else {
      message("生成演示数据失败", { type: "error" });
    }
  } finally {
    seeding.value = false;
  }
}

async function loadData() {
  loading.value = true;
  try {
    const [p, r] = await Promise.all([
      getHealthProfile(),
      getHealthRecords({ currentPage: 1, pageSize: 100000 })
    ]);
    if (p.code === 0) profile.value = p.data ?? null;
    if (r.code === 0 && r.data) records.value = r.data.list ?? [];
    await nextTick();
    renderTrend();
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  window.addEventListener("resize", handleResize);
  loadData();
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", handleResize);
  trendChart?.dispose();
});
</script>

<template>
  <div v-loading="loading">
    <!-- 风险提示条（有数据时显示） -->
    <div
      v-if="hasData"
      class="rounded-lg p-4 mb-4 flex items-center gap-3"
      :style="{
        background: `${levelColor(analyze.level)}1a`,
        borderLeft: `4px solid ${levelColor(analyze.level)}`
      }"
    >
      <span
        class="text-2xl font-bold shrink-0"
        :style="{ color: levelColor(analyze.level) }"
      >
        {{ analyze.level }}
      </span>
      <div class="text-sm">
        <div class="font-medium">
          综合风险等级「{{ analyze.level }}」，评分 {{ analyze.score }} 分
        </div>
        <div v-if="analyze.risks.length" class="mt-1 text-gray-600">
          主要风险点：{{ analyze.risks.slice(0, 3).join("、") }}
        </div>
        <div v-if="analyze.medicalAdvice" class="mt-1 text-red-600">
          {{ analyze.medicalAdvice }}
        </div>
      </div>
    </div>

    <template v-if="hasData">
      <!-- 核心指标卡片 -->
      <el-row :gutter="16" class="mb-4">
        <el-col
          v-for="(c, i) in cards"
          :key="i"
          :xs="12"
          :md="6"
          class="mb-4 md:mb-0"
        >
          <el-card shadow="hover">
            <div class="text-sm text-gray-500">{{ c.label }}</div>
            <div class="flex items-end gap-2 mt-2">
              <span class="text-3xl font-bold leading-none">
                {{ c.value }}
              </span>
              <el-tag :type="gradeTagType(c.level)" size="small">
                {{ c.grade }}
              </el-tag>
            </div>
          </el-card>
        </el-col>
      </el-row>

      <!-- 近 30 天趋势 -->
      <el-card shadow="never">
        <template #header>
          <div class="font-medium">近 30 天关键指标趋势</div>
        </template>
        <div
          v-if="last30Records().length >= 2"
          ref="trendRef"
          class="w-full h-80"
        />
        <el-empty v-else description="近 30 天暂无足够记录" :image-size="80" />
      </el-card>
    </template>

    <!-- 无数据引导 -->
    <el-empty
      v-else
      description="暂无健康数据，请先录入或导入指标记录"
      :image-size="120"
    >
      <el-button
        v-if="isAdmin"
        type="warning"
        :loading="seeding"
        @click="handleSeed"
      >
        一键生成演示数据
      </el-button>
      <el-button type="primary" @click="router.push('/health/records/index')">
        去录入
      </el-button>
      <el-button @click="router.push('/health/profile')">完善档案</el-button>
    </el-empty>
  </div>
</template>
