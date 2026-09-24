<script setup lang="ts">
/**
 * M3 引导式健康档案：把原「大表单」改造为三步流程
 *  Step1 基础信息 → Step2 生活习惯 → Step3 健康目标 → 完成页
 * 接口仍是 GET/PUT /api/health/profile，原字段/数据库一行未删。
 */
import { ref, reactive, onMounted } from "vue";
import { ElMessage } from "element-plus";
import { getHealthProfile, updateHealthProfile } from "@/api/health";
import type { HealthProfile } from "@/types/health";
import ProfileStepIndicator from "@/components/health/profile/ProfileStepIndicator.vue";
import BasicInfoStep from "@/components/health/profile/BasicInfoStep.vue";
import LifestyleStep from "@/components/health/profile/LifestyleStep.vue";
import GoalStep from "@/components/health/profile/GoalStep.vue";
import ProfileComplete from "@/components/health/profile/ProfileComplete.vue";

defineOptions({ name: "HealthProfile" });

const loading = ref(false);
const saving = ref(false);
const step = ref(1);
const TOTAL = 3;
const stepTitles = ["基础信息", "生活习惯", "健康目标"];

const form = reactive<HealthProfile>({
  name: "",
  gender: 1,
  age: 0,
  height: 0,
  weight: 0,
  waistline: 0,
  medicalHistory: "",
  familyHistory: "",
  allergyHistory: "",
  smoking: "",
  drinking: "",
  exercise: "",
  sleepHabit: "",
  exerciseHabit: "",
  dietHabit: "",
  healthGoal: "",
  createTime: ""
});

/** 是否已完成过引导（有名字且有目标 = 已走完三步） */
function isComplete(): boolean {
  return Boolean(form.name && form.healthGoal);
}

async function loadProfile() {
  loading.value = true;
  try {
    const { code, data } = await getHealthProfile();
    if (code === 0 && data) {
      Object.assign(form, data);
      // 已完成过引导的老用户：直接进完成页，不再强制走流程
      if (isComplete()) step.value = 4;
    }
  } finally {
    loading.value = false;
  }
}

async function save(): Promise<boolean> {
  saving.value = true;
  try {
    const { code } = await updateHealthProfile({ ...form });
    return code === 0;
  } finally {
    saving.value = false;
  }
}

async function next() {
  const ok = await save();
  if (!ok) return;
  if (step.value < TOTAL) {
    step.value += 1;
  } else {
    step.value = 4;
    ElMessage.success("健康档案已保存");
  }
}

function back() {
  if (step.value > 1) step.value -= 1;
}

onMounted(loadProfile);
</script>

<template>
  <div v-loading="loading" class="profile-guide">
    <ProfileStepIndicator
      v-if="step < 4"
      :step="step"
      :total="TOTAL"
      :titles="stepTitles"
    />

    <BasicInfoStep v-if="step === 1" v-model="form" />
    <LifestyleStep v-else-if="step === 2" v-model="form" />
    <GoalStep v-else-if="step === 3" v-model="form" />
    <ProfileComplete v-else :profile="form" />

    <div v-if="step < 4" class="nav-row">
      <el-button v-if="step > 1" @click="back">上一步</el-button>
      <el-button type="primary" round :loading="saving" @click="next">
        {{ step === TOTAL ? "完成" : "下一步" }}
      </el-button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.profile-guide {
  max-width: 640px;
  margin: 0 auto;
}

.nav-row {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  max-width: 520px;
  margin-top: 20px;
}
</style>
