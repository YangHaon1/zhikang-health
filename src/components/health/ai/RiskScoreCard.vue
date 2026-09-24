<script setup lang="ts">
/** M4 风险评分卡：大数字 + 风险等级 */
import type { AiProfileView } from "@/types/health";
defineOptions({ name: "RiskScoreCard" });
defineProps<{ profile: AiProfileView }>();
</script>

<template>
  <div class="risk-card">
    <p class="kicker">健康风险分析</p>
    <div class="big">{{ profile.healthScore }}</div>
    <p class="level" :class="profile.riskLevel">{{ profile.riskLevel }}</p>
  </div>
</template>

<style lang="scss" scoped>
.risk-card {
  padding: 24px;
  text-align: center;
  background: #fff;
  border: 1px solid #e6f0ea;
  border-radius: 16px;
}

.kicker {
  margin: 0;
  font-size: 12px;
  color: #8aa094;
}

.big {
  font-size: 56px;
  font-weight: 750;
  line-height: 1.1;
  color: #17382c;
}

.level {
  margin: 4px 0 0;
  font-size: 14px;
  font-weight: 600;
}

.level.低风险 {
  color: #16a34a;
}

.level.中风险 {
  color: #f59e0b;
}

.level.高风险 {
  color: #dc2626;
}
</style>
