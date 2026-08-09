/**
 * Every quant-analysis MCP tool's input schema, checked against the zod schema
 * (or the query parameters) of the web route it actually calls.
 *
 * `contractParity.test.ts` proves the catalogue agrees with
 * `agent/tools/contract.json`. It cannot catch the failure that matters here:
 * an MCP tool advertising a field the route will reject, or missing a field the
 * route requires. `POST /api/quant-agent/analysis` parses with a `.strict()`
 * zod object — one extra key is a hard 400 — and the monitor routes silently
 * DROP unknown keys, which is worse: the call succeeds and the setting the
 * operator asked for is thrown away without a word.
 *
 * The web sources are read as text rather than imported. mcp/ and web/ are
 * separate packages with separate tsconfigs and a `@/` alias this build has no
 * resolver for; importing the route would pull Next, the DB layer, and the
 * whole analysis engine into a schema comparison. Reading the schema literal is
 * the cheap check that actually runs in CI, and a rename on either side fails
 * it immediately.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { z } from "zod";
import { getToolDef } from "../schemas/index.js";

const WEB_ROUTES = join(process.cwd(), "..", "web", "src", "app", "api", "quant-agent");

/**
 * A missing route is a real failure, not a reason to skip: an MCP tool whose
 * web route does not exist answers 404 for every caller. The message says
 * which route, so the fix is obvious rather than an ENOENT stack trace.
 */
function routeSource(...segments: string[]): string {
  const path = join(WEB_ROUTES, ...segments);
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new Error(
      `web route missing: api/quant-agent/${segments.join("/")} — an MCP tool in the quant group calls it, so it must ship in the same change`,
    );
  }
}

/**
 * Fields an MCP tool owns that never travel in the request body: the
 * idempotency/confirmation guards (enforced in the MCP handler) and `id`,
 * which is a path segment on both sides.
 */
const MCP_ONLY_FIELDS = new Set(["idempotencyKey", "confirmDelete", "id"]);

/** Walk from `start` (an opening brace) to its match, ignoring braces in strings. */
function matchingBrace(source: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i]!;
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error("unbalanced braces in route source");
}

/**
 * Drop `//` and block comments, leaving string literals intact.
 *
 * Not cosmetic. Without it a comment above a field hides that field from the
 * extractor below, because the entry then begins with `//` and the
 * `key:` regex does not match. That fails BOTH ways: a commented MCP-side
 * field looks like one the route rejects (a loud false alarm), and a commented
 * REQUIRED route field silently vanishes from `required` — a real drift this
 * suite would then stop catching. Quote-aware because route schemas contain
 * `"https://"`, which a naive strip would eat.
 */
function stripComments(source: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]!;
    if (quote) {
      out += ch;
      if (ch === "\\") {
        out += source[i + 1] ?? "";
        i += 1;
      } else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      const end = source.indexOf("\n", i);
      if (end < 0) break;
      i = end - 1;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      if (end < 0) break;
      i = end + 1;
      continue;
    }
    out += ch;
  }
  return out;
}

/** Split a `z.object({...})` body into its top-level `key: value` entries. */
function topLevelEntries(body: string): string[] {
  const entries: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]!;
    if (quote) {
      current += ch;
      if (ch === "\\") {
        current += body[i + 1] ?? "";
        i += 1;
      } else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "{" || ch === "(" || ch === "[") depth += 1;
    if (ch === "}" || ch === ")" || ch === "]") depth -= 1;
    if (ch === "," && depth === 0) {
      entries.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) entries.push(current);
  return entries;
}

interface WebSchema {
  keys: Set<string>;
  required: Set<string>;
  strict: boolean;
}

/** Read `const <name> = z.object({...})` out of a route file. */
function webSchema(source: string, constName: string): WebSchema {
  const declIndex = source.indexOf(`const ${constName} =`);
  assert.ok(declIndex >= 0, `${constName} not found — the web route was renamed`);
  const objectIndex = source.indexOf(".object(", declIndex);
  assert.ok(objectIndex > declIndex, `${constName} is not a z.object`);
  const open = source.indexOf("{", objectIndex);
  const close = matchingBrace(source, open);
  const body = stripComments(source.slice(open + 1, close));

  const keys = new Set<string>();
  const required = new Set<string>();
  for (const entry of topLevelEntries(body)) {
    const match = /^\s*([A-Za-z_$][\w$]*)\s*:/.exec(entry);
    if (!match) continue;
    const key = match[1]!;
    keys.add(key);
    if (!/\.optional\(\)|\.default\(/.test(entry)) required.add(key);
  }
  assert.ok(keys.size > 0, `${constName} parsed to zero fields — the extractor broke`);
  return { keys, required, strict: /\.strict\(\)/.test(source.slice(close, close + 40)) };
}

/** Query parameters a GET route actually reads. */
function searchParams(source: string): Set<string> {
  const found = new Set<string>();
  for (const match of source.matchAll(/searchParams\.get\(\s*["']([^"']+)["']/g)) {
    found.add(match[1]!);
  }
  assert.ok(found.size > 0, "route reads no search params — did it change shape?");
  return found;
}

/** MCP tool fields, split into what the handler sends and what it keeps. */
function mcpFields(name: string): { body: Set<string>; required: Set<string>; all: Set<string> } {
  const shape = getToolDef(name).inputSchema as Record<string, z.ZodType>;
  const all = new Set(Object.keys(shape));
  const body = new Set([...all].filter((k) => !MCP_ONLY_FIELDS.has(k)));
  // "Required" = the field rejects `undefined`, which is exactly what the
  // exported JSON Schema's `required` array is derived from.
  const required = new Set([...all].filter((key) => !shape[key]!.safeParse(undefined).success));
  return { body, required, all };
}

/**
 * The core assertion, both directions:
 *   - nothing the MCP tool advertises is unknown to the route (a `.strict()`
 *     route 400s on it; a lenient route silently discards it), and
 *   - nothing the route REQUIRES is missing from the MCP tool.
 */
function assertBodyParity(toolName: string, schema: WebSchema) {
  const mcp = mcpFields(toolName);
  for (const field of mcp.body) {
    assert.ok(
      schema.keys.has(field),
      `${toolName} advertises "${field}", which the route does not accept`,
    );
  }
  for (const field of schema.required) {
    assert.ok(
      mcp.all.has(field),
      `${toolName} is missing "${field}", which the route requires`,
    );
    assert.ok(
      mcp.required.has(field),
      `${toolName} marks "${field}" optional, but the route requires it`,
    );
  }
}

describe("quant analysis MCP tools ↔ web route schemas", () => {
  it("quant_agent_run_analysis matches the STRICT analysis route body exactly", () => {
    const source = routeSource("analysis", "route.ts");
    const schema = webSchema(source, "runSchema");
    assert.ok(schema.strict, "runSchema is expected to be .strict() — re-read the route");
    assertBodyParity("quant_agent_run_analysis", schema);
    // Strict means the reverse direction matters too: a field the route grew
    // that the MCP tool cannot send is a capability silently missing from MCP.
    const mcp = mcpFields("quant_agent_run_analysis");
    for (const field of schema.keys) {
      assert.ok(
        mcp.all.has(field),
        `the analysis route accepts "${field}" and no MCP tool can send it`,
      );
    }
  });

  it("quant_agent_create_monitor matches the monitor create schema", () => {
    assertBodyParity(
      "quant_agent_create_monitor",
      webSchema(routeSource("monitors", "route.ts"), "createSchema"),
    );
  });

  it("quant_agent_update_monitor matches the monitor update schema", () => {
    assertBodyParity(
      "quant_agent_update_monitor",
      webSchema(routeSource("monitors", "[id]", "route.ts"), "updateSchema"),
    );
  });

  it("every list/read tool only sends query parameters its route reads", () => {
    const cases: Array<[string, Set<string>]> = [
      ["quant_agent_list_analyses", searchParams(routeSource("analysis", "route.ts"))],
      [
        "quant_agent_analysis_accuracy",
        searchParams(routeSource("analysis", "accuracy", "route.ts")),
      ],
      ["quant_agent_list_signals", searchParams(routeSource("signals", "route.ts"))],
    ];
    for (const [toolName, params] of cases) {
      for (const field of mcpFields(toolName).body) {
        assert.ok(
          params.has(field),
          `${toolName} sends ?${field}=, which its route never reads`,
        );
      }
    }
  });

  it("the by-id routes this server calls exist and are ownership-checked", () => {
    // Not a schema check — a check that the id in the URL is never treated as
    // authority. Every by-id quant tool here reaches a route whose handler
    // resolves the caller first and scopes the read to them.
    for (const segments of [
      ["analysis", "[id]", "route.ts"],
      ["signals", "[id]", "route.ts"],
      ["monitors", "[id]", "route.ts"],
    ]) {
      const source = routeSource(...segments);
      assert.match(
        source,
        /resolveQuantAgentUserId/,
        `${segments.join("/")} must resolve the caller before touching the row`,
      );
      assert.match(
        source,
        /\buserId\b/,
        `${segments.join("/")} must scope the row to that caller`,
      );
    }
  });

  it("no quant tool can reach a route that returns candles", () => {
    // Belt to noExecutionTools.test.ts's brace: the analysis feed is
    // analysis-only, so none of these routes may be a bar-series endpoint.
    for (const segments of [
      ["analysis", "route.ts"],
      ["signals", "route.ts"],
      ["monitors", "route.ts"],
    ]) {
      const source = routeSource(...segments);
      assert.ok(
        !/\bcandles\s*[:=]|\bbars\s*[:=]/.test(source),
        `${segments.join("/")} appears to return a bar series`,
      );
    }
  });
});
