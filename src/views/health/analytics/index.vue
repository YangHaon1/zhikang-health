<template>
  <div class="analytics-page">
    <!-- 页头：标题 + 操作 -->
    <el-card shadow="never" class="mb-4">
      <div class="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h3 class="text-base font-bold">群体健康看板</h3>
          <p class="text-sm text-gray-500 mt-1">
            仅展示脱敏聚合结果：不出现任何个体数据，任一分组样本小于
            {{ minSample }} 人一律隐藏
          </p>
        </div>
        <div class="flex items-center gap-2">
          <el-button :loading="loading" @click="load">刷新</el-button>
          <el-button
            type="primary"
            :loading="exporting === 'csv'"
            :disabled="!data"
            @click="handleExport('csv')"
          >
            导出 CSV
          </el-button>
          <el-button
            :loading="exporting === 'json'"
            :disabled="!data"
            @click="handleExport('json')"
          >
            导出 JSON
          </el-button>
        </div>
      </div>
    </el-card>

    <!-- P1-2：调研聚合卡 -->
    <el-card v-if="data?.survey" shadow="never" class="mb-4">
      <h4>大学生健康调研洞察</h4>
      <div class="survey-grid">
        <div>
          <span class="s-num">{{ data.survey.totalParticipants }}</span>
          <div class="s-lab">参与调研人数</div>
        </div>
        <div>
          <span class="s-num"
            >{{ data.survey.averageMetrics.sleepHours }}h</span
          >
          <div class="s-lab">平均睡眠</div>
        </div>
        <div>
          <span class="s-num">{{
            data.survey.averageMetrics.stressLevel
          }}</span>
          <div class="s-lab">平均压力</div>
        </div>
        <div>
          <span class="s-num"
            >{{ data.survey.averageMetrics.sedentaryHours }}h</span
          >
          <div class="s-lab">平均久坐</div>
        </div>
      </div>
      <div class="risk-dist" style="margin-top: 12px">
        <span>风险倾向：</span>
        <el-tag type="success" plain
          >低 {{ data.survey.riskDistribution.low }}</el-tag
        >
        <el-tag type="warning" plain
          >中 {{ data.survey.riskDistribution.medium }}</el-tag
        >
        <el-tag type="danger" plain
          >高 {{ data.survey.riskDistribution.high }}</el-tag
        >
      </div>
      <!-- clusterInfo 为空对象时不能渲染（旧写法 v-if="{}" 恒真，会显示版本 undefined） -->
      <p
        v-if="data.survey.clusterInfo?.version"
        style="margin-top: 10px; font-size: 12px; color: #9ca3af"
      >
        行为画像模型：KMeans（{{ data.survey.clusterInfo.version }}）· 数据模式
        {{ data.survey.clusterInfo.trainingMode }} · 真实样本
        {{ data.survey.clusterInfo.realSamples ?? 0 }} 条 · 轮廓系数
        {{ data.survey.clusterInfo.silhouette ?? "-" }}
      </p>
      <p v-else style="margin-top: 10px; font-size: 12px; color: #9ca3af">
        行为画像模型未加载（cluster-model/metadata.json 不可用）
      </p>
    </el-card>
    <!-- 加载 / 空态 -->
    <el-card v-if="loading && !data" shadow="never">
      <el-skeleton :rows="6" animated />
    </el-card>
    <el-empty
      v-else-if="!data"
      description="看板数据加载失败，请稍后重试或确认当前账号是否有权限"
    />

    <template v-else>
      <!-- 全站降级：用户太少，连总量明细都不展示 -->
      <el-alert
        v-if="data.degraded"
        type="warning"
        show-icon
        :closable="false"
        title="样本不足，看板已降级"
        :description="data.degradedReason"
        class="mb-4"
      />

      <!-- 总量指标卡 -->
      <el-row :gutter="16" class="mb-4">
        <el-col
          v-for="card in statCards"
          :key="card.label"
          :xs="12"
          :sm="8"
          :md="4"
          class="mb-4"
        >
          <el-card shadow="never" class="stat-card">
            <div class="text-sm text-gray-500">{{ card.label }}</div>
            <div class="stat-value" :class="card.masked ? 'masked' : ''">
              {{ card.value }}
            </div>
            <div class="text-xs text-gray-400 mt-1">{{ card.hint }}</div>
          </el-card>
        </el-col>
      </el-row>

      <!-- 图表：降级时整体隐藏 -->
      <el-row v-if="!data.degraded" :gutter="16">
        <el-col :xs="24" :md="12" class="mb-4">
          <el-card shadow="never">
            <div class="chart-title">评分分布</div>
            <div ref="scoreRef" class="chart-box" />
            <div class="chart-note">{{ maskedNote(scoreMasked) }}</div>
          </el-card>
        </el-col>
        <el-col :xs="24" :md="12" class="mb-4">
          <el-card shadow="never">
            <div class="chart-title">风险等级分布</div>
            <div ref="riskRef" class="chart-box" />
            <div class="chart-note">{{ maskedNote(riskMasked) }}</div>
          </el-card>
        </el-col>
      </el-row>

      <!-- 指标异常率：表格比图表更能逐格说明「已隐藏」 -->
      <el-card v-if="!data.degraded" shadow="never" class="mb-4">
        <div class="chart-title">指标异常率</div>
        <div ref="indicatorRef" class="chart-box chart-box-lg" />
        <div class="chart-note">{{ maskedNote(indicatorMasked) }}</div>

        <el-table :data="data.indicatorAbnormal" size="small" class="mt-3">
          <el-table-column prop="name" label="指标" min-width="120" />
          <el-table-column label="有效样本" min-width="100">
            <template #default="{ row }">
              {{ cell(row.sampleSize) }}
            </template>
          </el-table-column>
          <el-table-column label="异常人数" min-width="100">
            <template #default="{ row }">
              {{ cell(row.abnormalCount) }}
            </template>
          </el-table-column>
          <el-table-column label="异常率" min-width="100">
            <template #default="{ row }">
              {{ row.rate === null ? MASKED_TEXT : `${row.rate}%` }}
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <!-- 口径说明 -->
      <el-card shadow="never">
        <div class="text-sm/6 text-gray-500">
          <div>
            口径：每个用户的评分与风险等级均由服务端规则引擎（analyzeHealth）
            现算，与个人报告完全同源，可复算核对。
          </div>
          <div>
            隐私：任一分组（评分区间 / 风险等级 / 指标）样本小于
            {{ minSample }} 人时一律隐藏为「{{
              MASKED_TEXT
            }}」；全站有效用户不足
            {{ minSample }} 人时整体降级，只提示不展示分组数值。
          </div>
          <div>
            授权：仅统计已在「授权中心」开启「允许他人查看我的健康数据」的用户；
            关闭开关的用户不进入任何分组，人数单独列在「关闭共享被排除」卡片中。
          </div>
          <div>
            导出：CSV / JSON
            导出内容与页面同口径（同样脱敏），并写入审计日志留痕。
          </div>
        </div>
      </el-card>
    </template>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from "vue";
import { message } from "@/utils/message";
import { useDark } from "@pureadmin/utils";
import { exportHealthAnalytics, getHealthAnalytics } from "@/api/health";
import type { AnalyticsOverview } from "@/types/health";
import { ANALYTICS_MIN_SAMPLE, MASKED_TEXT } from "@/types/health";
import echarts from "@/plugins/echarts";

defineOptions({
  name: "HealthAnalytics"
});

/** 小样本阈值 / 隐藏文案均来自共享层唯一源码，前端不另行硬编码 */
const minSample = ANALYTICS_MIN_SAMPLE;

const loading = ref(false);
const exporting = ref<"" | "csv" | "json">("");
const data = ref<(AnalyticsOverview & { survey?: any }) | null>(null);

const scoreRef = ref<HTMLDivElement>();
const riskRef = ref<HTMLDivElement>();
const indicatorRef = ref<HTMLDivElement>();
let scoreChart: ReturnType<typeof echarts.init> | null = null;
let riskChart: ReturnType<typeof echarts.init> | null = null;
let indicatorChart: ReturnType<typeof echarts.init> | null = null;

const { isDark } = useDark();
const theme = computed(() => (isDark.value ? "dark" : undefined));

/** 风险等级配色（与个人报告页一致） */
const LEVEL_COLOR: Record<string, string> = {
  低: "#16a34a",
  中: "#f59e0b",
  高: "#f97316",
  极高: "#dc2626"
};

/** 数值单元格：null 一律显示隐藏文案，绝不兜底成 0 */
function cell(value: number | null): string {
  return value === null ? MASKED_TEXT : String(value);
}

/** 被隐藏的分组名（降级时全部隐藏，不再逐条罗列） */
const scoreMasked = computed(() =>
  (data.value?.scoreDistribution ?? []).filter(s => s.masked).map(s => s.label)
);
const riskMasked = computed(() =>
  (data.value?.riskDistribution ?? []).filter(s => s.masked).map(s => s.level)
);
const indicatorMasked = computed(() =>
  (data.value?.indicatorAbnormal ?? []).filter(s => s.masked).map(s => s.name)
);

/** 隐藏说明文案：无可隐藏项时不占位 */
function maskedNote(names: string[]): string {
  if (!names.length) return "";
  return `样本不足，已隐藏：${names.join("、")}`;
}

/** 总量指标卡（降级时各项明细为 null，卡片显示隐藏文案） */
const statCards = computed(() => {
  const t = data.value?.totals;
  const rate = t?.planParticipationRate ?? null;
  return [
    {
      label: "有效用户数",
      value: t ? String(t.userCount) : MASKED_TEXT,
      hint: "启用状态的账号总数",
      masked: !t
    },
    {
      label: "已授权共享",
      value: cell(t?.sharedCount ?? null),
      hint: "开启「允许他人查看我的健康数据」的用户",
      masked: (t?.sharedCount ?? null) === null
    },
    {
      label: "关闭共享被排除",
      value: cell(t?.excludedByPrivacy ?? null),
      hint: "这些用户的数据不参与任何统计",
      masked: (t?.excludedByPrivacy ?? null) === null
    },
    {
      label: "有记录用户数",
      value: cell(t?.withRecords ?? null),
      hint: "评分与等级分布的分母",
      masked: (t?.withRecords ?? null) === null
    },
    {
      label: "计划参与人数",
      value: cell(t?.planParticipants ?? null),
      hint: "有计划处于进行中 / 已完成",
      masked: (t?.planParticipants ?? null) === null
    },
    {
      label: "计划参与率",
      value: rate === null ? MASKED_TEXT : `${rate}%`,
      hint: "参与人数 / 已授权共享用户数",
      masked: rate === null
    }
  ];
});

// ---------- 图表 ----------

/** 评分分布：柱状图，被隐藏的区间留空（下方注释说明是哪些） */
function scoreOption(d: AnalyticsOverview) {
  return {
    tooltip: { trigger: "axis" },
    grid: { left: 44, right: 24, top: 24, bottom: 28 },
    xAxis: {
      type: "category",
      data: d.scoreDistribution.map(s => s.label)
    },
    yAxis: { type: "value", name: "人数", minInterval: 1 },
    series: [
      {
        name: "人数",
        type: "bar",
        barMaxWidth: 48,
        label: {
          show: true,
          position: "top",
          formatter: (p: { value: number | null }) =>
            p.value === null ? MASKED_TEXT : String(p.value)
        },
        data: d.scoreDistribution.map(s => s.count),
        itemStyle: {
          color: (p: { dataIndex: number }) => {
            const key = d.scoreDistribution[p.dataIndex]?.key;
            return key === "gte80"
              ? "#dc2626"
              : key === "b60to79"
                ? "#f97316"
                : key === "b30to59"
                  ? "#f59e0b"
                  : "#16a34a";
          }
        }
      }
    ]
  };
}

/** 风险等级分布：饼图，被隐藏的等级直接不入图（注释说明） */
function riskOption(d: AnalyticsOverview) {
  const shown = d.riskDistribution.filter(s => !s.masked);
  return {
    tooltip: { trigger: "item", formatter: "{b}：{c} 人（{d}%）" },
    legend: { bottom: 0 },
    series: [
      {
        type: "pie",
        radius: ["40%", "65%"],
        center: ["50%", "45%"],
        data: shown.map(s => ({
          name: s.level,
          value: s.count ?? 0,
          itemStyle: { color: LEVEL_COLOR[s.level] ?? "#16a34a" }
        }))
      }
    ]
  };
}

/** 指标异常率：横向条形图，被隐藏的指标留空 */
function indicatorOption(d: AnalyticsOverview) {
  const list = [...d.indicatorAbnormal].reverse();
  return {
    tooltip: {
      trigger: "axis",
      formatter: (params: Array<{ dataIndex: number }>) => {
        const s = list[params[0]?.dataIndex ?? 0];
        if (!s) return "";
        if (s.rate === null) return `${s.name}<br/>${MASKED_TEXT}`;
        return `${s.name}<br/>异常 ${s.abnormalCount} / 样本 ${s.sampleSize}<br/>异常率 ${s.rate}%`;
      }
    },
    grid: { left: 96, right: 48, top: 16, bottom: 24 },
    xAxis: { type: "value", name: "异常率%", max: 100 },
    yAxis: { type: "category", data: list.map(s => s.name) },
    series: [
      {
        name: "异常率",
        type: "bar",
        barMaxWidth: 20,
        label: {
          show: true,
          position: "right",
          formatter: (p: { value: number | null }) =>
            p.value === null ? MASKED_TEXT : `${p.value}%`
        },
        data: list.map(s => s.rate),
        itemStyle: { color: "#f97316" }
      }
    ]
  };
}

/** 渲染三个图表（元素或数据未就绪时跳过，降级时不渲染） */
function renderCharts() {
  const d = data.value;
  if (!d || d.degraded) return;
  const t = theme.value;

  if (scoreRef.value) {
    scoreChart?.dispose();
    scoreChart = echarts.init(scoreRef.value, t);
    scoreChart.setOption(scoreOption(d));
  }
  if (riskRef.value && d.riskDistribution.some(s => !s.masked)) {
    riskChart?.dispose();
    riskChart = echarts.init(riskRef.value, t);
    riskChart.setOption(riskOption(d));
  }
  if (indicatorRef.value) {
    indicatorChart?.dispose();
    indicatorChart = echarts.init(indicatorRef.value, t);
    indicatorChart.setOption(indicatorOption(d));
  }
}

function handleResize() {
  scoreChart?.resize();
  riskChart?.resize();
  indicatorChart?.resize();
}

/** 主题切换后重建图表（echarts 主题只能在 init 时指定） */
watch(theme, () => {
  renderCharts();
});

// ---------- 数据 ----------
async function load() {
  loading.value = true;
  try {
    const { code, data: overview } = await getHealthAnalytics();
    if (code === 0 && overview) {
      data.value = overview;
      await nextTick();
      renderCharts();
    } else {
      message("看板数据获取失败", { type: "error" });
    }
  } catch (error: any) {
    // 越权（403）与登录失效都会走到这里，服务端 message 优先
    message(error?.response?.data?.message ?? "看板数据获取失败", {
      type: "error"
    });
  } finally {
    loading.value = false;
  }
}

// ---------- 导出 ----------
/** 日期戳（与服务端文件名口径一致） */
function stamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/**
 * 导出看板：二进制流由服务端生成（导出即写审计日志），前端只负责落盘。
 * 导出内容与页面同为脱敏值，因此不额外提示「已脱敏」——页面顶部已经说明。
 */
async function handleExport(format: "csv" | "json") {
  exporting.value = format;
  try {
    const blob = await exportHealthAnalytics(format);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analytics-${stamp()}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
    message(`已导出 ${format.toUpperCase()}（本次导出已记录审计日志）`, {
      type: "success"
    });
  } catch (error: any) {
    message(error?.response?.data?.message ?? "导出失败", { type: "error" });
  } finally {
    exporting.value = "";
  }
}

onMounted(() => {
  window.addEventListener("resize", handleResize);
  load();
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", handleResize);
  scoreChart?.dispose();
  riskChart?.dispose();
  indicatorChart?.dispose();
});
</script>

<style scoped lang="scss">
.stat-card {
  .stat-value {
    font-size: 28px;
    font-weight: 700;
    line-height: 1.4;

    &.masked {
      font-size: 14px;
      font-weight: 400;
      color: var(--el-text-color-secondary);
    }
  }
}

.chart-title {
  margin-bottom: 8px;
  font-size: 15px;
  font-weight: 600;
}

.chart-box {
  width: 100%;
  height: 260px;
}

.chart-box-lg {
  height: 320px;
}

.chart-note {
  min-height: 20px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.survey-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-top: 12px;
}

.s-num {
  font-size: 26px;
  font-weight: 800;
  color: #0f766e;
}

.s-lab {
  margin-top: 4px;
  font-size: 12px;
  color: #6b7280;
}

@media (width <= 640px) {
  .survey-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
