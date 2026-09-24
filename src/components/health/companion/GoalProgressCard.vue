<script setup lang="ts">
/** M5 目标进度卡 */
import type { GoalProgressView } from "@/types/health";
defineOptions({ name: "GoalProgressCard" });
defineProps<{ goals: GoalProgressView[] }>();
</script>

<template>
  <div class="goal-card">
    <p class="kicker">我的目标</p>
    <template v-if="goals.length">
      <div v-for="g in goals" :key="g.goalType" class="row">
        <div class="line">
          <span class="name">{{ g.label }}</span>
          <span class="num">{{ g.current }} / {{ g.target }}</span>
        </div>
        <el-progress :percentage="g.progress" :stroke-width="8" />
      </div>
    </template>
    <p v-else class="empty">在「我的健康」里选择健康目标后这里会显示进度</p>
  </div>
</template>

<style lang="scss" scoped>
.goal-card {
  padding: 20px;
  background: #fff;
  border: 1px solid #e6f0ea;
  border-radius: 16px;
}

.kicker {
  margin: 0 0 12px;
  font-size: 12px;
  color: #8aa094;
}

.row {
  margin-bottom: 14px;

  &:last-child {
    margin-bottom: 0;
  }
}

.line {
  display: flex;
  justify-content: space-between;
  margin-bottom: 6px;
}

.name {
  font-size: 13px;
  color: #2c4a3d;
}

.num {
  font-size: 12px;
  color: #6b7f74;
}

.empty {
  margin: 0;
  font-size: 12px;
  color: #8aa094;
}
</style>
