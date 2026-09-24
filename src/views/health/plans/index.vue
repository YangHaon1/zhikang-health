<template>
  <div class="plans-page">
    <!-- 页头：标题 + 操作 -->
    <el-card shadow="never" class="plans-header">
      <div class="header-row">
        <div class="header-copy">
          <h3 class="header-title">健康行动计划</h3>
          <p class="header-sub">
            基于风险自动生成 / 手动创建，每日打卡形成「识别 → 干预 → 打卡 →
            复评」闭环
          </p>
        </div>
        <div class="header-actions">
          <el-button
            type="primary"
            :loading="genLoading"
            @click="generateFromRisk"
          >
            从当前风险生成
          </el-button>
          <el-button @click="openCreateDialog">手动创建</el-button>
        </div>
      </div>
    </el-card>

    <!-- P2-2 P2：AI 复评报告 -->
    <el-card shadow="never" class="review-card" style="margin-bottom: 16px">
      <div class="header-row">
        <div>
          <h4 style="margin: 0 0 4px">AI 复评报告</h4>
          <p style="margin: 0; font-size: 12px; color: #9ca3af">
            根据计划完成情况与近期数据生成
          </p>
        </div>
        <el-select
          v-model="reviewPlanId"
          placeholder="选择计划"
          style="width: 180px; margin-right: 8px"
        >
          <el-option
            v-for="pl in plans"
            :key="pl.id"
            :label="pl.title"
            :value="pl.id"
          />
        </el-select>
        <el-button
          type="primary"
          plain
          :loading="reviewLoading"
          :disabled="!plans.length"
          @click="runReview"
          >生成复评报告</el-button
        >
      </div>
      <div v-if="review" style="margin-top: 12px">
        <p><b>完成率：</b>{{ review.completionRate }}%</p>
        <p>{{ review.evaluation }}</p>
        <div v-for="(ch, i) in review.changes" :key="i" style="font-size: 13px">
          {{ ch.metric }}：{{ ch.before }} → {{ ch.after }}（{{
            ch.trend === "improve"
              ? "↑ 改善"
              : ch.trend === "decline"
                ? "↓ 下降"
                : "— 持平"
          }}）
        </div>
        <p v-if="review.nextSuggestions.length" style="margin-top: 8px">
          <b>下一步：</b>{{ review.nextSuggestions.join("；") }}
        </p>
      </div>
    </el-card>
    <!-- 计划列表 -->
    <div v-if="loading" class="state-box">
      <el-skeleton :rows="3" animated />
    </div>
    <el-empty
      v-else-if="plans.length === 0"
      description="还没有行动计划，可从当前风险一键生成，或手动创建"
    />
    <div v-else class="plan-grid">
      <el-card v-for="p in plans" :key="p.id" shadow="hover" class="plan-card">
        <div class="flex-bc">
          <span class="plan-title">{{ p.title }}</span>
          <el-tag
            :type="p.status === 'active' ? 'success' : 'info'"
            size="small"
          >
            {{ statusText(p.status) }}
          </el-tag>
        </div>
        <div class="plan-period">
          {{ p.startDate }} ~ {{ p.endDate }} · {{ p.tasks.length }} 个任务 ·
          目标：{{ p.riskKey }}
        </div>
        <el-progress
          v-if="p.progress"
          :percentage="p.progress.rate"
          :stroke-width="10"
          :status="
            p.progress.rate >= 70
              ? 'success'
              : p.progress.rate >= 40
                ? ''
                : 'exception'
          "
        />
        <div class="plan-meta">
          连续打卡 {{ p.progress?.streakDays ?? 0 }} 天 · 完成
          {{ p.progress?.doneCount ?? 0 }}/{{ p.progress?.dueCount ?? 0 }} 次
        </div>
        <div class="plan-actions">
          <el-button size="small" type="primary" @click="openDetail(p)">
            查看与打卡
          </el-button>
          <el-button
            v-if="p.status === 'active'"
            size="small"
            @click="completePlan(p)"
          >
            完成计划
          </el-button>
        </div>
      </el-card>
    </div>

    <!-- C6：健康提醒设置（演示用站内提醒；渠道清单与判定口径都来自共享层） -->
    <el-card shadow="never" class="reminder-card">
      <template #header>
        <div class="reminder-head">
          <span class="font-medium">提醒设置</span>
          <el-tag size="small" effect="plain" type="info">
            演示用站内提醒 · 当前渠道：{{ activeChannelLabel }}
          </el-tag>
        </div>
      </template>

      <el-skeleton v-if="reminderLoading && !reminder" :rows="3" animated />
      <el-empty
        v-else-if="!reminder"
        description="提醒设置加载失败，请稍后重试"
        :image-size="60"
      />
      <template v-else>
        <div v-for="s in reminder.settings" :key="s.kind" class="reminder-row">
          <div class="reminder-body">
            <div class="reminder-title">
              <span>{{ REMINDER_LABELS[s.kind] }}</span>
              <el-tag
                :type="s.enabled ? 'success' : 'info'"
                size="small"
                effect="light"
              >
                {{ s.enabled ? "已开启" : "未开启" }}
              </el-tag>
            </div>
            <div class="muted mt-1">{{ REMINDER_DESCRIPTIONS[s.kind] }}</div>
            <div class="muted">
              <template v-if="!s.enabled">
                开启后每天 {{ s.time }} 提醒一次
              </template>
              <template v-else-if="s.firedToday">
                今日 {{ s.time }} 已提醒（见下方「今日提醒」）
              </template>
              <template v-else>下次提醒：{{ s.nextFireText }}</template>
            </div>
          </div>
          <div class="reminder-controls">
            <el-time-picker
              v-model="reminderDraft[s.kind]"
              arrow-control
              format="HH:mm"
              value-format="HH:mm"
              :aria-label="`${REMINDER_LABELS[s.kind]}时刻`"
              :placeholder="DEFAULT_REMINDER_TIMES[s.kind]"
              :disabled="savingKind === s.kind"
              class="reminder-time"
              @change="(v: string) => saveReminder(s.kind, s.enabled, v)"
            />
            <el-switch
              :model-value="s.enabled"
              :loading="savingKind === s.kind"
              :aria-label="`${REMINDER_LABELS[s.kind]}开关`"
              :active-text="s.enabled ? '开启' : '关闭'"
              inline-prompt
              @update:model-value="
                (v: string | number | boolean) =>
                  saveReminder(s.kind, Boolean(v), null)
              "
            />
          </div>
        </div>

        <el-divider content-position="left">今日提醒</el-divider>
        <el-empty
          v-if="!reminder.notices.length"
          description="今日暂无站内提醒"
          :image-size="60"
        />
        <ul v-else class="notice-list">
          <li v-for="n in reminder.notices" :key="n.id" class="notice-item">
            <div class="notice-title">{{ n.title }}</div>
            <div class="muted">{{ n.content }}</div>
            <div class="muted">触发时间：{{ n.createTime }}</div>
          </li>
        </ul>

        <el-alert
          type="info"
          show-icon
          :closable="false"
          class="mt-3"
          title="渠道与调度说明"
          :description="`${reminder.note}${reminder.scheduleNote}`"
        />
        <div class="reminder-foot">
          <span>服务端当前时刻 {{ reminder.serverTime }}</span>
          <span v-if="!reminder.configured">尚未设置过，当前为默认关闭</span>
          <span v-else>上次修改：{{ reminder.updateTime }}</span>
        </div>
      </template>
    </el-card>

    <!-- 计划详情：任务打卡（C6：宽度走 JS 断点，窄屏改为百分比，固定 480px 会超出 375px 视口） -->
    <el-drawer
      v-model="detailVisible"
      :size="drawerSize"
      :title="detail?.title ?? '计划详情'"
      destroy-on-close
    >
      <template v-if="detail">
        <div class="detail-info">
          <div class="flex-bc">
            <span>{{ detail.startDate }} ~ {{ detail.endDate }}</span>
            <el-tag size="small" type="warning">
              连续打卡 {{ detail.progress?.streakDays ?? 0 }} 天
            </el-tag>
          </div>
          <el-progress
            class="mt-3"
            :percentage="detail.progress?.rate ?? 0"
            :stroke-width="12"
          />
          <div class="muted mt-1">
            完成率 {{ detail.progress?.rate ?? 0 }}%（{{
              detail.progress?.doneCount ?? 0
            }}/{{ detail.progress?.dueCount ?? 0 }}）
          </div>
        </div>

        <el-divider content-position="left">今日任务打卡</el-divider>
        <div v-if="detail.tasks.length === 0" class="muted">该计划暂无任务</div>
        <div
          v-for="t in detail.tasks"
          :key="t.id"
          class="task-row"
          :class="{ done: checkinMap[t.id] }"
        >
          <div class="task-body">
            <div class="flex gap-2 items-center">
              <span class="task-title">{{ t.title }}</span>
              <el-tag size="small" type="info">{{
                taskTypeText(t.taskType)
              }}</el-tag>
              <el-tag size="small" type="success" effect="plain">
                {{ t.frequency === "daily" ? "每日" : "每周" }}
              </el-tag>
            </div>
            <div class="muted mt-1">
              今日 {{ checkinMap[t.id] ? "已完成" : "未完成" }}
              <template v-if="checkinMap[t.id]">· {{ fmt(today) }}</template>
            </div>
          </div>
          <el-button
            size="small"
            :type="checkinMap[t.id] ? 'success' : 'primary'"
            :disabled="checkinMap[t.id] || checkingTaskId === t.id"
            :loading="checkingTaskId === t.id"
            @click="doCheckin(t)"
          >
            {{ checkinMap[t.id] ? "已打卡" : "打卡" }}
          </el-button>
        </div>

        <el-divider content-position="left">分任务进度</el-divider>
        <div
          v-for="pt in detail.progress?.perTask ?? []"
          :key="pt.taskId"
          class="per-task"
        >
          <div class="flex-bc">
            <span class="task-title">{{ pt.title }}</span>
            <span class="muted">{{ pt.done }}/{{ pt.due }}</span>
          </div>
          <el-progress :percentage="pt.rate" :stroke-width="8" />
        </div>
      </template>
    </el-drawer>

    <!-- 创建计划对话框（手动 / 从风险生成预览） -->
    <el-dialog
      v-model="createVisible"
      :title="draft?.source === 'risk' ? '从当前风险生成计划' : '手动创建计划'"
      :width="dialogWidth"
      destroy-on-close
    >
      <el-form
        :label-width="isNarrow ? 'auto' : '90px'"
        :label-position="isNarrow ? 'top' : 'right'"
      >
        <el-form-item :label="PLAN_FIELD_LABELS.title">
          <el-input v-model="form.title" placeholder="如：血压改善计划" />
        </el-form-item>
        <el-form-item :label="PLAN_FIELD_LABELS.riskKey">
          <el-select v-model="form.riskKey" class="w-full">
            <el-option
              v-for="k in riskKeyOptions"
              :key="k.value"
              :label="k.label"
              :value="k.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item :label="PLAN_FIELD_LABELS.targetValue">
          <el-input v-model="form.targetValue" placeholder="可选，如 140" />
        </el-form-item>
        <el-form-item :label="PLAN_FIELD_LABELS.startDate">
          <el-date-picker
            v-model="form.startDate"
            type="date"
            value-format="YYYY-MM-DD"
            class="w-full"
          />
        </el-form-item>
        <el-form-item :label="PLAN_FIELD_LABELS.endDate">
          <el-date-picker
            v-model="form.endDate"
            type="date"
            value-format="YYYY-MM-DD"
            class="w-full"
          />
        </el-form-item>
        <!-- C6：这一项里有三个控件，EP 会把它标成 role="group" + aria-labelledby="任务列表"，
             组内每个控件因此必须各自带 aria-label，否则读屏听不出哪个是哪个。 -->
        <el-form-item :label="PLAN_FIELD_LABELS.tasks">
          <div class="w-full task-editor">
            <div v-for="(t, i) in form.tasks" :key="i" class="task-editor-row">
              <el-input
                v-model="t.title"
                placeholder="任务内容"
                class="task-input"
                :aria-label="PLAN_FIELD_LABELS.taskTitle"
              />
              <el-select
                v-model="t.taskType"
                class="task-type"
                :aria-label="PLAN_FIELD_LABELS.taskType"
              >
                <el-option
                  v-for="tt in PLAN_TASK_TYPES"
                  :key="tt.value"
                  :label="tt.label"
                  :value="tt.value"
                />
              </el-select>
              <el-select
                v-model="t.frequency"
                class="task-freq"
                :aria-label="PLAN_FIELD_LABELS.frequency"
              >
                <el-option
                  v-for="f in PLAN_FREQUENCIES"
                  :key="f.value"
                  :label="f.label"
                  :value="f.value"
                />
              </el-select>
              <el-button
                text
                type="danger"
                :disabled="form.tasks.length <= 1"
                @click="form.tasks.splice(i, 1)"
              >
                删除
              </el-button>
            </div>
            <el-button size="small" class="mt-2" @click="addTaskRow"
              >+ 添加任务</el-button
            >
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitCreate"
          >创建计划</el-button
        >
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, onMounted, reactive, ref } from "vue";
import {
  buildPlanFromAnalysis,
  fmtDate,
  addDays,
  PLAN_TASK_TYPES,
  PLAN_FREQUENCIES
} from "@shared/health-plan";
import type {
  HealthPlan,
  HealthPlanTask,
  PlanFrequency,
  PlanTaskType,
  ReminderKind,
  ReminderState
} from "@/types/health";
// C6：表单标签取自共享层唯一源码（EP 只在「一个表单项恰好一个控件」时才把 label 用 for
// 绑到控件上，所以任务编辑器那一行的三个控件共处一个表单项，各自带 aria-label）。
import {
  DEFAULT_REMINDER_TIMES,
  PLAN_FIELD_LABELS,
  REMINDER_DESCRIPTIONS,
  REMINDER_LABELS,
  TIME_OF_DAY_HINT,
  normalizeTimeOfDay
} from "@/types/health";
import {
  createHealthPlan,
  getHealthPlans,
  getHealthPlan,
  updateHealthPlan,
  checkinPlanTask,
  getHealthChatConfig,
  getReminders,
  updateReminder
} from "@/api/health";
import { useNarrowScreen } from "../composables/useNarrowScreen";

defineOptions({
  name: "HealthPlans"
});

/**
 * C6：抽屉与对话框的宽度是**组件属性**，CSS 媒体查询管不到，必须走 JS 断点。
 * 桌面沿用原来的 480px / 640px，窄屏改成百分比 —— 固定宽度会超出 375px 视口。
 */
const { isNarrow } = useNarrowScreen();
const drawerSize = computed(() => (isNarrow.value ? "92%" : "480px"));
const dialogWidth = computed(() => (isNarrow.value ? "94%" : "640px"));

const plans = ref<HealthPlan[]>([]);
const review = ref<any>(null);
const reviewPlanId = ref<number | null>(null);
const reviewLoading = ref(false);
async function runReview() {
  if (!reviewPlanId.value && plans.value.length)
    reviewPlanId.value = plans.value[0].id;
  if (!reviewPlanId.value) return;
  reviewLoading.value = true;
  try {
    const { getHealthAgentReview } = await import("@/api/health");
    const r = await getHealthAgentReview(reviewPlanId.value!);
    if (r.code === 0) review.value = r.data;
  } finally {
    reviewLoading.value = false;
  }
}
const loading = ref(false);
const genLoading = ref(false);
const saving = ref(false);

const detailVisible = ref(false);
const detail = ref<HealthPlan | null>(null);
const checkinMap = ref<Record<number, boolean>>({});
const checkingTaskId = ref<number | null>(null);

const createVisible = ref(false);
const draft = ref<{ source: "risk" | "manual" }>({ source: "manual" });
const today = fmtDate(new Date());

const form = reactive({
  title: "",
  riskKey: "bloodPressure",
  targetValue: "",
  startDate: today,
  endDate: addDays(today, 14),
  tasks: [] as Array<{
    title: string;
    taskType: PlanTaskType;
    frequency: PlanFrequency;
  }>
});

/** 可创建的计划风险类型（模板 key 为主 + 自由输入） */
const riskKeyOptions = [
  { value: "bloodPressure", label: "血压改善" },
  { value: "bloodGlucose", label: "血糖管理" },
  { value: "bmi", label: "体重管理" },
  { value: "lipid", label: "血脂改善" },
  { value: "hdl", label: "HDL 提升" },
  { value: "lifestyle", label: "生活方式" },
  { value: "maintain", label: "健康维持" }
];

function statusText(s: string): string {
  return s === "active" ? "进行中" : s === "completed" ? "已完成" : "已停止";
}

function taskTypeText(t: string): string {
  return PLAN_TASK_TYPES.find(x => x.value === t)?.label ?? t;
}

function fmt(d: string): string {
  return d;
}

async function loadPlans() {
  loading.value = true;
  try {
    const res = await getHealthPlans();
    plans.value = (res.data ?? []) as HealthPlan[];
  } finally {
    loading.value = false;
  }
}

// ---------- 从当前风险生成 ----------

async function generateFromRisk() {
  genLoading.value = true;
  try {
    // 复用后端实时分析（当前用户库内数据），再本地生成计划草稿
    const { http } = await import("@/utils/http");
    const res: any = await http.request("post", "/api/health/analyze", {});
    const analyze = res.data;
    const draftPlan = buildPlanFromAnalysis(analyze, today, addDays(today, 14));
    if (!draftPlan) {
      ElMessage.info(
        "当前无明显风险点，无需生成专项计划；可直接手动创建健康维持计划。"
      );
      return;
    }
    form.title = draftPlan.title;
    form.riskKey = draftPlan.riskKey;
    form.targetValue =
      draftPlan.targetValue != null ? String(draftPlan.targetValue) : "";
    form.startDate = draftPlan.startDate;
    form.endDate = draftPlan.endDate;
    form.tasks = draftPlan.tasks.map(t => ({ ...t }));
    draft.value = { source: "risk" };
    createVisible.value = true;
  } finally {
    genLoading.value = false;
  }
}

// ---------- 手动创建 ----------

function openCreateDialog() {
  draft.value = { source: "manual" };
  form.title = "";
  form.riskKey = "bloodPressure";
  form.targetValue = "";
  form.startDate = today;
  form.endDate = addDays(today, 14);
  form.tasks = [
    {
      title: "每日定时测量血压并记录",
      taskType: "measure",
      frequency: "daily"
    },
    { title: "低盐饮食（每日食盐 <5g）", taskType: "diet", frequency: "daily" },
    {
      title: "每日 30 分钟中等强度有氧运动",
      taskType: "exercise",
      frequency: "daily"
    }
  ];
  createVisible.value = true;
}

function addTaskRow() {
  form.tasks.push({ title: "", taskType: "other", frequency: "daily" });
}

async function submitCreate() {
  if (!form.title.trim()) {
    ElMessage.warning("请填写计划标题");
    return;
  }
  if (form.startDate > form.endDate) {
    ElMessage.warning("开始日期不能晚于结束日期");
    return;
  }
  const tasks = form.tasks
    .filter(t => t.title.trim())
    .map(t => ({
      title: t.title.trim(),
      taskType: t.taskType,
      frequency: t.frequency
    }));
  if (tasks.length === 0) {
    ElMessage.warning("至少需要一个有效任务");
    return;
  }
  saving.value = true;
  try {
    await createHealthPlan({
      title: form.title.trim(),
      riskKey: form.riskKey,
      targetValue: form.targetValue === "" ? null : Number(form.targetValue),
      startDate: form.startDate,
      endDate: form.endDate,
      source: draft.value.source === "risk" ? "rule" : "manual",
      tasks
    });
    ElMessage.success("计划已创建，开始每日打卡吧");
    createVisible.value = false;
    await loadPlans();
  } finally {
    saving.value = false;
  }
}

// ---------- 详情与打卡 ----------

async function openDetail(p: HealthPlan) {
  const res = await getHealthPlan(p.id);
  detail.value = res.data as HealthPlan;
  checkinMap.value = {};
  for (const t of detail.value.tasks) {
    checkinMap.value[t.id] = false;
  }
  // 今日已完成状态
  const todayRes: any = await httpToday();
  const item = todayRes.find((x: any) => x.plan.id === p.id);
  if (item) {
    for (const t of item.tasks) {
      if (t.checkedToday) checkinMap.value[t.id] = true;
    }
  }
  detailVisible.value = true;
}

async function httpToday() {
  const { getHealthPlansToday } = await import("@/api/health");
  const res: any = await getHealthPlansToday();
  return res.data ?? [];
}

async function doCheckin(t: HealthPlanTask) {
  checkingTaskId.value = t.id;
  try {
    await checkinPlanTask(t.id);
    checkinMap.value[t.id] = true;
    ElMessage.success(`「${t.title}」打卡成功`);
    const res = await getHealthPlan(detail.value!.id);
    detail.value = res.data as HealthPlan;
  } finally {
    checkingTaskId.value = null;
  }
}

async function completePlan(p: HealthPlan) {
  await ElMessageBox.confirm(`确认将「${p.title}」标记为已完成？`, "完成计划", {
    type: "warning"
  });
  await updateHealthPlan(p.id, { status: "completed" });
  ElMessage.success("计划已完成");
  await loadPlans();
}

// ---------- C6：健康提醒（站内提醒） ----------

const reminder = ref<ReminderState | null>(null);
const reminderLoading = ref(false);
/** 正在保存的类型（只禁用那一行，避免整块表单闪烁） */
const savingKind = ref<ReminderKind | null>(null);

/** 时刻输入的本地草稿：请求失败时用服务端返回值回写，界面不会停在非法值上 */
const reminderDraft = reactive<Record<ReminderKind, string>>({
  measure: DEFAULT_REMINDER_TIMES.measure,
  checkin: DEFAULT_REMINDER_TIMES.checkin
});

/** 当前生效渠道的中文名（渠道清单来自共享层，前端不硬编码文案） */
const activeChannelLabel = computed(
  () =>
    reminder.value?.channels.find(c => c.key === reminder.value?.activeChannel)
      ?.label ?? "站内提醒"
);

function syncDraft(data: ReminderState) {
  for (const s of data.settings) reminderDraft[s.kind] = s.time;
}

async function loadReminders() {
  reminderLoading.value = true;
  try {
    const { code, data } = await getReminders();
    if (code === 0 && data) {
      reminder.value = data;
      syncDraft(data);
    } else {
      reminder.value = null;
    }
  } catch {
    reminder.value = null;
  } finally {
    reminderLoading.value = false;
  }
}

/**
 * 保存一类提醒。`time` 传 null / undefined 表示「只改开关，时刻沿用库内值」。
 *
 * 时刻先过一遍共享层的 `normalizeTimeOfDay`：与服务端是同一个函数，因此前端放行的值
 * 服务端一定接受；非法值直接提示并回滚草稿，不浪费一次往返。
 */
async function saveReminder(
  kind: ReminderKind,
  enabled: boolean,
  time?: string | null
) {
  let nextTime: string | undefined;
  if (time) {
    const parsed = normalizeTimeOfDay(time);
    if (!parsed) {
      ElMessage.warning(`提醒时刻格式不正确（${TIME_OF_DAY_HINT}）`);
      if (reminder.value) syncDraft(reminder.value);
      return;
    }
    nextTime = parsed;
  }

  savingKind.value = kind;
  try {
    const { code, data } = await updateReminder({
      kind,
      enabled,
      time: nextTime
    });
    if (code === 0 && data) {
      reminder.value = data;
      syncDraft(data);
      if (data.changed) {
        ElMessage.success(
          `${REMINDER_LABELS[kind]}已${enabled ? "开启" : "关闭"}`
        );
      }
    } else {
      ElMessage.error("提醒设置保存失败");
      await loadReminders();
    }
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message ?? "提醒设置保存失败");
    // 以服务端为准回滚（本地草稿可能已经被用户改过了）
    await loadReminders();
  } finally {
    savingKind.value = null;
  }
}

onMounted(() => {
  loadPlans();
  loadReminders();
});
</script>

<style scoped>
.plans-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.plans-header {
  border-radius: 12px;
}

.header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.header-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.header-sub {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.header-actions {
  display: flex;
  gap: 10px;
}

.state-box {
  padding: 16px;
}

.plan-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.plan-card {
  border-radius: 12px;
}

.plan-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.plan-period {
  margin: 8px 0 12px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.plan-meta {
  margin-top: 8px;
  font-size: 12px;
  color: #075e45;
}

.plan-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.detail-info {
  padding: 12px;
  background: #f7faf8;
  border: 1px solid #e6f0ea;
  border-radius: 10px;
}

.task-row {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  padding: 12px 10px;
  border-bottom: 1px dashed #eef4f0;

  &.done {
    background: #f6fdf9;
  }
}

.task-body {
  flex: 1;
  min-width: 0;
}

.task-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.per-task {
  margin-bottom: 10px;
}

.muted {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.flex-bc {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.flex {
  display: flex;
}

.gap-2 {
  gap: 8px;
}

.items-center {
  align-items: center;
}

.mt-1 {
  margin-top: 4px;
}

.mt-3 {
  margin-top: 12px;
}

.w-full {
  width: 100%;
}

.task-editor-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}

.task-input {
  flex: 1;
}

.task-type {
  width: 110px;
}

.task-freq {
  width: 90px;
}

/* ---------- C6：提醒设置 ---------- */

.reminder-head {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
}

.reminder-row {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px dashed #eef4f0;

  &:last-of-type {
    border-bottom: none;
  }
}

.reminder-body {
  flex: 1;
  min-width: 0;
}

.reminder-title {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.reminder-controls {
  display: flex;
  flex: none;
  gap: 10px;
  align-items: center;
}

.reminder-time {
  width: 130px;
}

.notice-list {
  padding: 0;
  margin: 0;
  list-style: none;
}

.notice-item {
  padding: 10px 12px;
  margin-bottom: 8px;
  background: #f6fdf9;
  border: 1px solid #d8efe3;
  border-radius: 10px;
}

.notice-title {
  font-size: 13px;
  font-weight: 600;
  color: #075e45;
}

.reminder-foot {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-top: 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

/* ---------- C6 移动端适配：断点 768px，与共享层 MOBILE_BREAKPOINT 同值 ---------- */

@media (width <= 768px) {
  /* 卡片网格从「最少 320px 自适应」改为单列：320px 下限在 375px 视口里只剩几十像素余量，
     卡片阴影与内边距一挤就会溢出 */
  .plan-grid {
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .header-row {
    flex-direction: column;
    gap: 12px;
    align-items: stretch;
  }

  .header-actions {
    flex-wrap: wrap;
  }

  .header-actions :deep(.el-button) {
    flex: 1;
    min-width: 120px;
  }

  /* 计划卡片的操作按钮铺满并加高，触控目标不小于 40px */
  .plan-actions :deep(.el-button) {
    flex: 1;
    height: 40px;
  }

  /* 任务编辑器一行放不下三个控件 + 删除按钮，改为换行（输入框独占一行） */
  .task-editor-row {
    flex-wrap: wrap;
  }

  .task-input {
    flex: 1 1 100%;
  }

  .task-type,
  .task-freq {
    flex: 1;
    width: auto;
  }

  /* 提醒行改为上下排布：开关与时刻在窄屏下与说明文字争宽度 */
  .reminder-row {
    flex-direction: column;
    align-items: stretch;
  }

  .reminder-controls {
    justify-content: space-between;
  }

  .reminder-time {
    flex: 1;
    width: auto;
  }

  /* 详情抽屉里的打卡按钮铺满整行 */
  .task-row {
    flex-wrap: wrap;
  }

  .task-row :deep(.el-button) {
    width: 100%;
    height: 40px;
  }
}
</style>
