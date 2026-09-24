<script setup lang="ts">
/** M4 健康风险预测页：风险评分 + 影响因素 + 建议 */
import { ref, onMounted } from "vue";
import { getAiProfile } from "@/api/health";
import type { AiProfileView } from "@/types/health";
import RiskScoreCard from "@/components/health/ai/RiskScoreCard.vue";
import HealthFactorChart from "@/components/health/ai/HealthFactorChart.vue";
import AIAdviceList from "@/components/health/ai/AIAdviceList.vue";

defineOptions({ name: "HealthRisk" });

const loading = ref(false);
const profile = ref<AiProfileView | null>(null);

onMounted(async () => {
  loading.value = true;
  try {
    const { code, data } = await getAiProfile();
    if (code === 0) profile.value = data;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div v-loading="loading" class="risk-page">
    <template v-if="profile">
      <div class="risk-hero">
        <p class="risk-kicker">
          <iconify-icon icon="ri:radar-line" /> AI 风险预测
        </p>
        <h2>你的健康风险状态</h2>
        <p>基于近期健康数据，AI 逐项评估风险等级与影响因素</p>
      </div>
      <RiskScoreCard :profile="profile" />
      <HealthFactorChart :problems="profile.problems" />
      <AIAdviceList :advice="profile.suggestions" />
    </template>
    <el-empty v-else description="请先在「AI 健康画像」生成分析" />
  </div>
</template>

<style lang="scss" scoped>
.risk-page {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  max-width: 800px;
  margin: 0 auto;
}

.risk-hero {
  grid-column: 1 / -1;
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

.risk-page > :last-child {
  grid-column: 1 / -1;
}
</style>
