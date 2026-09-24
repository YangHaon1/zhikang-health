<script setup lang="ts">
/** M5 AI 健康陪伴页：今日总结 + 目标进度 + 建议 */
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import {
  getDailySummary,
  generateDailySummary,
  getGoalProgress
} from "@/api/health";
import type { DailySummaryView, GoalProgressView } from "@/types/health";
import DailySummaryCard from "@/components/health/companion/DailySummaryCard.vue";
import GoalProgressCard from "@/components/health/companion/GoalProgressCard.vue";
import SuggestionCard from "@/components/health/companion/SuggestionCard.vue";

defineOptions({ name: "HealthCompanion" });

const router = useRouter();
const loading = ref(false);
const generating = ref(false);
const summary = ref<DailySummaryView | null>(null);
const goals = ref<GoalProgressView[]>([]);

async function load() {
  loading.value = true;
  try {
    const [s, g] = await Promise.all([getDailySummary(), getGoalProgress()]);
    if (s.code === 0) summary.value = s.data;
    if (g.code === 0) goals.value = g.data;
  } finally {
    loading.value = false;
  }
}

async function generate() {
  generating.value = true;
  try {
    const { code, data } = await generateDailySummary();
    if (code === 0) {
      summary.value = data;
      ElMessage.success("今日总结已生成");
    } else {
      ElMessage.error((data as any)?.message || "生成失败");
    }
  } catch (err: any) {
    ElMessage.error(
      err?.response?.data?.message || "AI 总结生成失败，请稍后重试"
    );
  } finally {
    generating.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div v-loading="loading" class="companion-page">
    <div class="head">
      <h2>AI 健康陪伴</h2>
      <el-button
        v-if="!summary"
        type="primary"
        round
        :loading="generating"
        @click="generate"
      >
        生成今日总结
      </el-button>
      <el-button v-else round :loading="generating" @click="generate"
        >刷新总结</el-button
      >
    </div>

    <template v-if="summary">
      <DailySummaryCard :summary="summary" />
      <div class="grid">
        <GoalProgressCard :goals="goals" />
        <SuggestionCard :suggestions="summary.suggestions" />
      </div>
    </template>

    <!-- 首次进入 AI 欢迎卡片（空态引导） -->
    <div v-else class="welcome-card">
      <div class="welcome-avatar">
        <iconify-icon icon="ri:robot-2-line" width="30" />
      </div>
      <h3 class="welcome-title">你好，我是智康 AI 健康助手</h3>
      <p class="welcome-desc">
        基于你的健康数据，我可以帮你分析指标、解读趋势、提供个性化生活建议。
      </p>
      <ul class="welcome-points">
        <li>分析健康数据</li>
        <li>解读健康趋势</li>
        <li>提供生活方式建议</li>
      </ul>
      <div class="welcome-actions">
        <el-button type="primary" round :loading="generating" @click="generate">
          生成今日健康总结
        </el-button>
        <el-button round @click="router.push('/health/chat')">
          去 AI 健康问答 →
        </el-button>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.companion-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 880px;
  margin: 0 auto;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;

  h2 {
    margin: 0;
    font-size: 20px;
    color: #17382c;
  }
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

/* AI 欢迎卡片 */
.welcome-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 28px;
  text-align: center;
  background: linear-gradient(160deg, #fff, #f0f5ff);
  border: 1px solid #e0e7ff;
  border-radius: 20px;
}

.welcome-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  margin-bottom: 16px;
  color: #fff;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border-radius: 50%;
  box-shadow: 0 8px 20px rgb(99 102 241 / 30%);
}

.welcome-title {
  margin: 0 0 8px;
  font-size: 20px;
  font-weight: 700;
  color: #1e1b4b;
}

.welcome-desc {
  max-width: 440px;
  margin: 0 0 18px;
  font-size: 14px;
  line-height: 1.7;
  color: #64748b;
}

.welcome-points {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: center;
  padding: 0;
  margin: 0 0 22px;
  list-style: none;

  li {
    padding: 6px 14px;
    font-size: 13px;
    color: #4f46e5;
    background: #eef2ff;
    border-radius: 999px;
  }
}

.welcome-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: center;
}
</style>
