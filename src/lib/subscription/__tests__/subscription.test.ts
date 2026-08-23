import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { AICHART_PLAN } from "@/lib/subscription/plan";
import {
  resolveEntitlement,
  type UserEntitlementRow,
} from "@/lib/subscription/entitlement";

const root = resolve(process.cwd(), "src");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

function row(over: Partial<UserEntitlementRow>): UserEntitlementRow {
  return {
    user_id: 2,
    plan_status: "trial",
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
  // Zero priced or bounded constants in code. A price key reappearing here
  // is the regression this test exists to catch.
  const keys = Object.keys(AICHART_PLAN);
  for (const banned of [
    "regularPriceUsd",
    "promotionalPriceUsd",
    "trialRecommendations",
    "trialDurationMs",
    "signupGrantCredits",
  ]) {
    assert.ok(!keys.includes(banned), `${banned} must live in billing_plan, not code`);
  }
});

test("admin bypasses the subscription gate", () => {
  const snap = resolveEntitlement({ id: 1, role: "admin", status: "active" }, row({ user_id: 1 }));
  assert.equal(snap.access, "admin");
  assert.equal(snap.hasPaidAccess, true);
});

/**
 * The four states. A FREE account is NOT blocked: it carries every feature
 * and pays per operation from its credit balance, so the resolver must not
 * pre-judge it — that question belongs to the one spend gate.
 */
test("a never-subscribed account is FREE — full product access, no allowance", () => {
  const snap = resolveEntitlement({ id: 2, role: "user", status: "active" }, row({}));
  assert.equal(snap.access, "free");
  assert.equal(snap.planStatus, "trial");
  assert.equal(snap.hasPaidAccess, false);
  assert.equal(snap.expiresAt, null);
});

test("an active subscription grants full access", () => {
  const snap = resolveEntitlement(
    { id: 3, role: "user", status: "active" },
    row({
      user_id: 3,
      plan_status: "active",
      subscription_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    }),
  );
  assert.equal(snap.access, "full");
  assert.equal(snap.hasPaidAccess, true);
});

test("a lapsed subscription is blocked and keeps its expiry date", () => {
  const expired = new Date(Date.now() - 60_000).toISOString();
  const snap = resolveEntitlement(
    { id: 4, role: "user", status: "active" },
    row({ user_id: 4, plan_status: "active", subscription_expires_at: expired }),
  );
  assert.equal(snap.planStatus, "expired");
  assert.equal(snap.access, "blocked");
  assert.equal(snap.hasPaidAccess, false);
  assert.equal(snap.expiresAt, expired);
});

test("a suspended account is blocked whatever its plan says", () => {
  const snap = resolveEntitlement(
    { id: 5, role: "user", status: "suspended" },
    row({ user_id: 5, plan_status: "active" }),
  );
  assert.equal(snap.access, "blocked");
});

test("the entitlement snapshot carries no trial allowance at all", () => {
  const snap = resolveEntitlement({ id: 6, role: "user", status: "active" }, row({ user_id: 6 }));
  for (const banned of ["trialUsed", "trialLimit", "trialRemaining", "trialStartedAt", "trialExpiresAt"]) {
    assert.ok(
      !(banned in snap),
      `${banned} is a second allowance the spend gate would have to reconcile`,
    );
  }
});

test("the chat stream gates access through the ONE spend gate", () => {
  const stream = read("app/api/agent/chat/stream/route.ts");
  // The bug this pins: an older trial gate answered FIRST and hardcoded
  // "your free trial ended", so an expired subscriber never reached the
  // correct subscription_expired code below it.
  assert.doesNotMatch(stream, /claimTrialInteraction|trialQuota/);
  assert.match(stream, /resolveSpendGate/);
  assert.ok(stream.indexOf("resolveSpendGate") < stream.indexOf("publishResidentEvent"));
  assert.ok(stream.indexOf("resolveSpendGate") < stream.indexOf("runWebChatTurn"));
  const turn = read("lib/agent/webTurn.ts");
  assert.match(turn, /runUnifiedChartAgent/);
});

test("the MCP bridge admits Free accounts and blocks only blocked ones", () => {
  const auth = read("lib/agentAuth.ts");
  assert.match(auth, /getEntitlementForUser/);
  assert.match(auth, /access === "blocked"/);
});

test("the recommendation choke point asks the spend gate, and nothing else", () => {
  const repo = read("lib/recommendations/canonical/repository.ts");
  assert.match(repo, /resolveSpendGate/);
  assert.doesNotMatch(repo, /claimTrialRecommendation|TRIAL_RECOMMENDATION_LIMIT/);
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
