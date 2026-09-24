<script setup lang="ts">
/** M4 AI 建议清单 */
import AiBadge from "@/components/health/AiBadge.vue";
defineOptions({ name: "AIAdviceList" });
defineProps<{ advice: string[] }>();
</script>

<template>
  <div class="advice-card">
    <AiBadge />
    <p class="kicker">AI 改善建议</p>
    <ul v-if="advice.length">
      <li v-for="(a, i) in advice" :key="i">{{ a }}</li>
    </ul>
    <p v-else class="empty">暂无建议</p>
  </div>
</template>

<style lang="scss" scoped>
.advice-card {
  padding: 20px;
  background: #fff;
  border: 1px solid #e6f0ea;
  border-radius: 16px;
}

.kicker {
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 600;
  color: #8aa094;
}

ul {
  padding: 0;
  margin: 0;
  list-style: none;

  li {
    padding: 6px 0;
    font-size: 13px;
    line-height: 1.7;
    color: #2c4a3d;

    &::before {
      color: #075e45;
      content: "→ ";
    }
  }
}

.empty {
  margin: 0;
  font-size: 12px;
  color: #8aa094;
}
</style>
