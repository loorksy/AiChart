import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isOptionCallback,
  markChosenReply,
  optionsForTelegramFastPath,
  rememberInlineOptions,
  resetInlineOptions,
  resolveInlineOption,
  telegramSessionId,
} from "@/lib/telegram/inlineOptions";

describe("agent-authored Telegram inline options", () => {
  it("stores opaque o: tokens and resolves them only for that chat", () => {
    resetInlineOptions();
    const rows = rememberInlineOptions("4242", [
      { id: "analyze_chart", label: "تحليل الشارت الحالي", prompt: "حلّل الشارت الحالي." },
      { id: "draw_trendline", label: "رسم خط الاتجاه", prompt: "ارسم خط الاتجاه." },
    ]);
    const tokens = rows.flat().map((b) => {
      assert.ok("callback_data" in b);
      return b.callback_data;
    });
    assert.equal(tokens.length, 2);
    for (const token of tokens) {
      assert.equal(isOptionCallback(token), true);
    }
    const first = resolveInlineOption(tokens[0]!, "4242");
    assert.equal(first?.prompt, "حلّل الشارت الحالي.");
    assert.equal(resolveInlineOption(tokens[0]!, "4242"), null, "a tap is one-shot");
    assert.equal(resolveInlineOption(tokens[1]!, "9999"), null, "another chat cannot steal it");
    assert.equal(resolveInlineOption(tokens[1]!, "4242")?.label, "رسم خط الاتجاه");
  });

  it("refuses leftover execution-shaped callbacks", () => {
    resetInlineOptions();
    assert.equal(isOptionCallback("cmd:approve:12"), false);
    assert.equal(isOptionCallback("cmd:env:live"), false);
    assert.equal(resolveInlineOption("cmd:approve:12", "1"), null);
  });

  it("authors greeting chips from the turn, not a standing keypad", () => {
    const greeting = optionsForTelegramFastPath("greeting");
    const labels = greeting.map((o) => o.label);
    assert.ok(labels.includes("تحليل الشارت الحالي"));
    assert.ok(!labels.includes("توصية الذهب"));
    assert.ok(!labels.includes("حالة السوق"));
    assert.equal(telegramSessionId("7"), "tg:7");
  });

  it("marks the chosen option on the original message", () => {
    assert.equal(markChosenReply("أهلاً", "تحليل الشارت الحالي"), "أهلاً\n\n✓ تحليل الشارت الحالي");
    assert.equal(markChosenReply(undefined, "x"), "…\n\n✓ x");
  });
});
