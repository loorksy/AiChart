/**
 * ONE source of truth for which brain answers — structurally.
 *
 * The bug this guard exists to prevent already happened in production. The
 * operator switched AI_PROVIDER to Anthropic with a valid key; the AI
 * suggestions immediately followed the switch, while analysis and chat kept
 * failing on OpenAI's exhausted billing. Two independent mechanisms let a
 * path answer on a provider the operator had not selected:
 *
 *   1. a per-user stored model preference was honoured whenever its provider
 *      merely had a key on file, and it pinned the whole run;
 *   2. the SYNC platform-config reader answered from process.env and cached
 *      that answer, so an env value could permanently beat the panel.
 *
 * What must stay true forever:
 *
 *   A. only lib/llm.ts talks to a provider client or builds a provider model
 *      object — every other path asks the resolver;
 *   B. only lib/llm.ts (plus the admin surfaces that DISPLAY config) reads
 *      the provider/model config keys;
 *   C. a user's stored pick is checked against the ACTIVE provider, not just
 *      against "some key exists";
 *   D. the sync config reader never writes env values into the DB cache.
 *
 * A failure here means the operator's choice in the panel is a suggestion
 * rather than a decision.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { listSourceFiles, valueImportSpecifiers, resolveSpecifier } from "./helpers/importGraph";

const SRC = path.join(process.cwd(), "src");
const REPO = process.cwd();

function rel(file: string): string {
  return path.relative(REPO, file).replaceAll(path.sep, "/");
}

const ALL = listSourceFiles(SRC).filter((f) => !f.includes("__tests__"));

/**
 * A. The provider CLIENTS (the modules that actually speak HTTP to OpenAI or
 * Anthropic, and the AI-SDK factories that build a callable model) may be
 * reached from exactly one place: the unified LLM layer, plus the resident
 * loop which needs an AI-SDK model object and gets its provider/model FROM
 * the resolver (asserted separately in C).
 */
test("only the LLM layer talks to a provider client", () => {
  const CLIENT_MODULES = ["@/lib/anthropic", "./anthropic", "@/lib/openaiCompat", "./openaiCompat"];
  const allowed = new Set(["src/lib/llm.ts"]);
  const offenders: string[] = [];

  for (const file of ALL) {
    const source = readFileSync(file, "utf8");
    for (const spec of valueImportSpecifiers(source)) {
      if (!CLIENT_MODULES.includes(spec)) continue;
      const resolved = resolveSpecifier(file, spec);
      if (!resolved) continue;
      const target = rel(resolved);
      if (target !== "src/lib/anthropic.ts" && target !== "src/lib/openaiCompat.ts") continue;
      if (allowed.has(rel(file))) continue;
      offenders.push(`${rel(file)} → ${target}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Only src/lib/llm.ts may call a provider client directly. Route the call through callLLM/callLLMStream so the operator's AI_PROVIDER governs it:\n  ${offenders.join("\n  ")}`,
  );
});

test("only the sanctioned surfaces build a provider model object", () => {
  // The AI-SDK factories pick a provider by construction, so their use is
  // limited to the resident loop, which asks the resolver first.
  const allowed = new Set(["src/lib/resident/agentLoop.ts"]);
  const offenders: string[] = [];
  for (const file of ALL) {
    const source = readFileSync(file, "utf8");
    if (!/@ai-sdk\/(anthropic|openai)/.test(source)) continue;
    if (allowed.has(rel(file))) continue;
    offenders.push(rel(file));
  }
  assert.deepEqual(
    offenders,
    [],
    `These modules construct a provider model themselves instead of asking the resolver:\n  ${offenders.join("\n  ")}`,
  );
});

/**
 * B. The provider/model CONFIG KEYS. Reading them anywhere but the resolver
 * is how a second, quietly divergent opinion about "the active provider"
 * gets born. The admin surfaces are exempt: their job is to show and edit
 * the very rows the resolver reads.
 */
test("only the resolver decides from the provider/model config keys", () => {
  const KEYS = ["AI_PROVIDER", "AI_MODEL", "ANTHROPIC_MODEL", "AI_QUICK_MODEL", "ANTHROPIC_QUICK_MODEL"];
  const allowed = new Set([
    // The resolver itself.
    "src/lib/llm.ts",
    // The field registry these keys are DEFINED in.
    "src/lib/platformConfig.ts",
    // Admin surfaces: display and edit, never decide.
    "src/components/admin/AdminKeysPanel.tsx",
    "src/app/api/admin/config/models/route.ts",
    "src/app/api/agent/models/route.ts",
  ]);
  const offenders: string[] = [];
  for (const file of ALL) {
    if (allowed.has(rel(file))) continue;
    const source = readFileSync(file, "utf8");
    for (const key of KEYS) {
      // Only a real config lookup counts, not the word appearing in prose.
      const lookup = new RegExp(`getPlatformValue(Async)?\\s*\\(\\s*["'\`]${key}["'\`]`);
      const envRead = new RegExp(`process\\.env\\.${key}\\b|process\\.env\\[["'\`]${key}["'\`]\\]`);
      if (lookup.test(source) || envRead.test(source)) {
        offenders.push(`${rel(file)} reads ${key}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `The active provider/model is resolved in ONE place (src/lib/llm.ts). These read the raw keys and can disagree with it:\n  ${offenders.join("\n  ")}`,
  );
});

/**
 * C. The rules inside the resolver that the graph cannot express.
 */
test("a stored user pick can never choose a different provider than the operator", () => {
  const llm = readFileSync(path.join(SRC, "lib/llm.ts"), "utf8");
  const fn = llm.slice(
    llm.indexOf("export async function resolveUserModelSelection"),
    llm.indexOf("export type ModelRefRejection"),
  );
  assert.ok(fn.length > 0, "resolveUserModelSelection must exist");
  assert.match(
    fn,
    /parsed\.provider !== \(await getActiveProviderAsync\(\)\)/,
    "a stored ref whose provider is not the active one must be refused",
  );
  // And the refusal must come BEFORE the key-presence check, which is what
  // used to let a stale OpenAI pick through.
  assert.ok(
    fn.indexOf("getActiveProviderAsync") < fn.indexOf("isProviderReadyAsync"),
    "the active-provider check must gate before mere key presence",
  );
});

test("an explicit operator choice is absolute — no silent substitution", () => {
  const llm = readFileSync(path.join(SRC, "lib/llm.ts"), "utf8");
  const decide = llm.slice(llm.indexOf("function decideProvider"), llm.indexOf("export function getActiveProvider"));
  assert.match(decide, /if \(choice\) return choice;/, "an explicit choice returns unchanged");
  // Inference may only happen when there is no choice at all.
  assert.ok(
    decide.indexOf("if (choice) return choice;") < decide.indexOf("ready("),
    "readiness may only be consulted after an explicit choice is ruled out",
  );
});

test("the resolver never auto-switches provider on a failure", () => {
  // The operator owns this decision. Nothing may write AI_PROVIDER outside
  // the admin save path, and no failure handler may re-point the platform.
  const offenders: string[] = [];
  for (const file of ALL) {
    if (rel(file) === "src/lib/platformConfig.ts") continue;
    const source = readFileSync(file, "utf8");
    if (/savePlatformConfig\s*\(\s*\{[^}]*AI_PROVIDER/.test(source)) {
      offenders.push(rel(file));
    }
  }
  assert.deepEqual(offenders, [], `Nothing may switch the provider on the operator's behalf:\n  ${offenders.join("\n  ")}`);
});

/**
 * D. The config reader itself: an env fallback must stay a fallback.
 */
test("the sync config reader never caches an env value over the database", () => {
  const cfg = readFileSync(path.join(SRC, "lib/platformConfig.ts"), "utf8");
  const fn = cfg.slice(
    cfg.indexOf("export function getPlatformValue("),
    cfg.indexOf("export async function getPlatformValueAsync"),
  );
  assert.ok(fn.length > 0, "getPlatformValue must exist");
  assert.doesNotMatch(
    fn,
    /cache\.set\s*\(/,
    "caching the env fallback makes it permanent and unbeatable by the panel",
  );
  // And the refresh must not expose an empty cache while it reloads.
  assert.doesNotMatch(
    cfg,
    /clearPlatformConfigCache\(\);\s*\n\s*populateFromRows\(await/,
    "clearing before an await leaves a window where every key reads as missing",
  );
});

/**
 * E. Housekeeping never runs on the decision model. Naming a chat in the
 * sidebar used to ask for the "quick" tier, which falls back to the DEEP
 * model when no quick model is configured — so every title was billed at
 * analysis rates.
 */
test("chat titling and summarization run on the chore tier, never the decision model", () => {
  const chores = [
    "lib/agent/chatHistory/composeChatMeta.ts",
    "lib/memoryLifecycle.ts",
  ];
  for (const file of chores) {
    const source = readFileSync(path.join(SRC, file), "utf8");
    assert.match(source, /tier:\s*"chore"/, `${file} must ask for the chore tier`);
    assert.doesNotMatch(
      source,
      /tier:\s*"deep"/,
      `${file} must never request the decision model`,
    );
  }
  // And the chore tier itself must not be able to reach the deep model.
  const llm = readFileSync(path.join(SRC, "lib/llm.ts"), "utf8");
  const resolver = llm.slice(
    llm.indexOf("export async function resolveActiveSelection"),
    llm.indexOf("/** Active model for the active provider"),
  );
  assert.match(
    resolver,
    /if \(tier === "chore"\) return \{ provider, model: CHORE_DEFAULT\[provider\] \}/,
    "an unconfigured chore falls back to the cheap default, not to deep",
  );
  assert.ok(
    resolver.indexOf('tier === "chore"') < resolver.indexOf('tier === "quick"'),
    "the chore fallback must be decided before the quick tier's fallback-to-deep",
  );
});

test("a provider failure is reported with the provider that produced it", () => {
  const llm = readFileSync(path.join(SRC, "lib/llm.ts"), "utf8");
  assert.match(llm, /tagProviderFailure\(err, provider\)/, "call failures carry their provider");
  const taxonomy = readFileSync(path.join(SRC, "lib/agent/errorTaxonomy.ts"), "utf8");
  assert.match(taxonomy, /providerOfFailure/, "the taxonomy reads that tag");
  assert.match(taxonomy, /fault\.named\.\$\{code\}/, "and words the message with the provider name");
});
