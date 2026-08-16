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
 *    rest, so a photo cannot fall through into the engine; option taps are
 *    parsed separately and never as a free-text prompt;
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
  parseTelegramCallback,
  parseTelegramStart,
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
  message: {
    message_id: 55,
    chat: { id: 4242 },
    text: "أعطني توصية",
    from: { id: 7 },
    ...over,
  },
});

describe("the update parser", () => {
  it("reads a plain message", () => {
    const parsed = parseTelegramUpdate(message());
    assert.equal(parsed?.chatId, "4242");
    assert.equal(parsed?.text, "أعطني توصية");
    assert.equal(parsed?.updateId, 1);
    assert.equal(parsed?.messageId, 55);
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

  it("reads an option tap as a callback, not as a typed message", () => {
    const parsed = parseTelegramCallback({
      update_id: 4,
      callback_query: {
        id: "cb-1",
        data: "o:deadbeef",
        from: { id: 7, username: "op" },
        message: {
          message_id: 88,
          chat: { id: 4242 },
          text: "أهلاً",
        },
      },
    });
    assert.equal(parsed?.chatId, "4242");
    assert.equal(parsed?.data, "o:deadbeef");
    assert.equal(parsed?.messageId, 88);
    assert.equal(parseTelegramCallback(message()), null);
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

  it("reads /start, /start@bot, and a bare 12-char hex code", () => {
    assert.deepEqual(parseTelegramStart("/start"), { code: null });
    assert.deepEqual(parseTelegramStart("/start@lonora_bot"), { code: null });
    assert.deepEqual(parseTelegramStart("/start 957deb00f11c"), {
      code: "957deb00f11c",
    });
    assert.deepEqual(parseTelegramStart("/start@lonora_bot 957deb00f11c"), {
      code: "957deb00f11c",
    });
    assert.deepEqual(parseTelegramStart("957deb00f11c"), {
      code: "957deb00f11c",
    });
    assert.equal(parseTelegramStart("مرحبا"), null);
  });

  it("resolves explicit commands and hands EVERYTHING else to the agent", () => {
    // The phrase classifier and its canned paragraphs are gone: a greeting,
    // an identity question, a session question — all generated live by the
    // same brain. Only explicit commands stay mechanical (/chart's photo).
    assert.match(agentSource, /resolveTelegramCommand/);
    assert.match(agentSource, /sendPhotoBuffer/);
    assert.doesNotMatch(agentSource, /classifyTelegramTurn|telegramGreeting|telegramMenu|telegramSessionStatus/);
  });

  it("never answers an unlinked chat with an analysis", () => {
    const unlinkedBranch = agentSource.indexOf("if (userId == null)");
    const analysisCall = agentSource.indexOf("runUnifiedChartAgent(");
    assert.ok(unlinkedBranch > 0 && unlinkedBranch < analysisCall);
  });
});

describe("cards carry links, never actions", () => {
  it("attaches agent-authored option taps, never execution controls", () => {
    assert.match(agentSource, /rememberInlineOptions/);
    assert.match(agentSource, /handleTelegramCallback/);
    assert.match(agentSource, /generateAgentSuggestions/);
    assert.match(agentSource, /TelegramLiveTurn/);
    assert.match(agentSource, /generated.length \? generated : undefined/);
    assert.doesNotMatch(agentSource, /optionsForTelegramFastPath/);
    assert.doesNotMatch(agentSource, /sendMessageWithReplyKeyboard/);
    assert.doesNotMatch(agentSource, /arabicReplyKeyboardRows/);
    assert.doesNotMatch(agentSource, /cmd:approve|cmd:reject|cmd:env:live/);
  });

  it("subscribes to messages and option callbacks", () => {
    const telegram = readFileSync(path.join(SRC, "lib", "telegram.ts"), "utf8");
    assert.match(telegram, /allowed_updates: \["message", "callback_query"\]/);
  });

  it("re-registers the webhook on process boot so a deploy cannot leave the bot deaf", () => {
    const instrumentation = readFileSync(
      path.join(SRC, "instrumentation.ts"),
      "utf8",
    );
    assert.match(instrumentation, /ensureTelegramWebhook/);
    const telegram = readFileSync(path.join(SRC, "lib", "telegram.ts"), "utf8");
    assert.match(telegram, /ipv4first/);
  });
});

describe("the webhook route survives Telegram's retry contract", () => {
  it("verifies the secret token before doing any work", () => {
    const check = routeSource.indexOf("x-telegram-bot-api-secret-token");
    const work = routeSource.indexOf("handleTelegramMessage(");
    const callback = routeSource.indexOf("handleTelegramCallback(");
    assert.ok(check > 0 && check < work, "the engine must not run for an unverified caller");
    assert.ok(check < callback);
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
    const callback = routeSource.indexOf("handleTelegramCallback(");
    assert.ok(dedupe > 0 && dedupe < work);
    assert.ok(dedupe < callback);
  });

  it("acknowledges a malformed or unsupported update instead of erroring", () => {
    // A non-200 asks Telegram to redeliver the same broken update forever.
    assert.match(routeSource, /ignored: "unparseable"/);
    assert.match(routeSource, /ignored: "unsupported_update"/);
  });
});

describe("the professional turn: progress, memory, and the right theatre", () => {
  it("wires the engine's stage narration into the live bubble", () => {
    // The engine narrated itself all along (emitStage); the surface passed a
    // no-op and the bubble froze for the whole run. The reporter is the wire.
    assert.match(agentSource, /emitStage: \(event\) => reporter\.onStage\(event\)/);
    assert.match(agentSource, /TelegramProgressReporter\.forLiveTurn/);
    // The narration channel too: the specialist's own sentences reach the
    // bubble, filtered to visible events exactly like the web stream.
    assert.match(agentSource, /event\.visible !== false/);
    // finish() must run before the answer replaces the bubble — a trailing
    // progress edit landing after finalize would overwrite the result.
    const finish = agentSource.indexOf("reporter.finish()");
    const deliver = agentSource.indexOf("renderToolsBlock(reporter.snapshot())");
    assert.ok(finish > 0 && deliver > 0 && finish < deliver);
  });

  it("appends the collapsed tools block, Telegram-native", () => {
    assert.match(agentSource, /<blockquote expandable>/);
    assert.match(agentSource, /renderToolsBlock/);
  });

  it("gives a conversational RESULT a conversation's shape — decided after, not guessed before", () => {
    // No pre-classification: one agent path, and the delivery splits on what
    // the run RETURNED. An informational result ships as the generated reply
    // alone — no cards, no suggestion chips, no report button, no tools block.
    const informational = agentSource.indexOf('result.decision === "informational"');
    assert.ok(informational > 0, "the informational delivery must exist");
    const cards = agentSource.indexOf("renderCardsForTelegram(deriveCards(result))");
    assert.ok(informational < cards, "the conversational delivery returns before the card path");
    const informationalBlock = agentSource.slice(informational, cards);
    assert.doesNotMatch(informationalBlock, /generateAgentSuggestions/);
    assert.doesNotMatch(informationalBlock, /reportLinkButtons/);
    assert.doesNotMatch(informationalBlock, /renderToolsBlock/);
  });

  it("shows no pre-printed status: the bubble is born from real events", () => {
    // wake()/think() fired two fixed strings at every user before any work
    // happened. The reporter now starts with typing only; the first REAL
    // stage or activity event creates the bubble, and a run that emits
    // nothing (a conversational answer) never shows one.
    assert.doesNotMatch(agentSource, /\.wake\(\)|\.think\(\)/);
    assert.match(agentSource, /emitActivity: \(event\) => \{/);
    assert.match(agentSource, /reporter\.onActivity\(event\.message\)/);
  });

  it("remembers the conversation like the web chat does", () => {
    // Same store, same builder, same token budget — one memory, two
    // transports. The session key is the chat's own stable id.
    assert.match(agentSource, /telegramSessionId\(message\.chatId\)/);
    assert.match(agentSource, /buildAgentConversationContext/);
    assert.match(agentSource, /tokenBudget: 2_400/);
    assert.match(agentSource, /appendMessage/);
    assert.match(agentSource, /ensureChat/);
  });

  it("escapes model text everywhere HTML is assembled", () => {
    const cards = readFileSync(
      path.join(SRC, "lib", "agent", "cards", "telegramCards.ts"),
      "utf8",
    );
    assert.match(cards, /escapeTelegramHtml/);
    assert.match(cards, /esc\(card\.summary\)/);
    assert.match(agentSource, /escapeTelegramHtml\(result\.summary\)/);
  });

  it("registers the command menu at boot, beside the webhook", () => {
    const telegram = readFileSync(path.join(SRC, "lib", "telegram.ts"), "utf8");
    assert.match(telegram, /setMyCommands/);
    assert.match(telegram, /arabicBotCommands\(\)/);
  });
});
