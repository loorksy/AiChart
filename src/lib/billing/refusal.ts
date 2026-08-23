/**
 * ONE presentation for a refusal, shared by every surface.
 *
 * The gate decides WHAT happened (`code`) and WHAT TO DO (`action`); this
 * module turns that pair into the sentence, the button label, and the link.
 * Web, Telegram, and MCP all read it, so the three cannot drift into saying
 * different things about the same account state — which is exactly how a
 * lapsed subscriber ended up being told their free trial had ended.
 *
 * The `action` is what varies where the code does not: an empty balance
 * sends a Free account to subscribe (top-up packs are sold to live
 * subscribers only) and a subscriber to the top-up page.
 */
import { t, type AppLocale } from "@/lib/i18n";
import type { SpendRefusalAction, SpendRefusalCode } from "./spend";

export interface RefusalView {
  code: SpendRefusalCode;
  action: SpendRefusalAction;
  /** The one sentence the user reads. */
  message: string;
  /** The one button. */
  ctaLabel: string;
  /** Where that button goes (app-relative). */
  ctaPath: string;
}

const ACTION_PATH: Record<SpendRefusalAction, string> = {
  subscribe: "/subscribe",
  renew: "/subscribe",
  topup: "/console/billing",
  support: "/support",
};

/**
 * The message key. `insufficient_credits` splits by action because "you have
 * no credits" needs a different next step for an account that has never
 * subscribed than for one that has.
 */
function messageKey(code: SpendRefusalCode, action: SpendRefusalAction): string {
  if (code === "insufficient_credits") {
    return action === "subscribe"
      ? "billing.refusal.no_credits_free"
      : "billing.refusal.no_credits_pro";
  }
  return `billing.refusal.${code}`;
}

export function presentRefusal(
  locale: AppLocale,
  refusal: { code: SpendRefusalCode; action: SpendRefusalAction },
): RefusalView {
  return {
    code: refusal.code,
    action: refusal.action,
    message: t(locale, messageKey(refusal.code, refusal.action)),
    ctaLabel: t(locale, `billing.cta.${refusal.action}`),
    ctaPath: ACTION_PATH[refusal.action],
  };
}

/**
 * Why a BLOCKED account cannot use the product at all (suspended, or a
 * subscription that lapsed). Access gates need this before any operation is
 * even named, so it takes an entitlement rather than a spend decision.
 */
export function presentAccessBlock(
  locale: AppLocale,
  planStatus: string,
): RefusalView {
  const expired = planStatus === "expired";
  return presentRefusal(locale, {
    code: expired ? "subscription_expired" : "account_blocked",
    action: expired ? "renew" : "support",
  });
}
