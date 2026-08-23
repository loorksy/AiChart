/**
 * A model name the operator reads must be the model that answers, and a model
 * saved for a provider must belong to it.
 *
 * Two live reports sit behind this:
 *
 *  - `/model` on Telegram answered "claude-sonnet-4-6" regardless of anything.
 *    It never called the resolver: it read the stored per-user pick and, when
 *    that was unset, a COMPILE-TIME CONSTANT. So it reported Sonnet 4.6 while
 *    the operator's configured model was something else, would print an
 *    Anthropic name while the platform was pointed at OpenAI, and echoed a
 *    stale pick the resolver silently ignores at run time. A "current model"
 *    line that can be wrong about the current model is worse than none.
 *  - "Provider out of credit" appeared while the provider was Anthropic. The
 *    platform has no function that infers a provider from a model's shape, so
 *    `ANTHROPIC_MODEL = gpt-4.1` saved cleanly and failed later as a provider
 *    fault — which reads as "the AI account is broken" and sends the operator
 *    to top up an account that was never the problem.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  ANTHROPIC_MODEL_CHOICES,
  OPENAI_MODEL_CHOICES,
  modelBelongsToProvider,
  modelLooksLikeProvider,
} from "@/lib/modelCatalog";

const REPO = path.join(import.meta.dirname, "..", "..", "..");

describe("a model belongs to exactly one provider", () => {
  it("the configured deep model is a real Anthropic model", () => {
    // The live configuration. `claude-sonnet-4-6` IS a current Anthropic
    // model — the reported symptom was never a bad model name.
    assert.equal(modelBelongsToProvider("anthropic", "claude-sonnet-4-6"), true);
    assert.equal(modelBelongsToProvider("openai", "claude-sonnet-4-6"), false);
  });

  it("no catalogue entry is claimed by both providers", () => {
    const anthropic = new Set(ANTHROPIC_MODEL_CHOICES.map((m) => m.id));
    const overlap = OPENAI_MODEL_CHOICES.filter((m) => anthropic.has(m.id));
    assert.deepEqual(overlap, [], "a model id must name one provider only");
  });

  it("the cross-provider mistake is caught, and a new model still passes", () => {
    // Deliberately looser than the catalogue: providers ship models faster
    // than this repo lists them, and refusing a brand-new correctly-paired
    // model would be worse than the bug being fixed.
    assert.equal(modelLooksLikeProvider("anthropic", "gpt-4.1"), false);
    assert.equal(modelLooksLikeProvider("openai", "claude-opus-5"), false);
    assert.equal(modelLooksLikeProvider("anthropic", "claude-not-released-yet"), true);
    assert.equal(modelLooksLikeProvider("openai", "gpt-9-future"), true);
  });
});

describe("the admin panel refuses a mismatched model by name", () => {
  it("the config route validates the model fields against their provider", () => {
    const route = readFileSync(
      path.join(REPO, "src", "app", "api", "admin", "config", "route.ts"),
      "utf8",
    );
    assert.match(route, /modelLooksLikeProvider/);
    // Every model field is bound to the provider it belongs to.
    for (const field of ["ANTHROPIC_MODEL", "AI_MODEL"]) {
      assert.ok(route.includes(field), `${field} is not validated`);
    }
    // Refused by NAME: the message carries the model and the provider.
    assert.match(route, /config\.model_wrong_provider/);
  });

  it("the refusal names the model and the provider in both languages", async () => {
    const { t } = await import("@/lib/i18n");
    for (const locale of ["ar", "en"] as const) {
      const message = t(locale, "config.model_wrong_provider", {
        model: "gpt-4.1",
        field: "ANTHROPIC_MODEL",
        provider: "Anthropic",
      });
      assert.match(message, /gpt-4\.1/, "the operator is told WHICH model");
      assert.match(message, /Anthropic/, "and which provider it does not belong to");
      assert.doesNotMatch(message, /\{/, "no unfilled placeholder");
    }
  });
});

describe("the displayed model is the model that will answer", () => {
  it("Telegram's /model reads the resolver, not a constant", () => {
    const bot = readFileSync(
      path.join(REPO, "src", "lib", "telegram", "webhookAgent.ts"),
      "utf8",
    );
    const menu = bot.slice(bot.indexOf("tg.model_current") - 3000, bot.indexOf("tg.model_current"));
    assert.match(
      menu,
      /resolveActiveSelection\("deep"\)/,
      "the current line must come from the same resolver the run uses",
    );
    // A stored pick only counts when the resolver would honour it.
    assert.match(menu, /checkModelRef\(storedRef\)/);
    assert.doesNotMatch(
      menu,
      /settings\.telegram_model_ref \?\? PLATFORM_DEFAULT_MODEL_REF/,
      "the compile-time constant must not stand in for the live selection",
    );
  });

  it("the model catalogue route follows the ACTIVE provider", () => {
    // With Anthropic active this route used to answer 400 "enter your
    // OPENAI_API_KEY", because it named OpenAI in every branch.
    const route = readFileSync(
      path.join(REPO, "src", "app", "api", "admin", "config", "models", "route.ts"),
      "utf8",
    );
    assert.match(route, /getActiveProviderAsync\(\)/);
    assert.doesNotMatch(
      route,
      /getProviderApiKey\("openai"\)/,
      "the key it checks must be the active provider's",
    );
    assert.doesNotMatch(
      route,
      /provider: "openai"/,
      "and the provider it reports must be the active one",
    );
  });
});
