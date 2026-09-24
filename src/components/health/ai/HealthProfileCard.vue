<script setup lang="ts">
/** M4 画像主卡：健康类型 + 评分 + 优势/问题清单 */
import type { AiProfileView } from "@/types/health";
import AiBadge from "@/components/health/AiBadge.vue";
defineOptions({ name: "HealthProfileCard" });
defineProps<{ profile: AiProfileView }>();
</script>

<template>
  <div class="profile-card">
    <AiBadge />
    <p class="kicker">我的 AI 健康画像</p>
    <h2 class="type">{{ profile.healthType }}</h2>
    <p class="score-line">
      健康分 <strong>{{ profile.healthScore }}</strong> ·
      <span :class="['level', profile.riskLevel]">{{ profile.riskLevel }}</span>
    </p>

    <div class="cols">
      <div>
        <p class="col-title">优势</p>
        <ul v-if="profile.advantages.length">
          <li v-for="a in profile.advantages" :key="a">✓ {{ a }}</li>
        </ul>
        <p v-else class="empty">—</p>
      </div>
      <div>
        <p class="col-title warn">需要关注</p>
        <ul v-if="profile.problems.length">
          <li v-for="p in profile.problems" :key="p">! {{ p }}</li>
        </ul>
        <p v-else class="empty">各项正常</p>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.profile-card {
  padding: 24px;
  background: #fff;
  border: 1px solid #e6f0ea;
  border-radius: 16px;
}

.kicker {
  margin: 0 0 6px;
  font-size: 12px;
  color: #8aa094;
}

.type {
  margin: 0 0 6px;
  font-size: 24px;
  color: #17382c;
}

.score-line {
  margin: 0 0 18px;
  font-size: 14px;
  color: #6b7f74;

  strong {
    font-size: 22px;
    color: #17382c;
  }
}

.level {
  font-weight: 600;
}

.level.低风险 {
  color: #16a34a;
}

.level.中风险 {
  color: #f59e0b;
}

.level.高风险 {
  color: #dc2626;
}

.cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.col-title {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 700;
  color: #075e45;

  &.warn {
    color: #b45309;
  }
}

ul {
  padding: 0;
  margin: 0;
  list-style: none;

  li {
    padding: 3px 0;
    font-size: 13px;
    color: #2c4a3d;
  }
}

.empty {
  margin: 0;
  font-size: 12px;
  color: #8aa094;
}
</style>
