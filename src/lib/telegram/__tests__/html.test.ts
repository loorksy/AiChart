/**
 * HTML hygiene for a parse_mode:"HTML" bot.
 *
 * Both properties here were production failures waiting on their first user:
 * a model summary containing `<` 400'd the send, and a long answer 400'd the
 * send AND its fallback, so a successful analysis surfaced as the generic
 * error message.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  escapeTelegramHtml,
  splitTelegramMessage,
  TELEGRAM_TEXT_LIMIT,
} from "@/lib/telegram/html";

describe("escapeTelegramHtml", () => {
  it("escapes the three characters Telegram's parser trips on", () => {
    assert.equal(
      escapeTelegramHtml('السعر < 4000 & الهدف > 4050 "قوي"'),
      'السعر &lt; 4000 &amp; الهدف &gt; 4050 "قوي"',
    );
  });

  it("is idempotent-safe on ampersands (escapes first, so no double pass)", () => {
    // One pass over raw text; the & rule runs before < and > so entities the
    // MODEL wrote stay visible as text instead of becoming markup.
    assert.equal(escapeTelegramHtml("&lt;"), "&amp;lt;");
  });
});

describe("splitTelegramMessage", () => {
  it("returns short text untouched", () => {
    assert.deepEqual(splitTelegramMessage("مرحبا"), ["مرحبا"]);
  });

  it("splits on the blank line nearest the limit — a card boundary", () => {
    const block = "س".repeat(60);
    const text = Array.from({ length: 10 }, () => block).join("\n\n");
    const chunks = splitTelegramMessage(text, 200);
    assert.ok(chunks.length > 1);
    for (const chunk of chunks) {
      assert.ok(chunk.length <= 200, `chunk of ${chunk.length} exceeds limit`);
      // Splits land BETWEEN blocks: no chunk starts or ends mid-block.
      assert.ok(!chunk.startsWith("\n") && !chunk.endsWith("\n"));
    }
    assert.equal(chunks.join("\n\n"), text, "nothing lost, nothing reordered");
  });

  it("keeps a tag pair inside one chunk — markup opens and closes on a line", () => {
    const line = "<b>عنوان</b> نص يشرح السطر بطوله المعتاد";
    const text = Array.from({ length: 40 }, () => line).join("\n");
    for (const chunk of splitTelegramMessage(text, 300)) {
      const opens = (chunk.match(/<b>/g) ?? []).length;
      const closes = (chunk.match(/<\/b>/g) ?? []).length;
      assert.equal(opens, closes, "a split tore a tag pair across messages");
    }
  });

  it("hard-cuts only when a single line exceeds the whole limit", () => {
    const monster = "م".repeat(TELEGRAM_TEXT_LIMIT + 500);
    const chunks = splitTelegramMessage(monster);
    assert.equal(chunks.length, 2);
    assert.ok(chunks[0]!.length <= TELEGRAM_TEXT_LIMIT);
  });
});
