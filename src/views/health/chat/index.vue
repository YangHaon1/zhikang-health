<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessageBox } from "element-plus";
import { message } from "@/utils/message";
import {
  clearHealthChatHistory,
  getHealthChatConfig,
  getHealthChatHistory
} from "@/api/health";
import { ChatGPT } from "./components";

defineOptions({
  name: "HealthChat"
});

// A/B 模式：rules（规则引擎，默认）/ llm（真实大模型）
// 切换只写 localStorage，需刷新页面后才生效（deep-chat 连接目标在挂载时确定，不做运行时热切换）
const MODE_KEY = "health-ai-mode";

const mode = ref<"rules" | "llm">(
  localStorage.getItem(MODE_KEY) === "llm" ? "llm" : "rules"
);

// 方案 B 的 Key 在服务端，前端只能问「能不能用」；未配置时给出降级提示
const llmAvailable = ref(true);
const noKey = computed(() => mode.value === "llm" && !llmAvailable.value);

// 会话历史存服务端（chat_history 表）：换浏览器、重启服务后仍能恢复
const history = ref<Array<{ role: string; text: string }>>([]);
const loaded = ref(false);

// 子组件（ChatGPT）实例：清空对话时调用其 resetChat()
const chatComp = ref<{ resetChat?: () => void }>();

/** 清空对话历史（P1-6）：服务端删除 + 前端重置会话，幂等 */
async function handleClearChat() {
  try {
    await ElMessageBox.confirm(
      "将清空服务端保存的全部对话记录，且无法恢复。确定清空吗？",
      "清空对话",
      { type: "warning", confirmButtonText: "清空", cancelButtonText: "取消" }
    );
  } catch {
    return; // 用户取消
  }
  const res = await clearHealthChatHistory();
  if (res?.code === 0) {
    history.value = [];
    chatComp.value?.resetChat?.();
    message("对话历史已清空", { type: "success" });
  }
}

onMounted(async () => {
  try {
    const [cfg, his] = await Promise.all([
      getHealthChatConfig(),
      getHealthChatHistory()
    ]);
    if (cfg?.code === 0 && cfg.data) llmAvailable.value = cfg.data.llmAvailable;
    if (his?.code === 0 && Array.isArray(his.data)) history.value = his.data;
  } finally {
    // 拉取失败也放行渲染，不阻断对话
    loaded.value = true;
  }
});

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
        <div class="flex items-center gap-3">
          <el-button size="small" :icon="'Delete'" @click="handleClearChat">
            清空对话
          </el-button>
          <el-radio-group v-model="mode" @change="handleModeChange">
            <el-radio-button value="rules">规则引擎</el-radio-button>
            <el-radio-button value="llm">AI 大模型</el-radio-button>
          </el-radio-group>
        </div>
      </div>
    </template>

    <el-alert
      v-if="noKey"
      type="warning"
      :closable="false"
      show-icon
      title="服务端尚未配置大模型 API Key（server/.env 的 LLM_API_KEY），「AI 大模型」暂不可用，建议先使用「规则引擎」模式"
      class="mb-3"
    />

    <ChatGPT v-if="loaded" ref="chatComp" :history="history" />
  </el-card>
</template>
