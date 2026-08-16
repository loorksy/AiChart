import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAT_QUERY_KEY,
  chatConsoleHref,
  isValidChatId,
  parseChatIdFromSearchParams,
} from "@/lib/chatUrl";

test("chatConsoleHref encodes chat query param", () => {
  const id = "a1b2c3d4-e5f6-4789-a012-3456789abcde";
  // /chat is the canonical surface; /workspace only redirects (preserving
  // ?chat=). Pointing the href back at /workspace would round-trip through a
  // redirect on every chat switch — and dropping the query there was the bug
  // that reset a fresh session to the empty landing state.
  assert.equal(chatConsoleHref(id), `/chat?${CHAT_QUERY_KEY}=${id}`);
});


test("isValidChatId accepts UUID and legacy chat-* ids", () => {
  assert.equal(isValidChatId("a1b2c3d4-e5f6-4789-a012-3456789abcde"), true);
  assert.equal(isValidChatId("chat-123-456"), true);
  assert.equal(isValidChatId(""), false);
  assert.equal(isValidChatId("not-a-chat"), false);
});

test("parseChatIdFromSearchParams validates chat query", () => {
  const id = "a1b2c3d4-e5f6-4789-a012-3456789abcde";
  assert.equal(
    parseChatIdFromSearchParams(new URLSearchParams(`${CHAT_QUERY_KEY}=${id}`)),
    id,
  );
  assert.equal(parseChatIdFromSearchParams(new URLSearchParams("chat=bad")), null);
  assert.equal(parseChatIdFromSearchParams(new URLSearchParams()), null);
});
