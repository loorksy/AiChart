import assert from "node:assert/strict";
import test from "node:test";
import {
  extractQuantAgentSymbolHint,
  routeQuantAgentChatIntent,
} from "@/lib/agent/quantAgentChat/intentRouter";

test("defaults to chat for plain conversation", () => {
  assert.equal(routeQuantAgentChatIntent("hello, how are you?"), "chat");
  assert.equal(routeQuantAgentChatIntent("مرحبا كيف حالك"), "chat");
  assert.equal(routeQuantAgentChatIntent(""), "chat");
});

test("routes generate_strategy on English action + strategy co-occurrence", () => {
  assert.equal(routeQuantAgentChatIntent("can you create a strategy for gold"), "generate_strategy");
  assert.equal(routeQuantAgentChatIntent("build a new strategy for me"), "generate_strategy");
  assert.equal(routeQuantAgentChatIntent("generate a strategy that trades trends"), "generate_strategy");
  assert.equal(routeQuantAgentChatIntent("design strategy please"), "generate_strategy");
  assert.equal(routeQuantAgentChatIntent("write a strategy for EURUSD"), "generate_strategy");
});

test("routes generate_strategy on the plan's exact Arabic trigger phrases", () => {
  assert.equal(routeQuantAgentChatIntent("أريد استراتيجية جديدة"), "generate_strategy");
  assert.equal(routeQuantAgentChatIntent("اصنع استراتيجية للذهب"), "generate_strategy");
  assert.equal(routeQuantAgentChatIntent("أنشئ استراتيجية جديدة"), "generate_strategy");
  assert.equal(routeQuantAgentChatIntent("صمم استراتيجية للتداول"), "generate_strategy");
});

test("does not route generate_strategy on 'strategy' alone without an action word", () => {
  assert.equal(routeQuantAgentChatIntent("what is your strategy?"), "chat");
  assert.equal(routeQuantAgentChatIntent("ما هي الاستراتيجية المستخدمة؟"), "chat");
});

test("routes explain_recommendation on an explain word + symbol mention", () => {
  assert.equal(routeQuantAgentChatIntent("why did XAUUSD get a buy signal?"), "explain_recommendation");
  assert.equal(routeQuantAgentChatIntent("explain the EURUSD recommendation"), "explain_recommendation");
  assert.equal(routeQuantAgentChatIntent("لماذا GBPUSD بيع؟"), "explain_recommendation");
  assert.equal(routeQuantAgentChatIntent("فسّر توصية XAUUSD"), "explain_recommendation");
});

test("routes explain_recommendation on an explain word + recommendation reference phrase", () => {
  assert.equal(
    routeQuantAgentChatIntent("why did this recommendation trigger?"),
    "explain_recommendation",
  );
  assert.equal(routeQuantAgentChatIntent("اشرح هذه التوصية"), "explain_recommendation");
  assert.equal(routeQuantAgentChatIntent("لماذا آخر توصية؟"), "explain_recommendation");
});

test("does not route explain_recommendation on an explain word alone", () => {
  assert.equal(routeQuantAgentChatIntent("why is the sky blue?"), "chat");
  assert.equal(routeQuantAgentChatIntent("لماذا؟"), "chat");
});

test("generate_strategy takes priority over explain_recommendation when both cues appear", () => {
  assert.equal(
    routeQuantAgentChatIntent("explain why you would build a new strategy for XAUUSD"),
    "generate_strategy",
  );
});

test("extractQuantAgentSymbolHint recognizes common forex/metal/crypto pairs", () => {
  assert.equal(extractQuantAgentSymbolHint("what about XAUUSD today"), "XAUUSD");
  assert.equal(extractQuantAgentSymbolHint("EUR/USD looks interesting"), "EURUSD");
  assert.equal(extractQuantAgentSymbolHint("no symbol here"), null);
});
