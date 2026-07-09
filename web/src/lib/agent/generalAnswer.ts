/**
 * General (non-trading) question answerer. Uses the shared LLM layer with the
 * Smart Chart Agent persona but NO market/OANDA/MT5 tools — a general question
 * must never trigger trading activity or candle fetches.
 */
import { callLLM, isLLMConfigured } from "@/lib/llm";
import { sanitizeActivityMessage } from "./activity";
import {
  SMART_CHART_AGENT_SYSTEM_PROMPT,
  GENERAL_ANSWER_SUFFIX,
} from "./systemPrompt";

export async function answerGeneralQuestion(message: string): Promise<string> {
  if (!isLLMConfigured()) {
    return "الذكاء الاصطناعي غير مُفعّل حالياً على الخادم.";
  }
  try {
    const res = await callLLM({
      system: `${SMART_CHART_AGENT_SYSTEM_PROMPT}\n\n${GENERAL_ANSWER_SUFFIX}`,
      messages: [{ role: "user", content: message }],
      maxTokens: 800,
    });
    const text = res.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    // Sanitize in case the model leaks any reasoning phrasing.
    return sanitizeActivityMessageLong(text) || "تعذّر صياغة رد.";
  } catch {
    return "تعذّر معالجة السؤال حالياً. حاول مرة أخرى.";
  }
}

/** Like sanitizeActivityMessage but without the 240-char cap (full answers). */
function sanitizeActivityMessageLong(text: string): string {
  // Reuse the phrase-stripping by sanitizing in chunks would drop content; here
  // we only strip the leak phrases, keeping full length.
  const stripped = sanitizeActivityMessage(text);
  // sanitizeActivityMessage caps at 240 — for long answers, re-run on the full
  // text via a manual pass so we don't truncate legitimate content.
  return stripped.length >= 240 ? stripLeakPhrasesFull(text) : stripped;
}

const LEAK = [
  /chain[- ]of[- ]thought/gi,
  /hidden reasoning/gi,
  /scratchpad/gi,
  /private reasoning/gi,
  /تفكيري الداخلي/g,
  /سلسلة التفكير/g,
  /أفكر داخليا[ً]?/g,
];

function stripLeakPhrasesFull(text: string): string {
  let out = text.trim();
  for (const re of LEAK) out = out.replace(re, "");
  return out.replace(/\s{2,}/g, " ").trim();
}
