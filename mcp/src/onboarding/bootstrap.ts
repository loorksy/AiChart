/**
 * Onboarding bootstrap — single source of truth for the "first message" that
 * primes any model (Claude / ChatGPT) on connect. Canonical text lives in
 * `agent/onboarding/bootstrap.en.md`; MCP instructions core is extracted from
 * `agent/workspace/SYSTEM.md` so the three surfaces never drift.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BOOTSTRAP_REL = "agent/onboarding/bootstrap.en.md";
const SYSTEM_REL = "agent/workspace/SYSTEM.md";
const CORE_START = "<!-- instructions-core-start -->";
const CORE_END = "<!-- instructions-core-end -->";
const MCP_CORE_START = "<!-- mcp-core-start -->";
const MCP_CORE_END = "<!-- mcp-core-end -->";

const MISSING_BOOTSTRAP =
  "Failed to load bootstrap from agent/onboarding/bootstrap.en.md.";
const MISSING_SYSTEM =
  "Failed to load system constitution from agent/workspace/SYSTEM.md.";

let cachedBootstrap: string | null = null;
let cachedSystem: string | null = null;

function here(): string {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
}

function readRepoFile(relativePath: string): string | null {
  const base = here();
  const candidates = [
    join(process.cwd(), relativePath),
    join(process.cwd(), "..", relativePath),
    join(base, "../../..", relativePath),
    join(base, "../../../..", relativePath),
    join(base, "../..", relativePath),
  ];
  for (const path of candidates) {
    try {
      const raw = readFileSync(path, "utf8").trim();
      if (raw) return raw;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Full canonical bootstrap text (read once, cached). */
export function bootstrapText(): string {
  if (cachedBootstrap != null) return cachedBootstrap;
  cachedBootstrap = readRepoFile(BOOTSTRAP_REL) ?? MISSING_BOOTSTRAP;
  return cachedBootstrap;
}

/** Full SYSTEM.md constitution (read once, cached). */
export function systemText(): string {
  if (cachedSystem != null) return cachedSystem;
  cachedSystem = readRepoFile(SYSTEM_REL) ?? MISSING_SYSTEM;
  return cachedSystem;
}

function delimitedBlock(text: string, startMark: string, endMark: string): string | null {
  const start = text.indexOf(startMark);
  const end = text.indexOf(endMark);
  if (start >= 0 && end > start) {
    return text.slice(start + startMark.length, end).trim();
  }
  return null;
}

/**
 * MCP `instructions` = the shared canonical identity core (same block the web
 * runtime loads) + the MCP-specific session/skill/tool addendum from SYSTEM.md.
 */
export function instructionsCore(): string {
  const text = systemText();
  const core = delimitedBlock(text, CORE_START, CORE_END);
  const mcpCore = delimitedBlock(text, MCP_CORE_START, MCP_CORE_END);
  if (core) {
    return mcpCore ? `${core}\n\n${mcpCore}` : core;
  }
  return [
    "AiChart Trading Agent — execution partner. Reply in the operator's language.",
    "Read aichart://system at session start. The model owns the direction — every successful analysis ends in BUY or SELL with an immediate, anticipatory, or conditional plan; execution uses explicit approval and technical safety.",
    text.slice(0, 4000),
  ].join("\n\n");
}
