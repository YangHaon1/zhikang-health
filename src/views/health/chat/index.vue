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
const MODE_KEY = "health-ai-mode";

const mode = ref<"rules" | "llm">(
  localStorage.getItem(MODE_KEY) === "llm" ? "llm" : "rules"
);

const llmAvailable = ref(true);
const noKey = computed(() => mode.value === "llm" && !llmAvailable.value);

// 会话历史存服务端
const history = ref<Array<{ role: string; text: string }>>([]);
const loaded = ref(false);
const chatComp = ref<{ resetChat?: () => void }>();

const suggestedQuestions = [
  "我最近血压怎么样",
  "帮我分析一下健康风险",
  "解读我的报告",
  "给我一些生活方式建议"
];

async function handleClearChat() {
  try {
    await ElMessageBox.confirm(
      "将清空服务端保存的全部对话记录，且无法恢复。确定清空吗？",
      "清空对话",
      { type: "warning", confirmButtonText: "清空", cancelButtonText: "取消" }
    );
  } catch {
    return;
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
  <div class="health-chat-page">
    <div class="health-chat-container">
      <div class="chat-header">
        <div class="chat-header-left">
          <div class="chat-title">AI 健康助手</div>
          <div class="chat-subtitle">
            基于您的健康档案与指标记录，解读血压、血糖、血脂并评估健康风险
          </div>
        </div>
        <div class="chat-header-right">
          <el-button
            size="small"
            plain
            :icon="'Delete'"
            @click="handleClearChat"
          >
            清空对话
          </el-button>
          <el-radio-group
            v-model="mode"
            size="small"
            @change="handleModeChange"
          >
            <el-radio-button value="rules">规则引擎</el-radio-button>
            <el-radio-button value="llm">AI 大模型</el-radio-button>
          </el-radio-group>
        </div>
      </div>

      <el-alert
        v-if="noKey"
        type="warning"
        :closable="false"
        show-icon
        title="服务端尚未配置大模型 API Key，「AI 大模型」暂不可用，建议先使用「规则引擎」模式"
        class="mb-3"
      />

      <div class="chat-body">
        <ChatGPT
          v-if="loaded"
          ref="chatComp"
          :history="history"
          :suggested-questions="suggestedQuestions"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.health-chat-page {
  box-sizing: border-box;
  display: flex;
  justify-content: center;
  min-height: calc(100vh - 100px);
  padding: 20px 16px 16px;
}

.health-chat-container {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 800px;
}

.chat-header {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
}

.chat-header-left {
  min-width: 0;
}

.chat-title {
  font-size: 20px;
  font-weight: 600;
  line-height: 1.3;
  color: #111827;
}

.chat-subtitle {
  margin-top: 4px;
  font-size: 13px;
  color: #9ca3af;
}

.chat-header-right {
  display: flex;
  flex-shrink: 0;
  gap: 10px;
  align-items: center;
}

.chat-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  width: 100%;
  min-height: 560px;
}
</style>
