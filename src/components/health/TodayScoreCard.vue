<script setup lang="ts">
/**
 * M2 今日健康评分卡：只展示后端 GET /api/health/daily/today 返回的 index，
 * 不在前端重新计算，也不做颜色等级判断。视觉为环形进度 + 数字动画。
 */
import { computed } from "vue";
import type { DailyTodayView } from "@/types/health";

const props = defineProps<{
  index: DailyTodayView["index"] | null;
}>();

const R = 44;
const CIRC = 2 * Math.PI * R;

/** 环的 dash 比例（0~100） */
const dash = computed(() => {
  const s = props.index?.score ?? 0;
  return `${(CIRC * Math.min(100, Math.max(0, s))) / 100} ${CIRC}`;
});

/** 环比上周变化文案 */
const deltaText = computed(() => {
  const d = props.index?.delta;
  if (d == null) return "";
  return d >= 0 ? `较上周 +${d}` : `较上周 ${d}`;
});
</script>

<template>
  <div class="today-score-card">
    <p class="card-kicker">今日健康指数</p>
    <div class="score-main">
      <div class="ring" :class="{ empty: !index }">
        <svg width="112" height="112" viewBox="0 0 112 112">
          <circle class="ring-bg" cx="56" cy="56" :r="R" />
          <circle
            class="ring-fg"
            cx="56"
            cy="56"
            :r="R"
            :stroke-dasharray="index ? dash : '0 999'"
          />
        </svg>
        <div class="ring-center">
          <span class="score-num">{{ index?.score ?? "--" }}</span>
        </div>
      </div>
      <div class="score-meta">
        <span class="score-level">{{ index?.levelText ?? "待记录" }}</span>
        <span v-if="deltaText" class="score-delta">{{ deltaText }}</span>
      </div>
    </div>

    <div v-if="index && index.adjustments.length" class="adjust-tags">
      <p class="adjust-title">评分来源</p>
      <el-tag
        v-for="a in index.adjustments"
        :key="a.label"
        size="small"
        :type="a.delta >= 0 ? 'success' : 'danger'"
        effect="plain"
      >
        {{ a.label }} {{ a.delta >= 0 ? "+" : "" }}{{ a.delta }}
      </el-tag>
    </div>
    <p v-else class="adjust-hint">记录今日睡眠 / 运动后生成指数</p>
  </div>
</template>

<style lang="scss" scoped>
.today-score-card {
  padding: 20px 22px;
  background: linear-gradient(160deg, #fff, #f3faf6);
  border: 1px solid #e6f0ea;
  border-radius: 16px;

  :deep(.el-tag) {
    margin: 0 6px 6px 0;
  }
}

.card-kicker {
  margin: 0 0 12px;
  font-size: 12px;
  font-weight: 600;
  color: #8aa094;
}

.score-main {
  display: flex;
  gap: 20px;
  align-items: center;
}

.ring {
  position: relative;
  flex: none;
  width: 112px;
  height: 112px;

  svg {
    transform: rotate(-90deg);
  }
}

.ring-bg {
  fill: none;
  stroke: #e6f0ea;
  stroke-width: 9;
}

.ring-fg {
  fill: none;
  stroke: #16a34a;
  stroke-width: 9;
  stroke-linecap: round;
  transition: stroke-dasharray 0.9s ease;
}

.ring-center {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.score-num {
  font-size: 34px;
  font-weight: 800;
  line-height: 1;
  color: #0b3b2c;
  letter-spacing: -0.04em;
}

.score-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.score-level {
  font-size: 18px;
  font-weight: 700;
  color: #075e45;
}

.score-delta {
  font-size: 12px;
  font-weight: 600;
  color: #16a34a;
}

.adjust-tags {
  margin-top: 14px;
}

.adjust-title {
  margin: 0 0 6px;
  font-size: 11px;
  color: #8aa094;
}

.adjust-hint {
  margin: 14px 0 0;
  font-size: 12px;
  color: #8aa094;
}
</style>
