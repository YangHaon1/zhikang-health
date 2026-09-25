<script setup lang="ts">
/** M4 AI 健康画像页：读已有画像，无则引导点「生成画像」 */
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { getAiProfile, generateAiProfile } from "@/api/health";
import type { AiProfileView } from "@/types/health";
import HealthProfileCard from "@/components/health/ai/HealthProfileCard.vue";
import AIAdviceList from "@/components/health/ai/AIAdviceList.vue";

defineOptions({ name: "HealthAiProfile" });

const router = useRouter();
const loading = ref(false);
const generating = ref(false);
const profile = ref<AiProfileView | null>(null);

/** AI 分析过程步骤（纯展示） */
// 与报告页保持一致的三段真实状态文案（不再叫"AI 生成过程"）
const steps = ["数据分析完成", "风险计算完成", "建议生成完成"];

async function load() {
  loading.value = true;
  try {
    const { code, data } = await getAiProfile();
    if (code === 0) profile.value = data;
  } finally {
    loading.value = false;
  }
}

async function generate() {
  generating.value = true;
  try {
    const { code, data } = await generateAiProfile();
    if (code === 0) {
      profile.value = data;
      ElMessage.success("AI 画像已生成");
    } else {
      ElMessage.error((data as any)?.message || "生成失败");
    }
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || "AI 生成失败，请稍后重试");
  } finally {
    generating.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div v-loading="loading" class="ai-profile-page">
    <template v-if="profile">
      <!--
        分析状态：画像由后端一次生成（规则引擎 + 大模型润色总结），
        这里只反映"已完成 / 正在生成"的真实状态，不模拟分步进度与百分比。
      -->
      <div class="process-steps">
        <template v-for="(s, i) in steps" :key="s">
          <div class="step" :class="{ done: !generating }">
            <span class="step-dot">{{ generating ? "…" : i + 1 }}</span>
            <span class="step-label">{{ s }}</span>
          </div>
          <div v-if="i < steps.length - 1" class="step-line" />
        </template>
      </div>
      <p class="profile-note">
        画像由规则引擎基于健康档案与近 7 天记录计算，大模型仅用于润色总结文案。
      </p>

      <HealthProfileCard :profile="profile" />
      <AIAdviceList :advice="profile.suggestions" />
      <p class="summary">{{ profile.aiSummary }}</p>
      <div class="nav-row">
        <el-button round :loading="generating" @click="generate"
          >重新分析</el-button
        >
        <el-button
          type="primary"
          round
          @click="router.push('/health/dashboard')"
        >
          返回驾驶舱
        </el-button>
      </div>
    </template>

    <el-empty v-else description="还没有 AI 画像">
      <el-button type="primary" round :loading="generating" @click="generate">
        生成我的 AI 画像
      </el-button>
    </el-empty>
  </div>
</template>

<style lang="scss" scoped>
.ai-profile-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 720px;
  margin: 0 auto;
}

.summary {
  padding: 14px 16px;
  font-size: 13px;
  line-height: 1.7;
  color: #2c4a3d;
  background: #f0f7f3;
  border-radius: 10px;
}

.nav-row {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

/* 分析状态步骤（真实状态，非伪进度） */
.process-steps {
  display: flex;
  gap: 0;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: #fff;
  border: 1px solid #e6f0ea;
  border-radius: 16px;
}

.profile-note {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: #9ca3af;
  text-align: center;
}

.step {
  display: flex;
  gap: 8px;
  align-items: center;
}

.step-dot {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border-radius: 50%;
}

.step-label {
  font-size: 14px;
  font-weight: 600;
  color: #1e1b4b;
}

.step-line {
  width: 40px;
  height: 2px;
  margin: 0 12px;
  background: linear-gradient(90deg, #6366f1, #a5b4fc);
  border-radius: 2px;
}
</style>
