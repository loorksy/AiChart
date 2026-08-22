import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { AICHART_PLAN, type TrialConfig } from "@/lib/subscription/plan";
import {
  resolveEntitlement,
  type UserEntitlementRow,
} from "@/lib/subscription/entitlement";
import { subscriptionRequiredMessage } from "@/lib/subscription/trialQuota";

const root = resolve(process.cwd(), "src");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

/** Admin-set trial bounds; tests pass them explicitly (they are DATA now). */
const CFG: TrialConfig = { trialLimit: 3, trialDurationMs: 60 * 60 * 1000 };
const NO_CLOCK: TrialConfig = { trialLimit: 3, trialDurationMs: 0 };

function row(over: Partial<UserEntitlementRow>): UserEntitlementRow {
  return {
    user_id: 2,
    plan_status: "trial",
    trial_interactions_used: 0,
    trial_in_flight: 0,
    trial_started_at: null,
    trial_recommendations_used: 0,
    subscription_expires_at: null,
    activated_at: null,
    activated_by: null,
    note: null,
    updated_at: "",
    ...over,
  };
}

test("the plan module carries identity and contact ONLY — every price is data", () => {
  assert.equal(AICHART_PLAN.telegramHandle, "aswadtr");
  assert.equal(AICHART_PLAN.telegramUrl, "https://t.me/aswadtr");
  // Billing v3: zero priced or bounded constants in code. A price key
  // reappearing here is the regression this test exists to catch.
  const keys = Object.keys(AICHART_PLAN);
  for (const banned of ["regularPriceUsd", "promotionalPriceUsd", "trialRecommendations", "trialDurationMs"]) {
    assert.ok(!keys.includes(banned), `${banned} must live in billing_plan, not code`);
  }
});

test("admin bypasses subscription gate", () => {
  const snap = resolveEntitlement(
    { id: 1, role: "admin", status: "active" },
    row({ user_id: 1, trial_recommendations_used: 3 }),
    CFG,
  );
  assert.equal(snap.access, "admin");
  assert.equal(snap.hasPaidAccess, true);
});

test("trial before the clock starts: full access, clock not started", () => {
  const snap = resolveEntitlement({ id: 2, role: "user", status: "active" }, row({}), CFG);
  assert.equal(snap.access, "trial");
  assert.equal(snap.trialStartedAt, null);
  assert.equal(snap.trialExpiresAt, null);
  assert.equal(snap.trialRemaining, CFG.trialLimit);
});

test("trial inside the hour with recommendations left stays open", () => {
  const started = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const snap = resolveEntitlement(
    { id: 2, role: "user", status: "active" },
    row({ trial_started_at: started, trial_recommendations_used: 2 }),
    CFG,
  );
  assert.equal(snap.access, "trial");
  assert.equal(snap.trialRemaining, 1);
  assert.ok(snap.trialExpiresAt);
});

test("with a configured clock, the trial dies when it elapses — recommendations left or not", () => {
  const started = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const snap = resolveEntitlement(
    { id: 2, role: "user", status: "active" },
    row({ trial_started_at: started, trial_recommendations_used: 0 }),
    CFG,
  );
  assert.equal(snap.access, "blocked");
});

test("with the clock DISABLED (the default), only the recommendation count bounds the trial", () => {
  const started = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const snap = resolveEntitlement(
    { id: 2, role: "user", status: "active" },
    row({ trial_started_at: started, trial_recommendations_used: 1 }),
    NO_CLOCK,
  );
  assert.equal(snap.access, "trial", "two days in, the trial lives — no clock is configured");
  assert.equal(snap.trialExpiresAt, null);
});

test("trial dies on the third recommendation, even inside the hour", () => {
  const started = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const snap = resolveEntitlement(
    { id: 2, role: "user", status: "active" },
    row({ trial_started_at: started, trial_recommendations_used: 3 }),
    CFG,
  );
  assert.equal(snap.access, "blocked");
  assert.equal(snap.trialRemaining, 0);
});

test("active subscription grants full access", () => {
  const snap = resolveEntitlement(
    { id: 3, role: "user", status: "active" },
    row({ user_id: 3, plan_status: "active", trial_recommendations_used: 3 }),
    CFG,
  );
  assert.equal(snap.access, "full");
  assert.equal(snap.hasPaidAccess, true);
});

test("subscription message is user-facing, price-free, without internal codes", () => {
  const ar = subscriptionRequiredMessage("ar");
  const en = subscriptionRequiredMessage("en");
  // Prices are DATA now — a dollar figure inside a hardcoded message is the
  // drift this pin prevents.
  assert.doesNotMatch(ar, /\d+\s*\$|\$\s*\d+/);
  assert.doesNotMatch(en, /\$\s*\d+/);
  assert.doesNotMatch(ar, /entitlement|quota_table|plan_status/i);
  assert.ok(ar.length > 10 && en.length > 10);
});

test("chat stream gates access before provider work", () => {
  const stream = read("app/api/agent/chat/stream/route.ts");
  assert.match(stream, /claimTrialInteraction/);
  assert.ok(stream.indexOf("claimTrialInteraction") < stream.indexOf("runUnifiedChartAgent"));
});

test("MCP gate admits valid trials and blocks everyone else", () => {
  assert.match(read("app/api/admin/mcp-auth/verify/route.ts"), /subscription_required/);
  const auth = read("lib/agentAuth.ts");
  assert.match(auth, /getEntitlementForUser/);
  assert.match(auth, /access !== "trial"/);
});

test("the trial recommendation cap is claimed at the canonical choke point", () => {
  const repo = read("lib/recommendations/canonical/repository.ts");
  assert.match(repo, /claimTrialRecommendation/);
  assert.match(repo, /TRIAL_RECOMMENDATION_LIMIT/);
});

test("landing pricing uses the shared contact facts, no inline dollar prices", () => {
  const pricing = read("components/landing/LandingPricing.tsx");
  assert.match(pricing, /AICHART_PLAN/);
});

test("opening telegram is not an activation API", () => {
  const sub = read("components/subscription/SubscribeClient.tsx");
  assert.match(sub, /does not activate|لا يفعّل الاشتراك/);
  assert.doesNotMatch(sub, /fetch\(["'`]\/api\/.*activat/i);
});
