/**
 * The server half of the admin API contract.
 *
 * Defect 9: the Flutter client read `parity.unpaired` as a list and called
 * `.length` on it; the server had always sent a count. `7 as List?` threw, and
 * because the Operations screen loads four sources with `Future.wait`, that one
 * cast killed the entire screen — "Failed to load data. TypeError: 7: type
 * 'int' is not a subtype of type 'List<dynamic>?'" — while health, usage and
 * the audit trail parsed perfectly.
 *
 * Every guard in the repo stayed green. The one that existed asked "does the
 * client have a method for this endpoint?", which is a question about wiring,
 * not about shape — and shape is the entire class this defect belongs to.
 *
 * So the two sides are now pinned to the SAME fixture file:
 *
 *   - here: the fixtures must match the server's DECLARED TypeScript types.
 *     `expectType<ParityReport["unpaired"]>()` is a compile-time assertion —
 *     change that field to an array and `tsc` fails on this file — and the
 *     runtime checks below catch a fixture that drifts from the wire.
 *   - `admin_flutter/test/contract_test.dart`: every fixture must parse
 *     through the real `fromJson`.
 *
 * A change on either side that the other has not followed now fails on one of
 * the two, instead of reaching an operator as a blank screen.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import type { ParityReport } from "@/lib/agent/parityLog";
import type { BillingPlanRow, PlanPriceRow, TopupPackRow, OfferRow } from "@/lib/billing/planConfig";
import type { ClaudeUsageRow } from "@/lib/store";
import type { AdRow } from "@/lib/ads/adsStore";

const REPO = path.join(import.meta.dirname, "..", "..", "..");
const FIXTURES = path.join(REPO, "admin_flutter", "test", "fixtures", "admin_contracts.json");

const fixtures = JSON.parse(readFileSync(FIXTURES, "utf8")) as Record<string, unknown>;

function endpoint(name: string): Record<string, unknown> {
  const value = fixtures[name];
  assert.ok(value && typeof value === "object", `no fixture for ${name}`);
  return value as Record<string, unknown>;
}

/**
 * Compile-time only: asserts the fixture's recorded JS type still matches the
 * server's declared type for that field. It has no runtime effect — `tsc` is
 * the assertion.
 */
function expectType<T>(_value: T): void {
  /* the type parameter IS the test */
}

describe("the admin API contract — the server's half", () => {
  it("parity.unpaired is a COUNT, and the fixture records it as one", () => {
    // The defect, pinned at the type level. If this field ever becomes a list,
    // this file stops compiling and the Dart side is updated in the same change
    // instead of discovering it in production.
    expectType<ParityReport["unpaired"]>(0);
    const parity = endpoint("admin/diagnostics").parity as Record<string, unknown>;
    assert.equal(
      typeof parity.unpaired,
      "number",
      "the client takes .length of this when it is a list — it must stay a number",
    );
    // And the nested shape the client deliberately flattens past.
    const totals = parity.totals as Record<string, unknown>;
    assert.equal(typeof totals.byClassification, "object");
    expectType<ParityReport["totals"]["byClassification"]>({});
  });

  it("the billing rows match their declared server types", () => {
    const cfg = endpoint("admin/billing/config");
    const plan = cfg.plan as Record<string, unknown>;
    expectType<BillingPlanRow["signup_grant_credits"]>(0);
    expectType<BillingPlanRow["min_rr_first_target_bp"]>(0);
    assert.equal(typeof plan.signup_grant_credits, "number");
    assert.equal(typeof plan.min_rr_first_target_bp, "number");

    const price = cfg.current_price as Record<string, unknown>;
    expectType<PlanPriceRow["price_cents"]>(0);
    assert.equal(typeof price.price_cents, "number");
    assert.equal(price.archived_at, null, "the CURRENT price is the unarchived row");

    // `active` is an INTEGER on the wire (SQLite), not a boolean — the client
    // coerces it. Recording that here stops someone "fixing" one side alone.
    const pack = (cfg.packs as unknown[])[0] as Record<string, unknown>;
    expectType<TopupPackRow["active"]>(1);
    assert.equal(typeof pack.active, "number");
    const offer = (cfg.offers as unknown[])[0] as Record<string, unknown>;
    expectType<OfferRow["active"]>(1);
    assert.equal(typeof offer.active, "number");
  });

  it("usage rows match the store's declared row type", () => {
    const row = (endpoint("admin/usage").usage as unknown[])[0] as Record<string, unknown>;
    expectType<ClaudeUsageRow["used_today"]>(0);
    expectType<ClaudeUsageRow["quota"]>(0);
    assert.equal(typeof row.used_today, "number");
    assert.equal(typeof row.email, "string");
  });

  it("an ad row carries its slides as a JSON STRING column", () => {
    const row = (endpoint("admin/ads").ads as unknown[])[0] as Record<string, unknown>;
    expectType<AdRow["slides_json"]>("");
    assert.equal(typeof row.slides_json, "string");
    assert.doesNotThrow(() => JSON.parse(row.slides_json as string));
  });

  it("the overview roster answers under `rows`, which is what the client reads", () => {
    // The silent half of the same drift: the client read `users` and got an
    // empty list forever.
    const route = readFileSync(
      path.join(REPO, "src", "app", "api", "admin", "overview", "users", "route.ts"),
      "utf8",
    );
    assert.match(route, /rows:\s/, "the route answers under `rows`");
    assert.ok("rows" in endpoint("admin/overview/users"));

    const client = readFileSync(
      path.join(REPO, "admin_flutter", "lib", "api", "repository.dart"),
      "utf8",
    );
    assert.match(
      client,
      /j\['rows'\] as List\?/,
      "the client must read the key the server sends",
    );
  });

  it("every admin route that a screen reads has a fixture", () => {
    // Coverage, stated as a list rather than inferred: a route whose payload
    // no fixture describes is a contract nobody is checking the shape of.
    const covered = new Set(Object.keys(fixtures).filter((k) => !k.startsWith("_")));
    // Endpoints that are pure ACTIONS (write, then re-read another endpoint)
    // or machine-to-machine callbacks carry no screen-parsed payload shape of
    // their own beyond `{ok:true}`.
    const actionsOnly = new Set([
      "admin/ads/upload",
      "admin/billing/adjust",
      "admin/billing/offers",
      "admin/billing/packs",
      "admin/billing/subscription",
      "admin/config/models",
      "admin/mcp-auth/check-access",
      "admin/mcp-auth/verify",
      "admin/parity",
      "admin/subscriptions/[id]",
      "admin/users/[id]",
      "admin/diagnostics/",
    ]);
    const routes: string[] = [];
    const entries = readdirSync(path.join(REPO, "src", "app", "api", "admin"), {
      recursive: true,
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (!entry.isFile() || entry.name !== "route.ts") continue;
      const rel = path
        .relative(path.join(REPO, "src", "app", "api"), path.join(entry.parentPath, entry.name))
        .split(path.sep)
        .join("/")
        .replace(/\/route\.ts$/, "");
      routes.push(rel);
    }
    const unchecked = routes.filter((r) => !covered.has(r) && !actionsOnly.has(r));
    assert.deepEqual(
      unchecked,
      [],
      `no response-shape fixture for:\n${unchecked.join("\n")}`,
    );
  });
});
