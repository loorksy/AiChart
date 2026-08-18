import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { clearPlatformConfigCache } from "@/lib/platformConfig";
import {
  DEFAULT_TOKENROUTER_MODEL,
  isAllowedModelRef,
  isReasoningModel,
} from "@/lib/modelCatalog";
import {
  getActiveModel,
  getActiveProvider,
  isLLMConfigured,
  isOfferedModelRef,
  isProviderReady,
  isTokenRouterEnabled,
  parseModelRef,
  parsePlatformProvider,
  resolveUserModelSelection,
} from "@/lib/llm";

const ENV_KEYS = [
  "AI_PROVIDER",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENROUTER_API_KEY",
  "TOKENROUTER_API_KEY",
  "TOKENROUTER_ENABLED",
  "TOKENROUTER_MODEL",
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

const DEEPSEEK_REF = `tokenrouter/${DEFAULT_TOKENROUTER_MODEL}`;

describe("TokenRouter provider (DeepSeek V4 Pro catalogue)", () => {
  it("parses nested TokenRouter model refs", () => {
    assert.deepEqual(parseModelRef(DEEPSEEK_REF), {
      provider: "tokenrouter",
      model: DEFAULT_TOKENROUTER_MODEL,
    });
    assert.equal(parseModelRef("tokenrouter/"), null);
    assert.equal(parseModelRef("unknown/foo"), null);
  });

  it("offers only the closed DeepSeek catalogue — not live-all routes", () => {
    assert.equal(isAllowedModelRef(DEEPSEEK_REF), true);
    assert.equal(
      isAllowedModelRef("tokenrouter/deepseek/deepseek-v3-0324"),
      false,
    );
    assert.equal(isAllowedModelRef("openrouter/openai/gpt-4o-mini"), false);
  });

  it("classifies DeepSeek V4 as a reasoning model for token headroom", () => {
    assert.equal(isReasoningModel(DEFAULT_TOKENROUTER_MODEL), true);
    assert.equal(isReasoningModel("deepseek-v4-pro-0813-free"), true);
    assert.equal(isReasoningModel("deepseek-v3-0324"), false);
  });

  it("is enabled by default; only an explicit off kills it", () => {
    clearPlatformConfigCache();
    process.env.TOKENROUTER_API_KEY = "sk-tr-test";
    delete process.env.TOKENROUTER_ENABLED;
    assert.equal(isTokenRouterEnabled(), true);
    assert.equal(isProviderReady("tokenrouter"), true);

    process.env.TOKENROUTER_ENABLED = "1";
    clearPlatformConfigCache();
    assert.equal(isTokenRouterEnabled(), true);
    assert.equal(isProviderReady("tokenrouter"), true);

    process.env.TOKENROUTER_ENABLED = "0";
    clearPlatformConfigCache();
    assert.equal(isTokenRouterEnabled(), false);
    assert.equal(isProviderReady("tokenrouter"), false);
  });

  it("activates TokenRouter as platform default when key is present", () => {
    clearPlatformConfigCache();
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    process.env.AI_PROVIDER = "tokenrouter";
    process.env.TOKENROUTER_API_KEY = "sk-tr-test";
    process.env.TOKENROUTER_MODEL = DEFAULT_TOKENROUTER_MODEL;
    delete process.env.TOKENROUTER_ENABLED;

    assert.equal(parsePlatformProvider("tokenrouter"), "tokenrouter");
    assert.equal(getActiveProvider(), "tokenrouter");
    assert.equal(getActiveModel(), DEFAULT_TOKENROUTER_MODEL);
    assert.equal(isLLMConfigured(), true);

    process.env.TOKENROUTER_ENABLED = "0";
    clearPlatformConfigCache();
    assert.equal(getActiveProvider(), "tokenrouter");
    assert.equal(isLLMConfigured(), false);
  });

  it("is configured when only TokenRouter has a key, even if AI_PROVIDER is openai", () => {
    clearPlatformConfigCache();
    delete process.env.AI_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    process.env.TOKENROUTER_API_KEY = "sk-tr-test";
    delete process.env.TOKENROUTER_ENABLED;

    assert.equal(parsePlatformProvider(process.env.AI_PROVIDER), "openai");
    assert.equal(isProviderReady("openai"), false);
    assert.equal(isProviderReady("tokenrouter"), true);
    assert.equal(isLLMConfigured(), true);
    assert.equal(getActiveProvider(), "tokenrouter");
    assert.equal(getActiveModel(), DEFAULT_TOKENROUTER_MODEL);
  });

  it("resolveUserModelSelection accepts the catalogue id when ready", async () => {
    clearPlatformConfigCache();
    process.env.TOKENROUTER_API_KEY = "sk-tr-test";
    process.env.TOKENROUTER_ENABLED = "0";

    assert.equal(await resolveUserModelSelection(DEEPSEEK_REF), null);

    delete process.env.TOKENROUTER_ENABLED;
    clearPlatformConfigCache();
    assert.deepEqual(await resolveUserModelSelection(DEEPSEEK_REF), {
      provider: "tokenrouter",
      model: DEFAULT_TOKENROUTER_MODEL,
    });
    assert.equal(
      await resolveUserModelSelection("tokenrouter/not-in-catalogue"),
      null,
    );
    assert.equal(
      await isOfferedModelRef({
        provider: "tokenrouter",
        model: DEFAULT_TOKENROUTER_MODEL,
      }),
      true,
    );
  });
});
