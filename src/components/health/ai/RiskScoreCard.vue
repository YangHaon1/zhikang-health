<script setup lang="ts">
/** M4 风险评分卡：大数字 + 风险等级 */
import type { AiProfileView } from "@/types/health";
defineOptions({ name: "RiskScoreCard" });
defineProps<{ profile: AiProfileView }>();
</script>

<template>
  <div class="risk-card health-cockpit">
    <p class="kicker">健康风险分析</p>
    <div class="big">{{ profile.healthScore }}</div>
    <p class="level" :class="profile.riskLevel">{{ profile.riskLevel }}</p>
  </div>
</template>

<style lang="scss" scoped>
.risk-card {
  padding: 24px;
  text-align: center;
  background: var(--hc-card, #fff);
  border: 1px solid var(--hc-border, #e6f0ea);
  border-radius: 16px;
  backdrop-filter: blur(12px);
}

.kicker {
  margin: 0;
  font-size: 12px;
  color: var(--hc-text-secondary, #8aa094);
}

.big {
  font-family: "DIN Alternate", "JetBrains Mono", ui-monospace, monospace;
  font-size: 56px;
  font-weight: 750;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
  color: var(--hc-text-primary, #17382c);
}

.level {
  margin: 4px 0 0;
  font-size: 14px;
  font-weight: 600;
}

.level.低风险 {
  color: var(--hc-level-low, #16a34a);
}

.level.中风险 {
  color: var(--hc-level-mid, #f59e0b);
}

.level.高风险 {
  color: var(--hc-level-critical, #dc2626);
}
</style>
