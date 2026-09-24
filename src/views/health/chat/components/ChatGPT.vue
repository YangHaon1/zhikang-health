<script setup lang="ts">
import "deep-chat";
import { ref, computed, nextTick } from "vue";
import { getToken } from "@/utils/auth";

const chatRef = ref<any>();

const props = defineProps<{
  history?: Array<{ role: string; text: string }>;
  suggestedQuestions?: string[];
  /** AI 模式：rules 规则引擎 | llm 大模型。父组件传入，切换即生效（免刷新） */
  mode?: "rules" | "llm";
}>();

const hasInteracted = ref(
  Array.isArray(props.history) && props.history.length > 0
);

const accessToken = getToken()?.accessToken ?? "";
// V1.5：connect 随 props.mode 响应式重建，切模式无需刷新页面
const connect = computed(() => ({
  url: "/api/health/chat",
  method: "POST",
  headers: { Authorization: `Bearer ${accessToken}` },
  additionalBodyProps: { mode: props.mode === "llm" ? "llm" : "rules" },
  stream: false
}));

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

/** 聚焦 deep-chat 内部输入框，保证首次 Enter 即可命中已就绪的输入 */
function focusInput() {
  nextTick(() => {
    const root = chatRef.value as any;
    const el = root?.shadowRoot
      ? root.shadowRoot.querySelector("textarea, input")
      : root?.querySelector?.("textarea, input");
    el?.focus?.();
  });
}

function handleSuggestion(text: string) {
  hasInteracted.value = true;
  focusInput();
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
    <!--
      deep-chat 从挂载起就 flex:1 占满 chat-wrapper 固定高度：
      绝不 display:none、绝不因欢迎层而重排，输入框位置恒定，首次 Enter 即可发送。
      欢迎层是其后的 absolute 浮层（pointer-events:none），不影响输入。
    -->
    <deep-chat
      ref="chatRef"
      class="zhikang-chat"
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
    />

    <!-- 欢迎浮层：absolute 盖在消息区上方，pointer-events:none 不挡输入；
         推荐按钮单独恢复点击。消息发出后 hasInteracted=true 即淡出。 -->
    <transition name="fade">
      <div v-if="!hasInteracted" class="empty-state">
        <div class="empty-avatar">
          <iconify-icon icon="ri:robot-2-line" width="34" />
        </div>
        <div class="empty-title">你好，我是智康 AI 健康助手</div>
        <div class="empty-sub">
          基于你的健康档案与指标，帮你解读血压血糖、评估风险、提供生活建议
        </div>
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
    </transition>
  </div>
</template>

<style scoped>
.chat-wrapper {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: calc(100vh - 300px);
  min-height: 560px;
}

.empty-state {
  position: absolute;
  inset: 0 0 76px; /* 露出底部输入框 */
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 20px;
  pointer-events: none; /* 不挡 deep-chat 输入区 */
  background: #fff;
}

.fade-leave-active {
  transition: opacity 0.25s ease;
}

.fade-leave-to {
  opacity: 0;
}

.empty-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  margin-bottom: 18px;
  color: #fff;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border-radius: 50%;
  box-shadow: 0 10px 24px rgb(99 102 241 / 32%);
}

.empty-title {
  margin-bottom: 10px;
  font-size: 24px;
  font-weight: 700;
  color: #111827;
  text-align: center;
}

.empty-sub {
  max-width: 460px;
  margin: 0 0 28px;
  font-size: 14px;
  line-height: 1.7;
  color: #6b7280;
  text-align: center;
}

.empty-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: center;
  max-width: 600px;
  pointer-events: auto; /* 推荐按钮可点 */
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

:deep(.zhikang-chat) {
  display: flex !important;
  flex-direction: column !important;
  width: 100% !important;
  height: 100% !important;
}

:deep(.zhikang-chat > *) {
  width: 100% !important;
  max-width: 100% !important;
}
</style>
