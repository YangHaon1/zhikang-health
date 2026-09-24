<script setup lang="ts">
/** M3 Step3：健康目标多选（逗号分隔存 healthGoal） */
import type { HealthProfile } from "@/types/health";

defineOptions({ name: "GoalStep" });

const props = defineProps<{ modelValue: HealthProfile }>();
const emit = defineEmits<{
  (e: "update:modelValue", v: HealthProfile): void;
}>();

function set<K extends keyof HealthProfile>(key: K, val: HealthProfile[K]) {
  emit("update:modelValue", { ...props.modelValue, [key]: val });
}

const goals = [
  { value: "weight", label: "控制体重", icon: "⚖️" },
  { value: "exercise", label: "提升运动能力", icon: "🏃" },
  { value: "sleep", label: "改善睡眠", icon: "😴" },
  { value: "stress", label: "管理压力", icon: "🧘" },
  { value: "keep", label: "保持健康", icon: "💚" }
];

const selected = () =>
  props.modelValue.healthGoal
    ? props.modelValue.healthGoal.split(",").filter(Boolean)
    : [];

function toggle(value: string) {
  const cur = selected();
  const next = cur.includes(value)
    ? cur.filter(g => g !== value)
    : [...cur, value];
  emit("update:modelValue", {
    ...props.modelValue,
    healthGoal: next.join(",")
  });
}
</script>

<template>
  <div class="step-card">
    <h2 class="step-title">你希望改善什么？</h2>
    <p class="hint">可多选，AI 会据此调整建议方向</p>

    <div class="goal-grid">
      <button
        v-for="g in goals"
        :key="g.value"
        type="button"
        class="goal-item"
        :class="{ picked: selected().includes(g.value) }"
        @click="toggle(g.value)"
      >
        <span class="goal-icon">{{ g.icon }}</span>
        <span class="goal-label">{{ g.label }}</span>
      </button>
    </div>

    <el-form label-position="top" class="desc-form">
      <el-form-item label="目标描述（选填）">
        <el-input
          :model-value="modelValue.goalDescription"
          placeholder="例如：希望 3 个月减重 5kg"
          maxlength="100"
          type="textarea"
          :rows="2"
          @update:model-value="v => set('goalDescription', String(v))"
        />
      </el-form-item>
    </el-form>
  </div>
</template>

<style lang="scss" scoped>
.step-card {
  max-width: 520px;
  padding: 28px;
  background: #fff;
  border: 1px solid #e6f0ea;
  border-radius: 16px;
}

.step-title {
  margin: 0 0 6px;
  font-size: 20px;
  color: #17382c;
}

.hint {
  margin: 0 0 20px;
  font-size: 12px;
  color: #8aa094;
}

.goal-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.goal-item {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 16px;
  font-size: 14px;
  color: #2c4a3d;
  cursor: pointer;
  background: #fafdfb;
  border: 2px solid #e6f0ea;
  border-radius: 12px;
  transition: all 0.15s;

  &:hover {
    border-color: #b9d8c5;
  }

  &.picked {
    color: #075e45;
    background: #f0f7f3;
    border-color: #075e45;
  }
}

.goal-icon {
  font-size: 20px;
}

.desc-form {
  margin-top: 20px;
}
</style>
