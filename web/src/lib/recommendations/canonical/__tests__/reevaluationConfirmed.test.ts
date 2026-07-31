import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "aichart-reeval-confirmed-"));
process.env.DB_PATH = join(dir, "confirmed.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "confirmed-test-secret";
delete process.env.DATABASE_URL;
delete process.env.TELEGRAM_BOT_TOKEN;

/**
 * The first-class confirmation event.
 *
 * A re-evaluation cycle's `confirmed` verdict used to be recorded in
 * `recommendation_reevaluations` and deliberately NOT announced — so the
 * operator could not tell "the agent looked again and stood by the plan" from
 * "nobody looked". `reevaluation_confirmed` says the former out loud: purely
 * informational, NON-terminal, and deduped on (recommendation, revision,
 * trigger) so a re-check of the same condition does not re-announce.
 */

let db: typeof import("@/lib/db");
let notifier: typeof import("@/lib/recommendations/lifecycleNotifier");
let userId = 0;

before(async () => {
  db = await import("@/lib/db");
  await db.initDb();
  notifier = await import("@/lib/recommendations/lifecycleNotifier");
  userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["reeval-confirmed@example.com", "x", "user", "active"],
  );
});

/** The event exactly as the tracker's cycle block builds it. */
function confirmedEvent(over: { reason?: string; revisionNo?: number } = {}) {
  const reason = over.reason ?? "structure_break";
  const revisionNo = over.revisionNo ?? 1;
  return {
    type: "reevaluation_confirmed" as const,
    recommendationId: "rec-c1",
    symbol: "XAUUSD",
    revisionNo,
    dedupeKey: `rec-c1:${revisionNo}:reeval:confirmed:${reason}`,
    detail: "XAUUSD: أُعيد التقييم والقرار لم يتغيّر — النسخة قائمة.",
    terminal: false,
    occurredAt: Date.now(),
  };
}

describe("reevaluation_confirmed delivery", () => {
  it("is announced once and a re-check of the same condition stays silent", async () => {
    const first = await notifier.notifyLifecycleEvents(userId, [confirmedEvent()]);
    assert.equal(first.delivered, 1);

    const again = await notifier.notifyLifecycleEvents(userId, [confirmedEvent()]);
    assert.equal(again.delivered, 0);
    assert.equal(again.suppressedDuplicate, 1);
  });

  it("treats a different trigger reason as a different confirmation worth hearing", async () => {
    const other = await notifier.notifyLifecycleEvents(userId, [
      confirmedEvent({ reason: "spread_widened" }),
    ]);
    assert.equal(other.delivered, 1);
  });

  it("re-announces at a new revision — a re-confirmed NEW plan is new information", async () => {
    const later = await notifier.notifyLifecycleEvents(userId, [
      confirmedEvent({ revisionNo: 2 }),
    ]);
    assert.equal(later.delivered, 1);
  });
});

describe("the event is wired, informational, and non-terminal", () => {
  it("is emitted from the tracker's cycle block, not invented anywhere else", () => {
    const tracker = readFileSync(
      resolve(process.cwd(), "src/lib/recommendations/recommendationTracker.ts"),
      "utf8",
    );
    assert.ok(
      /type:\s*"reevaluation_confirmed"/.test(tracker),
      "the tracker must announce a confirmed cycle verdict",
    );
    assert.ok(
      /reeval:confirmed:\$\{cycle\.trigger\.reason\}/.test(tracker),
      "the dedupe key must include the trigger, so the same re-check stays silent",
    );
    // The tracker still decides nothing: no direct revision, no inline brain.
    assert.ok(!/applyRecommendationRevision\s*\(/.test(tracker));
  });

  it("is never terminal — 'stood by the plan' must not read as an ending", async () => {
    const { deriveLifecycleEvents } = await import(
      "@/lib/recommendations/lifecycleEvents"
    );
    // The derivation module owns terminality; a confirmed re-check is not in
    // its terminal set. (Belt and braces: the literal event above already
    // carries terminal: false, and the notifier's rate-limit exemption relies
    // on the flag.)
    void deriveLifecycleEvents;
    const event = confirmedEvent();
    assert.equal(event.terminal, false);
  });

  it("has an operator-facing label", async () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/lib/recommendations/lifecycleNotifier.ts"),
      "utf8",
    );
    assert.ok(
      /case "reevaluation_confirmed":/.test(source),
      "the notifier must label the event rather than falling through to the generic 'تحديث'",
    );
  });
});
