import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { routeIntent, isGeneralOnly } from "@/lib/agent/intentRouter";
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
      message: "كيف حال الطقس في إسطنبول الآن؟",
      chartContext: {},
      ctx: fakeCtx(events),
    });
    assert.deepEqual(intents, ["general_question"]);
    assert.ok(isGeneralOnly(intents));
    assert.equal(
      events.some((e) => String(e.message).includes("OANDA")),
      false,
    );
    assert.equal(
      events.some((e) => String(e.message).includes("شموع")),
      false,
    );
  });

  it("chart question triggers chart_analysis intent", () => {
    const events: Array<Omit<AgentActivityEvent, "id" | "timestamp">> = [];
    const intents = routeIntent({
      message: "حلل الذهب الآن",
      chartContext: { symbol: "XAUUSD", interval: "15m" },
      ctx: fakeCtx(events),
    });
    assert.ok(intents.includes("chart_analysis"));
    assert.ok(!isGeneralOnly(intents));
  });

  it("execution wording triggers trade_execution intent", () => {
    const events: Array<Omit<AgentActivityEvent, "id" | "timestamp">> = [];
    const intents = routeIntent({
      message: "نفذ صفقة شراء على اليورو",
      ctx: fakeCtx(events),
    });
    assert.ok(intents.includes("trade_execution"));
  });

  it("news wording triggers market_news intent", () => {
    const events: Array<Omit<AgentActivityEvent, "id" | "timestamp">> = [];
    const intents = routeIntent({
      message: "هل توجد أخبار مؤثرة على الدولار؟",
      ctx: fakeCtx(events),
    });
    assert.ok(intents.includes("market_news"));
  });
});
