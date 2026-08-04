import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAT_QUERY_KEY,
  chatConsoleHref,
  chatShareHref,
  isValidChatId,
  parseChatIdFromSearchParams,
} from "@/lib/chatUrl";

test("chatConsoleHref encodes chat query param", () => {
  const id = "a1b2c3d4-e5f6-4789-a012-3456789abcde";
  assert.equal(chatConsoleHref(id), `/workspace?${CHAT_QUERY_KEY}=${id}`);
});

test("chatShareHref builds pretty share path", () => {
  const id = "a1b2c3d4-e5f6-4789-a012-3456789abcde";
  assert.equal(chatShareHref(id), `/console/chats/${id}`);
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
