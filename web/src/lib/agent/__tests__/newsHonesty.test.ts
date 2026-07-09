import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runNewsMacroAgent } from "@/lib/agent/agents/newsMacroAgent";
import type { AgentActivityEvent, AgentRunContext } from "@/lib/agent/types";

function fakeCtx(
  events: Array<Omit<AgentActivityEvent, "id" | "timestamp">>,
): AgentRunContext {
  return { requestId: "t", emitActivity: (e) => events.push(e) };
}

describe("newsMacroAgent honesty (no provider configured)", () => {
  it("never claims to review news and returns newsRisk=unknown", async () => {
    // Ensure no provider keys leak in from the environment.
    delete process.env.NEWS_API_KEY;
    delete process.env.ECONOMIC_CALENDAR_API_KEY;

    const events: Array<Omit<AgentActivityEvent, "id" | "timestamp">> = [];
    const res = await runNewsMacroAgent(fakeCtx(events), {
      symbol: "EURUSD",
      message: "هل توجد أخبار؟",
    });

    assert.equal(res.newsRisk, "unknown");
    assert.equal(res.reason, "News provider is not configured.");
    // No event may claim a news review happened.
    assert.equal(
      events.some((e) => String(e.message).includes("أراجع الأخبار")),
      false,
    );
    assert.equal(
      events.some((e) => String(e.message).includes("راجعت الأخبار")),
      false,
    );
    // The honest "provider not configured" warning IS emitted.
    assert.equal(
      events.some((e) => String(e.message).includes("مزوّد الأخبار غير مفعّل")),
      true,
    );
  });
});
