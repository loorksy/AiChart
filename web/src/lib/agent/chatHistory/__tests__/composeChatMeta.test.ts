import assert from "node:assert/strict";
import { test } from "node:test";
import {
  composeChatMeta,
  fallbackChatMeta,
  isDefaultChatTitle,
  MAX_HOOK_CHARS,
  MAX_TITLE_CHARS,
} from "@/lib/agent/chatHistory/composeChatMeta";

test("fallback titles are concise and not the full first user message", () => {
  const longUser =
    "أعطني تحليل مفصل جداً عن الذهب الآن مع كل الأسباب والمستويات والسيناريوهات الممكنة من فضلك";
  const meta = fallbackChatMeta(longUser, "انتظر عودة السعر إلى منطقة البيع", "ar");
  assert.notEqual(meta.title, longUser);
  assert.ok(meta.title.split(" ").length <= 7);
  assert.ok(meta.title.length <= MAX_TITLE_CHARS);
  assert.notEqual(meta.hook, meta.title);
  assert.ok(meta.hook.length <= MAX_HOOK_CHARS);
});

test("Arabic fallback stays Arabic; English fallback stays English", () => {
  const ar = fallbackChatMeta("حلل الذهب", "انتظار منطقة البيع", "ar");
  assert.match(ar.title, /[\u0600-\u06FF]/);
  const en = fallbackChatMeta(
    "Review EURUSD breakout setup please with full context",
    "Watching the retest before entry",
    "en",
  );
  assert.doesNotMatch(en.title, /[\u0600-\u06FF]/);
  assert.ok(en.hook.toLowerCase().includes("retest") || en.hook.length > 0);
});

test("composeChatMeta failure falls back without throwing", async () => {
  const meta = await composeChatMeta({
    language: "en",
    userText: "Analyze XAUUSD scalp opportunity carefully",
    assistantText: "WAIT near resistance until a clean retest.",
  });
  assert.ok(meta.title.length > 0);
  assert.ok(meta.hook.length > 0);
  assert.notEqual(meta.title, "Analyze XAUUSD scalp opportunity carefully");
});

test("isDefaultChatTitle recognizes both locales", () => {
  assert.equal(isDefaultChatTitle("محادثة جديدة"), true);
  assert.equal(isDefaultChatTitle("New chat"), true);
  assert.equal(isDefaultChatTitle("تحليل فرصة الذهب"), false);
});
