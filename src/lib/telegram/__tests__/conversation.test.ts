import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyTelegramTurn,
  telegramGreeting,
  telegramLinkedWelcome,
} from "@/lib/telegram/conversation";
import { arabicReplyKeyboardRows } from "@/lib/telegramCommands";

describe("classifyTelegramTurn", () => {
  it("treats a hello as a greeting, not an analysis", () => {
    assert.equal(classifyTelegramTurn("مرحبا").kind, "greeting");
    assert.equal(classifyTelegramTurn("hello").kind, "greeting");
  });

  it("sends a chart photo ask to the snapshot path", () => {
    assert.equal(classifyTelegramTurn("ارسل صورة الشارت").kind, "chart_photo");
    assert.equal(classifyTelegramTurn("صورة الشارت").kind, "chart_photo");
  });

  it("routes a recommendation request to analysis", () => {
    assert.equal(classifyTelegramTurn("اعطني توصية").kind, "analysis");
    assert.equal(classifyTelegramTurn("توصية الذهب").kind, "analysis");
  });

  it("answers session status without a market run", () => {
    assert.equal(classifyTelegramTurn("حالة السوق").kind, "session");
  });
});

describe("the phone keyboard is recommendations-only", () => {
  it("offers analysis, chart, and session — never demo/live/trades", () => {
    const labels = arabicReplyKeyboardRows().flat();
    assert.ok(labels.includes("توصية الذهب"));
    assert.ok(labels.includes("صورة الشارت"));
    assert.ok(labels.includes("حالة السوق"));
    assert.ok(!labels.some((l) => /ديمو|حقيقي|صفقات|رصيد/.test(l)));
  });

  it("greets without leaking internal card taxonomy", () => {
    const text = `${telegramGreeting()}\n${telegramLinkedWelcome()}`;
    for (const leak of [
      "informational",
      "descriptive_only",
      "operational_blocker",
      "not_applicable",
    ]) {
      assert.equal(text.includes(leak), false);
    }
  });
});
