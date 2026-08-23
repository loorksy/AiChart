/**
 * Start clean: every account back to FREE, with a fresh welcome balance.
 *
 * Run once when the platform goes live with real users, while everything on
 * it is still a test account. It is an explicit ADMIN action rather than a
 * boot migration for one reason: the welcome grant is a number the operator
 * sets in the panel, and a migration that ran at deploy time would hand out
 * whatever the column happened to default to (zero) before they ever saw the
 * field.
 *
 * What it does, per non-admin account:
 *   - plan back to `trial` (the stored name of FREE) with no expiry;
 *   - balance zeroed and the ledger cleared — including the old
 *     `signup_grant` row, which is what makes the account eligible again;
 *   - the CURRENT welcome grant re-issued, so a reset account starts exactly
 *     where a brand-new one does.
 *
 * Admin accounts are left alone: they are never charged, and zeroing the
 * operator's own row would only confuse the panel.
 */
import { execute, query } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { ensureSignupGrant } from "./signupGrant";
import { bustBillingConfigCache } from "./planConfig";

const log = createLogger("billing.reset");

export interface AccountResetResult {
  accounts: number;
  granted: number;
  grantEach: number;
}

export async function resetAllAccountsToFree(): Promise<AccountResetResult> {
  const users = await query<{ id: number }>(
    "SELECT id FROM users WHERE role != 'admin'",
  );

  // Subscriptions off, expiry cleared: everyone is Free again.
  await execute(
    `UPDATE user_entitlements
        SET plan_status = 'trial',
            subscription_expires_at = NULL,
            activated_at = NULL,
            activated_by = NULL
      WHERE user_id IN (SELECT id FROM users WHERE role != 'admin')`,
  );

  // Balances and history: gone. Deleting the ledger rows (the signup grant
  // included) is what lets the once-ever UNIQUE accept a fresh grant below.
  await execute(
    `DELETE FROM credit_entries
      WHERE user_id IN (SELECT id FROM users WHERE role != 'admin')`,
  );
  await execute(
    `UPDATE credit_accounts SET balance = 0
      WHERE user_id IN (SELECT id FROM users WHERE role != 'admin')`,
  );

  bustBillingConfigCache();

  let granted = 0;
  let grantEach = 0;
  for (const user of users) {
    const result = await ensureSignupGrant(user.id);
    grantEach = result.amount || grantEach;
    if (result.granted) granted += 1;
  }

  log.warn("all non-admin accounts reset to free", {
    accounts: users.length,
    granted,
    grantEach,
  });
  return { accounts: users.length, granted, grantEach };
}
