/**
 * Switching AI_PROVIDER must reach EVERY path — functionally, against a real
 * database, in one running process.
 *
 * The production failure this pins: the operator switched to Anthropic with a
 * valid key, the suggestions followed immediately, and analysis + chat kept
 * billing OpenAI. Two things had to be true for that, and both are asserted
 * here from the outside: a stale per-user pick could out-vote the operator,
 * and an env value could out-live the panel's own row.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { before, beforeEach, describe, it } from "node:test";

// Env FIRST — static app imports would hoist above these lines and bind the
// db module to the default dev path, so every repo module loads dynamically.
const dir = mkdtempSync(join(tmpdir(), "aichart-provider-switch-"));
process.env.DB_PATH = join(dir, "provider.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "provider-test-secret";
delete process.env.DATABASE_URL;
delete process.env.AI_PROVIDER;

let db: typeof import("@/lib/db");
let cfg: typeof import("@/lib/platformConfig");
let llm: typeof import("@/lib/llm");
let taxonomy: typeof import("@/lib/agent/errorTaxonomy");

/** Write config the way the admin panel does. */
async function setConfig(patch: Record<string, string | undefined>): Promise<void> {
  await cfg.savePlatformConfig(patch);
}

before(async () => {
  db = await import("@/lib/db");
  await db.initDb();
  cfg = await import("@/lib/platformConfig");
  llm = await import("@/lib/llm");
  taxonomy = await import("@/lib/agent/errorTaxonomy");
});

beforeEach(async () => {
  // Both keys on file throughout: readiness is never what is under test —
  // the operator's CHOICE is.
  await setConfig({
    OPENAI_API_KEY: "sk-test-openai",
    ANTHROPIC_API_KEY: "sk-test-anthropic",
    AI_MODEL: "gpt-4.1",
    ANTHROPIC_MODEL: "claude-sonnet-4-6",
  });
});

describe("the operator's choice governs every resolution", () => {
  it("switching the provider changes what the next call resolves — no restart", async () => {
    await setConfig({ AI_PROVIDER: "openai" });
    const first = await llm.resolveActiveSelection("deep");
    assert.equal(first.provider, "openai");
    assert.equal(first.model, "gpt-4.1");

    // The same live process, exactly as a running worker would be.
    await setConfig({ AI_PROVIDER: "anthropic" });
    const second = await llm.resolveActiveSelection("deep");
    assert.equal(second.provider, "anthropic", "the switch must apply without a restart");
    assert.equal(second.model, "claude-sonnet-4-6");
  });

  it("a stale per-user pick can never out-vote the operator", async () => {
    await setConfig({ AI_PROVIDER: "anthropic" });
    // The exact production shape: a preference saved while OpenAI was active,
    // whose key is still present and valid.
    const stale = await llm.resolveUserModelSelection("openai/gpt-4.1");
    assert.equal(stale, null, "a pick from a non-active provider is ignored, not pinned");

    // A pick WITHIN the active provider is still honoured — users keep
    // choosing which model answers.
    const withinActive = await llm.resolveUserModelSelection("anthropic/claude-opus-5");
    assert.ok(withinActive, "a model of the active provider stays selectable");
    assert.equal(withinActive.provider, "anthropic");
  });

  it("refuses a mismatched pick BY NAME instead of failing later", async () => {
    await setConfig({ AI_PROVIDER: "anthropic" });
    const checked = await llm.checkModelRef("openai/gpt-4.1");
    assert.equal(checked.ok, false);
    assert.equal(checked.ok === false && checked.reason, "provider_not_active");
    assert.equal(checked.ok === false && checked.activeProvider, "anthropic");
  });

  it("the pin narrows the model but never the provider", async () => {
    await setConfig({ AI_PROVIDER: "anthropic" });
    const pinned = await llm.resolveUserModelSelection("anthropic/claude-opus-5");
    const resolved = llm.withRequestModel(pinned, () => llm.getActiveProvider());
    assert.equal(resolved, "anthropic");
  });
});

describe("the panel outranks the environment", () => {
  it("an env AI_PROVIDER cannot beat the row the operator saved", async () => {
    await setConfig({ AI_PROVIDER: "anthropic" });
    process.env.AI_PROVIDER = "openai";
    try {
      // The sync reader used to answer from env AND cache that answer, which
      // then poisoned the async reader too.
      assert.equal(llm.getActiveProvider(), "anthropic", "the saved row wins");
      assert.equal(await llm.getActiveProviderAsync(), "anthropic");
      assert.equal((await llm.resolveActiveSelection("deep")).provider, "anthropic");
    } finally {
      delete process.env.AI_PROVIDER;
    }
  });

  it("env still serves a key the database does not carry", async () => {
    process.env.SOME_UNSAVED_KEY = "from-env";
    try {
      assert.equal(cfg.getPlatformValue("SOME_UNSAVED_KEY"), "from-env");
    } finally {
      delete process.env.SOME_UNSAVED_KEY;
    }
  });
});

describe("no path substitutes a provider on its own", () => {
  it("an explicit choice stands even when the other provider is the ready one", async () => {
    await setConfig({ AI_PROVIDER: "openai", ANTHROPIC_API_KEY: undefined });
    assert.equal(await llm.getActiveProviderAsync(), "openai");
    // And with the CHOSEN provider's key missing, the platform does not
    // quietly answer as somebody else.
    await setConfig({ AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: undefined });
    assert.equal(
      await llm.getActiveProviderAsync(),
      "anthropic",
      "a missing key is a configuration fault to report, never a reason to switch",
    );
  });

  it("with NO choice recorded, the platform may infer one from the keys", async () => {
    await setConfig({ AI_PROVIDER: undefined, ANTHROPIC_API_KEY: undefined });
    assert.equal(
      await llm.getActiveProviderAsync(),
      "openai",
      "inference is for a fresh install, where no operator choice exists yet",
    );
  });
});

describe("the operator can see which provider is failing", () => {
  it("records the outcome per provider, so a failure names its account", async () => {
    const health = await import("@/lib/providerHealth");
    await health.recordProviderFailure("openai", "provider_billing", "insufficient_quota");
    await health.recordProviderSuccess("anthropic");

    const rows = await health.readProviderHealth();
    const openai = rows.get("openai");
    const anthropic = rows.get("anthropic");
    assert.equal(openai?.last_failure_code, "provider_billing");
    assert.ok(openai?.last_failure_at, "the failing account is identifiable");
    assert.ok(anthropic?.last_success_at, "and the working one is not blamed for it");
    assert.equal(anthropic?.last_failure_code ?? null, null);
  });

  it("the panel offers a closed provider list, not a free-text field", () => {
    const panel = readFileSync(
      path.join(process.cwd(), "src/components/admin/AdminKeysPanel.tsx"),
      "utf8",
    );
    assert.match(panel, /data-testid="ai-provider-select"/);
    assert.match(panel, /<select/, "AI_PROVIDER is picked from a list");
    assert.match(panel, /ProviderStatusCard/, "per-provider status is on the page");
  });
});

describe("housekeeping stays cheap", () => {
  it("a chore falls back to a cheap model, never to the decision model", async () => {
    await setConfig({ AI_PROVIDER: "anthropic", ANTHROPIC_MODEL: "claude-opus-5" });
    const deep = await llm.resolveActiveSelection("deep");
    const chore = await llm.resolveActiveSelection("chore");
    assert.equal(deep.model, "claude-opus-5");
    assert.notEqual(chore.model, deep.model, "titling must not be billed at analysis rates");
    assert.match(chore.model, /haiku/, "the unconfigured default is the cheap model");
  });

  it("the operator can name the chore model from the panel", async () => {
    await setConfig({ AI_PROVIDER: "anthropic", ANTHROPIC_CHORE_MODEL: "claude-sonnet-4-6" });
    assert.equal((await llm.resolveActiveSelection("chore")).model, "claude-sonnet-4-6");
    await setConfig({ ANTHROPIC_CHORE_MODEL: undefined });
  });

  it("a user's model pick does not drag chores onto their model", async () => {
    await setConfig({ AI_PROVIDER: "anthropic", ANTHROPIC_MODEL: "claude-sonnet-4-6" });
    const pinned = await llm.resolveUserModelSelection("anthropic/claude-opus-5");
    const chore = await llm.withRequestModel(pinned, () => llm.resolveActiveSelection("chore"));
    assert.notEqual(chore.model, "claude-opus-5", "a chore is the platform's cost, not the user's pick");
  });
});

describe("a provider failure says which provider", () => {
  it("carries the provider from the call site to the user's sentence", () => {
    const err = new Error("429 insufficient_quota: You exceeded your current quota");
    llm.tagProviderFailure(err, "openai");
    const classified = taxonomy.classifyAgentError(err);
    assert.equal(classified.code, "provider_billing");
    assert.equal(classified.provider, "openai");

    const named = taxonomy.userMessageForFailure("provider_billing", "en", {
      provider: classified.provider,
    });
    assert.match(named, /OpenAI/, "the operator must read WHICH account is out of credit");
    assert.doesNotMatch(named, /Anthropic/);

    // Untagged failures keep the generic wording rather than guessing.
    const generic = taxonomy.userMessageForFailure("provider_billing", "en");
    assert.doesNotMatch(generic, /OpenAI|Anthropic/);
  });
});
