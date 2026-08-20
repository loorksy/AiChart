import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { getDeepModel, getQuickModel, modelForTier } from "@/lib/llm";
import { clearPlatformConfigCache } from "@/lib/platformConfig";

describe("model tiers (item 15: fast/deep split)", () => {
  const origModel = process.env.AI_MODEL;
  const origQuick = process.env.AI_QUICK_MODEL;
  const origProvider = process.env.AI_PROVIDER;

  // These cases exercise the OpenAI tier env vars; the platform default
  // provider is Anthropic, so pin the provider the fixtures configure.
  beforeEach(() => {
    process.env.AI_PROVIDER = "openai";
    clearPlatformConfigCache();
  });
  afterEach(() => {
    if (origModel === undefined) delete process.env.AI_MODEL;
    else process.env.AI_MODEL = origModel;
    if (origQuick === undefined) delete process.env.AI_QUICK_MODEL;
    else process.env.AI_QUICK_MODEL = origQuick;
    if (origProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = origProvider;
    clearPlatformConfigCache();
  });

  it("quick falls back to deep when AI_QUICK_MODEL is unset (no split)", () => {
    process.env.AI_MODEL = "gpt-x-deep";
    delete process.env.AI_QUICK_MODEL;
    clearPlatformConfigCache();
    assert.equal(getDeepModel(), "gpt-x-deep");
    assert.equal(getQuickModel(), "gpt-x-deep");
    assert.equal(modelForTier("quick"), "gpt-x-deep");
    assert.equal(modelForTier("deep"), "gpt-x-deep");
  });

  it("quick uses AI_QUICK_MODEL when set; the decision tier stays on AI_MODEL", () => {
    process.env.AI_MODEL = "gpt-x-deep";
    process.env.AI_QUICK_MODEL = "gpt-x-quick";
    clearPlatformConfigCache();
    assert.equal(modelForTier("deep"), "gpt-x-deep");
    assert.equal(modelForTier("quick"), "gpt-x-quick");
    // The deep model is never the quick model when a split is configured.
    assert.notEqual(modelForTier("deep"), modelForTier("quick"));
  });
});
