import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isDrawingOnly,
  isGeneralOnly,
  routeIntent,
} from "@/lib/agent/intentRouter";
import type { AgentActivityEvent, AgentRunContext } from "@/lib/agent/types";

function fakeCtx(events: Array<Omit<AgentActivityEvent, "id" | "timestamp">>): AgentRunContext {
  return {
    requestId: "test",
    emitActivity: (e) => events.push(e),
  };
}

describe("intentRouter", () => {
  it("general question does not trigger trading/candle/OANDA activity", () => {
    const events: Array<Omit<AgentActivityEvent, "id" | "timestamp">> = [];
    const intents = routeIntent({
      message: "how is the weather in Istanbul now?",
      chartContext: {},
      ctx: fakeCtx(events),
    });
    assert.deepEqual(intents, ["general_question"]);
    assert.ok(isGeneralOnly(intents));
    assert.equal(events.some((e) => String(e.message).includes("OANDA")), false);
    assert.equal(events.some((e) => String(e.message).includes("candle")), false);
  });

  it("chart question triggers new_trade_analysis intent", () => {
    const events: Array<Omit<AgentActivityEvent, "id" | "timestamp">> = [];
    const intents = routeIntent({
      message: "analyze EURUSD now",
      chartContext: { symbol: "EURUSD", interval: "15m" },
      ctx: fakeCtx(events),
    });
    assert.ok(intents.includes("new_trade_analysis"));
    assert.ok(!isGeneralOnly(intents));
  });

  it("trendline drawing is drawing-only, not a trade recommendation", () => {
    const events: Array<Omit<AgentActivityEvent, "id" | "timestamp">> = [];
    const intents = routeIntent({
      message: "draw trendline",
      chartContext: { symbol: "EURUSD", interval: "15m" },
      ctx: fakeCtx(events),
    });
    assert.ok(intents.includes("draw_trendline"));
    assert.equal(intents.includes("new_trade_analysis"), false);
    assert.ok(isDrawingOnly(intents));
  });

  it("support/resistance drawing is drawing-only", () => {
    const events: Array<Omit<AgentActivityEvent, "id" | "timestamp">> = [];
    const intents = routeIntent({
      message: "draw support and resistance",
      chartContext: { symbol: "EURUSD", interval: "15m" },
      ctx: fakeCtx(events),
    });
    assert.ok(intents.includes("draw_support_resistance"));
    assert.equal(intents.includes("new_trade_analysis"), false);
    assert.ok(isDrawingOnly(intents));
  });

  it("follow-up about the active recommendation routes to stored explanation", () => {
    const events: Array<Omit<AgentActivityEvent, "id" | "timestamp">> = [];
    const intents = routeIntent({
      message: "based on what is this recommendation",
      chartContext: { symbol: "EURUSD", interval: "15m" },
      ctx: fakeCtx(events),
    });
    assert.deepEqual(intents, ["explain_active_recommendation"]);
  });

  it("recommendation status routes to the stored recommendation tracker", () => {
    const events: Array<Omit<AgentActivityEvent, "id" | "timestamp">> = [];
    const intents = routeIntent({
      message: "recommendation status",
      chartContext: { symbol: "EURUSD", interval: "15m" },
      ctx: fakeCtx(events),
    });
    assert.deepEqual(intents, ["track_active_recommendation"]);
  });

  it("execution wording triggers trade_execution intent", () => {
    const events: Array<Omit<AgentActivityEvent, "id" | "timestamp">> = [];
    const intents = routeIntent({
      message: "execute buy trade on EURUSD",
      ctx: fakeCtx(events),
    });
    assert.ok(intents.includes("trade_execution"));
  });

  it("news wording triggers market_news intent", () => {
    const events: Array<Omit<AgentActivityEvent, "id" | "timestamp">> = [];
    const intents = routeIntent({
      message: "any important USD news?",
      ctx: fakeCtx(events),
    });
    assert.ok(intents.includes("market_news"));
  });
});
