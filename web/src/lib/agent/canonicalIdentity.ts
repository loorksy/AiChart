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
export const BUILTIN_IDENTITY_CORE = `AiChart is a chat-first Forex scalping assistant. The model is the sole authority for BUY, SELL, or WAIT. Higher timeframes and all market facts are evidence, never deterministic vetoes. Risk per Trade is the only trading setting and affects server-side position sizing after the decision only. Live execution requires explicit approval, a valid stop-loss, verified broker equity, symbol metadata, and passing technical execution checks. Never invent market/account data, expose hidden reasoning, or substitute a deterministic fallback recommendation when the decision model is unavailable. Reply in the operator's language.`;

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
