import type { PublicUser } from "@/lib/types";
import { t } from "@/lib/i18n";
import { getEntitlementForUser } from "@/lib/subscription/entitlement";

/**
 * Trial access gate for the chat surface.
 *
 * The trial carries EVERY feature and is bounded by the caps the ADMIN sets
 * (billing_plan): the recommendation count, and an optional wall clock that
 * is off by default. Chat itself is unmetered inside the window, so claim
 * answers only "may this user run the agent right now?", and commit/release
 * exist as no-ops to keep the stream route's claim→work→commit/release shape
 * (and its retry safety) intact.
 *
 * The `trial_interaction_ledger` table stays readable for history; nothing
 * writes it anymore.
 */

export type TrialClaimResult =
  | { ok: true; mode: "paid" | "admin" }
  | { ok: true; mode: "trial"; used: number; remaining: number }
  | { ok: false; reason: "exhausted" | "blocked"; used: number; remaining: number };

export async function claimTrialInteraction(
  user: Pick<PublicUser, "id" | "role" | "status">,
  _requestId: string,
): Promise<TrialClaimResult> {
  const snap = await getEntitlementForUser(user);
  if (snap.isAdmin || snap.hasPaidAccess) {
    return { ok: true, mode: snap.isAdmin ? "admin" : "paid" };
  }
  if (snap.access === "trial") {
    return {
      ok: true,
      mode: "trial",
      used: snap.trialUsed,
      remaining: snap.trialRemaining,
    };
  }
  return {
    ok: false,
    // A trial that ran out (count or optional clock) reads as exhausted; any
    // other blocked state (suspended/expired) is a plain block.
    reason: snap.planStatus === "trial" ? "exhausted" : "blocked",
    used: snap.trialUsed,
    remaining: 0,
  };
}

/** No-op: chat is unmetered inside the trial window. */
export async function commitTrialInteraction(
  _userId: number,
  _requestId: string,
): Promise<void> {}

/** No-op: nothing is reserved, so nothing needs releasing. */
export async function releaseTrialInteraction(
  _userId: number,
  _requestId: string,
): Promise<void> {}

/** Short, price-free — the price is DATA now; the CTA carries the action. */
export function subscriptionRequiredMessage(locale: "ar" | "en" = "ar"): string {
  return t(locale, "billing.trial_exhausted_message");
}
