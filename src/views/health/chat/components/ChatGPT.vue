<script setup lang="ts">
import "deep-chat";
import { onMounted, ref } from "vue";

// AI 健康助手对话组件（保留 ChatGPT 风格皮肤）
const chatRef = ref();

// ---------- A/B 模式（页面加载时读取，运行时不做热切换） ----------
const MODE_KEY = "health-ai-mode";
const HISTORY_KEY = "health-chat-history";
// 方案 B 目标：火山方舟豆包模型（OpenAI 兼容），待配置 VITE_LLM_API_KEY 实测
const LLM_MODEL = "doubao-1-5-pro-32k-250115";
const LLM_KEY = (import.meta.env.VITE_LLM_API_KEY as string) || "";

const isLlm = localStorage.getItem(MODE_KEY) === "llm";

// 请求目标：方案 A 规则引擎 /health/chat；方案 B 真实大模型 /llm-api（走 vite 代理）
const connect = isLlm
  ? {
      url: "/llm-api/api/v3/chat/completions",
      method: "POST",
      headers: { Authorization: `Bearer ${LLM_KEY}` },
      additionalBodyProps: { model: LLM_MODEL },
      stream: false
    }
  : {
      url: "/health/chat",
      method: "POST",
      stream: false
    };

// ---------- 对话历史（消息写入 localStorage，挂载时用 history 恢复） ----------
function loadHistory(): Array<{ role: string; text: string }> {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

const history = loadHistory();

function persist() {
  const msgs = (chatRef.value?.getMessages?.() ?? [])
    .map((m: any) => ({ role: m.role ?? "user", text: m.text ?? "" }))
    .filter((m: { text: string }) => m.text)
    .slice(-50); // 最多保留最近 50 条，避免无限增长
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(msgs));
  } catch {
    // 忽略存储异常
  }
}

function handleMessage(body: { message: any; isHistory: boolean }) {
  if (body.isHistory) return; // 恢复历史时不重复写入
  persist();
}

onMounted(() => {
  chatRef.value.onMessage = handleMessage;
});

// ---------- 响应解析：方案 A 返回 { code, data }；方案 B 返回 OpenAI { choices } ----------
function responseInterceptor(response: any) {
  if (response && typeof response.data === "string") {
    return { text: response.data };
  }
  const content = response?.choices?.[0]?.message?.content;
  if (content) return { text: content };
  const err = response?.message || response?.error?.message;
  if (err) return { error: String(err) };
  return { text: "（未获取到有效回答）" };
}
</script>

<template>
  <deep-chat
    ref="chatRef"
    style="border-radius: 10px"
    :messageStyles="{
      default: {
        shared: {
          bubble: {
            maxWidth: '100%',
            backgroundColor: 'unset',
            marginTop: '10px',
            marginBottom: '10px'
          }
        },
        user: {
          bubble: {
            marginLeft: '0px',
            color: 'black'
          }
        },
        ai: {
          outerContainer: {
            backgroundColor: 'rgba(247,247,248)',
            borderTop: '1px solid rgba(0,0,0,.1)',
            borderBottom: '1px solid rgba(0,0,0,.1)'
          }
        }
      }
    }"
    :avatars="{
      default: { styles: { position: 'start' } }
    }"
    :submitButtonStyles="{
      submit: {
        container: {
          default: {
            padding: '1px 0 0 5px',
            backgroundColor: '#16a34a'
          },
          hover: { backgroundColor: '#15803d' },
          click: { backgroundColor: '#166534' }
        },
        svg: {
          content:
            '<?xml version=&quot;1.0&quot; ?> <svg viewBox=&quot;0 0 28 28&quot; xmlns=&quot;http://www.w3.org/2000/svg&quot;> <g> <path d=&quot;M21.66,12a2,2,0,0,1-1.14,1.81L5.87,20.75A2.08,2.08,0,0,1,5,21a2,2,0,0,1-1.82-2.82L5.46,13H11a1,1,0,0,0,0-2H5.46L3.18,5.87A2,2,0,0,1,5.86,3.25h0l14.65,6.94A2,2,0,0,1,21.66,12Z&quot;> </path> </g> </svg>',
          styles: {
            default: {
              filter:
                'brightness(0) saturate(100%) invert(100%) sepia(28%) saturate(2%) hue-rotate(69deg) brightness(107%) contrast(100%)'
            }
          }
        }
      },
      loading: {
        container: { default: { backgroundColor: 'white' } },
        svg: {
          styles: {
            default: {
              filter:
                'brightness(0) saturate(100%) invert(72%) sepia(0%) saturate(3044%) hue-rotate(322deg) brightness(100%) contrast(96%)'
            }
          }
        }
      },
      stop: {
        container: {
          default: { backgroundColor: 'white' },
          hover: { backgroundColor: '#dadada52' }
        },
        svg: {
          content:
            '<?xml version=&quot;1.0&quot; encoding=&quot;utf-8&quot;?> <svg viewBox=&quot;0 0 24 24&quot; xmlns=&quot;http://www.w3.org/2000/svg&quot;> <rect width=&quot;24&quot; height=&quot;24&quot; rx=&quot;4&quot; ry=&quot;4&quot; /> </svg>',
          styles: {
            default: {
              width: '0.95em',
              marginTop: '0.32em',
              filter:
                'brightness(0) saturate(100%) invert(72%) sepia(0%) saturate(3044%) hue-rotate(322deg) brightness(100%) contrast(96%)'
            }
          }
        }
      }
    }"
    :textInput="{
      placeholder: { text: '输入健康问题，例如：我最近血压怎么样' }
    }"
    :history="history"
    :connect="connect"
    :responseInterceptor="responseInterceptor"
    :introMessage="{
      text: '您好，我是智康健康助手。可以问我血压、血糖、血脂、BMI、健康报告、风险评估等问题。'
    }"
  />
</template>
