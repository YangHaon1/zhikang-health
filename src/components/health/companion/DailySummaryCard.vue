<script setup lang="ts">
/** M5 今日总结卡 */
import type { DailySummaryView } from "@/types/health";
import AiBadge from "@/components/health/AiBadge.vue";
defineOptions({ name: "DailySummaryCard" });
defineProps<{ summary: DailySummaryView }>();
</script>

<template>
  <div class="summary-card">
    <AiBadge />
    <p class="kicker">今日健康总结</p>
    <p class="score">
      健康指数 <strong>{{ summary.healthScore }}</strong>
    </p>
    <p class="text">{{ summary.summary }}</p>
    <ul v-if="summary.highlights.length" class="hl">
      <li v-for="h in summary.highlights" :key="h">✓ {{ h }}</li>
    </ul>
    <ul v-if="summary.warnings.length" class="wn">
      <li v-for="w in summary.warnings" :key="w">! {{ w }}</li>
    </ul>
  </div>
</template>

<style lang="scss" scoped>
.summary-card {
  padding: 20px;
  background: #fff;
  border: 1px solid #e6f0ea;
  border-radius: 16px;
}

.kicker {
  margin: 0 0 8px;
  font-size: 12px;
  color: #8aa094;
}

.score {
  margin: 0 0 8px;
  font-size: 14px;
  color: #6b7f74;

  strong {
    font-size: 26px;
    color: #17382c;
  }
}

.text {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.7;
  color: #2c4a3d;
}

.hl {
  padding: 0;
  margin: 0 0 8px;
  list-style: none;

  li {
    padding: 2px 0;
    font-size: 12px;
    color: #16a34a;
  }
}

.wn {
  padding: 0;
  margin: 0;
  list-style: none;

  li {
    padding: 2px 0;
    font-size: 12px;
    color: #b45309;
  }
}
</style>
