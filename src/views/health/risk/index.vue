<script setup lang="ts">
/** M4 健康风险预测页 + V2.0 P1-1C：ML 亚健康 AI 预测展示 */
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import {
  getAiProfile,
  getHealthRisk,
  getCoachPlan,
  confirmCoachPlan,
  getHealthAgentAnalysis,
  getHealthAgentPlan,
  type RiskPredictView,
  type CoachPlanView,
  type HealthAgentAnalysis,
  type HealthAgentPlan
} from "@/api/health";
import type { AiProfileView } from "@/types/health";
import RiskScoreCard from "@/components/health/ai/RiskScoreCard.vue";
import HealthFactorChart from "@/components/health/ai/HealthFactorChart.vue";
import AIAdviceList from "@/components/health/ai/AIAdviceList.vue";

defineOptions({ name: "HealthRisk" });
const router = useRouter();

const loading = ref(false);
const profile = ref<AiProfileView | null>(null);
const risk = ref<RiskPredictView | null>(null);
const agent = ref<HealthAgentAnalysis | null>(null);
const agentPlan = ref<HealthAgentPlan | null>(null);

onMounted(async () => {
  loading.value = true;
  try {
    const [p, r] = await Promise.all([getAiProfile(), getHealthRisk()]);
    if (p.code === 0) profile.value = p.data;
    if (r.code === 0) risk.value = r.data;
    const a = await getHealthAgentAnalysis();
    if (a.code === 0) agent.value = a.data;
    const p2 = await getHealthAgentPlan();
    if (p2.code === 0) agentPlan.value = p2.data;
  } finally {
    loading.value = false;
  }
});

const LEVEL_META: Record<string, { text: string; color: string }> = {
  low: { text: "低风险倾向", color: "#16a34a" },
  medium: { text: "中等风险倾向", color: "#f59e0b" },
  high: { text: "高风险倾向", color: "#dc2626" }
};

const level = computed(() => LEVEL_META[risk.value?.riskLevel ?? "low"]);
const probPct = computed(() =>
  risk.value ? Math.round(risk.value.riskProbability * 100) : 0
);
const hasDaily = computed(() =>
  risk.value ? risk.value.dataQuality.filledRatio > 0 : false
);

const plan = ref<CoachPlanView | null>(null);
const planLoading = ref(false);
const adopting = ref(false);
const adopted = ref(false);
async function genPlan() {
  planLoading.value = true;
  try {
    const { code, data } = await getCoachPlan();
    if (code === 0) {
      plan.value = data;
      adopted.value = false;
    }
  } finally {
    planLoading.value = false;
  }
}
async function adopt() {
  if (!plan.value) return;
  adopting.value = true;
  try {
    const { code } = await confirmCoachPlan(plan.value);
    if (code === 0) adopted.value = true;
  } finally {
    adopting.value = false;
  }
}
</script>

<template>
  <div v-loading="loading" class="risk-page">
    <!-- V2.0：AI 预测结果卡 -->
    <section class="risk-hero">
      <p class="risk-kicker">
        <iconify-icon icon="ri:radar-line" /> AI 亚健康风险预测
      </p>
      <h2>你的健康风险倾向</h2>
      <p>基于近期健康数据，AI 评估生活方式风险（不构成疾病诊断）</p>
    </section>

    <template v-if="risk && hasDaily">
      <div class="ml-card" :style="{ borderTop: `4px solid ${level.color}` }">
        <div class="ml-main">
          <div class="ml-level" :style="{ color: level.color }">
            {{ level.text }}
          </div>
          <div class="ml-prob">
            风险倾向概率 <b>{{ probPct }}%</b>
          </div>
          <div class="ml-meta">
            <el-tag size="small" effect="plain">
              数据完整度 {{ Math.round(risk.dataQuality.filledRatio * 100) }}%
            </el-tag>
            <el-tag
              size="small"
              :type="risk.source === 'ml' ? 'primary' : 'info'"
            >
              {{ risk.source === "ml" ? "AI 模型预测" : "规则分析结果" }}
            </el-tag>
            <el-tag size="small" effect="plain">
              {{ risk.modelVersion }}
            </el-tag>
          </div>
        </div>
      </div>

      <!-- P2-2：AI 健康分析报告 -->
      <div v-if="agent" class="agent-card">
        <div class="type-head">
          <span class="type-kicker">AI 健康分析报告</span>
          <span class="type-badge">{{
            agent.source === "ai" ? "AI 生成" : "规则分析"
          }}</span>
        </div>
        <p class="type-desc">{{ agent.summary }}</p>
        <div v-if="agent.keyProblems.length" class="agent-problems">
          <div v-for="(p, i) in agent.keyProblems" :key="i" class="agent-row">
            <b>{{ p.factor }}</b
            ><span>{{ p.reason }}</span>
          </div>
        </div>
        <div v-if="agent.suggestions.length" class="type-sugg">
          <div v-for="(s, i) in agent.suggestions" :key="i">· {{ s }}</div>
        </div>
      </div>
      <!-- P2-2 P1：AI 7天改善方案 -->
      <div v-if="agentPlan" class="agent-card">
        <div class="type-head">
          <span class="type-kicker">AI 7 天改善方案</span>
          <span class="type-badge">{{
            agentPlan.source === "ai" ? "AI 生成" : "模板方案"
          }}</span>
        </div>
        <h4 style="margin: 8px 0">{{ agentPlan.title }}</h4>
        <div v-if="agentPlan.goals.length" class="plan-goals">
          <div v-for="(g, i) in agentPlan.goals" :key="i" class="goal">
            <b>{{ g.name }}</b
            ><span>{{ g.target }}</span>
          </div>
        </div>
        <div class="plan-tasks">
          <div v-for="t in agentPlan.tasks" :key="t.day" class="plan-row">
            <span class="day">Day{{ t.day }}</span>
            <div>
              <b>{{ t.title }}</b
              ><span>{{ t.action }}（{{ t.duration }}）</span>
            </div>
          </div>
        </div>
      </div>
      <!-- 健康类型分型卡 -->
      <div v-if="risk.healthType" class="type-card">
        <div class="type-head">
          <span class="type-kicker"
            >你的健康行为画像
            <span class="src-tag">{{
              risk.healthType.source === "cluster" ? "AI 聚类分析" : "规则分析"
            }}</span></span
          >
          <span class="type-badge">{{ risk.healthType.name }}</span>
        </div>
        <p class="type-desc">{{ risk.healthType.description }}</p>
        <div class="type-meta">
          <span
            v-for="f in risk.healthType.factors"
            :key="f"
            class="type-factor"
            >{{ f }}</span
          >
        </div>
        <div class="type-sugg">
          <div v-for="(s, i) in risk.healthType.suggestions" :key="i">
            · {{ s }}
          </div>
        </div>
      </div>

      <div v-if="risk.shapFactors?.length" class="factor-card">
        <h3 class="factor-title">为什么判断我有这个风险</h3>
        <div
          v-for="f in risk.modelExplain?.featureImportance || []"
          :key="f.feature"
          class="bar-row"
        >
          <span class="bar-label">{{ f.label }}</span>
          <div class="bar-track">
            <div
              class="bar-fill"
              :style="{
                width: f.value + '%',
                background: f.direction === 'risk_up' ? '#f59e0b' : '#16a34a'
              }"
            />
          </div>
          <span class="bar-dir">{{
            f.direction === "risk_up" ? "↑ 升高风险" : "↓ 降低风险"
          }}</span>
        </div>
      </div>

      <div class="coach-entry" @click="router.push('/health/chat')">
        <iconify-icon icon="ri:customer-service-2-line" width="22" />
        <span>根据我的风险分析，制定改善方案 →</span>
      </div>

      <!-- AI 教练一键生成方案 -->
      <div class="coach-card">
        <h3 class="factor-title">AI 校园健康教练</h3>
        <p class="coach-desc">基于你的风险因素，生成本周可执行的改善计划</p>
        <el-button type="primary" round :loading="planLoading" @click="genPlan">
          生成我的健康改善方案
        </el-button>

        <div v-if="plan" class="plan-box">
          <div class="plan-title">{{ plan.title }}</div>
          <p class="plan-summary">{{ plan.summary }}</p>
          <div v-for="(g, i) in plan.goals" :key="i" class="plan-goal">
            <span class="plan-check">□</span>
            <div>
              <b>{{ g.name }}</b>
              <div class="plan-action">{{ g.action }}</div>
            </div>
          </div>
          <div class="plan-actions">
            <el-button
              v-if="!adopted"
              type="primary"
              round
              :loading="adopting"
              @click="adopt"
            >
              采纳该改善方案
            </el-button>
            <el-tag v-else type="success" size="large"
              >已加入我的健康计划 ✓</el-tag
            >
          </div>
        </div>
      </div>
    </template>

    <el-empty
      v-else
      class="risk-empty"
      description="完成每日健康记录后，AI 将生成风险预测"
    >
      <el-button
        type="primary"
        round
        @click="router.push('/health/records/index')"
      >
        去记录
      </el-button>
    </el-empty>

    <!-- 原有 AI 画像结果（保留） -->
    <template v-if="profile">
      <RiskScoreCard :profile="profile" />
      <HealthFactorChart :problems="profile.problems" />
      <AIAdviceList :advice="profile.suggestions" />
    </template>
  </div>
</template>

<style lang="scss" scoped>
.risk-page {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  max-width: 900px;
  margin: 0 auto;
}

.risk-hero,
.ml-card,
.factor-card,
.coach-entry,
.risk-empty {
  grid-column: 1 / -1;
}

.risk-hero {
  padding: 28px;
  color: #fff;
  background: linear-gradient(135deg, #0f766e, #4f46e5);
  border-radius: 20px;

  h2 {
    margin: 6px 0;
    font-size: 22px;
  }

  p {
    margin: 0;
    font-size: 13px;
    opacity: 0.9;
  }
}

.risk-kicker {
  display: flex;
  gap: 6px;
  align-items: center;
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
  opacity: 0.85;
}

.ml-card {
  padding: 24px;
  background: #fff;
  border: 1px solid #e6f0ea;
  border-radius: 16px;
}

.ml-level {
  font-size: 26px;
  font-weight: 800;
}

.ml-prob {
  margin-top: 8px;
  font-size: 15px;
  color: #4b5563;

  b {
    font-size: 22px;
    color: #17382c;
  }
}

.ml-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

.factor-card {
  padding: 20px 24px;
  background: #fff;
  border: 1px solid #e6f0ea;
  border-radius: 16px;
}

.factor-title {
  margin: 0 0 12px;
  font-size: 15px;
  color: #17382c;
}

.bar-row {
  display: grid;
  grid-template-columns: 90px 1fr 90px;
  gap: 10px;
  align-items: center;
  margin-top: 10px;
  font-size: 13px;
}

.bar-label {
  color: #374151;
}

.bar-track {
  height: 10px;
  overflow: hidden;
  background: #f3f4f6;
  border-radius: 999px;
}

.bar-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.6s ease;
}

.bar-dir {
  font-size: 12px;
  color: #6b7280;
  text-align: right;
}

.coach-entry {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 16px 20px;
  font-weight: 600;
  color: #4f46e5;
  cursor: pointer;
  background: linear-gradient(120deg, #eef2ff, #f5f3ff);
  border-radius: 14px;
  transition: transform 0.18s ease;

  &:hover {
    transform: translateY(-2px);
  }
}

.risk-page > :last-child {
  grid-column: 1 / -1;
}

.coach-card {
  padding: 24px;
  background: linear-gradient(135deg, #eef2ff, #f0fdf4);
  border-radius: 16px;
}

.coach-desc {
  margin: 6px 0 14px;
  font-size: 13px;
  color: #6b7280;
}

.plan-box {
  padding: 18px;
  margin-top: 18px;
  background: #fff;
  border-radius: 12px;
}

.plan-title {
  font-size: 17px;
  font-weight: 700;
  color: #17382c;
}

.plan-summary {
  font-size: 13px;
  color: #4b5563;
}

.plan-goal {
  display: grid;
  grid-template-columns: 24px 1fr;
  gap: 8px;
  margin-top: 12px;
  font-size: 14px;
}

.plan-check {
  font-size: 18px;
  color: #16a34a;
}

.plan-action {
  margin-top: 2px;
  font-size: 12px;
  color: #6b7280;
}

.plan-actions {
  margin-top: 16px;
}

.type-card {
  padding: 24px;
  background: linear-gradient(135deg, #fefce8, #f0fdf4);
  border: 1px solid #fde68a;
  border-radius: 16px;
}

.type-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.type-kicker {
  font-size: 12px;
  color: #92400e;
}

.type-badge {
  padding: 4px 12px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #f59e0b, #16a34a);
  border-radius: 999px;
}

.type-desc {
  margin: 10px 0 0;
  font-size: 14px;
  color: #4b5563;
}

.type-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.type-factor {
  padding: 3px 10px;
  font-size: 12px;
  color: #92400e;
  background: #fffbeb;
  border-radius: 999px;
}

.type-sugg {
  margin-top: 12px;
  font-size: 13px;
  line-height: 1.9;
  color: #17382c;
}

.src-tag {
  padding: 2px 10px;
  margin-left: 8px;
  font-size: 11px;
  font-weight: 600;
  vertical-align: middle;
  color: #4f46e5;
  background: #eef2ff;
  border-radius: 999px;
}
</style>
