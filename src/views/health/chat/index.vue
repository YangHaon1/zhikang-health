<script setup lang="ts">
import { computed, ref } from "vue";
import { message } from "@/utils/message";
import { ChatGPT } from "./components";

defineOptions({
  name: "HealthChat"
});

// A/B 模式：rules（规则引擎，默认）/ llm（真实大模型）
// 切换只写 localStorage，需刷新页面后才生效（deep-chat 连接目标在挂载时确定，不做运行时热切换）
const MODE_KEY = "health-ai-mode";
const LLM_KEY = (import.meta.env.VITE_LLM_API_KEY as string) || "";

const mode = ref<"rules" | "llm">(
  localStorage.getItem(MODE_KEY) === "llm" ? "llm" : "rules"
);

const noKey = computed(() => mode.value === "llm" && !LLM_KEY);

function handleModeChange(next: string | number | boolean) {
  const value = (next as string) === "llm" ? "llm" : "rules";
  localStorage.setItem(MODE_KEY, value);
  message(
    value === "rules"
      ? "已切换为「规则引擎」模式，刷新页面后生效"
      : "已切换为「AI 大模型」模式，刷新页面后生效",
    { type: "success" }
  );
}
</script>

<template>
  <el-card shadow="never">
    <template #header>
      <div class="flex-bc flex-wrap gap-3">
        <div>
          <div class="font-medium">AI 健康助手</div>
          <div class="text-xs text-gray-400 mt-1">
            基于您的健康档案与指标记录，解读血压、血糖、血脂并评估健康风险
          </div>
        </div>
        <el-radio-group v-model="mode" @change="handleModeChange">
          <el-radio-button value="rules">规则引擎</el-radio-button>
          <el-radio-button value="llm">AI 大模型</el-radio-button>
        </el-radio-group>
      </div>
    </template>

    <el-alert
      v-if="noKey"
      type="warning"
      :closable="false"
      show-icon
      title="尚未配置 API Key（.env.local 的 VITE_LLM_API_KEY），「AI 大模型」待 Key 实测，建议先使用「规则引擎」模式"
      class="mb-3"
    />

    <ChatGPT />
  </el-card>
</template>
