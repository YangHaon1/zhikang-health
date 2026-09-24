<script setup lang="ts">
/** M3 完成页：健康档案已生成（健康类型按已填习惯简单推断，M4 再细化） */
import { computed } from "vue";
import { useRouter } from "vue-router";
import type { HealthProfile } from "@/types/health";

defineOptions({ name: "ProfileComplete" });

const props = defineProps<{ profile: HealthProfile }>();
const router = useRouter();

/** 规则推断健康类型（M4 画像会替换为正式模型） */
const profileType = computed(() => {
  const goals = props.profile.healthGoal?.split(",").filter(Boolean) ?? [];
  if (goals.includes("weight")) return "体重管理型";
  if (props.profile.exerciseHabit === "regular") return "活力运动型";
  if (props.profile.sleepHabit === "good") return "规律作息型";
  return "健康养成型";
});
</script>

<template>
  <div class="complete-card">
    <div class="check-circle">✓</div>
    <h2>你的健康档案已生成</h2>
    <p class="type-line">
      健康类型：<strong>{{ profileType }}</strong>
    </p>
    <p class="ai-line">AI 正在结合你的生活数据生成专属建议…</p>
    <el-button
      type="primary"
      round
      size="large"
      @click="router.push('/health/dashboard')"
    >
      查看健康驾驶舱 →
    </el-button>
  </div>
</template>

<style lang="scss" scoped>
.complete-card {
  max-width: 520px;
  padding: 48px 28px;
  text-align: center;
  background: #fff;
  border: 1px solid #e6f0ea;
  border-radius: 16px;
}

.check-circle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  margin: 0 auto 16px;
  font-size: 28px;
  color: #fff;
  background: #16a34a;
  border-radius: 50%;
}

h2 {
  margin: 0 0 8px;
  font-size: 20px;
  color: #17382c;
}

.type-line {
  margin: 8px 0;
  font-size: 14px;
  color: #2c4a3d;
}

.ai-line {
  margin: 0 0 24px;
  font-size: 12px;
  color: #8aa094;
}
</style>
