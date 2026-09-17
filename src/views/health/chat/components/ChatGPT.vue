<script setup lang="ts">
import "deep-chat";
import { ref } from "vue";
import { getToken } from "@/utils/auth";

// AI 健康助手对话组件（豆包风格：居中窄列、白色气泡、大圆角输入框）
const chatRef = ref();

// 会话历史由服务端恢复（父组件拉 /api/health/chat/history 后传入），组件挂载时即生效
const props = defineProps<{
  history?: Array<{ role: string; text: string }>;
}>();

// ---------- A/B 模式（页面加载时读取，运行时不做热切换） ----------
const MODE_KEY = "health-ai-mode";

const isLlm = localStorage.getItem(MODE_KEY) === "llm";

// 两种模式都打同一个后端接口：方案 A 由服务端规则引擎作答，方案 B 由服务端代调大模型。
// API Key 只在服务端（server/.env 的 LLM_API_KEY），前端不再持有任何 Key。
// 必须带 Authorization，否则后端 authMiddleware 返回 401，deep-chat 会显示 Error。
const accessToken = getToken()?.accessToken ?? "";
const connect = {
  url: "/api/health/chat",
  method: "POST",
  headers: { Authorization: `Bearer ${accessToken}` },
  additionalBodyProps: { mode: isLlm ? "llm" : "rules" },
  stream: false
};

// ---------- 响应解析：服务端统一返回 { code, message, data: "<回答文本>" } ----------
function responseInterceptor(response: any) {
  if (response && typeof response.data === "string") {
    return { text: response.data };
  }
  const err = response?.message || response?.error?.message;
  if (err) return { error: String(err) };
  return { text: "（未获取到有效回答）" };
}

// ---------- 清空会话（P1-6）：父组件「清空对话」按钮调用 ----------
function resetChat() {
  chatRef.value?.reset?.();
}
defineExpose({ resetChat });
</script>

<template>
  <deep-chat
    ref="chatRef"
    class="zhikang-chat"
    style="flex: 1; min-height: 560px; border-radius: 16px"
    :messageStyles="{
      default: {
        shared: {
          bubble: {
            maxWidth: '72%',
            marginTop: '6px',
            marginBottom: '6px',
            borderRadius: '18px',
            padding: '12px 16px',
            fontSize: '14px',
            lineHeight: '1.7',
            wordBreak: 'break-word'
          }
        },
        user: {
          outerContainer: { justifyContent: 'flex-end' },
          bubble: {
            backgroundColor: '#16a34a',
            color: '#ffffff',
            borderBottomRightRadius: '4px'
          }
        },
        ai: {
          outerContainer: { justifyContent: 'flex-start' },
          bubble: {
            backgroundColor: '#ffffff',
            color: '#1f2937',
            boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
            borderBottomLeftRadius: '4px'
          }
        }
      }
    }"
    :avatars="{
      ai: {
        src: '/logo.svg',
        styles: {
          position: 'start',
          width: '32px',
          height: '32px',
          borderRadius: '8px'
        }
      },
      user: { default: { hidden: true } }
    }"
    :textInput="{
      placeholder: { text: '输入健康问题，例如：我最近血压怎么样' },
      autoResize: true,
      container: {
        default: {
          borderRadius: '24px',
          border: '1px solid #e5e7eb',
          backgroundColor: '#ffffff',
          boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
          padding: '4px 4px 4px 16px'
        },
        focus: {
          border: '1px solid #16a34a',
          boxShadow: '0 2px 16px rgba(22,163,74,0.12)'
        }
      },
      input: {
        default: {
          fontSize: '14px',
          color: '#1f2937',
          placeholderColor: '#9ca3af'
        }
      }
    }"
    :submitButtonStyles="{
      submit: {
        container: {
          default: {
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            backgroundColor: '#16a34a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 4px'
          },
          hover: { backgroundColor: '#15803d' },
          click: { backgroundColor: '#166534' },
          disabled: { backgroundColor: '#d1d5db' }
        },
        svg: {
          content:
            '<?xml version=&quot;1.0&quot; ?> <svg viewBox=&quot;0 0 28 28&quot; xmlns=&quot;http://www.w3.org/2000/svg&quot;> <g> <path d=&quot;M21.66,12a2,2,0,0,1-1.14,1.81L5.87,20.75A2.08,2.08,0,0,1,5,21a2,2,0,0,1-1.82-2.82L5.46,13H11a1,1,0,0,0,0-2H5.46L3.18,5.87A2,2,0,0,1,5.86,3.25h0l14.65,6.94A2,2,0,0,1,21.66,12Z&quot; fill=&quot;white&quot;> </path> </g> </svg>',
          styles: {
            default: { width: '18px', height: '18px' }
          }
        }
      },
      loading: {
        container: { default: { backgroundColor: 'transparent' } },
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
          default: {
            backgroundColor: '#16a34a',
            borderRadius: '50%',
            width: '36px',
            height: '36px'
          },
          hover: { backgroundColor: '#15803d' }
        },
        svg: {
          content:
            '<?xml version=&quot;1.0&quot; encoding=&quot;utf-8&quot;?> <svg viewBox=&quot;0 0 24 24&quot; xmlns=&quot;http://www.w3.org/2000/svg&quot;> <rect width=&quot;10&quot; height=&quot;10&quot; x=&quot;7&quot; y=&quot;7&quot; rx=&quot;2&quot; fill=&quot;white&quot; /> </svg>',
          styles: { default: { width: '16px', height: '16px' } }
        }
      }
    }"
    :history="props.history ?? []"
    :connect="connect"
    :responseInterceptor="responseInterceptor"
    :introMessage="{
      text: '您好，我是智康健康助手。可以问我血压、血糖、血脂、BMI、健康报告、风险评估等问题。'
    }"
  />
</template>

<style scoped>
/* deep-chat 是 light DOM，可通过 :deep 覆盖内部样式 */
.zhikang-chat {
  background: transparent;
}

:deep(.deep-chat) {
  background: transparent !important;
}

/* 消息滚动区背景 */
:deep(.deep-chat-messages) {
  padding: 8px 4px !important;
  background: transparent !important;
}

/* 输入区与消息区分隔 */
:deep(.deep-chat-input) {
  padding: 12px 4px 4px !important;
  border-top: none !important;
}
</style>
