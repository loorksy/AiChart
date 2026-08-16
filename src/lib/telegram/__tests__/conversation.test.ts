import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyTelegramTurn,
  telegramGreeting,
  telegramLinkedWelcome,
} from "@/lib/telegram/conversation";
import { optionsForTelegramFastPath } from "@/lib/telegram/inlineOptions";

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

  it("authors follow-up chips for the turn instead of a persistent keyboard", () => {
    const greeting = optionsForTelegramFastPath("greeting").map((o) => o.label);
    const afterChart = optionsForTelegramFastPath("chart_photo").map((o) => o.label);
    assert.ok(greeting.includes("تحليل الشارت الحالي"));
    assert.ok(afterChart.includes("رأي شراء/بيع/انتظار"));
    assert.notDeepEqual(greeting, afterChart);
  });
});
