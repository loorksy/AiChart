/**
 * Bounded AI conversation title + hook composer.
 * Never blocks the main chat turn; failures fall back deterministically.
 */
import { callLLM, type ContentBlock } from "@/lib/llm";
import type { AgentChatLanguage } from "./types";

export const DEFAULT_CHAT_TITLE_AR = "محادثة جديدة";
export const DEFAULT_CHAT_TITLE_EN = "New chat";
export const MAX_TITLE_CHARS = 42;
export const MAX_HOOK_CHARS = 72;

export type ChatMeta = { title: string; hook: string };

export function defaultChatTitle(language: AgentChatLanguage): string {
  return language === "en" ? DEFAULT_CHAT_TITLE_EN : DEFAULT_CHAT_TITLE_AR;
}

export function isDefaultChatTitle(title: string): boolean {
  const t = title.trim().toLowerCase();
  return (
    t === DEFAULT_CHAT_TITLE_AR ||
    t === DEFAULT_CHAT_TITLE_EN.toLowerCase() ||
    t === "new chat"
  );
}

/** Pure fallback — never copies the full first user message. */
export function fallbackChatMeta(
  userText: string,
  assistantText: string,
  language: AgentChatLanguage,
): ChatMeta {
  const source = (assistantText || userText).replace(/\s+/g, " ").trim();
  const words = source.split(" ").filter(Boolean);
  const titleWords = words.slice(0, language === "ar" ? 5 : 6);
  let title = titleWords.join(" ");
  if (!title) title = defaultChatTitle(language);
  // Never use the raw full first user message as the title.
  if (title === userText.replace(/\s+/g, " ").trim() && words.length > 7) {
    title = titleWords.slice(0, 4).join(" ");
  }
  if (title.length > MAX_TITLE_CHARS) title = `${title.slice(0, MAX_TITLE_CHARS - 1).trim()}…`;

  const hookSource = (assistantText || userText).replace(/\s+/g, " ").trim();
  let hook = hookSource;
  if (hook.length > MAX_HOOK_CHARS) hook = `${hook.slice(0, MAX_HOOK_CHARS - 1).trim()}…`;
  if (!hook || hook === title) {
    hook = language === "ar" ? "متابعة التحليل" : "Continuing analysis";
  }
  return { title, hook };
}

function parseMetaJson(raw: string): ChatMeta | null {
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const obj = JSON.parse(raw.slice(start, end + 1)) as { title?: unknown; hook?: unknown };
    if (typeof obj.title !== "string" || typeof obj.hook !== "string") return null;
    const title = obj.title.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_CHARS);
    const hook = obj.hook.replace(/\s+/g, " ").trim().slice(0, MAX_HOOK_CHARS);
    if (!title || !hook) return null;
    return { title, hook };
  } catch {
    return null;
  }
}

function textFromBlocks(content: ContentBlock[]): string {
  return content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/**
 * Compose a short title + one-line hook. Uses a tiny LLM call when available;
 * otherwise falls back. Language of output matches `language`.
 */
export async function composeChatMeta(input: {
  language: AgentChatLanguage;
  userText: string;
  assistantText: string;
  symbol?: string;
}): Promise<ChatMeta> {
  const fallback = fallbackChatMeta(input.userText, input.assistantText, input.language);
  try {
    const langLine =
      input.language === "ar"
        ? "Write title and hook in Arabic."
        : "Write title and hook in English.";
    const prompt = [
      "You name a Forex trading chat for a sidebar.",
      langLine,
      'Return ONLY JSON: {"title":"...","hook":"..."}',
      "title: 3-7 words, no quotes, no secrets, not a full sentence copy.",
      "hook: one short line, different from title, no tools/skills/traces.",
      input.symbol ? `Symbol context: ${input.symbol}` : "",
      `User: ${input.userText.slice(0, 400)}`,
      `Assistant: ${input.assistantText.slice(0, 600)}`,
    ]
      .filter(Boolean)
      .join("\n");

    const res = await callLLM({
      system: "Return compact JSON only. No markdown.",
      messages: [{ role: "user", content: prompt }],
      maxTokens: 120,
    }, { tier: "quick" });
    const text = textFromBlocks(res.content ?? []);
    const parsed = parseMetaJson(text);
    if (!parsed) return fallback;
    if (parsed.title === input.userText.replace(/\s+/g, " ").trim()) return fallback;
    if (parsed.hook === parsed.title) {
      return { title: parsed.title, hook: fallback.hook };
    }
    return parsed;
  } catch {
    return fallback;
  }
}
