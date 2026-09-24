<script setup lang="ts">
/** M14 产品成果展示页：比赛答辩专用，纯展示。数据全部来自已有接口，不新增请求逻辑。 */
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { getDailyToday, getHealthReportHistory } from "@/api/health";
import type { DailyTodayView } from "@/types/health";

defineOptions({ name: "HealthShowcase" });

const router = useRouter();
const loading = ref(false);
const today = ref<DailyTodayView["index"] | null>(null);
const reportCount = ref(0);

onMounted(async () => {
  loading.value = true;
  try {
    const [d, h] = await Promise.all([
      getDailyToday(),
      getHealthReportHistory()
    ]);
    if (d.code === 0) today.value = d.data?.index ?? null;
    if (h.code === 0) reportCount.value = (h.data ?? []).length;
  } finally {
    loading.value = false;
  }
});

/** AI 能力矩阵（纯展示入口，全部跳已有页面） */
const caps = [
  {
    icon: "ri:sparkling-2-line",
    title: "AI 健康画像",
    desc: "基于档案与近期数据生成可解释的健康类型",
    to: "/health/ai-profile",
    color: "#4f46e5"
  },
  {
    icon: "ri:radar-line",
    title: "智能风险预测",
    desc: "逐项风险评分，每分扣分都有依据",
    to: "/health/risk",
    color: "#dc2626"
  },
  {
    icon: "ri:chat-3-line",
    title: "AI 健康陪伴",
    desc: "在你的健康数据上下文里回答问题",
    to: "/health/chat",
    color: "#0f766e"
  },
  {
    icon: "ri:file-chart-line",
    title: "健康报告",
    desc: "阶段性综合评估与改善建议",
    to: "/health/report",
    color: "#0e7490"
  }
];

/** 健康闭环流程（纯视觉） */
const loop = ["数据采集", "AI 分析", "风险预测", "健康建议", "持续管理"];

/** 平滑滚动到能力矩阵 */
function scrollToCaps() {
  document
    .getElementById("ai-caps")
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}
</script>

<template>
  <div v-loading="loading" class="showcase-page">
    <!-- 一、产品 Hero -->
    <section class="showcase-hero">
      <p class="hero-kicker">AI Health OS</p>
      <h1>智康健康管理系统</h1>
      <p class="hero-sub">AI 驱动的个人健康管理助手</p>
      <p class="hero-desc">
        通过人工智能分析健康数据，提供风险预测、趋势分析与个性化建议
      </p>
      <div class="hero-tags">
        <span>AI 健康画像</span>
        <span>智能风险预测</span>
        <span>个性化健康建议</span>
      </div>
      <div class="hero-cta">
        <el-button round size="large" @click="router.push('/health/dashboard')">
          立即体验
        </el-button>
        <el-button round size="large" plain @click="scrollToCaps">
          查看 AI 能力
        </el-button>
      </div>
    </section>

    <!-- 二、产品价值三层：感知 / 智能 / 决策 -->
    <section class="value-row">
      <div class="value-card">
        <div class="value-icon sense">
          <iconify-icon icon="ri:heart-pulse-line" width="24" />
        </div>
        <p class="value-layer">感知层</p>
        <h3>健康数据采集</h3>
        <p>记录你的每日健康状态，血压、血糖、睡眠、运动统一沉淀</p>
      </div>
      <div class="value-card">
        <div class="value-icon brain">
          <iconify-icon icon="ri:brain-2-line" width="24" />
        </div>
        <p class="value-layer">智能层</p>
        <h3>AI 健康分析</h3>
        <p>可解释的规则引擎 + 大模型总结，理解你的身体变化</p>
      </div>
      <div class="value-card">
        <div class="value-icon decide">
          <iconify-icon icon="ri:guide-line" width="24" />
        </div>
        <p class="value-layer">决策层</p>
        <h3>个性化健康建议</h3>
        <p>风险预测与目标追踪，帮助制定并坚持健康计划</p>
      </div>
    </section>

    <!-- 二、核心数据（真实接口） -->
    <section class="stat-row">
      <div class="stat-card">
        <div class="stat-num">{{ today?.score ?? "--" }}</div>
        <div class="stat-label">今日健康指数</div>
        <div class="stat-sub">{{ today?.levelText ?? "待记录" }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">{{ reportCount }}</div>
        <div class="stat-label">已生成健康报告</div>
        <div class="stat-sub">份</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">5</div>
        <div class="stat-label">AI 能力模块</div>
        <div class="stat-sub">画像 / 风险 / 陪伴 / 趋势 / 报告</div>
      </div>
    </section>

    <!-- 三、AI 能力矩阵 -->
    <section id="ai-caps" class="showcase-block">
      <h2 class="block-title">AI 能力矩阵</h2>
      <div class="cap-grid">
        <div
          v-for="c in caps"
          :key="c.title"
          class="cap-card"
          :style="{ '--c': c.color }"
          @click="router.push(c.to)"
        >
          <div class="cap-icon"><iconify-icon :icon="c.icon" width="26" /></div>
          <h3>{{ c.title }}</h3>
          <p>{{ c.desc }}</p>
          <span class="cap-go">进入 →</span>
        </div>
      </div>
    </section>

    <!-- 四、健康闭环 -->
    <section class="showcase-block">
      <h2 class="block-title">完整健康管理闭环</h2>
      <div class="loop-flow">
        <template v-for="(s, i) in loop" :key="s">
          <div class="loop-node">{{ s }}</div>
          <div v-if="i < loop.length - 1" class="loop-arrow">↓</div>
        </template>
      </div>
      <el-button
        type="primary"
        round
        size="large"
        class="loop-cta"
        @click="router.push('/health/dashboard')"
      >
        开始体验 →
      </el-button>
    </section>
  </div>
</template>

<style lang="scss" scoped>
.showcase-page {
  max-width: 1080px;
  margin: 0 auto;
  animation: page-in 0.4s ease;
}

@keyframes page-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.showcase-hero {
  padding: 48px 32px;
  margin-bottom: 24px;
  color: #fff;
  text-align: center;
  background:
    radial-gradient(
      circle at 80% 15%,
      rgb(255 255 255 / 20%),
      transparent 14rem
    ),
    linear-gradient(135deg, #075e45, #16a34a 55%, #6366f1);
  border-radius: 24px;
}

.hero-kicker {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.18em;
  opacity: 0.85;
}

.showcase-hero h1 {
  margin: 0;
  font-size: clamp(28px, 4vw, 40px);
  font-weight: 800;
}

.hero-sub {
  margin: 10px 0 0;
  font-size: 18px;
  font-weight: 600;
  opacity: 0.95;
}

.hero-desc {
  max-width: 560px;
  margin: 14px auto 0;
  font-size: 14px;
  line-height: 1.7;
  opacity: 0.9;
}

.hero-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: center;
  margin-top: 22px;

  span {
    padding: 7px 16px;
    font-size: 13px;
    font-weight: 600;
    background: rgb(255 255 255 / 20%);
    border: 1px solid rgb(255 255 255 / 35%);
    border-radius: 999px;
  }
}

.hero-cta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: center;
  margin-top: 26px;

  :deep(.el-button) {
    min-width: 132px;
  }

  :deep(.el-button--plain) {
    color: #fff;
    background: rgb(255 255 255 / 14%);
    border-color: rgb(255 255 255 / 50%);
  }
}

/* 三层价值卡 */
.value-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 28px;
}

.value-card {
  padding: 24px;
  background: #fff;
  border: 1px solid #e6f0ea;
  border-radius: 20px;
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease;

  &:hover {
    box-shadow: 0 16px 34px rgb(79 70 229 / 12%);
    transform: translateY(-4px);
  }

  h3 {
    margin: 8px 0 6px;
    font-size: 16px;
    color: #17382c;
  }

  p:last-child {
    margin: 0;
    font-size: 13px;
    line-height: 1.6;
    color: #6b7f74;
  }
}

.value-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  color: #fff;
  border-radius: 16px;

  &.sense {
    background: linear-gradient(135deg, #16a34a, #4ade80);
  }

  &.brain {
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
  }

  &.decide {
    background: linear-gradient(135deg, #0f766e, #2dd4bf);
  }
}

.value-layer {
  margin: 14px 0 0;
  font-size: 12px;
  font-weight: 700;
  color: #8aa094;
  letter-spacing: 0.1em;
}

.stat-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 28px;
}

.stat-card {
  padding: 24px;
  text-align: center;
  background: #fff;
  border: 1px solid #e6f0ea;
  border-radius: 20px;
}

.stat-num {
  font-size: 44px;
  font-weight: 800;
  line-height: 1;
  color: #0b3b2c;
  letter-spacing: -0.03em;
}

.stat-label {
  margin-top: 8px;
  font-size: 14px;
  font-weight: 700;
  color: #17382c;
}

.stat-sub {
  margin-top: 4px;
  font-size: 12px;
  color: #8aa094;
}

.showcase-block {
  margin-bottom: 28px;
}

.block-title {
  margin: 0 0 16px;
  font-size: 18px;
  font-weight: 700;
  color: #17382c;
}

.cap-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.cap-card {
  padding: 22px;
  cursor: pointer;
  background: #fff;
  border: 1px solid #e6f0ea;
  border-radius: 18px;
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease;

  &:hover {
    box-shadow: 0 14px 30px color-mix(in srgb, var(--c) 16%, transparent);
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

  .cap-go {
    font-size: 12px;
    font-weight: 600;
    color: var(--c, #075e45);
  }
}

.cap-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  color: #fff;
  background: linear-gradient(
    135deg,
    var(--c),
    color-mix(in srgb, var(--c) 60%, #8b5cf6)
  );
  border-radius: 14px;
}

.loop-flow {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: center;
  padding: 28px;
  background: linear-gradient(135deg, #f8fafc, #eef2ff);
  border-radius: 20px;
}

.loop-node {
  padding: 12px 22px;
  font-size: 14px;
  font-weight: 700;
  color: #1e1b4b;
  background: #fff;
  border: 1px solid #e0e7ff;
  border-radius: 999px;
  box-shadow: 0 4px 12px rgb(79 70 229 / 8%);
}

.loop-arrow {
  font-size: 18px;
  color: #6366f1;
}

.loop-cta {
  display: block;
  margin: 20px auto 0;
}

@media (width <= 900px) {
  .stat-row {
    grid-template-columns: 1fr;
  }

  .value-row {
    grid-template-columns: 1fr;
  }

  .cap-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .loop-arrow {
    transform: rotate(90deg);
  }
}

@media (width <= 560px) {
  .cap-grid {
    grid-template-columns: 1fr;
  }
}
</style>
