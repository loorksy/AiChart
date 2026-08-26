/**
 * Same session, same answer — the Telegram contradiction, pinned.
 *
 * The transcript this reproduces (a real one, translated):
 *
 *   bot:  "the active recommendation (conditional sell at 4688.51) still stands"
 *   user: "what is the recommendation's status?"
 *   bot:  "no recommendation is stored in this session right now"
 *   user: "what do you have?"
 *   bot:  describes the active recommendation again
 *
 * The middle turn was the only one that asked the SESSION-KEYED store. The
 * first message came from the lifecycle notifier (user-scoped) and the last
 * from conversation context (also user-scoped) — but the deterministic status
 * handler restored from the DB only when the tracked row's chatId exactly
 * equalled the asking session key. A worker restart cleared the in-memory
 * copy, the exact-match restore found nothing, and one user got three answers
 * about one plan.
 *
 * The rule now: a user's live plan is a fact about the USER. When the
 * session-keyed lookup misses, the user's newest live tracked recommendation
 * answers — on Telegram, on the web, anywhere the same user asks.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { gatedTrackedPlan } from "@/lib/recommendations/__tests__/fixtures/completePlan";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "lonora-rec-consistency-")), "test.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "test-secret";
delete process.env.DATABASE_URL;

describe("session recommendation consistency (the Telegram transcript)", () => {
  let userId = 0;
  const telegramSession = "tg:424242";

  before(async () => {
    const db = await import("@/lib/db");
    await db.initDb();
    userId = await db.insertReturningId(
      "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
      ["consistency@rec.com", "x", "user", "active"],
    );
    const store = await import("@/lib/recommendations/recommendationStore");
    const now = Date.now();
    // The plan from the transcript: a conditional sell, created under a chat
    // key that is NOT the Telegram session asking about it.
    await store.createTrackedRecommendation({
      ...(await gatedTrackedPlan(userId, {
        planType: "conditional",
        analysisId: "consistency-analysis-1",
        symbol: "XAUUSD",
      })),
      id: "rec-consistency-1",
      userId,
      chatId: "web-chat-9f2",
      symbol: "XAUUSD",
      interval: "15m",
      direction: "sell",
        entryType: "limit",
      entry: 4688.51,
      stopLoss: 4702,
      targets: [4664, 4640],
      status: "pending_entry",
      outcome: "pending",
      rr: 2.1,
      createdAt: now,
      createdCandleTime: now,
      expiresAt: now + 6 * 60 * 60_000,
    });
  });

  it("the status question between two turns that saw the plan sees it too", async () => {
    const {
      getActiveRecommendation,
      isActiveRecommendationLive,
      resetSessionRecommendationStoreForTests,
    } = await import("@/lib/agent/sessionRecommendation");

    // A worker restart between the turns: the in-memory cache is gone and the
    // DB restore is all there is — exactly the transcript's middle turn.
    resetSessionRecommendationStoreForTests();

    const seen = await getActiveRecommendation(telegramSession, "XAUUSD", userId);
    assert.ok(seen, "the user's live plan must answer, not 'nothing is stored'");
    assert.equal(seen.direction, "sell");
    assert.equal(seen.entry, 4688.51);
    assert.equal(isActiveRecommendationLive(seen), true);
  });

  it("consecutive turns of one session agree with each other", async () => {
    const { getActiveRecommendation, resetSessionRecommendationStoreForTests } =
      await import("@/lib/agent/sessionRecommendation");
    resetSessionRecommendationStoreForTests();

    const first = await getActiveRecommendation(telegramSession, "XAUUSD", userId);
    const second = await getActiveRecommendation(telegramSession, "XAUUSD", userId);
    const third = await getActiveRecommendation(telegramSession, undefined, userId);
    assert.ok(first && second && third);
    assert.equal(first.id, second.id, "turn N and turn N+1 must describe one plan");
    assert.equal(second.id, third.id, "a symbol-less status question is the same question");
  });

  it("the session-keyed row still wins when one exists", async () => {
    const {
      getActiveRecommendation,
      rememberActiveRecommendation,
      resetSessionRecommendationStoreForTests,
    } = await import("@/lib/agent/sessionRecommendation");
    resetSessionRecommendationStoreForTests();

    // A plan minted IN this session outranks the cross-session fallback.
    await rememberActiveRecommendation({
      id: "rec-consistency-own",
      userId,
      analysisId: "own-analysis",
      sessionId: telegramSession,
      symbol: "XAUUSD",
      interval: "15m",
      createdAt: Date.now(),
      direction: "buy",
      entry: 4700,
      stopLoss: 4690,
      targets: [4720],
      status: "pending_entry",
      invalidationLevel: 4690,
      invalidationRule: "إغلاق تحت 4690",
      summary: "خطة هذه الجلسة",
      keyReasons: [],
      riskWarnings: [],
      publicReasoningSummary: [],
    });
    const seen = await getActiveRecommendation(telegramSession, "XAUUSD", userId);
    assert.equal(seen?.id, "rec-consistency-own");
  });
});
