<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from "vue";
import { useRouter } from "vue-router";
import { useDark } from "@pureadmin/utils";
import { message } from "@/utils/message";
import { useUserStoreHook } from "@/store/modules/user";
import {
  getDailyToday,
  getHealthProfile,
  getHealthRecords,
  getHealthPlansToday,
  getStudentProfile,
  getHealthRisk,
  seedHealthRecords
} from "@/api/health";
import type { StudentProfile, RiskPredictView } from "@/api/health";
import TodayScoreCard from "@/components/health/TodayScoreCard.vue";
import TodayStatusCard from "@/components/health/TodayStatusCard.vue";
import AIAdviceCard from "@/components/health/AIAdviceCard.vue";
import QuickDailyRecord from "@/components/health/QuickDailyRecord.vue";
import {
  analyzeHealth,
  worseGrade,
  buildEvidence,
  BOUNDARY_TEXT
} from "@shared/health-engine";
import type {
  DailyTodayView,
  HealthProfile,
  HealthRecord,
  RiskEvidence,
  TodayPlan
} from "@/types/health";
import { isAnalyzable } from "@/types/health";
import echarts from "@/plugins/echarts";

defineOptions({
  name: "HealthDashboard"
});

const router = useRouter();
const loading = ref(false);

/** 问候语（按时段） */
const greeting = computed(() => {
  const h = new Date().getHours();
  if (h < 6) return "夜深了";
  if (h < 11) return "早上好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
});

/** 当前用户昵称（来自登录用户信息，纯展示） */
const userName = computed(() => {
  const u = useUserStoreHook() as any;
  return u?.nickname || u?.username || "体验用户";
});

/** 今日日期展示 */
const todayText = computed(() => {
  const d = new Date();
  return `今天是 ${d.getMonth() + 1}月${d.getDate()}日`;
});

/** AI 健康体验演示路径（纯前端流程引导，全部跳已有页面） */
const demoSteps = [
  {
    title: "健康状态分析",
    to: "/health/dashboard",
    icon: "ri:heart-pulse-line"
  },
  { title: "AI 风险预测", to: "/health/risk", icon: "ri:radar-line" },
  {
    title: "健康画像生成",
    to: "/health/ai-profile",
    icon: "ri:sparkling-2-line"
  },
  { title: "AI 建议输出", to: "/health/chat", icon: "ri:chat-3-line" },
  { title: "健康报告查看", to: "/health/report", icon: "ri:file-chart-line" }
];

/** 快捷入口（纯展示跳转，全部指向已有页面） */
const quickLinks = [
  {
    icon: "ri:heart-pulse-line",
    title: "健康记录",
    desc: "录入今日指标",
    to: "/health/records/index",
    bg: "#e8f7ef",
    color: "#075e45"
  },
  {
    icon: "ri:sparkling-2-line",
    title: "AI 画像",
    desc: "查看健康分析",
    to: "/health/ai-profile",
    bg: "#eef2ff",
    color: "#4f46e5"
  },
  {
    icon: "ri:line-chart-line",
    title: "趋势分析",
    desc: "近 30 天变化",
    to: "/health/trend",
    bg: "#fff7ed",
    color: "#c2410c"
  },
  {
    icon: "ri:file-chart-line",
    title: "健康报告",
    desc: "阶段性总结",
    to: "/health/report",
    bg: "#ecfeff",
    color: "#0e7490"
  },
  {
    icon: "ri:survey-line",
    title: "健康调研",
    desc: "大学生生活方式调研",
    to: "/health/survey",
    bg: "#f5f3ff",
    color: "#6d28d9"
  }
];
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

/** C0：逐项风险解释（规则版本 / 阈值 / 数据来源 / 限制），与后端解释接口同源 */
const evidence = computed<RiskEvidence[]>(
  () => buildEvidence(records.value, profile.value, analyze.value).items
);

/** 风险解释中需展示的项：警戒及以上 */
const evidenceItems = computed(() =>
  evidence.value.filter(it => it.level >= 1)
);

/** 固定边界文案（C0：风险页统一展示） */
const boundaryText = BOUNDARY_TEXT;

/** 是否已有任何数据 */
const hasData = computed(() => records.value.length > 0);

/**
 * C2：被排除的无效记录数。
 * 本页的评分 / 风险解释都是前端直接跑规则引擎算的，因此必须在取数处就按共享层口径
 * 过滤掉 qualityFlag === 'invalid' 的记录，才能保证「总览评分 == 报告评分」。
 */
const excludedCount = ref(0);

/** M2：今日健康驾驶舱数据（指数/状态/AI建议），与原指标卡解耦 */
const dailyToday = ref<DailyTodayView | null>(null);
const recordDialogVisible = ref(false);
async function loadDaily() {
  try {
    const res = await getDailyToday();
    dailyToday.value = res.data ?? null;
  } catch {
    /* 驾驶舱加载失败不影响原指标/趋势 */
  }
}

/** V2.0：学生画像（作息/久坐等） */
const studentProfile = ref<StudentProfile | null>(null);
async function loadStudent() {
  try {
    const res = await getStudentProfile();
    studentProfile.value = res.data ?? null;
  } catch {
    studentProfile.value = null;
  }
}

/** V2.1：ML 风险预测 + 健康类型（失败静默，不阻塞首页） */
const riskView = ref<RiskPredictView | null>(null);
async function loadRisk() {
  try {
    const res = await getHealthRisk();
    if (res.code === 0) riskView.value = res.data;
  } catch {
    riskView.value = null;
  }
}
const riskLevelText = computed(() => {
  const l = riskView.value?.riskLevel;
  return l === "high"
    ? "高风险倾向"
    : l === "medium"
      ? "中风险倾向"
      : l === "low"
        ? "低风险倾向"
        : "";
});

/**
 * V2.0 五维健康画像（纯前端按已有今日数据规则估算，0-100）。
 * 不做疾病诊断，只反映近期生活习惯；无数据维度为 null（展示"暂未记录"）。
 */
const fiveDimensions = computed(() => {
  const t = dailyToday.value?.today as any;
  const score = (v: number, good: number, bad: number) =>
    Math.max(0, Math.min(100, Math.round(((v - bad) / (good - bad)) * 100)));

  // 睡眠健康：时长 7-9h 满分
  const sleep = t?.sleepHours != null ? score(t.sleepHours, 8, 4) : null;
  // 运动健康：每日 30min 满分
  const exercise =
    t?.exerciseMinutes != null ? score(t.exerciseMinutes, 60, 0) : null;
  // 压力状态：stressLevel 1小=好 3大=差
  const stress = t?.stressLevel
    ? t.stressLevel === 1
      ? 85
      : t.stressLevel === 2
        ? 60
        : 35
    : null;
  // 饮食规律
  const diet =
    t?.dietRegularity === "good"
      ? 88
      : t?.dietRegularity === "normal"
        ? 62
        : t?.dietRegularity === "poor"
          ? 35
          : null;
  // 作息规律：有学生就寝/起床时间记录即视为规律
  const routine =
    studentProfile.value?.bedtime && studentProfile.value?.wakeTime ? 75 : null;

  return [
    { key: "sleep", label: "睡眠健康", value: sleep, color: "#6366f1" },
    { key: "exercise", label: "运动健康", value: exercise, color: "#16a34a" },
    { key: "stress", label: "压力状态", value: stress, color: "#f59e0b" },
    { key: "diet", label: "饮食规律", value: diet, color: "#0ea5e9" },
    { key: "routine", label: "作息规律", value: routine, color: "#8b5cf6" }
  ];
});

/** V2.0 亚健康风险因素（生活习惯口径，非疾病诊断） */
const riskFactors = computed(() => {
  const t = dailyToday.value?.today as any;
  const list: string[] = [];
  if (t?.sleepHours != null && t.sleepHours < 6.5) list.push("睡眠不足");
  if (t?.stressLevel === 3) list.push("压力偏高");
  if (t?.exerciseMinutes != null && t.exerciseMinutes < 20)
    list.push("运动不足");
  if (t?.dietRegularity === "poor") list.push("饮食不规律");
  if (studentProfile.value && studentProfile.value.sedentaryHours >= 10)
    list.push("久坐时间过长");
  return list;
});

/** V2.0 亚健康状态总评 */
const subHealthLevel = computed(() => {
  if (!dailyToday.value?.today) return { text: "待记录", color: "#9ca3af" };
  const n = riskFactors.value.length;
  if (n >= 3) return { text: "亚健康风险偏高", color: "#dc2626" };
  if (n === 1 || n === 2) return { text: "轻度亚健康信号", color: "#f59e0b" };
  return { text: "状态良好", color: "#16a34a" };
});

/** 汇总文案（有无效记录时如实说明，不让条数悄悄变少） */
const summaryText = computed(() => {
  const base = `已汇总 ${records.value.length} 条健康记录，持续关注趋势变化。`;
  return excludedCount.value
    ? `${base}另有 ${excludedCount.value} 条无效记录不参与分析。`
    : base;
});

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

const todayPlans = ref<TodayPlan[]>([]);

/** C1：今日待完成与连续打卡（来自 /api/health/plans/today） */
async function loadTodayPlans() {
  try {
    const { code, data } = await getHealthPlansToday();
    if (code === 0) todayPlans.value = data ?? [];
  } catch {
    todayPlans.value = [];
  }
}

/** 今日未完成任务数 */
const pendingCount = computed(() =>
  todayPlans.value.reduce(
    (n, x) => n + x.tasks.filter(t => !t.checkedToday).length,
    0
  )
);

/** 连续打卡天数（多计划取最大） */
const streakDays = computed(() =>
  todayPlans.value.reduce((m, x) => Math.max(m, x.streakDays), 0)
);

async function loadData() {
  loading.value = true;
  try {
    const [p, r] = await Promise.all([
      getHealthProfile(),
      getHealthRecords({ currentPage: 1, pageSize: 100000 })
    ]);
    if (p.code === 0) profile.value = p.data ?? null;
    if (r.code === 0 && r.data) {
      // C2：过滤口径与后端 recordsForEngine 同源（共享层 isAnalyzable）
      const all = r.data.list ?? [];
      records.value = all.filter(isAnalyzable);
      excludedCount.value = all.length - records.value.length;
    }
    await nextTick();
    renderTrend();
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  window.addEventListener("resize", handleResize);
  loadData();
  loadTodayPlans();
  loadDaily();
  loadStudent();
  loadRisk();
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", handleResize);
  trendChart?.dispose();
});
</script>

<template>
  <div v-loading="loading" class="health-dashboard">
    <section class="dashboard-hero">
      <div>
        <p class="hero-kicker">智康健康管理</p>
        <h1>{{ greeting }}，{{ userName }}</h1>
        <p class="hero-date">{{ todayText }}</p>
        <p v-if="dailyToday?.index" class="hero-ai-line">
          <iconify-icon icon="ri:sparkling-2-line" />
          你的健康指数
          <b>{{ dailyToday.index.score }}</b> 分 ·
          {{ dailyToday.index.levelText }}
        </p>
        <p v-if="riskView" class="hero-ai-line">
          <iconify-icon icon="ri:radar-line" />
          {{ riskLevelText }}
          <template v-if="riskView.healthType">
            · 行为画像：{{ riskView.healthType.name }}</template
          >
        </p>
        <p v-else class="hero-description">
          {{
            hasData
              ? summaryText
              : "从完善档案和记录指标开始，建立属于你的健康档案。"
          }}
        </p>
      </div>
      <div class="hero-actions">
        <el-button
          type="primary"
          round
          @click="router.push('/health/showcase')"
        >
          产品展示
        </el-button>
        <el-button type="success" round @click="recordDialogVisible = true">
          + 今日记录
        </el-button>
        <el-button
          type="primary"
          round
          @click="router.push('/health/records/index')"
        >
          录入指标
        </el-button>
        <el-button round @click="router.push('/health/profile')">
          健康档案
        </el-button>
      </div>
    </section>

    <!-- AI 健康体验演示路径（纯前端故事线导航） -->
    <section class="demo-path">
      <div class="demo-head">
        <iconify-icon icon="ri:flashlight-line" />
        <span>开始 AI 健康体验</span>
      </div>
      <div class="demo-steps">
        <template v-for="(s, i) in demoSteps" :key="s.to">
          <div class="demo-step" @click="router.push(s.to)">
            <iconify-icon :icon="s.icon" width="18" />
            <span>{{ s.title }}</span>
          </div>
          <div v-if="i < demoSteps.length - 1" class="demo-line" />
        </template>
      </div>
    </section>

    <!-- M2：AI 健康驾驶舱（今日评分 / 状态 / AI建议，数据全部来自 /daily/today） -->
    <section class="cockpit-grid">
      <TodayScoreCard :index="dailyToday?.index ?? null" />
      <TodayStatusCard :today="dailyToday?.today ?? null" />
      <AIAdviceCard :advice="dailyToday?.advice ?? []" />
    </section>

    <!-- V2.0：学生亚健康驾驶舱（五维画像 + 风险因素，数据来自 /daily/today 与 student-profile） -->
    <section class="subhealth-grid">
      <el-card shadow="never" class="subhealth-card">
        <template #header>
          <div class="card-heading">
            <div>
              <p>STUDENT HEALTH</p>
              <h2>学生健康状态</h2>
            </div>
            <el-tag
              :color="subHealthLevel.color"
              style="color: #fff; border: none"
            >
              {{ subHealthLevel.text }}
            </el-tag>
          </div>
        </template>
        <div class="dim-list">
          <div v-for="d in fiveDimensions" :key="d.key" class="dim-row">
            <span class="dim-label">{{ d.label }}</span>
            <div class="dim-bar">
              <div
                class="dim-fill"
                :style="
                  d.value != null
                    ? { width: d.value + '%', background: d.color }
                    : { width: '100%', background: '#e5e7eb' }
                "
              />
            </div>
            <span class="dim-value">{{ d.value != null ? d.value : "—" }}</span>
          </div>
        </div>
      </el-card>

      <el-card shadow="never" class="subhealth-card">
        <template #header>
          <div class="card-heading">
            <div>
              <p>RISK FACTORS</p>
              <h2>亚健康风险因素</h2>
            </div>
            <span>生活习惯口径，非疾病诊断</span>
          </div>
        </template>
        <template v-if="riskFactors.length">
          <div class="risk-tags">
            <el-tag
              v-for="r in riskFactors"
              :key="r"
              type="warning"
              effect="plain"
              size="large"
              class="risk-tag"
            >
              ⚠ {{ r }}
            </el-tag>
          </div>
          <div class="factor-more" @click="router.push('/health/risk')">
            查看 AI 风险预测与原因解释 →
          </div>
        </template>
        <el-empty
          v-else
          description="暂未发现明显亚健康风险因素"
          :image-size="60"
        />
        <div class="coach-entry" @click="router.push('/health/chat')">
          <iconify-icon icon="ri:customer-service-2-line" width="22" />
          <div>
            <p class="coach-title">AI 健康教练</p>
            <p class="coach-desc">根据你的健康数据，给出个性化改善建议 →</p>
          </div>
        </div>
      </el-card>
    </section>
    <QuickDailyRecord
      v-model:visible="recordDialogVisible"
      :today="dailyToday?.today ?? null"
      @saved="loadDaily"
    />

    <!-- 快捷入口：比赛演示导航（全部跳转已有页面） -->
    <section class="quick-nav">
      <div
        v-for="q in quickLinks"
        :key="q.to"
        class="quick-item"
        @click="router.push(q.to)"
      >
        <div class="quick-icon" :style="{ background: q.bg, color: q.color }">
          <iconify-icon :icon="q.icon" width="22" />
        </div>
        <div class="quick-text">
          <p class="quick-title">{{ q.title }}</p>
          <p class="quick-desc">{{ q.desc }}</p>
        </div>
      </div>
    </section>

    <!-- 风险提示条（有数据时显示） -->
    <div
      v-if="hasData"
      class="risk-banner"
      :style="{
        background: `${levelColor(analyze.level)}1a`,
        borderLeft: `4px solid ${levelColor(analyze.level)}`
      }"
    >
      <span class="risk-level" :style="{ color: levelColor(analyze.level) }">
        {{ analyze.level }}
      </span>
      <div class="risk-copy">
        <div class="risk-title">
          综合风险等级「{{ analyze.level }}」，评分 {{ analyze.score }} 分
        </div>
        <div v-if="analyze.risks.length" class="risk-detail">
          主要风险点：{{ analyze.risks.slice(0, 3).join("、") }}
        </div>
        <div v-if="analyze.medicalAdvice" class="risk-advice">
          {{ analyze.medicalAdvice }}
        </div>
      </div>
    </div>

    <!-- C0：固定边界文案 + 规则依据（风险可解释） -->
    <div v-if="hasData" class="risk-extra">
      <div class="risk-boundary">{{ boundaryText }}</div>
      <el-collapse v-if="evidenceItems.length" class="evidence-collapse">
        <el-collapse-item title="查看规则依据与数据来源" name="evidence">
          <ul class="evidence-list">
            <li v-for="it in evidenceItems" :key="it.key">
              <div class="evidence-head">
                <span class="evidence-name">{{ it.name }} {{ it.value }}</span>
                <el-tag :type="gradeTagType(it.level)" size="small">
                  {{ it.grade }}
                </el-tag>
              </div>
              <div class="evidence-line">
                数据来源：{{ it.sourceDesc }}（{{ it.recordDate }}）
              </div>
              <div class="evidence-line">
                阈值说明：{{ it.rule.thresholdDesc }}
              </div>
              <div class="evidence-line">
                规则：{{ it.rule.ruleId }} v{{ it.rule.ruleVersion }} · 适用{{
                  it.rule.applicableTo
                }}
              </div>
              <div class="evidence-line">依据：{{ it.rule.evidence }}</div>
              <div class="evidence-line">限制：{{ it.limit }}</div>
            </li>
          </ul>
        </el-collapse-item>
      </el-collapse>
    </div>

    <!-- C1：今日待完成 + 连续打卡 -->
    <section v-if="todayPlans.length" class="today-card">
      <div class="today-head">
        <span class="today-title">
          今日待完成
          <b class="today-count">{{ pendingCount }}</b>
          项
        </span>
        <span class="today-streak">🔥 连续打卡 {{ streakDays }} 天</span>
        <el-button
          size="small"
          text
          type="primary"
          @click="router.push('/health/plans')"
        >
          去打卡 →
        </el-button>
      </div>
      <div v-for="tp in todayPlans" :key="tp.plan.id" class="today-plan">
        <div class="today-plan-title">{{ tp.plan.title }}</div>
        <div class="today-tags">
          <el-tag
            v-for="t in tp.tasks.filter(x => !x.checkedToday)"
            :key="t.id"
            size="small"
            type="warning"
          >
            {{ t.title }}
          </el-tag>
          <span v-if="tp.tasks.every(x => x.checkedToday)" class="today-done">
            今日任务已全部完成 🎉
          </span>
        </div>
      </div>
    </section>

    <template v-if="hasData">
      <!-- 核心指标卡片 -->
      <el-row :gutter="16" class="metric-grid">
        <el-col
          v-for="(c, i) in cards"
          :key="i"
          :xs="12"
          :md="6"
          class="metric-column"
        >
          <el-card shadow="never" class="metric-card">
            <div class="metric-label">{{ c.label }}</div>
            <div class="metric-value-row">
              <span class="metric-value">
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
      <el-card shadow="never" class="trend-card">
        <template #header>
          <div class="card-heading">
            <div>
              <p>健康趋势</p>
              <h2>近 30 天关键指标趋势</h2>
            </div>
            <span>数据按记录日期更新</span>
          </div>
        </template>
        <div
          v-if="last30Records().length >= 2"
          ref="trendRef"
          class="w-full trend-chart"
          role="img"
          :aria-label="`近 30 天关键指标趋势折线图，共 ${last30Records().length} 次记录；各项分级与依据见上方核心指标卡片与「查看规则依据与数据来源」`"
        />
        <el-empty v-else description="近 30 天暂无足够记录" :image-size="80" />
      </el-card>
    </template>

    <!-- 无数据引导 -->
    <el-empty
      v-else
      class="dashboard-empty"
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

<style lang="scss" scoped>
.health-dashboard {
  max-width: 1440px;
  margin: 0 auto;
  animation: page-in 0.4s ease;
}

@keyframes page-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* AI 健康体验演示路径 */
.demo-path {
  padding: 16px 20px;
  margin-bottom: 20px;
  background: #fff;
  border: 1px solid #e6f0ea;
  border-radius: 16px;
}

.demo-head {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 12px;
  font-size: 13px;
  font-weight: 700;
  color: #4f46e5;
}

.demo-steps {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.demo-step {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 600;
  color: #17382c;
  cursor: pointer;
  background: #f4f6ff;
  border-radius: 999px;
  transition: all 0.15s ease;

  &:hover {
    color: #fff;
    background: #6366f1;
  }
}

.demo-line {
  width: 18px;
  height: 2px;
  background: #d8defc;
}

@media (width <= 768px) {
  .demo-steps {
    gap: 6px;
  }

  .demo-line {
    display: none;
  }
}

/* M2：驾驶舱三卡网格——窄屏自动堆叠 */
.cockpit-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 20px;
}

@media (width <= 960px) {
  .cockpit-grid {
    grid-template-columns: 1fr;
  }
}

/* V2.0：学生亚健康两栏 */
.subhealth-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 20px;
}

@media (width <= 960px) {
  .subhealth-grid {
    grid-template-columns: 1fr;
  }
}

.subhealth-card {
  border: 1px solid #e6f0ea;
  border-radius: 16px;
}

.dim-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.dim-row {
  display: grid;
  grid-template-columns: 72px 1fr 36px;
  gap: 12px;
  align-items: center;
}

.dim-label {
  font-size: 13px;
  color: #4b5563;
}

.dim-bar {
  height: 8px;
  overflow: hidden;
  background: #f0f4f1;
  border-radius: 999px;
}

.dim-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.6s ease;
}

.dim-value {
  font-size: 14px;
  font-weight: 700;
  color: #17382c;
  text-align: right;
}

.risk-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.risk-tag {
  padding: 8px 14px;
}

.factor-more {
  margin-top: 14px;
  font-size: 13px;
  font-weight: 600;
  color: #4f46e5;
  cursor: pointer;
}

.coach-entry {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 14px 16px;
  margin-top: 18px;
  color: #4f46e5;
  cursor: pointer;
  background: linear-gradient(120deg, #eef2ff, #f5f3ff);
  border-radius: 12px;
  transition: transform 0.18s ease;

  &:hover {
    transform: translateY(-2px);
  }
}

.coach-title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
}

.coach-desc {
  margin: 2px 0 0;
  font-size: 12px;
  color: #6366f1;
}

/* 快捷入口四宫格 */
.quick-nav {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  margin-bottom: 20px;
}

.quick-item {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 16px;
  cursor: pointer;
  background: #fff;
  border: 1px solid #e6f0ea;
  border-radius: 16px;
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease;

  &:hover {
    box-shadow: 0 12px 26px rgb(7 94 69 / 12%);
    transform: translateY(-3px);
  }
}

.quick-icon {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
}

.quick-title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: #17382c;
}

.quick-desc {
  margin: 2px 0 0;
  font-size: 12px;
  color: #8aa094;
}

@media (width <= 960px) {
  .quick-nav {
    grid-template-columns: repeat(2, 1fr);
  }
}

.dashboard-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 172px;
  padding: 28px 32px;
  margin-bottom: 20px;
  overflow: hidden;
  color: #fff;
  background:
    radial-gradient(
      circle at 88% 20%,
      rgb(255 255 255 / 22%),
      transparent 21rem
    ),
    linear-gradient(125deg, #075e45, #16a34a 58%, #55b77b);
  border-radius: 20px;
  box-shadow: 0 16px 32px rgb(22 163 74 / 18%);
}

.hero-kicker {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.12em;
  opacity: 0.78;
}

.dashboard-hero h1 {
  margin: 0;
  font-size: clamp(24px, 3vw, 32px);
  line-height: 1.25;
}

.hero-description {
  margin: 12px 0 0;
  font-size: 14px;
  opacity: 0.9;
}

.hero-date {
  margin: 6px 0 0;
  font-size: 13px;
  opacity: 0.82;
}

.hero-ai-line {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 6px 14px;
  margin: 10px 0 0;
  font-size: 13px;
  background: rgb(255 255 255 / 18%);
  border-radius: 999px;
  opacity: 0.96;

  b {
    font-size: 18px;
    font-weight: 800;
  }
}

.hero-actions {
  display: flex;
  flex: none;
  gap: 10px;
  margin-left: 24px;

  :deep(.el-button) {
    min-width: 96px;
  }

  :deep(.el-button--default) {
    color: #075e45;
    border-color: #fff;
  }
}

.risk-banner {
  display: flex;
  gap: 16px;
  align-items: center;
  padding: 16px 20px;
  margin-bottom: 20px;
  border-radius: 14px;
}

.risk-level {
  flex: none;
  font-size: 28px;
  font-weight: 800;
  line-height: 1;
}

.risk-title {
  font-size: 15px;
  font-weight: 700;
}

.risk-detail,
.risk-advice {
  margin-top: 5px;
  font-size: 13px;
}

.risk-detail {
  color: var(--el-text-color-regular);
}

.risk-advice {
  color: #dc2626;
}

/* C0：边界文案与规则依据 */
.risk-extra {
  margin-bottom: 20px;
}

.risk-boundary {
  padding: 10px 16px;
  font-size: 12px;
  line-height: 1.6;
  color: #6b7f74;
  background: #f0f7f3;
  border: 1px dashed #b9d8c5;
  border-radius: 10px;
}

.evidence-collapse {
  margin-top: 8px;
  overflow: hidden;
  border: 1px solid #e6f0ea;
  border-radius: 10px;

  :deep(.el-collapse-item__header) {
    padding: 0 16px;
    font-size: 13px;
    font-weight: 600;
    color: #075e45;
    background: #fafdfb;
  }

  :deep(.el-collapse-item__content) {
    padding: 4px 16px 12px;
  }
}

.evidence-list {
  padding: 0;
  margin: 0;
  list-style: none;

  li {
    padding: 10px 0;
    border-bottom: 1px dashed #eef4f0;

    &:last-child {
      border-bottom: none;
    }
  }
}

.evidence-head {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 4px;
}

.evidence-name {
  font-size: 13px;
  font-weight: 700;
  color: #17382c;
}

.evidence-line {
  margin-top: 3px;
  font-size: 12px;
  line-height: 1.6;
  color: #6b7f74;
}

.metric-grid {
  margin-bottom: 4px;
}

.metric-column {
  margin-bottom: 16px;
}

.metric-card,
.trend-card {
  height: 100%;
  border: 1px solid #e6f0ea;
  border-radius: 16px;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;

  &:hover {
    box-shadow: 0 14px 28px rgb(15 94 69 / 10%);
    transform: translateY(-3px);
  }
}

.metric-label {
  font-size: 13px;
  font-weight: 600;
  color: #6b7f74;
}

.metric-value-row {
  display: flex;
  gap: 10px;
  align-items: flex-end;
  margin-top: 14px;
}

.metric-value {
  font-size: 30px;
  font-weight: 750;
  line-height: 1;
  color: #17382c;
  letter-spacing: -0.04em;
}

.card-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;

  p {
    margin: 0 0 4px;
    font-size: 12px;
    font-weight: 700;
    color: #16a34a;
    letter-spacing: 0.08em;
  }

  h2 {
    margin: 0;
    font-size: 17px;
    color: #17382c;
  }

  > span {
    font-size: 12px;
    color: #8aa094;
  }
}

.dashboard-empty {
  padding: 42px 20px;
  background: #fff;
  border: 1px dashed #b9d8c5;
  border-radius: 16px;
}

/* 趋势图容器：显式高度（原来靠 `h-80` 工具类，C6 改成自有类名，才能在媒体查询里改高） */
.trend-chart {
  height: 288px;
}

/* C6 移动端适配：断点与共享层 MOBILE_BREAKPOINT 对齐（原为 720px，统一到 768px） */
@media (width <= 768px) {
  .dashboard-hero {
    display: block;
    min-height: auto;
    padding: 22px 20px;
    border-radius: 16px;
  }

  .hero-actions {
    margin: 20px 0 0;
  }

  .hero-actions :deep(.el-button) {
    flex: 1;
    min-height: 40px;
  }

  .card-heading > span {
    display: none;
  }

  /* 风险条：等级大字与说明文字并排时，说明会被压成每行两三个字 */
  .risk-banner {
    flex-direction: column;
    gap: 8px;
    align-items: flex-start;
    padding: 14px 16px;
  }

  .risk-level {
    font-size: 22px;
  }

  /* 指标卡的 30px 数值在 375px 两列布局里会顶到卡片边缘 */
  .metric-value {
    font-size: 24px;
  }

  .metric-value-row {
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    margin-top: 10px;
  }

  .today-head {
    flex-wrap: wrap;
    gap: 8px 12px;
  }

  /* 规则依据的长句在窄屏下换行更密，行高稍微放开 */
  .evidence-line {
    line-height: 1.7;
  }

  /* 图表改矮一点：窄屏下 288px 高的图会占掉半屏，反而看不到下面的内容 */
  .trend-chart {
    height: 240px;
  }
}

.today-card {
  padding: 14px 18px;
  margin-bottom: 20px;
  background: linear-gradient(135deg, #f0faf5, #f6fdf9);
  border: 1px solid #d8efe3;
  border-radius: 12px;
}

.today-head {
  display: flex;
  gap: 16px;
  align-items: center;
}

.today-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.today-count {
  margin: 0 2px;
  font-size: 18px;
  color: #d97706;
}

.today-streak {
  font-size: 13px;
  font-weight: 600;
  color: #075e45;
}

.today-plan {
  margin-top: 10px;
}

.today-plan-title {
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 600;
  color: #17382c;
}

.today-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.today-done {
  font-size: 13px;
  color: #16a34a;
}
</style>
