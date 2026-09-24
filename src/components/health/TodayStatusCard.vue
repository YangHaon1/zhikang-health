<script setup lang="ts">
/**
 * M2 今日状态卡：展示今日睡眠 / 运动 / 心情 / 饮食，数据与评分卡同来自 /daily/today。
 * 空值显示「未记录」，不做任何本地计算。
 */
import { computed } from "vue";
import {
  DIET_STATUS_TO_TEXT,
  MOOD_SCORE_TO_TEXT,
  type DailyTodayView
} from "@/types/health";

defineOptions({ name: "TodayStatusCard" });

const props = defineProps<{
  today: DailyTodayView["today"] | null;
}>();

const sleepText = computed(() =>
  props.today?.sleepHours != null ? `${props.today.sleepHours} 小时` : "未记录"
);
const exerciseText = computed(() =>
  props.today?.exerciseMinutes != null
    ? `${props.today.exerciseMinutes} 分钟`
    : "未记录"
);
const moodText = computed(() =>
  props.today?.moodScore != null
    ? MOOD_SCORE_TO_TEXT[props.today.moodScore]
    : "未记录"
);
const dietText = computed(() =>
  props.today?.dietStatus
    ? DIET_STATUS_TO_TEXT[props.today.dietStatus]
    : "未记录"
);
</script>

<template>
  <div class="today-status-card">
    <p class="card-kicker">今日状态</p>
    <ul class="status-list">
      <li>
        <span class="status-label">睡眠</span>
        <span class="status-value">{{ sleepText }}</span>
      </li>
      <li>
        <span class="status-label">运动</span>
        <span class="status-value">{{ exerciseText }}</span>
      </li>
      <li>
        <span class="status-label">心情</span>
        <span class="status-value">{{ moodText }}</span>
      </li>
      <li>
        <span class="status-label">饮食</span>
        <span class="status-value">{{ dietText }}</span>
      </li>
    </ul>
  </div>
</template>

<style lang="scss" scoped>
.today-status-card {
  padding: 20px 22px;
  background: #fff;
  border: 1px solid #e6f0ea;
  border-radius: 16px;
}

.card-kicker {
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 600;
  color: #8aa094;
}

.status-list {
  padding: 0;
  margin: 0;
  list-style: none;

  li {
    display: flex;
    justify-content: space-between;
    padding: 6px 0;
    font-size: 13px;
  }
}

.status-label {
  color: #6b7f74;
}

.status-value {
  font-weight: 600;
  color: #17382c;
}
</style>
