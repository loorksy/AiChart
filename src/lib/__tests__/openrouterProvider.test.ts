import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { clearPlatformConfigCache } from "@/lib/platformConfig";
import { isAllowedModelRef } from "@/lib/modelCatalog";
import {
  getActiveModel,
  getActiveProvider,
  isLLMConfigured,
  isOfferedModelRef,
  isOpenRouterEnabled,
  isProviderReady,
  parseModelRef,
  parsePlatformProvider,
  resolveUserModelSelection,
} from "@/lib/llm";
import {
  listOpenRouterFreeModels,
  listOpenRouterModels,
} from "@/lib/openaiCompat";

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

  it("has NO static OpenRouter catalogue — routes are offered live only", () => {
    // The static allow-list covers only the curated OpenAI/Anthropic trios.
    // OpenRouter refs validate through the live-gateway branch of
    // isOfferedModelRef (key ready + well-formed id), never a hardcoded list
    // that would go stale when OpenRouter rotates its free tier.
    assert.equal(isAllowedModelRef("openrouter/openai/gpt-4o-mini"), false);
    assert.equal(isAllowedModelRef("openrouter/not-a-real-model"), false);
    assert.equal(isAllowedModelRef("openai/gpt-5.6-luna-pro"), true);
    assert.equal(isAllowedModelRef("anthropic/claude-opus-5"), true);
  });

  it("is enabled by default; only an explicit off kills it", () => {
    clearPlatformConfigCache();
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    delete process.env.OPENROUTER_ENABLED;
    assert.equal(isOpenRouterEnabled(), true);
    assert.equal(isProviderReady("openrouter"), true);

    process.env.OPENROUTER_ENABLED = "1";
    clearPlatformConfigCache();
    assert.equal(isOpenRouterEnabled(), true);
    assert.equal(isProviderReady("openrouter"), true);

    process.env.OPENROUTER_ENABLED = "0";
    clearPlatformConfigCache();
    assert.equal(isOpenRouterEnabled(), false);
    assert.equal(isProviderReady("openrouter"), false);
  });

  it("activates OpenRouter as platform default when key is present", () => {
    clearPlatformConfigCache();
    process.env.AI_PROVIDER = "openrouter";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.OPENROUTER_MODEL = "openai/gpt-4o-mini";
    delete process.env.OPENROUTER_ENABLED;

    assert.equal(parsePlatformProvider("openrouter"), "openrouter");
    assert.equal(getActiveProvider(), "openrouter");
    assert.equal(getActiveModel(), "openai/gpt-4o-mini");
    assert.equal(isLLMConfigured(), true);

    process.env.OPENROUTER_ENABLED = "0";
    clearPlatformConfigCache();
    assert.equal(getActiveProvider(), "openrouter");
    assert.equal(isLLMConfigured(), false);
  });

  it("resolveUserModelSelection accepts dynamic OpenRouter ids when ready", async () => {
    clearPlatformConfigCache();
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.OPENROUTER_ENABLED = "0";

    assert.equal(
      await resolveUserModelSelection("openrouter/openai/gpt-4o-mini"),
      null,
    );

    delete process.env.OPENROUTER_ENABLED;
    clearPlatformConfigCache();
    assert.deepEqual(
      await resolveUserModelSelection("openrouter/openai/gpt-4o-mini"),
      { provider: "openrouter", model: "openai/gpt-4o-mini" },
    );
    assert.deepEqual(
      await resolveUserModelSelection("openrouter/google/gemini-2.0-flash-001"),
      { provider: "openrouter", model: "google/gemini-2.0-flash-001" },
    );
    assert.equal(
      await isOfferedModelRef({
        provider: "openrouter",
        model: "meta-llama/llama-3.1-8b-instruct",
      }),
      true,
    );
  });

  it("listOpenRouterModels maps the live catalogue", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: "openai/gpt-4o-mini",
              name: "OpenAI: GPT-4o Mini",
              created: 2,
              architecture: {
                modality: "text+image->text",
                input_modalities: ["text", "image"],
                output_modalities: ["text"],
              },
            },
            {
              id: "vendor/embed-only",
              name: "Embed",
              created: 3,
              architecture: {
                modality: "text->embeddings",
                output_modalities: ["embeddings"],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;
    try {
      const models = await listOpenRouterModels("sk-or-test");
      assert.equal(models.length, 1);
      assert.equal(models[0]?.id, "openai/gpt-4o-mini");
      assert.equal(models[0]?.display_name, "OpenAI: GPT-4o Mini");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("listOpenRouterFreeModels keeps only zero-cost routes", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: "vendor/paid-model",
              name: "Paid",
              created: 9,
              pricing: { prompt: "0.000002", completion: "0.000004" },
            },
            {
              id: "vendor/free-by-suffix:free",
              name: "Free by suffix",
              created: 5,
              // No pricing object — the :free suffix alone qualifies it.
            },
            {
              id: "vendor/free-by-pricing",
              name: "Free by pricing",
              created: 7,
              pricing: { prompt: "0", completion: "0" },
            },
            {
              id: "vendor/no-signals",
              name: "Unknown cost",
              created: 8,
              // Neither suffix nor pricing — must be assumed paid.
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;
    try {
      const models = await listOpenRouterFreeModels("sk-or-test");
      assert.deepEqual(
        models.map((m) => m.id),
        // newest-first: created 7 then 5
        ["vendor/free-by-pricing", "vendor/free-by-suffix:free"],
      );
    } finally {
      globalThis.fetch = original;
    }
  });
});
