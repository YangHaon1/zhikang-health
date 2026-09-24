<script setup lang="ts">
/** M3 Step1：基础信息（姓名/年龄/性别/身高/体重 全部数字/文本输入，自动算 BMI） */
import { computed } from "vue";
import type { HealthProfile } from "@/types/health";

defineOptions({ name: "BasicInfoStep" });

const props = defineProps<{ modelValue: HealthProfile }>();
const emit = defineEmits<{
  (e: "update:modelValue", v: HealthProfile): void;
}>();

function set<K extends keyof HealthProfile>(key: K, val: HealthProfile[K]) {
  emit("update:modelValue", { ...props.modelValue, [key]: val });
}

const bmi = computed(() => {
  const h = props.modelValue.height;
  const w = props.modelValue.weight;
  if (!h || !w) return null;
  return Number((w / Math.pow(h / 100, 2)).toFixed(1));
});

const bmiText = computed(() => {
  if (bmi.value === null) return "填写身高体重后自动计算";
  const b = bmi.value;
  if (b < 18.5) return `BMI ${b} · 偏瘦`;
  if (b < 24) return `BMI ${b} · 正常`;
  if (b < 28) return `BMI ${b} · 超重`;
  return `BMI ${b} · 肥胖`;
});
</script>

<template>
  <div class="step-card">
    <h2 class="step-title">你的基础信息</h2>

    <el-form label-position="top">
      <el-form-item label="姓名 / 昵称">
        <el-input
          :model-value="modelValue.name"
          placeholder="怎么称呼你？"
          maxlength="20"
          @update:model-value="v => set('name', String(v))"
        />
      </el-form-item>

      <el-form-item label="年龄">
        <el-input-number
          :model-value="modelValue.age || 0"
          :min="1"
          :max="120"
          :step="1"
          controls-position="right"
          @update:model-value="v => set('age', Number(v))"
        />
        <span class="unit">岁</span>
      </el-form-item>

      <el-form-item label="性别">
        <el-radio-group
          :model-value="modelValue.gender"
          @update:model-value="v => set('gender', Number(v))"
        >
          <el-radio-button :value="1">男</el-radio-button>
          <el-radio-button :value="0">女</el-radio-button>
        </el-radio-group>
      </el-form-item>

      <el-form-item label="身高">
        <el-input-number
          :model-value="modelValue.height || 0"
          :min="120"
          :max="220"
          :step="1"
          controls-position="right"
          @update:model-value="v => set('height', Number(v))"
        />
        <span class="unit">cm</span>
      </el-form-item>

      <el-form-item label="体重">
        <el-input-number
          :model-value="modelValue.weight || 0"
          :min="30"
          :max="200"
          :step="0.5"
          controls-position="right"
          @update:model-value="v => set('weight', Number(v))"
        />
        <span class="unit">kg</span>
      </el-form-item>
    </el-form>

    <p class="bmi-hint">{{ bmiText }}</p>
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

.unit {
  margin-left: 8px;
  font-size: 13px;
  color: #8aa094;
}

.bmi-hint {
  padding: 10px 14px;
  margin: 8px 0 0;
  font-size: 13px;
  color: #075e45;
  background: #f0f7f3;
  border-radius: 8px;
}
</style>
