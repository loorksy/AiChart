import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyTelegramTurn,
  telegramGreeting,
  telegramLinkedWelcome,
} from "@/lib/telegram/conversation";

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

describe("the phone is a conversation, not a standing keypad", () => {
  it("greets without listing a fixed command bar", () => {
    const text = `${telegramGreeting()}\n${telegramLinkedWelcome()}`;
    assert.equal(text.includes("توصية الذهب"), false);
    assert.equal(text.includes("استخدم الأزرار"), false);
    assert.equal(text.includes("الأزرار تحت"), false);
    for (const leak of [
      "informational",
      "descriptive_only",
      "operational_blocker",
      "not_applicable",
    ]) {
      assert.equal(text.includes(leak), false);
    }
  });

  it("does not invent a button menu in the greeting prose", () => {
    assert.equal(telegramGreeting().includes("تحليل الشارت الحالي"), false);
    assert.equal(telegramLinkedWelcome().includes("افتح التقرير"), false);
  });
});
