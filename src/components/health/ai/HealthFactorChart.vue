<script setup lang="ts">
/**
 * 主要影响因素。
 *
 * 重要：强度必须来自后端真实归因（SHAP 贡献度），前端不做任何"估算"。
 * 旧实现用正则数 problems 文案里关键词出现的次数当强度（count * 50%），
 * 那是在数文案而不是在算贡献，属于伪造的量化结果，已废弃。
 *
 * 数据源优先级：
 *   1. factors —— 后端 SHAP 归因（feature/label/value/direction）
 *   2. problems —— 规则画像文案，仅罗列文字，不画强度条
 *   3. 都没有 —— 显示"暂无分析数据"
 */
import { computed } from "vue";
defineOptions({ name: "HealthFactorChart" });

const props = defineProps<{
  /** 后端 SHAP 归因，value 为归一化后的相对重要度 0-100 */
  factors?: Array<{
    feature: string;
    label: string;
    value: number;
    direction?: string;
  }>;
  /** 规则画像的问题文案（兜底，只罗列不量化） */
  problems?: string[];
}>();

const hasFactors = computed(() => (props.factors ?? []).length > 0);
const hasProblems = computed(() => (props.problems ?? []).length > 0);

const bars = computed(() =>
  (props.factors ?? []).map(f => ({
    ...f,
    width: Math.max(2, Math.min(100, f.value)),
    color:
      f.direction === "risk_up"
        ? "#f59e0b"
        : f.direction === "risk_down"
          ? "#16a34a"
          : "#94a3b8",
    dirText:
      f.direction === "risk_up"
        ? "升高风险"
        : f.direction === "risk_down"
          ? "降低风险"
          : "方向待定"
  }))
);
</script>

<template>
  <div class="factor-card">
    <p class="kicker">主要影响因素</p>

    <!-- 1) 有真实归因：按 SHAP 贡献度画条 -->
    <div v-if="hasFactors" class="bars">
      <div v-for="f in bars" :key="f.feature" class="row">
        <span class="name">{{ f.label }}</span>
        <div class="bar">
          <div
            class="fill"
            :style="{ width: f.width + '%', background: f.color }"
          />
        </div>
        <span class="dir">{{ f.dirText }}</span>
      </div>
      <p class="note">强度来自模型 SHAP 单样本归因，非估算。</p>
    </div>

    <!-- 2) 无归因但有规则文案：只罗列，不编造强度 -->
    <div v-else-if="hasProblems" class="text-list">
      <div v-for="(p, i) in problems" :key="i" class="text-item">· {{ p }}</div>
      <p class="note">本次未获取到量化归因，仅展示规则分析识别出的问题。</p>
    </div>

    <!-- 3) 都没有 -->
    <p v-else class="empty">暂无分析数据，请先完成健康记录与风险预测。</p>
  </div>
</template>

<style lang="scss" scoped>
.factor-card {
  padding: 20px;
  background: #fff;
  border: 1px solid #e6f0ea;
  border-radius: 16px;
}

.kicker {
  margin: 0 0 12px;
  font-size: 12px;
  font-weight: 600;
  color: #8aa094;
}

.row {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 10px;
}

.name {
  width: 72px;
  font-size: 13px;
  color: #2c4a3d;
}

.bar {
  flex: 1;
  height: 8px;
  overflow: hidden;
  background: #eef4f0;
  border-radius: 4px;
}

.fill {
  height: 100%;
  border-radius: 4px;
}

.dir {
  width: 58px;
  font-size: 12px;
  color: #8aa094;
  text-align: right;
}

.text-item {
  font-size: 13px;
  line-height: 1.8;
  color: #2c4a3d;
}

.note {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: #9ca3af;
}

.empty {
  margin: 0;
  font-size: 12px;
  color: #8aa094;
}
</style>
