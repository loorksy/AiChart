import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { AICHART_PLAN } from "@/lib/subscription/plan";
import { resolveEntitlement } from "@/lib/subscription/entitlement";
import { subscriptionRequiredMessage } from "@/lib/subscription/trialQuota";

const root = resolve(process.cwd(), "src");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

test("single plan prices and telegram CTA", () => {
  assert.equal(AICHART_PLAN.regularPriceUsd, 350);
  assert.equal(AICHART_PLAN.promotionalPriceUsd, 180);
  assert.equal(AICHART_PLAN.trialInteractions, 3);
  assert.equal(AICHART_PLAN.telegramHandle, "aswadtr");
  assert.equal(AICHART_PLAN.telegramUrl, "https://t.me/aswadtr");
  assert.equal("billingPeriod" in AICHART_PLAN, false);
});

test("admin bypasses subscription gate", () => {
  const snap = resolveEntitlement(
    { id: 1, role: "admin", status: "active" },
    {
      user_id: 1,
      plan_status: "trial",
      trial_interactions_used: 3,
      trial_in_flight: 0,
      subscription_expires_at: null,
      activated_at: null,
      activated_by: null,
      note: null,
      updated_at: "",
    },
  );
  assert.equal(snap.access, "admin");
  assert.equal(snap.hasPaidAccess, true);
});

test("trial exhausts after three completed interactions", () => {
  const snap = resolveEntitlement(
    { id: 2, role: "user", status: "active" },
    {
      user_id: 2,
      plan_status: "trial",
      trial_interactions_used: 3,
      trial_in_flight: 0,
      subscription_expires_at: null,
      activated_at: null,
      activated_by: null,
      note: null,
      updated_at: "",
    },
  );
  assert.equal(snap.access, "blocked");
  assert.equal(snap.trialRemaining, 0);
});

test("active subscription grants full access", () => {
  const snap = resolveEntitlement(
    { id: 3, role: "user", status: "active" },
    {
      user_id: 3,
      plan_status: "active",
      trial_interactions_used: 3,
      trial_in_flight: 0,
      subscription_expires_at: null,
      activated_at: null,
      activated_by: null,
      note: null,
      updated_at: "",
    },
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

test("chat stream gates trial before provider work", () => {
  const stream = read("app/api/agent/chat/stream/route.ts");
  assert.match(stream, /claimTrialInteraction/);
  assert.match(stream, /commitTrialInteraction/);
  assert.match(stream, /releaseTrialInteraction/);
  assert.ok(stream.indexOf("claimTrialInteraction") < stream.indexOf("runUnifiedChartAgent"));
});

test("bridge download and MCP require paid access", () => {
  assert.match(read("app/api/ea/download/route.ts"), /requirePaidAccess/);
  assert.match(read("app/api/admin/mcp-auth/verify/route.ts"), /subscription_required/);
  assert.match(read("lib/agentAuth.ts"), /getEntitlementForUser/);
});

test("landing pricing uses real plan constants", () => {
  const pricing = read("components/landing/LandingPricing.tsx");
  assert.match(pricing, /AICHART_PLAN/);
  assert.match(pricing, /t\.me\/aswadtr|telegramUrl/);
  assert.doesNotMatch(pricing, /\/month|\/year|lifetime/i);
});

test("opening telegram is not an activation API", () => {
  const sub = read("components/subscription/SubscribeClient.tsx");
  assert.match(sub, /does not activate|لا يفعّل الاشتراك/);
  assert.doesNotMatch(sub, /fetch\(["'`]\/api\/.*activat/i);
});
