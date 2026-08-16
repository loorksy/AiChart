import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * A browser cannot authenticate against a bridge-only route.
 *
 * resolveBridgeUserId demands a service token AND a signed X-Aichart-User-Email
 * — headers the MCP bridge sends and a fetch from a component never can. Point a
 * form at one of those routes and every submit comes back "توكن الوكيل غير صحيح",
 * with nothing in the build, the types, or the unit suite to say so.
 *
 * That is what happened to the MetaTrader wizard: it posted to
 * /api/agent/mt/connect for the whole life of the feature, while
 * /api/mt/connect sat beside it handing the identical body to the identical
 * connectMtAccount behind session auth.
 *
 * Routes that accept EITHER credential are fine and must not be flagged —
 * /api/agent/trade-mode verifies a bridge request when bridge headers are
 * present and falls back to the platform session when they are not.
 */

const SRC = path.join(import.meta.dirname, "..", "..");
const API = path.join(SRC, "app", "api");

const BRIDGE_AUTH = /resolveBridgeUserId|requireAgentAuth/;
const SESSION_AUTH =
  /requirePlatformAccess|requirePaidAccess|requireUser|getCurrentUser|requireAdmin/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** "src/app/api/agent/mt/connect/route.ts" → "/api/agent/mt/connect" */
function routePath(file: string): string {
  return (
    "/api/" +
    path
      .relative(API, path.dirname(file))
      .split(path.sep)
      .join("/")
  );
}

function bridgeOnlyRoutes(): Set<string> {
  const out = new Set<string>();
  for (const file of walk(API)) {
    if (path.basename(file) !== "route.ts") continue;
    const text = readFileSync(file, "utf8");
    if (BRIDGE_AUTH.test(text) && !SESSION_AUTH.test(text)) {
      out.add(routePath(file));
    }
  }
  return out;
}

/** Every literal /api/... a "use client" module fetches. */
function browserFetches(): Map<string, string> {
  const found = new Map<string, string>();
  const call = /fetch\(\s*[`"'](\/api\/[A-Za-z0-9/_-]*)/g;
  for (const file of walk(SRC)) {
    if (!/\.tsx?$/.test(file)) continue;
    if (file.startsWith(API)) continue;
    const text = readFileSync(file, "utf8");
    if (!text.includes('"use client"')) continue;
    for (const [, url] of text.matchAll(call)) {
      if (!found.has(url!)) {
        found.set(url!, path.relative(SRC, file).replace(/\\/g, "/"));
      }
    }
  }
  return found;
}

test("no browser component fetches a bridge-only route", () => {
  const bridgeOnly = bridgeOnlyRoutes();
  // Guard the guard: if the detection ever stops finding bridge-only routes,
  // this test would pass by finding nothing rather than by being satisfied.
  assert.ok(
    bridgeOnly.size > 10,
    `expected the MCP bridge surface to be sizeable, found ${bridgeOnly.size}`,
  );

  const violations: string[] = [];
  for (const [url, file] of browserFetches()) {
    if (bridgeOnly.has(url)) violations.push(`${file} fetches ${url}`);
  }

  assert.deepEqual(
    violations,
    [],
    "these are called from the browser but only accept MCP bridge credentials, so every call 401s",
  );
});

