// 方案 B：后端直连大模型（火山方舟，OpenAI 兼容 /chat/completions）
// 关键点：API Key 只存在服务端（server/.env 的 LLM_API_KEY），前端不再持有任何 Key；
// 前端只发 mode=llm，由这里决定用不用、用哪个模型。无 Key 时不抛错，返回可展示的降级文案。
import { env } from "./env.js";
import { logger } from "./logger.js";

/** 系统提示词：把助手的回答约束在健康管理语境，并声明它不是医生 */
const SYSTEM_PROMPT =
  "你是「智康健康管理系统」的健康助手。基于用户提供的健康档案与指标数据，用简洁、口语化的中文解答血压、血糖、血脂、BMI、生活方式等问题，并给出可执行的建议。" +
  "回答控制在 200 字以内，不要使用 Markdown 标题。你是健康管理助手而非医生，涉及明显异常指标时提醒用户及时就医。";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmResult {
  /** 是否成功拿到回答 */
  ok: boolean;
  /** ok=true 时为模型回答；ok=false 时为可展示的降级/错误提示 */
  text: string;
}

/** 服务端是否配置了方案 B 的 Key（前端据此显示降级提示） */
export function llmAvailable(): boolean {
  return Boolean(env.LLM_API_KEY);
}

/**
 * 调用大模型。入参为对话消息（含前端历史 + 本轮问题 + 系统提示）。
 * 任何异常都不向上抛：网络错误/超时/非 2xx/响应结构异常统一转成 ok=false 的可读文案，
 * 避免一次外部服务抖动让整个对话页 500。
 */
export async function callLlm(messages: Array<LlmMessage>): Promise<LlmResult> {
  if (!llmAvailable()) {
    return {
      ok: false,
      text: "服务端尚未配置大模型 API Key（server/.env 的 LLM_API_KEY），「AI 大模型」模式暂不可用，请改用「规则引擎」模式。"
    };
  }

  // 超时保护：外部接口挂起时不能让请求一直悬着
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const resp = await fetch(`${env.LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.LLM_API_KEY}`
      },
      body: JSON.stringify({
        model: env.LLM_MODEL,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
        stream: false
      }),
      signal: controller.signal
    });

    if (!resp.ok) {
      const detail = (await resp.text()).slice(0, 200);
      logger.warn(`[llm] 上游返回 ${resp.status}：${detail}`);
      return {
        ok: false,
        text: `大模型服务暂时不可用（HTTP ${resp.status}），已保留您的问题，请稍后重试或改用「规则引擎」模式。`
      };
    }

    const data = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data?.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return {
        ok: false,
        text: "大模型未返回有效内容，请重试或改用「规则引擎」模式。"
      };
    }
    return { ok: true, text: content };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    logger.warn(`[llm] 调用失败：${(err as Error)?.message}`);
    return {
      ok: false,
      text: aborted
        ? "大模型响应超时（30s），请重试或改用「规则引擎」模式。"
        : "无法连接大模型服务，请检查服务端网络或改用「规则引擎」模式。"
    };
  } finally {
    clearTimeout(timer);
  }
}
