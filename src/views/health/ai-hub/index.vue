<script setup lang="ts">
/** M6 AI 能力中心：集中展示 5 个 AI 能力入口 */
import { useRouter } from "vue-router";
defineOptions({ name: "HealthAiHub" });
const router = useRouter();

const caps = [
  {
    icon: "ri:sparkling-2-line",
    title: "AI 健康画像",
    desc: "基于档案与近 7 天数据，生成可解释的健康类型与优势/问题清单",
    to: "/health/ai-profile",
    color: "#075e45"
  },
  {
    icon: "ri:radar-line",
    title: "健康风险预测",
    desc: "规则评分：BMI/睡眠/运动/心情逐项加减，每分扣分都有依据",
    to: "/health/risk",
    color: "#b45309"
  },
  {
    icon: "ri:notification-3-line",
    title: "每日健康总结",
    desc: "每天一份 AI 问候，结合昨日打卡生成今日建议",
    to: "/health/companion",
    color: "#1d4ed8"
  },
  {
    icon: "ri:flag-line",
    title: "目标进度追踪",
    desc: "把你选的健康目标变成可量化的周进度条",
    to: "/health/companion",
    color: "#7c3aed"
  },
  {
    icon: "ri:chat-3-line",
    title: "AI 健康问答",
    desc: "在已有健康数据上下文里回答你的问题",
    to: "/health/chat",
    color: "#0f766e"
  }
];
</script>

<template>
  <div class="ai-hub-page">
    <div class="head">
      <h2>AI 能力中心</h2>
      <p class="sub">
        规则评分可解释 · 大模型只做总结润色 · 所有输出基于你的真实健康数据
      </p>
    </div>

    <div class="grid">
      <div
        v-for="c in caps"
        :key="c.title"
        class="cap-card"
        :style="{ '--cap-color': c.color }"
        @click="router.push(c.to)"
      >
        <span class="cap-ai-badge">AI</span>
        <div
          class="icon"
          :style="{ background: c.color + '15', color: c.color }"
        >
          <iconify-icon :icon="c.icon" width="28" />
        </div>
        <h3>{{ c.title }}</h3>
        <p>{{ c.desc }}</p>
        <span class="go">进入 →</span>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.ai-hub-page {
  max-width: 960px;
  margin: 0 auto;
}

.head {
  margin-bottom: 24px;

  h2 {
    margin: 0 0 6px;
    font-size: 22px;
    color: #17382c;
  }

  .sub {
    margin: 0;
    font-size: 13px;
    color: #6b7f74;
  }
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
}

.cap-card {
  position: relative;
  padding: 22px;
  cursor: pointer;
  background: #fff;
  border: 1px solid #e6f0ea;
  border-radius: 18px;
  transition:
    transform 0.18s,
    box-shadow 0.18s;

  &:hover {
    box-shadow: 0 14px 30px
      color-mix(in srgb, var(--cap-color) 16%, transparent);
    transform: translateY(-4px);
  }

  h3 {
    margin: 12px 0 6px;
    font-size: 15px;
    color: #17382c;
  }

  p {
    margin: 0 0 12px;
    font-size: 12px;
    line-height: 1.6;
    color: #6b7f74;
  }

  .go {
    font-size: 12px;
    font-weight: 600;
    color: var(--cap-color, #075e45);
  }
}

.cap-ai-badge {
  position: absolute;
  top: 16px;
  right: 16px;
  padding: 2px 10px;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  letter-spacing: 0.05em;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border-radius: 999px;
}

.icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 12px;
}
</style>
