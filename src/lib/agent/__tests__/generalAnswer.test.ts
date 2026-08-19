import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const SRC = readFileSync(new URL("../generalAnswer.ts", import.meta.url), "utf8");

describe("general-answer faults stay faults", () => {
  it("does not invent a descriptive greeting when the provider is down", () => {
    assert.doesNotMatch(SRC, /تعذّر معالجة السؤال حالياً/);
    assert.doesNotMatch(SRC, /catch\s*\{/);
    assert.match(SRC, /throw new Error\("LLM is not configured\."\)/);
  });
});
