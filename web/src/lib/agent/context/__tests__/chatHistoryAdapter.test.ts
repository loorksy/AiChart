import assert from "node:assert/strict";
import test from "node:test";
import { adaptAuthorizedChatHistory } from "../chatHistoryAdapter";

test("rejects cross-user history", () => {
  assert.throws(() => adaptAuthorizedChatHistory({
    authenticatedUserId: 1, ownerUserId: 2, authorizedChatId: "c", messages: [],
  }), /tenant mismatch/);
});

test("filters wrong-chat rows and extracts only public assistant result fields", () => {
  const adapted = adaptAuthorizedChatHistory({
    authenticatedUserId: 1,
    ownerUserId: 1,
    authorizedChatId: "c1",
    messages: [
      { id: "wrong", chatId: "c2", role: "user", content: "secret", createdAt: 1 },
      {
        id: "ok", chatId: "c1", role: "assistant", content: "Public summary", createdAt: 2,
        recommendationId: "r1", analysisId: "a1", symbol: "XAUUSD", interval: "15m",
        result: {
          decision: "buy", summary: "Public summary", publicReasoningSummary: ["liquidity"],
          recommendation: { entry: 2400, stop_loss: 2390, targets: [2420] },
          debugDecisionFlow: { secret: "must-not-appear" }, rawReasoning: "private",
        },
      },
    ],
  });
  assert.equal(adapted.length, 1);
  assert.match(adapted[0]!.content ?? "", /Decision: buy|Entry: 2400|Public reasoning: liquidity/);
  assert.doesNotMatch(adapted[0]!.content ?? "", /must-not-appear|private/);
});
