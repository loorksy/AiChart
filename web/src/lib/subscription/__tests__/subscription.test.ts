import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { AICHART_PLAN } from "@/lib/subscription/plan";
import {
  resolveEntitlement,
  type UserEntitlementRow,
} from "@/lib/subscription/entitlement";
import { subscriptionRequiredMessage } from "@/lib/subscription/trialQuota";

const root = resolve(process.cwd(), "src");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

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

test("single plan prices, trial caps, and telegram CTA", () => {
  assert.equal(AICHART_PLAN.regularPriceUsd, 350);
  assert.equal(AICHART_PLAN.promotionalPriceUsd, 180);
  assert.equal(AICHART_PLAN.trialRecommendations, 3);
  assert.equal(AICHART_PLAN.trialDurationMs, 60 * 60 * 1000);
  assert.equal(AICHART_PLAN.telegramHandle, "aswadtr");
  assert.equal(AICHART_PLAN.telegramUrl, "https://t.me/aswadtr");
});

test("admin bypasses subscription gate", () => {
  const snap = resolveEntitlement(
    { id: 1, role: "admin", status: "active" },
    row({ user_id: 1, trial_recommendations_used: 3 }),
  );
  assert.equal(snap.access, "admin");
  assert.equal(snap.hasPaidAccess, true);
});

test("trial before the first MT link: full access, clock not started", () => {
  const snap = resolveEntitlement({ id: 2, role: "user", status: "active" }, row({}));
  assert.equal(snap.access, "trial");
  assert.equal(snap.trialStartedAt, null);
  assert.equal(snap.trialExpiresAt, null);
  assert.equal(snap.trialRemaining, AICHART_PLAN.trialRecommendations);
});

test("trial inside the hour with recommendations left stays open", () => {
  const started = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const snap = resolveEntitlement(
    { id: 2, role: "user", status: "active" },
    row({ trial_started_at: started, trial_recommendations_used: 2 }),
  );
  assert.equal(snap.access, "trial");
  assert.equal(snap.trialRemaining, 1);
  assert.ok(snap.trialExpiresAt);
});

test("trial dies when the hour elapses, even with recommendations left", () => {
  const started = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const snap = resolveEntitlement(
    { id: 2, role: "user", status: "active" },
    row({ trial_started_at: started, trial_recommendations_used: 0 }),
  );
  assert.equal(snap.access, "blocked");
});

test("trial dies on the third recommendation, even inside the hour", () => {
  const started = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const snap = resolveEntitlement(
    { id: 2, role: "user", status: "active" },
    row({ trial_started_at: started, trial_recommendations_used: 3 }),
  );
  assert.equal(snap.access, "blocked");
  assert.equal(snap.trialRemaining, 0);
});

test("active subscription grants full access", () => {
  const snap = resolveEntitlement(
    { id: 3, role: "user", status: "active" },
    row({ user_id: 3, plan_status: "active", trial_recommendations_used: 3 }),
  );
  assert.equal(snap.access, "full");
  assert.equal(snap.hasPaidAccess, true);
});

test("subscription message is user-facing without internal codes", () => {
  const ar = subscriptionRequiredMessage("ar");
  const en = subscriptionRequiredMessage("en");
  assert.match(ar, /180/);
  assert.match(ar, /350/);
  assert.match(ar, /aswadtr/);
  assert.doesNotMatch(ar, /entitlement|quota_table|plan_status/i);
  assert.match(en, /\$180/);
  assert.match(en, /aswadtr/);
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

test("landing pricing uses real plan constants", () => {
  const pricing = read("components/landing/LandingPricing.tsx");
  assert.match(pricing, /AICHART_PLAN/);
});

test("opening telegram is not an activation API", () => {
  const sub = read("components/subscription/SubscribeClient.tsx");
  assert.match(sub, /does not activate|لا يفعّل الاشتراك/);
  assert.doesNotMatch(sub, /fetch\(["'`]\/api\/.*activat/i);
});
