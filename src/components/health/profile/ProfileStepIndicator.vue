<script setup lang="ts">
/** M3 步骤指示器：3 步进度点 + 当前步标题 */
defineOptions({ name: "ProfileStepIndicator" });

defineProps<{
  step: number;
  total: number;
  titles: string[];
}>();
</script>

<template>
  <div class="step-indicator">
    <div class="steps">
      <div
        v-for="(t, i) in titles"
        :key="t"
        class="step"
        :class="{ done: i + 1 < step, active: i + 1 === step }"
      >
        <span class="dot">{{ i + 1 < step ? "✓" : i + 1 }}</span>
        <span class="label">{{ t }}</span>
      </div>
    </div>
    <p class="progress-text">
      档案完善进度：{{ Math.round((step / (total + 1)) * 100) }}%
    </p>
  </div>
</template>

<style lang="scss" scoped>
.step-indicator {
  margin-bottom: 24px;
}

.steps {
  display: flex;
  gap: 8px;
  align-items: center;
}

.step {
  display: flex;
  gap: 8px;
  align-items: center;

  .dot {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    font-size: 12px;
    font-weight: 700;
    color: #8aa094;
    background: #eef4f0;
    border-radius: 50%;
  }

  .label {
    font-size: 13px;
    color: #8aa094;
  }

  &.active .dot {
    color: #fff;
    background: #075e45;
  }

  &.active .label {
    font-weight: 600;
    color: #17382c;
  }

  &.done .dot {
    color: #fff;
    background: #16a34a;
  }
}

.progress-text {
  margin: 10px 0 0;
  font-size: 12px;
  color: #8aa094;
}
</style>
