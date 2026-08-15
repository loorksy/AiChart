import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeBotUsername } from "@/lib/telegram";

describe("normalizeBotUsername", () => {
  it("strips a pasted leading @ so t.me/<username> deep links stay valid", () => {
    assert.equal(normalizeBotUsername("@lonora_bot"), "lonora_bot");
    assert.equal(normalizeBotUsername("@@lonora_bot"), "lonora_bot");
    assert.equal(normalizeBotUsername("  @lonora_bot  "), "lonora_bot");
  });

  it("keeps a bare username and treats empty as missing", () => {
    assert.equal(normalizeBotUsername("lonora_bot"), "lonora_bot");
    assert.equal(normalizeBotUsername(""), null);
    assert.equal(normalizeBotUsername("   "), null);
    assert.equal(normalizeBotUsername(null), null);
    assert.equal(normalizeBotUsername(undefined), null);
  });
});
