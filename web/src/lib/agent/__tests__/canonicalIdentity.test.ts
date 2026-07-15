import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  BUILTIN_IDENTITY_CORE,
  canonicalIdentity,
  canonicalIdentityCore,
} from "@/lib/agent/canonicalIdentity";
import {
  GENERAL_ANSWER_SUFFIX,
  SMART_CHART_AGENT_SYSTEM_PROMPT,
} from "@/lib/agent/systemPrompt";

const SYSTEM_MD = resolve(process.cwd(), "..", "agent", "workspace", "SYSTEM.md");

/** Normalize EOL so Windows checkouts (CRLF) stay comparable to LF sources. */
function normalizeEol(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function systemMdCore(): string {
  const raw = readFileSync(SYSTEM_MD, "utf8");
  const start = raw.indexOf("<!-- instructions-core-start -->");
  const end = raw.indexOf("<!-- instructions-core-end -->");
  assert.ok(start >= 0 && end > start, "SYSTEM.md must contain the core block");
  return normalizeEol(
    raw.slice(start + "<!-- instructions-core-start -->".length, end).trim(),
  );
}

test("canonical identity loads the SYSTEM.md core block from the repository", () => {
  const identity = canonicalIdentity(true);
  assert.equal(identity.source, "file");
  assert.equal(normalizeEol(identity.text), systemMdCore());
});

test("builtin fallback stays byte-identical to the SYSTEM.md core block", () => {
  assert.equal(normalizeEol(BUILTIN_IDENTITY_CORE), systemMdCore());
});

test("canonical core carries the identity and the hard rules", () => {
  const core = canonicalIdentityCore();
  assert.match(core, /The Expert/);
  assert.match(core, /AiChart Trading Agent/);
  assert.match(core, /Risk Guard is absolute/);
  assert.match(core, /mandatory stop-loss/);
  assert.match(core, /same language as the operator/);
});

test("Smart Chart Agent prompt derives from the canonical core", () => {
  assert.ok(
    SMART_CHART_AGENT_SYSTEM_PROMPT.startsWith(canonicalIdentityCore()),
    "chart prompt must start with the canonical identity core",
  );
  // The chart specialization keeps its methodology but never redefines identity.
  assert.match(SMART_CHART_AGENT_SYSTEM_PROMPT, /Chart runtime role/);
  assert.doesNotMatch(SMART_CHART_AGENT_SYSTEM_PROMPT, /You are Lonora Smart Chart Agent/);
});

test("expert persona derives from the canonical core", async () => {
  const { buildSystemPrompt } = await import("@/lib/persona");
  const parts = await buildSystemPrompt({
    mode: "approval",
    style: "balanced",
    experience: "expert",
    daily_loss_limit_pct: 5,
    daily_profit_target_pct: 5,
  } as never);
  assert.ok(
    parts.static.startsWith(canonicalIdentityCore()),
    "expert persona must start with the canonical identity core",
  );
});

test("old V1 identities and analysis-only instructions are absent", () => {
  const prompts = [SMART_CHART_AGENT_SYSTEM_PROMPT, GENERAL_ANSWER_SUFFIX];
  for (const prompt of prompts) {
    assert.doesNotMatch(prompt, /spot USDT/i);
    assert.doesNotMatch(prompt, /Binance/i);
    assert.doesNotMatch(prompt, /crypto/i);
    assert.doesNotMatch(prompt, /analysis[- ]only assistant/i);
  }
});

test("general-answer suffix mirrors the operator language instead of forcing Arabic", () => {
  assert.match(GENERAL_ANSWER_SUFFIX, /same language as the operator/i);
  assert.doesNotMatch(GENERAL_ANSWER_SUFFIX, /أجب.*بالعربية/);
});
