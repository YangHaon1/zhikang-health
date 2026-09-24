<script setup lang="ts">
/** 统一 AI 标识：所有 AI 生成内容顶部展示，明确"非医疗诊断" */
defineOptions({ name: "AiBadge" });
</script>

<template>
  <span class="ai-badge">AI 辅助分析 · 基于您的健康数据生成</span>
</template>

<style lang="scss" scoped>
.ai-badge {
  display: inline-block;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 500;
  color: #075e45;
  background: #e6f4ec;
  border: 1px solid #b8dcc8;
  border-radius: 999px;
}
</style>
