import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shortModelLabel } from "@/lib/modelCatalog";

describe("shortModelLabel", () => {
  it("drops the company so the composer shows the model only", () => {
    assert.equal(shortModelLabel("Claude Fable 5"), "Fable 5");
    assert.equal(shortModelLabel("Claude Opus 5"), "Opus 5");
    assert.equal(shortModelLabel("Claude Sonnet 5"), "Sonnet 5");
    assert.equal(shortModelLabel("OpenAI: GPT-4o Mini"), "GPT-4o Mini");
    assert.equal(shortModelLabel("Anthropic: Claude Opus 5"), "Opus 5");
  });

  it("leaves names that already have no company prefix", () => {
    assert.equal(shortModelLabel("GPT-5.6 Luna Pro"), "GPT-5.6 Luna Pro");
    assert.equal(shortModelLabel("Fable 5"), "Fable 5");
  });
});
