import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { clearPlatformConfigCache } from "@/lib/platformConfig";
import { isAllowedModelRef } from "@/lib/modelCatalog";
import {
  getActiveModel,
  getActiveProvider,
  isLLMConfigured,
  isOpenRouterEnabled,
  isProviderReady,
  parseModelRef,
  parsePlatformProvider,
  resolveUserModelSelection,
} from "@/lib/llm";

const ENV_KEYS = [
  "AI_PROVIDER",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENROUTER_API_KEY",
  "OPENROUTER_ENABLED",
  "OPENROUTER_MODEL",
] as const;

const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

function stashEnv() {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
}

function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  clearPlatformConfigCache();
}

stashEnv();
afterEach(restoreEnv);

describe("OpenRouter provider (test gateway)", () => {
  it("parses nested OpenRouter model refs", () => {
    assert.deepEqual(parseModelRef("openrouter/openai/gpt-4o-mini"), {
      provider: "openrouter",
      model: "openai/gpt-4o-mini",
    });
    assert.equal(parseModelRef("openrouter/"), null);
    assert.equal(parseModelRef("unknown/foo"), null);
  });

  it("includes curated OpenRouter refs in the catalogue", () => {
    assert.equal(isAllowedModelRef("openrouter/openai/gpt-4o-mini"), true);
    assert.equal(isAllowedModelRef("openrouter/not-a-real-model"), false);
  });

  it("stays disabled unless the admin toggle is on", () => {
    clearPlatformConfigCache();
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    delete process.env.OPENROUTER_ENABLED;
    assert.equal(isOpenRouterEnabled(), false);
    assert.equal(isProviderReady("openrouter"), false);

    process.env.OPENROUTER_ENABLED = "1";
    clearPlatformConfigCache();
    assert.equal(isOpenRouterEnabled(), true);
    assert.equal(isProviderReady("openrouter"), true);

    process.env.OPENROUTER_ENABLED = "0";
    clearPlatformConfigCache();
    assert.equal(isOpenRouterEnabled(), false);
    assert.equal(isProviderReady("openrouter"), false);
  });

  it("activates OpenRouter as platform default only when ready", () => {
    clearPlatformConfigCache();
    process.env.AI_PROVIDER = "openrouter";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.OPENROUTER_MODEL = "openai/gpt-4o-mini";
    process.env.OPENROUTER_ENABLED = "1";

    assert.equal(parsePlatformProvider("openrouter"), "openrouter");
    assert.equal(getActiveProvider(), "openrouter");
    assert.equal(getActiveModel(), "openai/gpt-4o-mini");
    assert.equal(isLLMConfigured(), true);

    process.env.OPENROUTER_ENABLED = "0";
    clearPlatformConfigCache();
    assert.equal(getActiveProvider(), "openrouter");
    assert.equal(isLLMConfigured(), false);
  });

  it("resolveUserModelSelection ignores OpenRouter when disabled", async () => {
    clearPlatformConfigCache();
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.OPENROUTER_ENABLED = "0";

    assert.equal(
      await resolveUserModelSelection("openrouter/openai/gpt-4o-mini"),
      null,
    );

    process.env.OPENROUTER_ENABLED = "1";
    clearPlatformConfigCache();
    assert.deepEqual(
      await resolveUserModelSelection("openrouter/openai/gpt-4o-mini"),
      { provider: "openrouter", model: "openai/gpt-4o-mini" },
    );
  });
});
