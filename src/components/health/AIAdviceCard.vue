<script setup lang="ts">
/**
 * M2 AI 建议卡：直接展示后端 /daily/today 返回的 advice[]，
 * 文字由服务端规则生成（断网可用），前端不二次加工。
 */
defineOptions({ name: "AIAdviceCard" });

defineProps<{
  advice: string[];
}>();
</script>

<template>
  <div class="ai-advice-card">
    <p class="card-kicker">
      <span class="ai-badge">AI</span>
      健康建议
    </p>
    <ul v-if="advice.length" class="advice-list">
      <li v-for="(a, i) in advice" :key="i">{{ a }}</li>
    </ul>
    <p v-else class="advice-empty">记录几天数据后，这里会给出个性化建议。</p>
  </div>
</template>

<style lang="scss" scoped>
.ai-advice-card {
  padding: 20px 22px;
  background: linear-gradient(135deg, #f0f7f3 0%, #fff 100%);
  border: 1px solid #d8e8df;
  border-radius: 16px;
}

.card-kicker {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 600;
  color: #8aa094;
}

.ai-badge {
  padding: 1px 8px;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  background: #075e45;
  border-radius: 6px;
}

.advice-list {
  padding: 0;
  margin: 0;
  list-style: none;

  li {
    padding: 6px 0;
    font-size: 13px;
    line-height: 1.7;
    color: #2c4a3d;

    &::before {
      margin-right: 6px;
      font-weight: 700;
      color: #075e45;
      content: "·";
    }
  }
}

.advice-empty {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: #8aa094;
}
</style>
