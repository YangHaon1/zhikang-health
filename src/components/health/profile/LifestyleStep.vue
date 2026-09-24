<script setup lang="ts">
/** M3 Step2：生活习惯（单选保留 + 数值输入：睡眠小时/运动次数/每次时长） */
import type { HealthProfile } from "@/types/health";

defineOptions({ name: "LifestyleStep" });

const props = defineProps<{ modelValue: HealthProfile }>();
const emit = defineEmits<{
  (e: "update:modelValue", v: HealthProfile): void;
}>();

function set<K extends keyof HealthProfile>(key: K, val: HealthProfile[K]) {
  emit("update:modelValue", { ...props.modelValue, [key]: val });
}

const sleepQualityOptions = [
  { value: "good", label: "好" },
  { value: "normal", label: "一般" },
  { value: "poor", label: "差" }
];

const dietOptions = [
  { value: "good", label: "健康均衡" },
  { value: "normal", label: "偏油腻" },
  { value: "poor", label: "不规律" }
];
</script>

<template>
  <div class="step-card">
    <h2 class="step-title">你的生活习惯</h2>

    <div class="q">
      <p class="q-label">睡眠</p>
      <div class="row">
        <el-input-number
          :model-value="modelValue.sleepHours || 0"
          :min="0"
          :max="16"
          :step="0.5"
          controls-position="right"
          @update:model-value="v => set('sleepHours', Number(v))"
        />
        <span class="unit">平均睡眠时间（小时/天）</span>
      </div>
      <div class="row">
        <el-radio-group
          :model-value="modelValue.sleepHabit"
          @update:model-value="v => set('sleepHabit', String(v))"
        >
          <el-radio-button
            v-for="o in sleepQualityOptions"
            :key="o.value"
            :value="o.value"
            >{{ o.label }}</el-radio-button
          >
        </el-radio-group>
        <span class="unit">睡眠质量</span>
      </div>
    </div>

    <div class="q">
      <p class="q-label">运动</p>
      <div class="row">
        <el-input-number
          :model-value="modelValue.exerciseFrequency || 0"
          :min="0"
          :max="14"
          :step="1"
          controls-position="right"
          @update:model-value="v => set('exerciseFrequency', Number(v))"
        />
        <span class="unit">每周运动次数</span>
      </div>
    </div>

    <div class="q">
      <p class="q-label">饮食</p>
      <el-radio-group
        :model-value="modelValue.dietHabit"
        @update:model-value="v => set('dietHabit', String(v))"
      >
        <el-radio-button
          v-for="o in dietOptions"
          :key="o.value"
          :value="o.value"
          >{{ o.label }}</el-radio-button
        >
      </el-radio-group>
    </div>
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
  margin: 0 0 20px;
  font-size: 20px;
  color: #17382c;
}

.q {
  margin-bottom: 22px;
}

.q-label {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 600;
  color: #2c4a3d;
}

.row {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 10px;
}

.unit {
  font-size: 13px;
  color: #8aa094;
}
</style>
