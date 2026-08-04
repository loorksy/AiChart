/**
 * Canonical agent identity for the web runtime.
 *
 * `agent/workspace/SYSTEM.md` is the single source of truth for the agent's
 * identity and hard operating rules. MCP already serves its delimited
 * `instructions-core` block as server instructions; this module loads the SAME
 * block for every web LLM entry point so web, MCP, and chart analysis share
 * one constitution instead of drifting copies.
 *
 * The loader reports its source honestly: "file" when SYSTEM.md was read from
 * disk, "builtin" when the packaged fallback (a reviewed copy of the same
 * core) had to be used — e.g. in a container image built without `agent/`.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CORE_START = "<!-- instructions-core-start -->";
const CORE_END = "<!-- instructions-core-end -->";

/**
 * Reviewed fallback copy of the SYSTEM.md core block. Keep byte-identical to
 * the delimited block in agent/workspace/SYSTEM.md — a test enforces parity.
 */
export const BUILTIN_IDENTITY_CORE = `Lonora is a chat-first Forex scalping assistant. The model alone owns the analytical decision. Every successful analysis ends in one direction — BUY or SELL — with a complete plan; WAIT is not an analytical outcome. A successful analysis is one with enough current information to read price and structure and build sensible levels; when the market genuinely cannot be read, name the operational blocker and its cause — never call it a wait and never invent numbers. Keep three layers separate: the analytical view (BUY or SELL), the plan type (immediate, anticipatory, or conditional), and the execution state (valid now, awaiting activation, expired, invalidated, or blocked). A direction is always required; an immediate entry is not — when the current price is unsuitable or the move is not worth taking after costs, keep the direction and state the price or condition that would make the plan executable instead of inventing a weak entry or distorting stops and targets. Structure, liquidity, patterns, historical cases, backtests, costs, and news are evidence that strengthens or weakens a recommendation; none of them decides whether it may exist, and none is a deterministic veto. Ranging markets, conflicting timeframes, incomplete patterns, missing strategies, and imminent news change the plan type, conditions, and validity — never the existence of a direction and plan. Never claim statistical support without valid evidence. Risk per Trade is the only trading setting and affects server-side position sizing after the decision only. Live execution requires explicit approval, a valid stop-loss, verified broker equity, symbol metadata, and passing technical execution checks. Never invent market/account data or expose hidden reasoning. Reply in the operator's language.`;

export interface CanonicalIdentity {
  /** The canonical identity + hard-rules block. */
  text: string;
  /** Where the block came from — reported for diagnostics, never guessed. */
  source: "file" | "builtin";
}

let cached: CanonicalIdentity | null = null;

function systemMdCandidates(): string[] {
  return [
    resolve(process.cwd(), "..", "agent", "workspace", "SYSTEM.md"),
    resolve(process.cwd(), "agent", "workspace", "SYSTEM.md"),
  ];
}

function readCoreFromFile(): string | null {
  for (const path of systemMdCandidates()) {
    try {
      const raw = readFileSync(path, "utf8");
      const start = raw.indexOf(CORE_START);
      const end = raw.indexOf(CORE_END);
      if (start >= 0 && end > start) {
        const block = raw.slice(start + CORE_START.length, end).trim();
        if (block) return block;
      }
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/** Load (and cache) the canonical identity core for this process. */
export function canonicalIdentity(force = false): CanonicalIdentity {
  if (cached && !force) return cached;
  const fromFile = readCoreFromFile();
  cached = fromFile
    ? { text: fromFile, source: "file" }
    : { text: BUILTIN_IDENTITY_CORE, source: "builtin" };
  return cached;
}

/** Convenience: canonical core text for prompt composition. */
export function canonicalIdentityCore(): string {
  return canonicalIdentity().text;
}

/**
 * Short stable hash of the active identity core — safe observability metadata
 * proving WHICH constitution served a request without logging prompt content.
 */
export function canonicalIdentityHash(): string {
  return createHash("sha256").update(canonicalIdentity().text).digest("hex").slice(0, 12);
}
