<script setup lang="ts">
/** M4 影响因素：从 problems 文案归类（睡眠/运动/体重/情绪），简单条形展示 */
import { computed } from "vue";
defineOptions({ name: "HealthFactorChart" });

const props = defineProps<{ problems: string[] }>();

const factors = computed(() => {
  const keys = [
    { key: "睡眠", match: /睡眠/ },
    { key: "运动", match: /运动/ },
    { key: "体重", match: /BMI/ },
    { key: "情绪", match: /情绪/ }
  ];
  return keys
    .map(k => ({
      name: k.key,
      count: props.problems.filter(p => k.match.test(p)).length
    }))
    .filter(f => f.count > 0);
});
</script>

<template>
  <div class="factor-card">
    <p class="kicker">主要影响因素</p>
    <div v-if="factors.length" class="bars">
      <div v-for="f in factors" :key="f.name" class="row">
        <span class="name">{{ f.name }}</span>
        <div class="bar">
          <div
            class="fill"
            :style="{ width: Math.min(100, f.count * 50) + '%' }"
          />
        </div>
      </div>
    </div>
    <p v-else class="empty">未发现明显风险因素</p>
  </div>
</template>

<style lang="scss" scoped>
.factor-card {
  padding: 20px;
  background: #fff;
  border: 1px solid #e6f0ea;
  border-radius: 16px;
}

.kicker {
  margin: 0 0 12px;
  font-size: 12px;
  font-weight: 600;
  color: #8aa094;
}

.row {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 10px;
}

.name {
  width: 40px;
  font-size: 13px;
  color: #2c4a3d;
}

.bar {
  flex: 1;
  height: 8px;
  overflow: hidden;
  background: #eef4f0;
  border-radius: 4px;
}

.fill {
  height: 100%;
  background: #f59e0b;
  border-radius: 4px;
}

.empty {
  margin: 0;
  font-size: 12px;
  color: #8aa094;
}
</style>
