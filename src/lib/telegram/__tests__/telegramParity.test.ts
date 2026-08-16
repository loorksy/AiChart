/**
 * Telegram parity: one brain, two transports.
 *
 * The bot was outbound-only — the platform pushed cards and the setup route
 * deliberately DELETED the webhook, so an operator could receive a
 * recommendation on their phone and had nowhere to ask for one. The link flow
 * was half-built the same way: the platform minted a `t.me/bot?start=CODE` deep
 * link and `consumeLinkCode` had no caller anywhere in the repo.
 *
 * What these tests hold is the shape of the fix rather than its prose:
 *
 *  - the update parser accepts what Telegram actually sends and refuses the
 *    rest, so a callback query or a photo cannot fall through into the engine;
 *  - the dedupe is real, because Telegram retries on ITS schedule and a
 *    40-second analysis is long enough to be retried mid-flight — the second
 *    run would store a second recommendation for one question;
 *  - the surface routes through the SAME orchestrator entry point, which is
 *    what "parity" means and the only thing that keeps the two answers from
 *    drifting;
 *  - no card carries an action, because there is nothing to execute.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import path from "node:path";
import {
  alreadyHandled,
  parseTelegramUpdate,
  resetTelegramDedupe,
} from "@/lib/telegram/webhookAgent";

const SRC = path.join(import.meta.dirname, "..", "..", "..");
const agentSource = readFileSync(
  path.join(SRC, "lib", "telegram", "webhookAgent.ts"),
  "utf8",
);
const routeSource = readFileSync(
  path.join(SRC, "app", "api", "telegram", "webhook", "route.ts"),
  "utf8",
);

const message = (over: Record<string, unknown> = {}) => ({
  update_id: 1,
  message: { chat: { id: 4242 }, text: "أعطني توصية", from: { id: 7 }, ...over },
});

describe("the update parser", () => {
  it("reads a plain message", () => {
    const parsed = parseTelegramUpdate(message());
    assert.equal(parsed?.chatId, "4242");
    assert.equal(parsed?.text, "أعطني توصية");
    assert.equal(parsed?.updateId, 1);
  });

  it("refuses an update with no text", () => {
    // A photo, a sticker, a location: nothing this surface answers, and
    // falling through would run the engine on an empty prompt.
    assert.equal(parseTelegramUpdate(message({ text: undefined })), null);
    assert.equal(parseTelegramUpdate(message({ text: "   " })), null);
  });

  it("refuses an update with no message at all", () => {
    assert.equal(parseTelegramUpdate({ update_id: 9, callback_query: {} }), null);
    assert.equal(parseTelegramUpdate({ message: { chat: { id: 1 }, text: "x" } }), null);
    assert.equal(parseTelegramUpdate(null), null);
    assert.equal(parseTelegramUpdate("not an update"), null);
  });

  it("accepts an edited message as a question", () => {
    const parsed = parseTelegramUpdate({
      update_id: 3,
      edited_message: { chat: { id: 5 }, text: "وماذا عن الشراء؟" },
    });
    assert.equal(parsed?.chatId, "5");
  });
});

describe("update dedupe", () => {
  it("handles an update once and ignores its retries", () => {
    resetTelegramDedupe();
    assert.equal(alreadyHandled(100), false, "first delivery does the work");
    assert.equal(alreadyHandled(100), true, "Telegram's retry must not re-run it");
    assert.equal(alreadyHandled(101), false, "a different update is not a retry");
  });

  it("forgets an update once Telegram has given up on it", () => {
    resetTelegramDedupe();
    const now = Date.now();
    assert.equal(alreadyHandled(200, now), false);
    assert.equal(alreadyHandled(200, now + 60_000), true);
    // Past the window the map is swept, so it cannot grow without bound on a
    // long-lived process.
    assert.equal(alreadyHandled(200, now + 11 * 60_000), false);
  });
});

describe("the surface shares the platform's brain", () => {
  it("answers through the same orchestrator entry point", () => {
    // The whole point of parity. A separate decision path here is how the two
    // surfaces start giving different answers to the same question.
    assert.match(agentSource, /runUnifiedChartAgent\(/);
    assert.match(agentSource, /from "@\/lib\/agent\/orchestrator"/);
  });

  it("analyses gold and nothing else", () => {
    assert.match(agentSource, /symbol: DATA_SYMBOL/);
    assert.doesNotMatch(agentSource, /EURUSD|GBPUSD|BTCUSD/);
  });

  it("consumes the link code the platform mints", () => {
    assert.match(agentSource, /consumeLinkCode/);
    assert.match(agentSource, /setTelegramChatId/);
  });

  it("never answers an unlinked chat with an analysis", () => {
    const unlinkedBranch = agentSource.indexOf("if (userId == null)");
    const analysisCall = agentSource.indexOf("runUnifiedChartAgent(");
    assert.ok(unlinkedBranch > 0 && unlinkedBranch < analysisCall);
  });
});

describe("cards carry links, never actions", () => {
  it("offers no callback button anywhere on this surface", () => {
    // A callback_data button is a control. There is nothing to control: the
    // platform places no orders, so a card that acts could only fail.
    assert.doesNotMatch(agentSource, /callback_data/);
  });

  it("subscribes to message updates only", () => {
    const telegram = readFileSync(path.join(SRC, "lib", "telegram.ts"), "utf8");
    assert.match(telegram, /allowed_updates: \["message"\]/);
    assert.doesNotMatch(telegram, /callback_query/);
  });
});

describe("the webhook route survives Telegram's retry contract", () => {
  it("verifies the secret token before doing any work", () => {
    const check = routeSource.indexOf("x-telegram-bot-api-secret-token");
    const work = routeSource.indexOf("handleTelegramMessage(");
    assert.ok(check > 0 && check < work, "the engine must not run for an unverified caller");
  });

  it("refuses to serve at all without a configured secret", () => {
    // An unsecured webhook URL is guessable, and the handler behind it runs the
    // whole decision engine on someone else's budget.
    assert.match(routeSource, /TELEGRAM_WEBHOOK_SECRET/);
    assert.match(routeSource, /webhook secret is not configured/);
  });

  it("dedupes before running the engine, not after", () => {
    const dedupe = routeSource.indexOf("alreadyHandled(");
    const work = routeSource.indexOf("handleTelegramMessage(");
    assert.ok(dedupe > 0 && dedupe < work);
  });

  it("acknowledges a malformed or unsupported update instead of erroring", () => {
    // A non-200 asks Telegram to redeliver the same broken update forever.
    assert.match(routeSource, /ignored: "unparseable"/);
    assert.match(routeSource, /ignored: "unsupported_update"/);
  });
});
