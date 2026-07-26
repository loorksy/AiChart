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
  assert.match(core, /chat-first Forex scalping assistant/);
  assert.match(core, /model alone owns the analytical decision/);
  assert.match(core, /Risk per Trade is the only trading setting/);
  assert.match(core, /valid stop-loss/);
  assert.match(core, /operator's language/);
});

test("canonical core states the three-layer doctrine", () => {
  const core = canonicalIdentityCore();
  // Direction is mandatory on a successful analysis...
  assert.match(core, /ends in one direction — BUY or SELL/);
  assert.match(core, /WAIT is not an analytical outcome/);
  // ...but an immediate entry is not, so the agent never invents a weak one.
  assert.match(core, /A direction is always required; an immediate entry is not/);
  assert.match(core, /plan type \(immediate, anticipatory, or conditional\)/);
  assert.match(core, /execution state/);
  // Evidence supports the decision; it never gates it.
  assert.match(core, /none of them decides whether it may exist/);
  assert.match(core, /Never claim statistical support without valid evidence/);
  // A real blocker stays a named blocker, never a disguised wait.
  assert.match(core, /name the operational blocker and its cause/);
});

test("Smart Chart Agent prompt derives from the canonical core", () => {
  assert.ok(
    SMART_CHART_AGENT_SYSTEM_PROMPT.startsWith(canonicalIdentityCore()),
    "chart prompt must start with the canonical identity core",
  );
  // The chart specialization keeps its methodology but never redefines identity.
  assert.match(SMART_CHART_AGENT_SYSTEM_PROMPT, /Chart runtime role/);
  assert.doesNotMatch(SMART_CHART_AGENT_SYSTEM_PROMPT, /You are AiChart Smart Chart Agent/);
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
