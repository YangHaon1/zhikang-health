<script setup lang="ts">
/** M5 今日建议卡 */
import AiBadge from "@/components/health/AiBadge.vue";
defineOptions({ name: "SuggestionCard" });
defineProps<{ suggestions: string[] }>();
</script>

<template>
  <div class="sug-card">
    <AiBadge />
    <p class="kicker">今日建议</p>
    <ul v-if="suggestions.length">
      <li v-for="(s, i) in suggestions" :key="i">{{ s }}</li>
    </ul>
    <p v-else class="empty">保持当前节奏</p>
  </div>
</template>

<style lang="scss" scoped>
.sug-card {
  padding: 20px;
  background: #fff;
  border: 1px solid #e6f0ea;
  border-radius: 16px;
}

.kicker {
  margin: 0 0 10px;
  font-size: 12px;
  color: #8aa094;
}

ul {
  padding: 0;
  margin: 0;
  list-style: none;

  li {
    padding: 4px 0;
    font-size: 13px;
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
