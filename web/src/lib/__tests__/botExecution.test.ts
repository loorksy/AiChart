import assert from "node:assert/strict";
import { test } from "node:test";

test("ticketFromOrderId parses MT5 ticket strings", async () => {
  const { ticketFromOrderId } = await import("@/lib/botExecution");
  assert.equal(ticketFromOrderId("12345"), 12345);
  assert.equal(ticketFromOrderId(null), undefined);
  assert.equal(ticketFromOrderId(""), undefined);
  assert.equal(ticketFromOrderId("abc"), undefined);
});

test("botComment tags orders for grid bot tracing", async () => {
  const { botComment, goldBotComment } = await import("@/lib/botExecution");
  assert.equal(botComment(7), "AiChartBot#7");
  assert.equal(botComment(7, "gold"), "AiChartGoldBot#7");
  assert.equal(goldBotComment(7), "AiChartGoldBot#7");
});

test("botsLiveEnabled respects admin gate", async () => {
  const prev = process.env.BOTS_LIVE_ENABLED;
  process.env.BOTS_LIVE_ENABLED = "0";
  const { botsLiveEnabled } = await import("@/lib/botExecution");
  assert.equal(botsLiveEnabled(), false);
  delete process.env.BOTS_LIVE_ENABLED;
  assert.equal(botsLiveEnabled(), true);
  if (prev !== undefined) process.env.BOTS_LIVE_ENABLED = prev;
});
