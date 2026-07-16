import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isDrawActiveRecommendation,
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

  it("question about a user drawing uses the specialized drawing discussion path", () => {
    const events: Array<Omit<AgentActivityEvent, "id" | "timestamp">> = [];
    const intents = routeIntent({
      message: "what is this zone I drew?",
      chartContext: { symbol: "EURUSD", interval: "15m" },
      ctx: fakeCtx(events),
    });
    assert.deepEqual(intents, ["discuss_user_drawing"]);
    assert.ok(isDrawingOnly(intents));
  });

  it("generic explanation of agent drawings stays on the generic path", () => {
    const intents = routeIntent({
      message: "explain drawings",
      chartContext: { symbol: "EURUSD", interval: "15m" },
      ctx: fakeCtx([]),
    });
    assert.deepEqual(intents, ["explain_chart_drawings"]);
    assert.ok(isDrawingOnly(intents));
  });

  it("selected user drawing question remains specialized and never mixed", () => {
    const intents = routeIntent({
      message: "what is this line I drew?",
      chartContext: { symbol: "EURUSD", interval: "15m", selectedDrawingId: "d1" },
      ctx: fakeCtx([]),
    });
    assert.deepEqual(intents, ["discuss_user_drawing"]);
    assert.equal(intents.includes("mixed_request"), false);
    assert.equal(intents.includes("new_trade_analysis"), false);
  });

  it("true cross-family request is marked mixed", () => {
    const intents = routeIntent({
      message: "analyze EURUSD and show account status",
      chartContext: { symbol: "EURUSD", interval: "15m" },
      ctx: fakeCtx([]),
    });
    assert.ok(intents.includes("new_trade_analysis"));
    assert.ok(intents.includes("account_status"));
    assert.ok(intents.includes("mixed_request"));
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

  it("an Arabic recommendation request routes to a new trade analysis", () => {
    const events: Array<Omit<AgentActivityEvent, "id" | "timestamp">> = [];
    const intents = routeIntent({
      message: "أعطني توصية جديدة",
      chartContext: { symbol: "XAUUSD", interval: "15m" },
      ctx: fakeCtx(events),
    });
    assert.ok(intents.includes("new_trade_analysis"));
    assert.deepEqual(intents, ["new_trade_analysis"]);
  });

  it("a scalp request routes to the canonical analysis", () => {
    const events: Array<Omit<AgentActivityEvent, "id" | "timestamp">> = [];
    const intents = routeIntent({
      message: "توصية سكالب",
      chartContext: { symbol: "XAUUSD", interval: "1m" },
      ctx: fakeCtx(events),
    });
    assert.ok(intents.includes("new_trade_analysis"));
  });

  it("draw-the-recommendation wording never triggers a new trade analysis", () => {
    const events: Array<Omit<AgentActivityEvent, "id" | "timestamp">> = [];
    const intents = routeIntent({
      message: "ارسم تفاصيل الصفقة",
      chartContext: { symbol: "XAUUSD", interval: "15m" },
      ctx: fakeCtx(events),
    });
    assert.ok(isDrawActiveRecommendation(intents));
    assert.equal(intents.includes("new_trade_analysis"), false);
    assert.equal(intents.includes("draw_on_chart"), false);
  });

  it("generic 'draw the analysis' is drawing-only, not a new trade analysis", () => {
    const events: Array<Omit<AgentActivityEvent, "id" | "timestamp">> = [];
    const intents = routeIntent({
      message: "ارسم التحليل",
      chartContext: { symbol: "XAUUSD", interval: "15m" },
      ctx: fakeCtx(events),
    });
    assert.equal(intents.includes("new_trade_analysis"), false);
  });

  it("'cancel the previous and analyze again' cancels AND analyzes", () => {
    const events: Array<Omit<AgentActivityEvent, "id" | "timestamp">> = [];
    const intents = routeIntent({
      message: "ألغ السابقة وحلل من جديد",
      chartContext: { symbol: "XAUUSD", interval: "15m" },
      ctx: fakeCtx(events),
    });
    assert.ok(intents.includes("cancel_active_recommendation"));
    assert.ok(intents.includes("new_trade_analysis"));
  });

  it("a plain cancel does not start a new analysis", () => {
    const events: Array<Omit<AgentActivityEvent, "id" | "timestamp">> = [];
    const intents = routeIntent({
      message: "ألغِ هذه التوصية",
      chartContext: { symbol: "XAUUSD", interval: "15m" },
      ctx: fakeCtx(events),
    });
    assert.ok(intents.includes("cancel_active_recommendation"));
    assert.equal(intents.includes("new_trade_analysis"), false);
  });
});
