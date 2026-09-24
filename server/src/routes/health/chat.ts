/**
 * AI 健康对话路由：config（方案 B 可用性）/ history（恢复会话）/ chat（A 规则引擎 · B 大模型）。
 * 拆自原 routes/health.ts（P1-2）；对话历史清理见 P1-6（`DELETE /health/chat/history`）。
 */
import { Router } from "express";
import db from "../../db.js";
import { authMiddleware } from "../../middleware/auth.js";
import { chatAnswer } from "../../../shared/health-chat.js";
import {
  checkEmergency,
  emergencyCardToText
} from "../../../shared/health-engine.js";
import { callLlm, llmAvailable } from "../../llm.js";
import { profileForEngine, recordsForEngine, toText } from "./common.js";
import { recentReportSummaries } from "./report.js";
import { buildHealthContext } from "../../services/health-context.js";

const router = Router();

/** 对话历史返回给前端的最大条数（按最近若干轮，够恢复会话即可） */
const CHAT_HISTORY_LIMIT = 50;

interface ChatRow {
  role: string;
  content: string;
  create_time: string | null;
}

/** 落一条对话记录（role: 'user' | 'assistant'） */
const insertChat = db.prepare(
  `INSERT INTO chat_history (user_id, role, content, create_time)
   VALUES (?, ?, ?, datetime('now','localtime'))`
);

/** 从入参里取本轮提问：兼容 deep-chat 的 {messages:[{role,text/content}]} 与直接传 {question}/{text} */
function extractQuestion(body: Record<string, unknown>): string {
  const messages = body.messages;
  if (Array.isArray(messages)) {
    const last = [...messages]
      .reverse()
      .find(
        (m: { role?: string; content?: unknown; text?: unknown }) =>
          m?.role === "user" &&
          (typeof m.content === "string" || typeof m.text === "string")
      );
    if (last)
      return String(
        (last as { content?: string; text?: string }).content ??
          (last as { text?: string }).text
      );
  }
  // deep-chat 也可能直接发 { text: "..." }
  if (typeof body.text === "string" && body.text.trim())
    return body.text.trim();
  return toText(body.question);
}

/** 把入参里的历史消息整理成大模型可用的格式（只保留 user/assistant，最多最近 10 条） */
function extractLlmMessages(
  body: Record<string, unknown>
): Array<{ role: "user" | "assistant"; content: string }> {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  // deep-chat 发 { text } 时，转成单条 user 消息供大模型
  if (
    messages.length === 0 &&
    typeof body.text === "string" &&
    body.text.trim()
  ) {
    return [{ role: "user", content: body.text.trim() }];
  }
  return messages
    .filter(
      (m: { role?: string; content?: unknown; text?: unknown }) =>
        (m?.role === "user" || m?.role === "assistant") &&
        (typeof m.content === "string" || typeof m.text === "string") &&
        String(
          (m as { content?: string; text?: string }).content ??
            (m as { text?: string }).text
        ).trim()
    )
    .slice(-10)
    .map((m: { role: string; content?: string; text?: string }) => ({
      role: m.role as "user" | "assistant",
      content: String(m.content ?? m.text)
    }));
}

/**
 * GET /api/health/chat/config —— 方案 B 可用性（Key 在服务端，前端只能问「能不能用」）。
 * 前端用它决定是否展示「未配置 Key」的降级提示，Key 本身永不下发。
 */
router.get("/health/chat/config", authMiddleware, (_req, res) => {
  res.json({
    code: 0,
    message: "操作成功",
    data: { llmAvailable: llmAvailable() }
  });
});

/**
 * GET /api/health/chat/history —— 当前用户的对话历史（按时间正序，供前端恢复会话）。
 * 服务端存储：换浏览器/重启服务后仍能恢复（方案 B6 的持久化要求）。
 */
router.get("/health/chat/history", authMiddleware, (req, res) => {
  const rows = db
    .prepare(
      `SELECT role, content, create_time FROM chat_history
       WHERE user_id = ? ORDER BY id DESC LIMIT ?`
    )
    .all(req.user!.id, CHAT_HISTORY_LIMIT) as Array<ChatRow>;

  res.json({
    code: 0,
    message: "操作成功",
    data: rows.reverse().map(r => ({
      role: r.role === "assistant" ? "ai" : "user",
      text: r.content
    }))
  });
});

/**
 * DELETE /api/health/chat/history —— 清空当前用户的对话历史（P1-6 新增）。
 * 幂等：无论有没有历史都返回成功，前端「清空对话」按钮调用后刷新会话。
 */
router.delete("/health/chat/history", authMiddleware, (req, res) => {
  db.prepare("DELETE FROM chat_history WHERE user_id = ?").run(req.user!.id);
  res.json({ code: 0, message: "操作成功", data: null });
});

/**
 * POST /api/health/chat —— 对话（方案 A 规则引擎 / 方案 B 大模型）。
 *
 * 入参：`{ messages: [{role, text/content}] }`（deep-chat 格式，text 和 content 均兼容）或 `{ question }`/`{ text }`，可选 `{ mode: "llm" | "rules" }`。
 * 出参统一 `{ code: 0, data: "<回答文本>" }`（A/B 两路同构，前端 responseInterceptor 一套解析）。
 * 本轮提问与回答**成对**写入 chat_history（归属当前用户）；若按 `messages` 传了完整历史，
 * 只落最新一条 user 消息，避免重复入库。
 */
router.post("/health/chat", authMiddleware, async (req, res) => {
  const userId = req.user!.id;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const question = extractQuestion(body).trim();
  const useLlm = toText(body.mode) === "llm";

  if (!question) {
    res.json({ code: 0, message: "操作成功", data: "请问有什么可以帮您？" });
    return;
  }

  // C0 emergency 分流：命中紧急处置规则（极端指标 / 危险症状关键词）时，
  // 无论 rules 还是 llm 模式，一律返回固定处置卡，不交由大模型自由回答。
  const latestRecord = recordsForEngine(userId)[0] ?? null;
  const emergency = checkEmergency(question, latestRecord);
  if (emergency) {
    const answer = emergencyCardToText(emergency);
    db.transaction(() => {
      insertChat.run(userId, "user", question);
      insertChat.run(userId, "assistant", answer);
    })();
    res.json({ code: 0, message: "操作成功", data: answer });
    return;
  }

  let answer: string;
  if (useLlm) {
    // V1.5：把当前用户的结构化健康摘要作为 system 上下文前置注入，
    // 让大模型能引用真实档案/指标/报告；无数据时不注入（空串），不影响对话。
    const healthCtx = buildHealthContext(userId);
    const historyMessages = extractLlmMessages(body);
    const messages = healthCtx
      ? ([
          { role: "system" as const, content: healthCtx },
          ...historyMessages
        ] as Array<{ role: "system" | "user" | "assistant"; content: string }>)
      : historyMessages;
    const result = await callLlm(messages);
    answer = result.text;
  } else {
    answer = chatAnswer(question, {
      profile: profileForEngine(userId),
      records: recordsForEngine(userId),
      reports: recentReportSummaries(userId)
    });
  }

  // 用户提问与回答成对落库（同一事务，避免只落了半轮）
  db.transaction(() => {
    insertChat.run(userId, "user", question);
    insertChat.run(userId, "assistant", answer);
  })();

  res.json({ code: 0, message: "操作成功", data: answer });
});

export default router;
