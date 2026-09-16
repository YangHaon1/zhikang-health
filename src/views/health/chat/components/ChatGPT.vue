<script setup lang="ts">
import "deep-chat";
import { ref } from "vue";

// AI 健康助手对话组件（保留 ChatGPT 风格皮肤）
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
const connect = {
  url: "/api/health/chat",
  method: "POST",
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
    :history="props.history ?? []"
    :connect="connect"
    :responseInterceptor="responseInterceptor"
    :introMessage="{
      text: '您好，我是智康健康助手。可以问我血压、血糖、血脂、BMI、健康报告、风险评估等问题。'
    }"
  />
</template>
