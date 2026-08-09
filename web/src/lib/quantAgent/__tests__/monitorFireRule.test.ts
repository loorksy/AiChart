import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

/**
 * The two firing rules a monitor can carry.
 *
 * `always` is upstream's only behaviour and stays the default, so no existing
 * monitor changes meaning. `on_change` is the one users actually ask for on
 * slow timeframes: the second identical SELL is the same news again, not news.
 *
 * NOTHING is imported at module scope, and the pure assertions live inside the
 * one DB test rather than in a test of their own. `@/lib/quantAgent/*` pulls in
 * `@/lib/db` -> `@/lib/env`, which snapshots `DB_PATH` into a module constant
 * the first time it is loaded — and these files share ONE process, so the first
 * import anywhere in the suite fixes the database for all of them. Importing
 * the store from a pure test that has not set `DB_PATH` first would silently
 * point the whole suite at the DEVELOPMENT database. Set the env, then import.
 */
test("monitor fire rules: pure predicate, persistence, and round-trip", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qa-fire-rule-"));
  process.env.DB_PATH = join(dir, "test.db");
  process.env.ENCRYPTION_KEY = "0".repeat(64);
  process.env.APP_SECRET = "test-secret";
  delete process.env.DATABASE_URL;

  const db = await import("@/lib/db");
  await db.initDb();
  const owner = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["fire-rule@test.com", "x", "user", "active"],
  );

  const store = await import("@/lib/quantAgent/monitorStore");
  const { normalizeFireRule, shouldFireForDecision } = store;

  // --- The predicate itself ---
  assert.equal(shouldFireForDecision("always", null, "BUY"), true);
  assert.equal(shouldFireForDecision("always", "BUY", "BUY"), true, "a repeat still fires");
  assert.equal(shouldFireForDecision("always", "SELL", "BUY"), true);

  assert.equal(shouldFireForDecision("on_change", "HOLD", "SELL"), true);
  assert.equal(shouldFireForDecision("on_change", "SELL", "SELL"), false);
  assert.equal(shouldFireForDecision("on_change", "SELL", "HOLD"), true);
  assert.equal(shouldFireForDecision("on_change", "BUY", "SELL"), true);

  // A monitor with no previous decision has nothing to differ from. If that
  // counted as "unchanged", an on_change monitor would never work at all.
  assert.equal(shouldFireForDecision("on_change", null, "SELL"), true);
  assert.equal(shouldFireForDecision("on_change", "", "SELL"), true);

  assert.equal(normalizeFireRule("on_change"), "on_change");
  assert.equal(normalizeFireRule("always"), "always");
  assert.equal(normalizeFireRule(null), "always");
  assert.equal(normalizeFireRule(undefined), "always");
  assert.equal(normalizeFireRule("ON_CHANGE"), "always", "unknown values fall back, never throw");

  // --- Persistence ---
  const defaulted = await store.createMonitor(owner, { symbol: "XAUUSD", interval: "1h" });
  assert.equal(defaulted.fireRule, "always", "monitors default to upstream's behaviour");
  assert.equal(defaulted.lastFiredDecision, null, "nothing has fired yet");

  const onChange = await store.createMonitor(owner, {
    symbol: "EURUSD",
    interval: "4h",
    fireRule: "on_change",
  });
  assert.equal(onChange.fireRule, "on_change");

  const switched = await store.updateMonitor(owner, defaulted.id, { fireRule: "on_change" });
  assert.equal(switched!.fireRule, "on_change");
  assert.equal(switched!.notifyTelegram, true, "an untouched field is preserved");

  await store.markMonitorDecisionFired(defaulted.id, "SELL");
  const reread = await store.getMonitor(owner, defaulted.id);
  assert.equal(reread!.lastFiredDecision, "SELL");
  assert.equal(
    shouldFireForDecision(reread!.fireRule, reread!.lastFiredDecision, "SELL"),
    false,
    "the same call again is suppressed once it has been recorded",
  );
  assert.equal(shouldFireForDecision(reread!.fireRule, reread!.lastFiredDecision, "BUY"), true);
});

/**
 * Reachability, not behaviour.
 *
 * The store above is fully exercised, and that is exactly how this feature
 * managed to be implemented, persisted, tested — and unreachable. `fireRule`
 * was absent from the route's zod schema, and a non-strict `z.object` DROPS an
 * unknown key silently: the POST succeeded, returned 201, and threw the setting
 * away without a word. So the wiring is pinned separately from the logic, by
 * source, at each of the three hops a user's choice has to survive.
 */
test("monitor fire rules: the setting is reachable from the UI, the API and MCP", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (path: string) => readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");

  const createRoute = read("src/app/api/quant-agent/monitors/route.ts");
  assert.match(createRoute, /fireRule:\s*z\.enum\(MONITOR_FIRE_RULES\)/, "POST must accept fireRule");
  assert.match(createRoute, /fireRule:\s*body\.fireRule/, "POST must pass fireRule to the store");

  const patchRoute = read("src/app/api/quant-agent/monitors/[id]/route.ts");
  assert.match(patchRoute, /fireRule:\s*z\.enum\(MONITOR_FIRE_RULES\)/, "PATCH must accept fireRule");
  assert.match(patchRoute, /fireRule:\s*body\.fireRule/, "PATCH must pass fireRule to the store");

  const section = read("src/components/quantAgent/MonitorsSection.tsx");
  assert.match(section, /qa\.monitors\.field\.fire_rule/, "the create sheet must label the control");
  assert.match(section, /\bfireRule,/, "the create request must carry the chosen rule");

  const mcpSchemas = read("../mcp/src/tools/schemas/quantAnalysisSchemas.ts");
  assert.match(mcpSchemas, /fireRule:\s*zFireRule/, "MCP create/update must advertise fireRule");
  const mcpHandlers = read("../mcp/src/tools/quantAnalysis.ts");
  assert.match(mcpHandlers, /fireRule:\s*a\.fireRule/, "MCP handlers must forward fireRule");
});
