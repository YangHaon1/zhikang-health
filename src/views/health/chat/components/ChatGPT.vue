<script setup lang="ts">
import "deep-chat";
import { ref } from "vue";
import { getToken } from "@/utils/auth";

const chatRef = ref<any>();

const props = defineProps<{
  history?: Array<{ role: string; text: string }>;
  suggestedQuestions?: string[];
}>();

const hasInteracted = ref(
  Array.isArray(props.history) && props.history.length > 0
);

const MODE_KEY = "health-ai-mode";
const isLlm = localStorage.getItem(MODE_KEY) === "llm";

const accessToken = getToken()?.accessToken ?? "";
const connect = {
  url: "/api/health/chat",
  method: "POST",
  headers: { Authorization: `Bearer ${accessToken}` },
  additionalBodyProps: { mode: isLlm ? "llm" : "rules" },
  stream: false
};

function responseInterceptor(response: any) {
  if (response && typeof response.data === "string") {
    return { text: response.data };
  }
  const err = response?.message || response?.error?.message;
  if (err) return { error: String(err) };
  return { text: "（未获取到有效回答）" };
}

function onMessage() {
  hasInteracted.value = true;
}

function handleSuggestion(text: string) {
  hasInteracted.value = true;
  (chatRef.value as any)?.sendMessage?.(text);
}

function resetChat() {
  chatRef.value?.reset?.();
  hasInteracted.value = false;
}

defineExpose({ resetChat });
</script>

<template>
  <div class="chat-wrapper">
    <div v-if="!hasInteracted" class="empty-state">
      <div class="empty-title">有什么我可以帮你的吗？</div>
      <div class="empty-suggestions">
        <button
          v-for="q in suggestedQuestions"
          :key="q"
          class="suggestion-chip"
          @click="handleSuggestion(q)"
        >
          {{ q }}
        </button>
      </div>
    </div>

    <deep-chat
      ref="chatRef"
      class="zhikang-chat"
      :class="{ 'chat-hidden': !hasInteracted }"
      style="flex: 1; width: 100%"
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
              boxShadow:
                '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
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
            avatar: { width: '32px', height: '32px', borderRadius: '8px' }
          }
        },
        user: {
          styles: { container: { display: 'none' } }
        }
      }"
      :textInput="{
        placeholder: { text: '输入健康问题，例如：我最近血压怎么样' },
        styles: {
          container: {
            borderRadius: '24px',
            border: '1px solid #e5e7eb',
            backgroundColor: '#ffffff',
            boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
            padding: '6px 6px 6px 18px'
          },
          text: {
            fontSize: '14px',
            color: '#1f2937'
          },
          focus: {
            border: '1px solid #16a34a',
            boxShadow: '0 2px 16px rgba(22,163,74,0.12)'
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
            styles: { default: { width: '18px', height: '18px' } }
          }
        },
        loading: {
          container: { default: { backgroundColor: 'transparent' } }
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
      :history="history ?? []"
      :connect="connect"
      :responseInterceptor="responseInterceptor"
      :onMessage="onMessage"
      :introMessage="{
        text: '您好，我是智康健康助手。可以问我血压、血糖、血脂、BMI、健康报告、风险评估等问题。'
      }"
    />
  </div>
</template>

<style scoped>
.chat-wrapper {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  width: 100%;
  min-height: 560px;
}

.empty-state {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 400px;
  padding: 40px 20px;
}

.empty-title {
  margin-bottom: 32px;
  font-size: 28px;
  font-weight: 700;
  color: #111827;
  text-align: center;
}

.empty-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: center;
  max-width: 600px;
}

.suggestion-chip {
  padding: 10px 20px;
  font-size: 14px;
  color: #374151;
  cursor: pointer;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 20px;
  transition: all 0.2s;
}

.suggestion-chip:hover {
  color: #16a34a;
  background: #f0fdf4;
  border-color: #16a34a;
}

.chat-hidden {
  display: none !important;
}

:deep(.zhikang-chat) {
  display: flex !important;
  flex-direction: column !important;
  width: 100% !important;
}

:deep(.zhikang-chat > *) {
  width: 100% !important;
  max-width: 100% !important;
}
</style>
